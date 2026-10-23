import hashlib,json,os,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
import manus_bridge as b
import realtime_visual_bridge as rt

class PhotoOnlyTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name)
  self.images=self.base/'config/verified_snapshots/handoff';self.images.mkdir(parents=True)
  self.sender=types.SimpleNamespace(ALLOWED_SUFFIXES={'.jpg'},SenderError=type('SenderError',(Exception,),{}))
  self.sender.sidecar_path=lambda p:p.with_suffix('.json')
  self.sender.event_metadata=lambda p:(json.loads(p.with_suffix('.json').read_bytes()),hashlib.sha256(p.read_bytes()).hexdigest())
  self.image=self.images/'fixture.jpg';self.image.write_bytes(b'LOCAL_TEST_FIXTURE_NOT_UPLOADED')
  self.metadata={'schema_version':3,'cup_event_id':'fixture-cup-0001','captured_at_utc':'2026-10-18T20:00:00+00:00','people':[{}],'cup':{'score':0.8}}
  self.image.with_suffix('.json').write_text(json.dumps(self.metadata));os.utime(self.image,(995,995))
 def tearDown(self):self.tmp.cleanup()
 def collect(self,**kw):
  with patch.object(b,'load_module',return_value=self.sender),patch.object(b.time,'time',return_value=1000):
   return b.assemble('2026-10-18',self.base,**kw)
 def photo(self,**kw):return self.collect(include_count=False,include_video=False,min_source_age_seconds=2,**kw)
 def test_photo_only_never_opens_video_database(self):
  p=self.base/'pilot-archive/forward-20260929/index.sqlite3';p.parent.mkdir(parents=True);p.write_bytes(b'NO_VIDEO_DATABASE_ACCESS_ALLOWED')
  with patch.object(b.sqlite3,'connect',side_effect=AssertionError('video database read')):m,f=self.photo()
  self.assertEqual(len(f),2);self.assertEqual(m['events'][0]['segments'],[])
 def test_photo_only_never_reads_counts(self):
  with patch.object(b,'attach_reviewed_count',side_effect=AssertionError('count read')):m,f=self.photo()
  self.assertIsNone(m['cupsDetected']);self.assertIsNone(m['countRecord']);self.assertFalse(m['countRecordIncluded'])
 def test_original_image_and_sidecar_preserved(self):
  m,f=self.photo();e=m['events'][0]
  self.assertEqual(f[e['image']],self.image.read_bytes());self.assertEqual(f[e['metadata']],self.image.with_suffix('.json').read_bytes())
  self.assertEqual(e['cupEventId'],self.metadata['cup_event_id']);self.assertEqual(e['capturedAt'],self.metadata['captured_at_utc'])
 def test_explicit_scope_survives_incremental_subset(self):
  m,f=self.photo();m2,f2=rt.build_subset(m,f,m['events'])
  self.assertEqual(m2['collectionScope'],'live_photos_only');self.assertFalse(m2['videoContextIncluded']);self.assertEqual(len(f2),2)
 def test_default_still_waits_sixty_seconds(self):
  with self.assertRaisesRegex(b.BridgeError,'no_verified_evidence_for_date'):self.collect(include_count=False)
 def test_unsettled_photo_is_not_packaged(self):
  os.utime(self.image,(999,999))
  with self.assertRaisesRegex(b.BridgeError,'no_verified_evidence_for_date'):self.photo()
 def test_photo_only_forbids_count_attachment(self):
  with self.assertRaisesRegex(b.BridgeError,'photo_only_cannot_include_physical_count'):self.collect(include_count=True,include_video=False)
 def test_invalid_age_rejected(self):
  for age in (0,1,-1,True,3601):
   with self.subTest(age=age),self.assertRaisesRegex(b.BridgeError,'invalid_photo_collection_options'):self.collect(include_count=False,include_video=False,min_source_age_seconds=age)
 def test_completed_events_not_repackaged(self):
  with self.assertRaisesRegex(b.BridgeError,'no_verified_evidence_for_date'):self.photo(exclude_event_ids={'fixture-cup-0001'})
 def test_default_manifest_stays_legacy(self):
  os.utime(self.image,(900,900));m,f=self.collect(include_count=False)
  self.assertNotIn('collectionScope',m);self.assertNotIn('videoContextIncluded',m)
 def test_live_instruction_excludes_video_review_and_count(self):
  text=b.photo_prompt({'id':'a'*64,'day':'2026-10-18','sha256':'b'*64})
  self.assertIn('countRow:null',text);self.assertIn('NO hagas revision temporal',text)
  self.assertIn('automaticPushVerified:false',text);self.assertIn('normalizationProof',text)
  self.assertNotIn('Revisa los segmentos originales adjuntos',text)

if __name__=='__main__':unittest.main()
