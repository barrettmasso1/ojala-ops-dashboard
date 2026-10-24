import copy,json,tempfile,time,types,unittest
from pathlib import Path
from datetime import datetime,timezone
from unittest.mock import patch
from native_photos import PhotoQueue,PROTOCOL,RECEIPT,photo_payload,validate_photo_receipt,safe_evidence,PhotoHttp
from native_sync import SyncError,ORIGIN
from ledger import canonical,digest,InvalidEvidence

def observation(index=1):
 raw=bytes([255,216,255])+b'PHOTO_UNIT_TEST_NOT_PRODUCTION'
 return {'observationId':digest('observation-'+str(index)),'deviceId':'device-fixture','businessDate':'2026-10-23','cameraName':'handoff','sourceEventId':'fixture-photo-'+str(index),'sourceFalsePositive':False,'verification':'same_frame_local_cv','sameFrameEvidence':{'imageSha256':digest(raw),'capturedAt':'2026-10-23T23:00:00+00:00'}}
def receipt(o):
 return {'protocol':RECEIPT,'persisted':True,'storeId':1,'deviceId':o['deviceId'],'businessDate':o['businessDate'],'cameraName':'handoff','observationId':o['observationId'],'sourceEventId':o['sourceEventId'],'imageSha256':o['sameFrameEvidence']['imageSha256'],'capturedAt':o['sameFrameEvidence']['capturedAt'],'evidenceOrigin':'verified_snapshot','eventId':123,'receivedAt':datetime.now(timezone.utc).isoformat(),'externalAiInvoked':False,'physicalDeliveryCountCreated':False,'countsAreSales':False}
class Fake:
 def __init__(self,o):self.o=o;self.saved=None;self.posts=0;self.reads=0;self.fail=None
 def capabilities(self):return {'protocol':PROTOCOL,'scopedByCredential':True,'browserRequired':False,'externalAiRequired':False,'requiresPersistedLocalObservation':True,'persistedReadbackRequired':True}
 def receipt(self,o):self.reads+=1;return self.saved
 def send(self,p):
  self.posts+=1
  if self.fail in ('http_401','http_403'):raise SyncError(self.fail)
  self.saved=receipt(self.o)
  if self.fail in ('http_409','http_500','network_or_response_uncertain'):raise SyncError(self.fail)
  return {'success':True,'receipt':self.saved}
class QueueTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'queue.db';self.q=PhotoQueue(self.path);self.o=observation();self.q.discover([self.o]);self.api=Fake(self.o);self.c={'networkEnabled':True,'storeId':1}
 def tearDown(self):self.q.close();self.temp.cleanup()
 def cycle(self):return self.q.cycle(self.api,self.c,lambda o:{'observationId':o['observationId']})
 def state(self):return dict(self.q.db.execute('SELECT * FROM photos').fetchone())
 def test_no_network_until_enabled(self):self.c['networkEnabled']=False;self.cycle();self.assertEqual(self.api.posts+self.api.reads,0)
 def test_receipt_preflight_prevents_duplicate(self):self.api.saved=receipt(self.o);self.cycle();self.assertEqual(self.api.posts,0);self.assertEqual(self.state()['status'],'acknowledged')
 def test_success_and_repeat_do_not_duplicate(self):self.cycle();self.cycle();self.assertEqual(self.api.posts,1);self.assertEqual(self.state()['status'],'acknowledged')
 def test_restart_keeps_receipt(self):self.cycle();self.q.close();self.q=PhotoQueue(self.path);self.cycle();self.assertEqual(self.api.posts,1)
 def test_discovery_does_not_reset_attempts(self):self.cycle();self.q.discover([self.o]);self.assertEqual(self.state()['attempts'],1)
 def test_excluded_reference_does_not_upload(self):self.o['ownerSizeReview']={'label':'not_cup'};self.q.discover([self.o]);self.cycle();self.assertEqual(self.api.posts,0)
 def test_rejected_source_does_not_upload(self):self.o['sourceFalsePositive']=True;self.q.discover([self.o]);self.cycle();self.assertEqual(self.api.posts,0)
 def test_same_observation_cannot_replace_image(self):
  self.o['sameFrameEvidence']['imageSha256']='f'*64
  with self.assertRaises(InvalidEvidence):self.q.discover([self.o])
 def test_conflict_is_read_back_not_replayed(self):
  self.api.fail='http_409';self.cycle();self.assertEqual(self.state()['status'],'delivery_unknown');self.cycle();self.assertEqual(self.state()['status'],'acknowledged');self.assertEqual(self.api.posts,1)
 def test_timeout_after_write_is_read_back(self):
  self.api.fail='network_or_response_uncertain';self.cycle();self.cycle();self.assertEqual(self.api.posts,1);self.assertEqual(self.state()['status'],'acknowledged')
 def test_server_error_after_write_is_read_back(self):
  self.api.fail='http_500';self.cycle();self.cycle();self.assertEqual(self.api.posts,1)
 def test_uncertain_absence_waits_before_resend(self):
  self.api.fail='http_409';self.cycle();self.api.saved=None;self.cycle();self.assertEqual(self.state()['status'],'delivery_unknown');self.assertEqual(self.api.posts,1)
 def test_retry_requires_two_settled_absences(self):
  self.api.fail='http_409';self.cycle();self.api.saved=None
  with patch('native_photos.time.time',return_value=time.time()+121):
   self.cycle();self.assertEqual(self.state()['status'],'delivery_unknown');self.cycle();self.assertEqual(self.state()['status'],'queued')
  self.assertEqual(self.api.posts,1)
 def test_three_attempt_limit_blocks_after_absence(self):
  self.api.fail='http_409';self.cycle();self.api.saved=None;self.q.db.execute('UPDATE photos SET attempts=3,dispatched=?',(time.time()-121,));self.q.db.commit();self.cycle();self.cycle();self.assertEqual(self.state()['status'],'blocked')
 def test_auth_rejection_holds_without_trying_next_photo(self):
  self.q.discover([observation(2)]);self.api.fail='http_403';x=self.cycle();self.assertEqual(x['status'],'authorization_hold');self.assertEqual(self.api.posts,1)
 def test_invalid_server_capability_does_not_read_credentials_or_upload(self):
  self.api.capabilities=lambda:{'protocol':'other'};self.cycle();self.assertEqual(self.api.posts+self.api.reads,0);self.assertEqual(self.state()['status'],'blocked')
 def test_missing_tenant_scope_capability_blocks_before_key_or_upload(self):
  caps=self.api.capabilities();caps.pop('scopedByCredential');self.api.capabilities=lambda:caps
  self.cycle();self.assertEqual(self.api.posts+self.api.reads,0);self.assertEqual(self.state()['status'],'blocked')
 def test_wrong_receipt_does_not_mark_success(self):
  self.api.saved=receipt(self.o);self.api.saved['imageSha256']='f'*64;self.cycle();self.assertEqual(self.state()['status'],'blocked');self.assertEqual(self.api.posts,0)
 def test_source_excluded_after_uncertain_upload_still_reconciles(self):
  self.api.fail='http_409';self.cycle();self.o['ownerSizeReview']={'label':'not_cup'};self.q.discover([self.o]);self.cycle();self.assertEqual(self.state()['status'],'acknowledged');self.assertEqual(self.api.posts,1)
 def test_foreign_origin_rejected(self):
  with self.assertRaises(InvalidEvidence):PhotoHttp('https://other.example',Path('/none'),1)
 def test_capabilities_do_not_read_key(self):
  h=PhotoHttp(ORIGIN,Path('/none'),1)
  with patch.object(h,'_key',side_effect=AssertionError('key access')),patch.object(h,'_request',return_value={}) as request:h.capabilities()
  self.assertEqual(request.call_args.args,('GET','frigate.localEvidenceCapabilities'))
 def test_receipt_wrong_tenant_is_rejected(self):
  r=receipt(self.o);r['storeId']=2
  with self.assertRaises(InvalidEvidence):validate_photo_receipt(r,self.o,1)
 def test_receipt_cannot_certify_count(self):
  r=receipt(self.o);r['physicalDeliveryCountCreated']=True
  with self.assertRaises(InvalidEvidence):validate_photo_receipt(r,self.o,1)
 def test_boolean_event_id_not_accepted(self):
  r=receipt(self.o);r['eventId']=True
  with self.assertRaises(InvalidEvidence):validate_photo_receipt(r,self.o,1)
class OriginalBytesTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.o=observation();self.image=bytes([255,216,255])+b'PHOTO_UNIT_TEST_NOT_PRODUCTION';zone={'polygon':[[.1,.2],[.8,.2],[.8,.9]]};self.geometry=canonical([{'x':.1,'y':.2},{'x':.8,'y':.2},{'x':.8,'y':.9}]);self.zonehash=digest(canonical(zone))
  self.meta={'schema_version':3,'camera':'handoff','cup_zone':'handoff_zone','cup_event_id':self.o['sourceEventId'],'captured_at_utc':self.o['sameFrameEvidence']['capturedAt'],'image_sha256':digest(self.image),'zone_geometry':zone,'zone_config_sha256':self.zonehash,'image_dimensions':{'width':1920,'height':1080}}
  self.raw=canonical(self.meta).encode();(self.root/'photo.jpg').write_bytes(self.image);(self.root/'sidecar.json').write_bytes(self.raw);self.o['sameFrameEvidence'].update(originalSidecarSha256=digest(self.raw),sourceZoneSha256=self.zonehash,storedImageRelativePath='photo.jpg',storedSidecarRelativePath='sidecar.json')
  self.module=patch.dict('sys.modules',{'handoff_visual_sender':types.SimpleNamespace(normalize_capture_zone=lambda *a:(self.geometry,self.zonehash))});self.module.start()
 def tearDown(self):self.module.stop();self.temp.cleanup()
 def test_preserves_source_image_and_metadata_bytes(self):
  import base64
  p=photo_payload(self.o,self.root,self.root,'America/Mazatlan');self.assertEqual(base64.b64decode(p['imageDataUrl'].split(',')[1]),self.image);self.assertEqual(p['normalizationProof']['sourceMetadataJson'].encode(),self.raw);self.assertEqual(p['capture']['cup_event_id'],self.o['sourceEventId'])
 def test_tampered_photo_rejected(self):
  (self.root/'photo.jpg').write_bytes(self.image+b'bad')
  with self.assertRaises(InvalidEvidence):photo_payload(self.o,self.root,self.root,'America/Mazatlan')
 def test_symlink_not_read(self):
  (self.root/'linked.jpg').symlink_to(self.root/'photo.jpg');self.o['sameFrameEvidence']['storedImageRelativePath']='linked.jpg'
  with self.assertRaises(InvalidEvidence):photo_payload(self.o,self.root,self.root,'America/Mazatlan')
 def test_traversal_not_read(self):
  with self.assertRaises(InvalidEvidence):safe_evidence(self.root,'../../etc/passwd','a'*64,999999)
 def test_metadata_hash_not_recomputed_to_hide_changes(self):
  (self.root/'sidecar.json').write_text('{}')
  with self.assertRaises(InvalidEvidence):photo_payload(self.o,self.root,self.root,'America/Mazatlan')
 def test_configured_tenant_timezone_not_hardcoded(self):
  self.o['businessDate']='2026-10-24'
  p=photo_payload(self.o,self.root,self.root,'Asia/Tokyo');self.assertEqual(p['businessDate'],'2026-10-24')
 def test_wrong_tenant_day_rejected(self):
  with self.assertRaisesRegex(InvalidEvidence,'photo_day_mismatch'):photo_payload(self.o,self.root,self.root,'Asia/Tokyo')
 def test_missing_timezone_rejected(self):
  with self.assertRaisesRegex(InvalidEvidence,'timezone_required'):photo_payload(self.o,self.root,self.root,None)

if __name__=='__main__':unittest.main()
