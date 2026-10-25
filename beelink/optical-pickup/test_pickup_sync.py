import copy,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from datetime import datetime,timezone
from pickup_sync import Sync,RECEIPT,check_receipt
from pickup_core import PROTOCOL,digest
from test_pickup_core import P

def document():return {'protocol':PROTOCOL,'deviceId':P['deviceId'],'cameraName':'handoff','businessDate':'2026-10-25','records':[]}
class Transport:
 def __init__(self):self.saved=None;self.posts=0;self.reads=0;self.failure=None
 def capabilities(self):return {'protocol':PROTOCOL,'receiptProtocol':RECEIPT,'credentialScoped':True,'browserRequired':False,'externalAiRequired':False,'requiresPersistedLocalObservation':True,'persistedReadbackRequired':True,'createsSales':False,'createsReviewedPhysicalCounts':False}
 def receipt(self,device,day):self.reads+=1;return self.saved
 def send(self,e):
  self.posts+=1
  if self.failure=='http_403':raise ValueError('http_403')
  d=json.loads(e['documentJson']);self.saved={'protocol':RECEIPT,'persisted':True,'partial':True,'countsAreSales':False,'physicalUniqueCountCertified':False,'externalAiInvoked':False,'requiredHumanAction':False,'storeId':1,'deviceId':P['deviceId'],'businessDate':d['businessDate'],'cameraName':'handoff','sequence':e['sequence'],'documentSha256':e['documentSha256'],'recordsPersisted':len(d['records']),'receivedAt':datetime.now(timezone.utc).isoformat()}
  if self.failure=='after_persist':raise ValueError('network_or_response_uncertain')
  return {'success':True,'receipt':self.saved}
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'sync.sqlite3';self.c={'networkEnabled':True,'storeId':1,'deviceId':P['deviceId']};self.t=Transport();self.s=Sync(self.path,self.c,self.t)
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def test_disabled_never_posts(self):self.c['networkEnabled']=False;self.assertEqual(self.s.cycle(document())['status'],'disabled');self.assertEqual(self.t.posts,0)
 def test_conditional_first_create_does_not_require_nonexistent_read(self):self.assertEqual(self.s.cycle(document())['status'],'acknowledged');self.assertEqual(self.t.posts,1);self.assertEqual(self.t.reads,0)
 def test_unchanged_snapshot_not_sent_twice(self):self.s.cycle(document());self.s.cycle(document());self.assertEqual(self.t.posts,1)
 def test_three_consecutive_snapshots_preserve_revisions(self):
  for n in range(3):
   d=document();d['fixtureRevision']=n;r=self.s.cycle(d);self.assertEqual(r['status'],'acknowledged');self.assertEqual(r['sequence'],n+1)
  self.assertEqual(self.t.posts,3)
 def test_uncertain_write_reads_before_resending(self):
  self.t.failure='after_persist';self.assertEqual(self.s.cycle(document())['status'],'delivery_unknown');self.assertEqual(self.s.cycle(document())['status'],'acknowledged');self.assertEqual(self.t.posts,1)
 def test_restart_preserves_unknown_write(self):
  self.t.failure='after_persist';self.s.cycle(document());self.s.close();self.s=Sync(self.path,self.c,self.t);self.assertEqual(self.s.cycle(document())['status'],'acknowledged');self.assertEqual(self.t.posts,1)
 def test_wrong_tenant_receipt_blocks(self):
  self.t.failure='after_persist';self.s.cycle(document());self.t.saved['storeId']=2;self.assertEqual(self.s.cycle(document())['status'],'blocked');self.assertEqual(self.t.posts,1)
 def test_wrong_hash_receipt_blocks(self):
  self.t.failure='after_persist';self.s.cycle(document());self.t.saved['documentSha256']='0'*64;self.assertEqual(self.s.cycle(document())['status'],'blocked')
 def test_human_required_receipt_is_not_success(self):
  self.t.failure='after_persist';self.s.cycle(document());self.t.saved['requiredHumanAction']=True;self.assertEqual(self.s.cycle(document())['status'],'blocked')
 def test_generative_receipt_rejected(self):
  self.t.failure='after_persist';self.s.cycle(document());self.t.saved['externalAiInvoked']=True;self.assertEqual(self.s.cycle(document())['status'],'blocked')
 def test_403_hold_is_not_blindly_replayed(self):
  self.t.failure='http_403';self.assertEqual(self.s.cycle(document())['status'],'blocked');self.s.cycle(document());self.assertEqual(self.t.posts,1)
 def test_uncertain_without_receipt_never_blind_posts(self):
  self.t.failure='after_persist';self.s.cycle(document());self.t.saved=None
  for _ in range(6):self.s.cycle(document())
  self.assertEqual(self.t.posts,1)
if __name__=='__main__':unittest.main()
