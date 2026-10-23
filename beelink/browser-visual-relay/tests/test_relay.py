import unittest,sys,json,copy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from browser_visual_relay import check_receipt,RelayError,BROWSER_SCRIPT,ORIGIN,Browser

class ReceiptTests(unittest.TestCase):
 def setUp(self):
  self.capture={'cup_event_id':'fixture-only-event-1234','camera':'handoff','captured_at_utc':'2026-10-22T23:15:57.123469Z','image_sha256':'a'*64,'zone_config_sha256':'b'*64}
  self.item={'capture':self.capture}
  self.row={'id':123,'storeId':1,'businessDate':'2026-10-22','cameraName':'handoff','cupEventId':self.capture['cup_event_id'],'imageSha256':'a'*64,'evidenceOrigin':'verified_snapshot','captureMetadataJson':json.dumps(self.capture),'imageKey':'fixture-only/reference'}
  self.result={'status':'persisted','row':self.row,'persistedImageSha256':'a'*64,'imageContentHashDownloaded':False,'automaticDirectPushVerified':False,'physicalCupCountCreated':False}
 def check(self):return check_receipt(self.result,self.item,'2026-10-22')
 def test_valid_is_image_receipt_only(self):self.assertEqual(self.check()['id'],123)
 def test_wrong_store_rejected(self):
  self.row['storeId']=2
  with self.assertRaises(RelayError):self.check()
 def test_wrong_date_rejected(self):
  self.row['businessDate']='2026-10-21'
  with self.assertRaises(RelayError):self.check()
 def test_wrong_event_rejected(self):
  self.row['cupEventId']='other'
  with self.assertRaises(RelayError):self.check()
 def test_wrong_camera_rejected(self):
  self.row['cameraName']='other'
  with self.assertRaises(RelayError):self.check()
 def test_wrong_source_rejected(self):
  self.row['evidenceOrigin']='recording_extracted_frame'
  with self.assertRaises(RelayError):self.check()
 def test_wrong_db_hash_rejected(self):
  self.row['imageSha256']='c'*64
  with self.assertRaises(RelayError):self.check()
 def test_wrong_persisted_hash_rejected(self):
  self.result['persistedImageSha256']='d'*64
  with self.assertRaises(RelayError):self.check()
 def test_no_false_direct_delivery_claim(self):
  self.result['automaticDirectPushVerified']=True
  with self.assertRaises(RelayError):self.check()
 def test_no_physical_count_created(self):
  self.result['physicalCupCountCreated']=True
  with self.assertRaises(RelayError):self.check()
 def test_accepted_is_not_persisted(self):
  self.result['status']='accepted'
  with self.assertRaises(RelayError):self.check()
 def test_timestamp_must_remain_original(self):
  c=dict(self.capture,captured_at_utc='2026-10-22T23:15:57.000000Z');self.row['captureMetadataJson']=json.dumps(c)
  with self.assertRaises(RelayError):self.check()
 def test_equal_utc_representation_allowed(self):
  c=dict(self.capture,captured_at_utc='2026-10-22T23:15:57.123469+00:00');self.row['captureMetadataJson']=json.dumps(c);self.check()
 def test_missing_timezone_rejected(self):
  c=dict(self.capture,captured_at_utc='2026-10-22T23:15:57.123469');self.row['captureMetadataJson']=json.dumps(c)
  with self.assertRaises(RelayError):self.check()
 def test_zone_hash_bound(self):
  c=dict(self.capture,zone_config_sha256='c'*64);self.row['captureMetadataJson']=json.dumps(c)
  with self.assertRaises(RelayError):self.check()
 def test_row_id_not_bool(self):
  self.row['id']=True
  with self.assertRaises(RelayError):self.check()
 def test_originals_not_changed_by_validator(self):
  before=copy.deepcopy(self.result);self.check();self.assertEqual(before,self.result)
 def test_boundaries_and_native_auth(self):
  self.assertIn(ORIGIN,BROWSER_SCRIPT);self.assertIn("credentials:'same-origin'",BROWSER_SCRIPT)
  self.assertNotIn('apiKey',BROWSER_SCRIPT);self.assertNotIn('document.cookie',BROWSER_SCRIPT)
  self.assertNotIn('frigate.submit',BROWSER_SCRIPT);self.assertNotIn('importReviewedCameraCount',BROWSER_SCRIPT)
 def test_existing_is_reconciled_before_write(self):
  self.assertIn('if(!row&&write)',BROWSER_SCRIPT);self.assertIn('persistedImageSha256:row.imageSha256',BROWSER_SCRIPT)
 def test_readback_limit_fails_closed(self):self.assertIn('readback_limit_reached',BROWSER_SCRIPT)

if __name__=='__main__':unittest.main()
