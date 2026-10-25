import copy,json,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
from directional_core import Counter,canonical,digest,iso
from directional_sync import Sync,PROTOCOL,RECEIPT,check_receipt
from test_directional_core import policy,packet,evidence,DEVICE

class Fake:
 def __init__(self):self.posts=0;self.reads=0;self.saved=None;self.fail=None
 def capabilities(self):
  return {'protocol':PROTOCOL,'receiptProtocol':RECEIPT,'credentialScoped':True,'browserRequired':False,'externalAiRequired':False,'requiresPersistedLocalObservation':True,'persistedReadbackRequired':True,'createsSales':False,'createsReviewedPhysicalCounts':False}
 def receipt(self,*_):self.reads+=1;return copy.deepcopy(self.saved)
 def send(self,envelope):
  self.posts+=1
  if self.fail=='before':raise ValueError('network_or_response_uncertain')
  if self.fail=='auth':raise ValueError('http_401')
  d=json.loads(envelope['documentJson']);sizes=dict.fromkeys(['chico','mediano','pint','litro','unknown'],0);events=[r for r in d['records'] if r['status']=='estimated']
  for r in events:sizes[r['size']]+=1
  self.saved={'protocol':RECEIPT,'persisted':True,'storeId':1,'deviceId':DEVICE,'businessDate':d['businessDate'],'cameraName':'handoff','sequence':envelope['sequence'],'documentSha256':envelope['documentSha256'],'receivedAt':iso(time.time()),'recordsPersisted':len(d['records']),'estimatedHandoffs':len(events) if d['windows'] else None,'sizeBreakdown':sizes if d['windows'] else None,'observedFrom':d['windows'][0]['from'] if d['windows'] else None,'observedUntil':d['windows'][-1]['until'] if d['windows'] else None,'partial':True,'countsAreSales':False,'physicalUniqueCountCertified':False,'externalAiInvoked':False,'requiredHumanAction':False}
  if self.fail=='after':raise ValueError('http_409')
  if self.fail=='size':self.saved['sizeBreakdown']['chico']=99
  if self.fail=='store':self.saved['storeId']=2
  if self.fail=='hash':self.saved['documentSha256']='f'*64
  return {'success':True,'receipt':copy.deepcopy(self.saved)}

class SyncTests(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory();self.root=Path(self.t.name);self.counter=Counter(self.root/'count.sqlite3',policy());self.config={'networkEnabled':True,'storeId':1,'deviceId':DEVICE};self.api=Fake();self.sync=Sync(self.root/'sync.sqlite3',self.config,self.api)
  for i,w in enumerate(['origin']*2+['handoff']*2+['destination']*2):p=packet(i,w);self.counter.ingest_frame(p,p['frameAt'])
  self.counter.reconcile([evidence(size='mediano')]);self.doc=self.counter.document('2026-10-24')
 def tearDown(self):self.sync.close();self.counter.close();self.t.cleanup()
 def test_receipt_based_not_simply_http_success(self):self.assertEqual(self.sync.cycle(self.doc)['status'],'acknowledged');self.assertEqual(self.api.posts,1)
 def test_no_duplicate_send(self):
  self.sync.cycle(self.doc);self.assertFalse(self.sync.cycle(self.doc)['networkAttempted']);self.assertEqual(self.api.posts,1)
 def test_no_network_when_disabled(self):
  self.config['networkEnabled']=False;self.assertEqual(self.sync.cycle(self.doc)['status'],'disabled');self.assertEqual(self.api.posts+self.api.reads,0)
 def test_contract_not_ready_no_write(self):
  self.api.capabilities=lambda:{};self.assertEqual(self.sync.cycle(self.doc)['status'],'pending');self.assertEqual(self.api.posts,0)
 def test_scoped_contract_required(self):
  caps=self.api.capabilities();caps['credentialScoped']=False;self.api.capabilities=lambda:caps;self.assertEqual(self.sync.cycle(self.doc)['status'],'blocked');self.assertEqual(self.api.posts,0)
 def test_conflict_after_actual_save_reads_receipt_not_resends(self):
  self.api.fail='after';self.assertEqual(self.sync.cycle(self.doc)['status'],'delivery_unknown');self.assertEqual(self.sync.cycle(self.doc)['status'],'acknowledged');self.assertEqual(self.api.posts,1)
 def test_missing_receipt_waits_no_blind_retry(self):
  self.api.fail='before';self.sync.cycle(self.doc)
  for _ in range(3):self.assertEqual(self.sync.cycle(self.doc)['status'],'delivery_unknown')
  self.assertEqual(self.api.posts,1)
 def test_uncertain_snapshot_not_replaced_with_new_data(self):
  self.api.fail='before';self.sync.cycle(self.doc);old=self.sync.db.execute('SELECT document_sha FROM outbox').fetchone()[0]
  changed=copy.deepcopy(self.doc);changed['windows'][-1]['frames']+=1;self.sync.cycle(changed);self.assertEqual(self.sync.db.execute('SELECT document_sha FROM outbox').fetchone()[0],old)
 def test_401_not_retried(self):
  self.api.fail='auth';self.assertEqual(self.sync.cycle(self.doc)['status'],'blocked');self.assertFalse(self.sync.cycle(self.doc)['networkAttempted']);self.assertEqual(self.api.posts,1)
 def test_wrong_store_no_ack(self):
  self.api.fail='store';self.assertEqual(self.sync.cycle(self.doc)['status'],'blocked')
 def test_wrong_hash_no_ack(self):
  self.api.fail='hash';self.assertEqual(self.sync.cycle(self.doc)['status'],'blocked')
 def test_size_totals_recomputed(self):
  self.api.fail='size';self.assertEqual(self.sync.cycle(self.doc)['status'],'blocked')
 def test_new_observed_interval_updates_sequence(self):
  self.sync.cycle(self.doc);d=copy.deepcopy(self.doc);d['windows'][-1]['frames']+=1;r=self.sync.cycle(d);self.assertEqual(r['status'],'acknowledged');self.assertEqual(r['sequence'],2)
 def test_restart_preserves_ack(self):
  self.sync.cycle(self.doc);self.sync.close();self.sync=Sync(self.root/'sync.sqlite3',self.config,self.api);self.assertFalse(self.sync.cycle(self.doc)['networkAttempted']);self.assertEqual(self.api.posts,1)
 def test_restart_unknown_reads_without_post(self):
  self.api.fail='after';self.sync.cycle(self.doc);self.sync.close();self.sync=Sync(self.root/'sync.sqlite3',self.config,self.api);self.assertEqual(self.sync.cycle(self.doc)['status'],'acknowledged');self.assertEqual(self.api.posts,1)
 def test_zero_only_for_observed_interval(self):
  d=copy.deepcopy(self.doc);d['records']=[];self.sync.cycle(d);self.assertEqual(self.api.saved['estimatedHandoffs'],0);self.assertTrue(self.api.saved['partial'])
 def test_no_observation_remains_null(self):
  d=copy.deepcopy(self.doc);d['records']=[];d['windows']=[];self.sync.cycle(d);self.assertIsNone(self.api.saved['estimatedHandoffs']);self.assertIsNone(self.api.saved['sizeBreakdown'])
 def test_manual_approval_required_receipt_not_accepted(self):
  self.sync.cycle(self.doc);r=copy.deepcopy(self.api.saved);r['requiredHumanAction']=True;e={'sequence':1,'documentJson':canonical(self.doc),'documentSha256':digest(canonical(self.doc))}
  with self.assertRaises(ValueError):check_receipt(r,e,self.config)
 def test_payment_claim_not_accepted(self):
  self.sync.cycle(self.doc);r=copy.deepcopy(self.api.saved);r['countsAreSales']=True;e={'sequence':1,'documentJson':canonical(self.doc),'documentSha256':digest(canonical(self.doc))}
  with self.assertRaises(ValueError):check_receipt(r,e,self.config)
 def test_delayed_old_receipt_not_success_for_current(self):
  self.sync.cycle(self.doc);old=copy.deepcopy(self.api.saved);d=copy.deepcopy(self.doc);d['windows'][-1]['frames']+=1;self.api.fail='before';self.sync.cycle(d)
  for _ in range(3):self.assertEqual(self.sync.cycle(d)['status'],'delivery_unknown')
  self.assertEqual(self.api.posts,2)
 def test_stale_receipt_blocks_after_grace_without_retry(self):
  self.api.fail='before';self.sync.cycle(self.doc)
  with patch('directional_sync.time.time',return_value=time.time()+121):
   for _ in range(6):r=self.sync.cycle(self.doc)
  self.assertEqual(r['status'],'blocked');self.assertEqual(self.api.posts,1)
if __name__=='__main__':unittest.main()
