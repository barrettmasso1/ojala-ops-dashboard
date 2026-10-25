import copy,json,sqlite3,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
from native_photos import PhotoQueue
from native_photo_validation import AutomaticPhotoValidation,PROTOCOL,validation_state
from native_sync import SyncError
from ledger import canonical,InvalidEvidence
from test_native_photos import observation,receipt

class Fake:
 def __init__(self,o):
  self.o=o;self.saved=receipt(o);self.saved['analysisStatus']='pending_review';self.posts=0;self.reads=0;self.fail=None;self.keys=0;self.payload=None
 def capabilities(self):return {'automaticValidationProtocol':PROTOCOL,'humanApprovalRequired':False,'scopedByCredential':True,'externalAiRequired':False,'browserRequired':False}
 def receipt(self,o):self.reads+=1;return copy.deepcopy(self.saved)
 def _key(self):self.keys+=1;return 'fixture-key-not-real'
 def _request(self,method,path,payload):
  self.posts+=1;self.payload=payload
  if self.fail in ('http_401','http_403','http_429'):raise SyncError(self.fail)
  if self.fail=='timeout_before_persist':raise SyncError('network_or_response_uncertain')
  self.saved['analysisStatus']='approved_by_ai';self.saved.update(unreviewed=True,reviewedAt=None,reviewedByUserId=None)
  self.saved['automaticValidation']={'protocol':PROTOCOL,'status':'verified','requiredHumanAction':False,'method':'persisted_local_cv_proof','analysisModel':'ojala_local_cv_proof_v1','validatedAt':self.saved['receivedAt'],'externalAiInvoked':False,'observationId':self.o['observationId'],'imageSha256':self.o['sameFrameEvidence']['imageSha256']}
  if self.fail in ('http_409','network_or_response_uncertain'):raise SyncError(self.fail)
  return {'success':True,'receipt':copy.deepcopy(self.saved)}

class AutomaticVerificationTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'photos.db';self.q=PhotoQueue(self.path);self.o=observation();self.q.discover([self.o]);self.api=Fake(self.o);self.q.acknowledge(self.o,self.api.saved,1);self.v=AutomaticPhotoValidation(self.q.db);self.config={'networkEnabled':True,'automaticValidationEnabled':True,'storeId':1}
 def tearDown(self):self.q.close();self.temp.cleanup()
 def cycle(self):return self.v.cycle(self.api,self.config)
 def state(self):return dict(self.q.db.execute('SELECT * FROM photo_auto_validation').fetchone())
 def test_disabled_does_not_read_or_send(self):
  self.config['automaticValidationEnabled']=False;self.cycle();self.assertEqual(self.api.posts+self.api.reads,0)
 def test_disabled_network_does_not_touch_credentials(self):
  self.config['networkEnabled']=False;self.cycle();self.assertEqual(self.api.keys,0)
 def test_valid_existing_photo_automatically_finalized(self):
  r=self.cycle();self.assertEqual(self.state()['status'],'verified');self.assertEqual(self.api.posts,1);self.assertTrue(r['results'][0]['readbackVerified'])
 def test_metadata_only_finalization_never_includes_image_or_count(self):
  self.cycle();self.assertEqual(set(self.api.payload),{'apiKey','deviceId','businessDate','observationId'})
 def test_repeated_cycle_does_not_reapprove(self):
  self.cycle();self.cycle();self.assertEqual(self.api.posts,1)
 def test_preapproved_local_receipt_needs_no_mutation(self):
  self.api._request('POST','fixture',{});self.api.posts=0;self.cycle();self.assertEqual(self.api.posts,0);self.assertEqual(self.state()['status'],'verified')
 def test_manual_approval_preserved_without_finalization(self):
  self.api.saved['analysisStatus']='approved_by_manager';self.cycle();self.assertEqual(self.api.posts,0);self.assertEqual(self.state()['status'],'preserved_manual')
 def test_manual_discard_preserved_without_finalization(self):
  self.api.saved['analysisStatus']='discarded_by_manager';self.cycle();self.assertEqual(self.api.posts,0);self.assertEqual(self.state()['status'],'preserved_manual')
 def test_false_positive_not_approved(self):
  self.o['sourceFalsePositive']=True;self.q.discover([self.o]);self.cycle();self.assertEqual(self.api.posts+self.api.reads,0);self.assertEqual(self.state()['status'],'excluded')
 def test_owner_noncup_not_approved(self):
  self.o['ownerSizeReview']={'label':'not_cup'};self.q.discover([self.o]);self.cycle();self.assertEqual(self.state()['status'],'excluded')
 def test_unacknowledged_images_not_seeded(self):
  self.q.db.execute("UPDATE photos SET status='queued'");self.q.db.commit();self.cycle();self.assertEqual(self.v.states(),{});self.assertEqual(self.api.posts,0)
 def test_original_upload_receipt_and_attempts_unchanged(self):
  before=dict(self.q.db.execute('SELECT * FROM photos').fetchone());self.cycle();after=dict(self.q.db.execute('SELECT * FROM photos').fetchone());self.assertEqual(before,after)
 def test_restart_keeps_automatic_receipt_without_replay(self):
  self.cycle();self.q.close();self.q=PhotoQueue(self.path);self.v=AutomaticPhotoValidation(self.q.db);self.cycle();self.assertEqual(self.api.posts,1)
 def test_lost_response_is_read_back_not_replayed(self):
  self.api.fail='network_or_response_uncertain';self.cycle();self.assertEqual(self.state()['status'],'unknown');self.cycle();self.assertEqual(self.state()['status'],'verified');self.assertEqual(self.api.posts,1)
 def test_conflict_after_persist_is_read_back(self):
  self.api.fail='http_409';self.cycle();self.cycle();self.assertEqual(self.api.posts,1);self.assertEqual(self.state()['status'],'verified')
 def test_unknown_write_waits_before_retry(self):
  self.api.fail='timeout_before_persist';self.cycle();self.cycle();self.cycle();self.assertEqual(self.api.posts,1);self.assertEqual(self.state()['status'],'unknown')
 def test_retry_requires_two_settled_negative_readbacks(self):
  self.api.fail='timeout_before_persist';self.cycle()
  with patch('native_photo_validation.time.time',return_value=time.time()+121):self.cycle();self.assertEqual(self.state()['status'],'unknown');self.cycle();self.assertEqual(self.state()['status'],'pending')
  self.assertEqual(self.api.posts,1)
 def test_three_attempts_then_block_no_blind_loop(self):
  self.api.fail='timeout_before_persist';self.cycle();self.q.db.execute('UPDATE photo_auto_validation SET attempts=3,dispatched=?',(time.time()-121,));self.q.db.commit();self.cycle();self.cycle();self.assertEqual(self.state()['status'],'blocked');self.assertEqual(self.api.posts,1)
 def test_auth_failure_holds(self):
  self.api.fail='http_403';r=self.cycle();self.assertEqual(r['status'],'authorization_hold');self.assertEqual(self.state()['status'],'blocked')
 def test_capability_gate_checks_before_credential_access(self):
  self.api.capabilities=lambda:{};r=self.cycle();self.assertEqual(self.api.keys+self.api.posts+self.api.reads,0);self.assertEqual(r['status'],'contract_unavailable')
 def test_wrong_tenant_never_approved(self):
  self.api.saved['storeId']=2;self.cycle();self.assertEqual(self.state()['status'],'blocked');self.assertEqual(self.api.posts,0)
 def test_wrong_image_hash_never_approved(self):
  self.api.saved['imageSha256']='f'*64;self.cycle();self.assertEqual(self.state()['status'],'blocked');self.assertEqual(self.api.posts,0)
 def test_missing_remote_photo_never_reuploaded(self):
  self.api.saved=None;self.cycle();self.assertEqual(self.state()['status'],'blocked');self.assertEqual(self.api.posts,0)
 def test_external_ai_receipt_not_accepted(self):
  self.api.saved['externalAiInvoked']=True;self.cycle();self.assertEqual(self.state()['status'],'blocked')
 def test_invalid_protocol_not_a_positive_validation(self):
  self.api._request('POST','fixture',{});self.api.saved['automaticValidation']['protocol']='other';self.api.posts=0;self.cycle();self.assertEqual(self.state()['status'],'blocked');self.assertEqual(self.api.posts,0)
 def test_human_gate_not_an_automatic_result(self):
  self.api._request('POST','fixture',{});self.api.saved['automaticValidation']['requiredHumanAction']=True;self.cycle();self.assertEqual(self.state()['status'],'blocked')
 def test_forged_child_binding_rejected(self):
  self.api._request('POST','fixture',{});self.api.saved['automaticValidation']['observationId']='f'*64;self.cycle();self.assertEqual(self.state()['status'],'blocked')
 def test_rate_limited_finalize_remains_pending(self):
  self.api.fail='http_429';self.cycle();self.assertEqual(self.state()['status'],'pending')
 def test_real_manager_race_preserves_later_decision(self):
  original=self.api._request
  def race(*a):
   r=original(*a);self.api.saved['analysisStatus']='discarded_by_manager';return r
  self.api._request=race;self.cycle();self.assertEqual(self.state()['status'],'preserved_manual')
 def test_backfill_does_not_modify_ledger_or_create_sales_tables(self):
  self.cycle();tables={r[0] for r in self.q.db.execute("SELECT name FROM sqlite_master WHERE type='table'")};self.assertEqual(tables,{'photos','photo_auto_validation'})

 def test_nonobject_validation_receipt_is_blocked_not_a_worker_crash(self):
  self.api.saved['automaticValidation']='invalid';self.cycle();self.assertEqual(self.state()['status'],'blocked')
 def test_missing_protocol_with_verified_status_is_not_accepted(self):
  self.api.saved['analysisStatus']='approved_by_ai';self.api.saved['automaticValidation']={'status':'verified','requiredHumanAction':False};self.cycle();self.assertEqual(self.state()['status'],'blocked')
 def test_not_sufficient_to_set_approved_enum_without_proof(self):
  self.api.saved['analysisStatus']='approved_by_ai';self.api.fail='http_409';self.cycle();self.assertNotEqual(self.state()['status'],'verified')

if __name__=='__main__':unittest.main()
