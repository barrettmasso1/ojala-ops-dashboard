import copy,json,tempfile,time,unittest
from pathlib import Path
from datetime import datetime,timezone
from unittest.mock import patch
from ledger import Ledger,InvalidEvidence
from native_sync import Sync,SyncError,NativeHttp,PROTOCOL,RECEIPT,ORIGIN,validate_receipt
from test_ledger import track,START

class FakeNative:
    def __init__(self):self.sends=0;self.reads=0;self.caps=0;self.saved=None;self.fail=None;self.after_send=None;self.external=False
    def capabilities(self):
        self.caps+=1
        return {'protocol':PROTOCOL,'externalAiRequired':self.external,'browserRequired':False,'scopedByCredential':True,'persistedReadbackRequired':True}
    def send(self,e):
        self.sends+=1;d=json.loads(e['documentJson'])
        if self.fail=='http_403':raise SyncError('http_403')
        self.saved={'protocol':RECEIPT,'persisted':True,'storeId':1,'deviceId':d['deviceId'],'businessDate':d['businessDate'],'cameraName':'handoff','sequence':e['sequence'],'documentSha256':e['documentSha256'],'receivedAt':datetime.now(timezone.utc).isoformat(),'observationsPersisted':len(d['records']),'externalAiInvoked':False,'physicalDeliveryCountCreated':False,'countsAreSales':False}
        if self.after_send:self.after_send()
        if self.fail=='timeout_after_persist':raise SyncError('network_or_response_uncertain')
        if self.fail=='wrong_hash':self.saved['documentSha256']='f'*64
        if self.fail=='not_persisted':self.saved['persisted']=False
        return {'success':True,'receipt':self.saved}
    def receipt(self,device,day):self.reads+=1;return self.saved

class NativeSyncTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'ledger.sqlite3';self.ledger=Ledger(self.path)
        self.ledger.put(track());self.api=FakeNative();self.config={'networkEnabled':True,'deviceId':'device-test','storeId':1};self.sync=Sync(self.ledger,self.config,self.api)
    def tearDown(self):self.ledger.close();self.tmp.cleanup()
    def test_disabled_performs_no_network(self):
        self.config['networkEnabled']=False;r=self.sync.cycle('2026-10-22');self.assertFalse(r['networkAttempted']);self.assertEqual(self.api.caps+self.api.sends,0)
    def test_native_success_marks_only_matching_revision(self):
        r=self.sync.cycle('2026-10-22');self.assertEqual(r['status'],'acknowledged');self.assertEqual(self.ledger.snapshot('2026-10-22')['outboxStates'],{'acknowledged':1})
    def test_unchanged_day_not_resent(self):
        self.sync.cycle('2026-10-22');self.sync.cycle('2026-10-22');self.assertEqual(self.api.sends,1)
    def test_restart_preserves_receipt(self):
        self.sync.cycle('2026-10-22');self.ledger.close();self.ledger=Ledger(self.path);self.sync=Sync(self.ledger,self.config,self.api)
        self.sync.cycle('2026-10-22');self.assertEqual(self.api.sends,1)
    def test_model_api_required_by_server_fails_closed(self):
        self.api.external=True;r=self.sync.cycle('2026-10-22');self.assertEqual(r['status'],'blocked');self.assertEqual(self.api.sends,0)
    def test_403_is_not_retried(self):
        self.api.fail='http_403';self.sync.cycle('2026-10-22');r=self.sync.cycle('2026-10-22');self.assertEqual(self.api.sends,1);self.assertFalse(r['networkAttempted'])
    def test_timeout_reconciles_without_second_send(self):
        self.api.fail='timeout_after_persist';r=self.sync.cycle('2026-10-22');self.assertEqual(r['status'],'delivery_unknown')
        r=self.sync.cycle('2026-10-22');self.assertEqual(r['status'],'acknowledged');self.assertEqual(self.api.sends,1);self.assertEqual(self.api.reads,1)
    def test_unknown_without_receipt_does_not_resend(self):
        self.api.fail='timeout_after_persist';self.sync.cycle('2026-10-22');self.api.saved=None
        for _ in range(3):r=self.sync.cycle('2026-10-22')
        self.assertEqual(r['status'],'delivery_unknown');self.assertEqual(self.api.sends,1)
    def test_mismatching_hash_does_not_ack(self):
        self.api.fail='wrong_hash';r=self.sync.cycle('2026-10-22');self.assertEqual(r['status'],'blocked');self.assertEqual(self.ledger.snapshot('2026-10-22')['outboxStates'],{'pending':1})
    def test_accepted_is_not_persisted(self):
        self.api.fail='not_persisted';r=self.sync.cycle('2026-10-22');self.assertEqual(r['status'],'blocked')
    def test_new_track_new_snapshot_no_loss(self):
        self.sync.cycle('2026-10-22');self.ledger.put(track(2));r=self.sync.cycle('2026-10-22');self.assertEqual(r['sequence'],2);self.assertEqual(r['receipt']['observationsPersisted'],2)
    def test_source_update_during_request_not_falsely_acked(self):
        self.api.after_send=lambda:self.ledger.put(track(end=START+10));self.sync.cycle('2026-10-22')
        self.assertEqual(self.ledger.snapshot('2026-10-22')['outboxStates'],{'pending':1})
        self.api.after_send=None;r=self.sync.cycle('2026-10-22');self.assertEqual(r['sequence'],2)
    def test_no_physical_delivery_written(self):
        r=self.sync.cycle('2026-10-22');self.assertFalse(r['receipt']['physicalDeliveryCountCreated']);self.assertIsNone(self.ledger.snapshot('2026-10-22')['uniquePhysicalDeliveries'])
    def test_foreign_origin_rejected_before_key_read(self):
        with self.assertRaisesRegex(InvalidEvidence,'unapproved_api_origin'):NativeHttp('https://other.example',Path('/does-not-exist'),1)
    def test_capabilities_does_not_read_credentials(self):
        http=NativeHttp(ORIGIN,Path('/does-not-exist'),1)
        with patch.object(http,'_request',return_value={}) as request,patch.object(http,'_key',side_effect=AssertionError('secret read')):http.capabilities()
        self.assertEqual(request.call_args.args[0],'GET')
    def test_key_is_body_not_url_parameter(self):
        http=NativeHttp(ORIGIN,Path('/does-not-exist'),1)
        with patch.object(http,'_request',return_value={}) as request,patch.object(http,'_key',return_value='UNIT_TEST_NOT_A_SECRET'):
            http.send({'sequence':1,'documentJson':'{}','documentSha256':'a'*64})
        self.assertEqual(request.call_args.args[1],'frigate.submitLocalCupLedger');self.assertNotIn('?',request.call_args.args[1])
    def test_receipt_wrong_store_rejected(self):
        e,_=self.sync.prepare('2026-10-22');r=self.api.send(e)['receipt'];r['storeId']=2
        with self.assertRaisesRegex(InvalidEvidence,'receipt_identity_storeId'):validate_receipt(r,e,1,'device-test','2026-10-22')
    def test_receipt_wrong_date_rejected(self):
        e,_=self.sync.prepare('2026-10-22');r=self.api.send(e)['receipt'];r['businessDate']='2026-10-21'
        with self.assertRaisesRegex(InvalidEvidence,'receipt_identity_businessDate'):validate_receipt(r,e,1,'device-test','2026-10-22')
    def test_boolean_count_rejected(self):
        e,_=self.sync.prepare('2026-10-22');r=self.api.send(e)['receipt'];r['observationsPersisted']=True
        with self.assertRaisesRegex(InvalidEvidence,'receipt_identity_observationsPersisted'):validate_receipt(r,e,1,'device-test','2026-10-22')
    def test_absence_requires_grace_and_two_readbacks_before_retry(self):
        self.api.fail='timeout_after_persist';self.sync.cycle('2026-10-22');self.api.saved=None
        future=time.time()+121
        with patch('native_sync.time.time',return_value=future):
            first=self.sync.cycle('2026-10-22');self.assertEqual(first['status'],'delivery_unknown')
            second=self.sync.cycle('2026-10-22');self.assertEqual(second['status'],'pending');self.assertFalse(second['resent'])
            self.api.fail=None;final=self.sync.cycle('2026-10-22');self.assertEqual(final['status'],'acknowledged')
        self.assertEqual(self.api.sends,2)
    def test_absence_retry_limit_is_bounded(self):
        self.api.fail='timeout_after_persist';self.sync.cycle('2026-10-22');self.api.saved=None
        self.ledger.db.execute('UPDATE native_sync SET attempts=3,dispatched_at=?',(time.time()-121,));self.ledger.db.commit()
        self.sync.cycle('2026-10-22');result=self.sync.cycle('2026-10-22')
        self.assertEqual(result['status'],'blocked');self.sync.cycle('2026-10-22');self.assertEqual(self.api.sends,1)
    def test_receipt_found_after_timeout_never_requires_replay(self):
        self.api.fail='timeout_after_persist';self.sync.cycle('2026-10-22')
        with patch('native_sync.time.time',return_value=time.time()+121):result=self.sync.cycle('2026-10-22')
        self.assertEqual(result['status'],'acknowledged');self.assertEqual(self.api.sends,1)
    def test_new_evidence_kept_while_transport_held(self):
        self.api.fail='http_403';self.sync.cycle('2026-10-22');self.ledger.put(track(2));self.sync.cycle('2026-10-22')
        self.assertEqual(self.ledger.snapshot('2026-10-22')['detectorTracksRecorded'],2);self.assertEqual(self.api.sends,1)

if __name__=='__main__':unittest.main()
