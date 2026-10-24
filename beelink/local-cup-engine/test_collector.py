import json,os,sqlite3,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
from collector import Collector
from ledger import digest,InvalidEvidence
from test_ledger import track,meta,IMAGE,START

class CollectorIntegrationTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name);self.root=self.base/'external/state'
  (self.base/'config/model_cache').mkdir(parents=True)
  self.model=self.base/'config/model_cache/ojala_cups_v4_640.onnx';self.model.write_bytes(b'UNIT_TEST_MODEL_NOT_FOR_INFERENCE')
  self.dbpath=self.base/'config/frigate.db';db=sqlite3.connect(self.dbpath)
  db.execute('CREATE TABLE event(id,label,camera,start_time,end_time,top_score,false_positive,zones,box,data,model_hash,detector_type)')
  self.track=track();db.execute('INSERT INTO event VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(self.track['sourceEventId'],'cup','handoff',START,START+.5,.8,0,'["handoff_zone"]',None,'{"box":[0.4,0.5,0.08,0.1],"top_score":0.8}',None,'openvino'));db.commit();db.close()
  self.patch=patch.dict('sys.modules',{'package_storage':types.SimpleNamespace(verify_external=lambda *a,**k:self.root.parent)})
  self.patch.start()
  self.config={'schemaVersion':1,'basePath':str(self.base),'stateRoot':str(self.root),'timezone':'America/Mazatlan','deviceId':'device-test','expectedModelSha256':digest(self.model.read_bytes()),'pollSeconds':2}
  self.collector=Collector(self.config)
 def tearDown(self):self.collector.close();self.patch.stop();self.tmp.cleanup()
 def proof(self):
  folder=self.base/'config/verified_snapshots/handoff';folder.mkdir(parents=True,exist_ok=True)
  stem='20261022T230000Z_'+self.track['sourceEventId'];jpg=folder/(stem+'.jpg');side=folder/(stem+'.json')
  jpg.write_bytes(IMAGE);side.write_text(json.dumps(meta(self.track)));os.utime(jpg,(START,START));os.utime(side,(START,START));return jpg,side
 def test_short_finished_event_registered(self):
  r=self.collector.cycle('2026-10-22');self.assertEqual(r['sourceTracksRead'],1);self.assertEqual(self.collector.db.snapshot('2026-10-22')['detectorTracksRecorded'],1)
 def test_late_sidecar_enriches_same_observation(self):
  self.collector.cycle('2026-10-22');self.proof();r=self.collector.cycle('2026-10-22')
  self.assertEqual(r['verifiedLocalEvidence'],1);self.assertEqual(self.collector.db.snapshot('2026-10-22')['detectorTracksRecorded'],1)
 def test_later_source_rejection_overrides_cached_confirmation(self):
  self.proof();self.collector.cycle('2026-10-22')
  db=sqlite3.connect(self.dbpath);db.execute('UPDATE event SET false_positive=1');db.commit();db.close()
  r=self.collector.cycle('2026-10-22');s=self.collector.db.snapshot('2026-10-22')
  self.assertEqual(s['sameFrameVerifiedObservations'],0);self.assertEqual(s['rejectedSourceObservations'],1);self.assertEqual(r['invalidTracks'],[])
 def test_external_archived_originals_survive_source_removal(self):
  jpg,side=self.proof();self.collector.cycle('2026-10-22');originals=list((self.root/'evidence').iterdir());self.assertEqual(len(originals),2)
  jpg.unlink();side.unlink();self.collector.cycle('2026-10-22');self.assertTrue(all(p.exists() for p in originals));self.assertEqual(self.collector.db.snapshot('2026-10-22')['sameFrameVerifiedObservations'],1)
 def test_corrupted_source_does_not_replace_verified_archive(self):
  jpg,side=self.proof();self.collector.cycle('2026-10-22');before={p.name:p.read_bytes() for p in (self.root/'evidence').iterdir()}
  jpg.write_bytes(IMAGE+b'changed');os.utime(jpg,(START,START));r=self.collector.cycle('2026-10-22')
  self.assertEqual(r['status'],'attention_required');self.assertEqual(len(r['invalidEvidence']),1);self.assertEqual(before,{p.name:p.read_bytes() for p in (self.root/'evidence').iterdir()})
 def test_source_database_bytes_unchanged(self):
  before=self.dbpath.read_bytes();self.proof();self.collector.cycle('2026-10-22');self.assertEqual(self.dbpath.read_bytes(),before)
 def test_model_change_requires_explicit_configuration(self):
  self.model.write_bytes(b'OTHER_MODEL')
  with self.assertRaisesRegex(InvalidEvidence,'model_changed_reload_required'):self.collector.cycle('2026-10-22')
 def test_missing_mount_fails_without_internal_fallback(self):
  self.proof();self.collector.guard=lambda *a,**k:(_ for _ in ()).throw(InvalidEvidence('external_mount_missing'))
  with self.assertRaisesRegex(InvalidEvidence,'external_mount_missing'):self.collector.cycle('2026-10-22')
  self.assertFalse((self.base/'state').exists());self.assertEqual(self.collector.db.snapshot('2026-10-22')['detectorTracksRecorded'],0)
 def test_real_restart_idempotency_and_archive_reuse(self):
  self.proof();self.collector.cycle('2026-10-22');self.collector.close();self.collector=Collector(self.config);r=self.collector.cycle('2026-10-22')
  self.assertEqual(r['changedObservations'],0);self.assertEqual(len(list((self.root/'evidence').iterdir())),2)


 def test_health_delegates_transport_state_without_false_disabled_claim(self):
  r=self.collector.cycle('2026-10-22')
  self.assertEqual(r['cloudSyncStatus'],'reported_by_separate_native_sync')
  self.assertEqual(r['cloudSyncHealthFile'],str(self.root/'sync-health.json'))
  self.assertEqual(r['networkWrites'],0)
 def test_health_reference_does_not_claim_a_stale_sync_is_active(self):
  (self.root/'sync-health.json').write_text('{"status":"old"}')
  r=self.collector.cycle('2026-10-22')
  self.assertEqual(r['cloudSyncStatus'],'reported_by_separate_native_sync')
  self.assertNotIn('receiptVerified',r)


 def test_reference_size_enriches_same_detection_without_new_cup(self):
  self.proof();self.collector.cycle('2026-10-22')
  self.collector.size_runtime=types.SimpleNamespace(status='ready',assess=lambda track,evidence:{'size':'mediano','status':'classified','imageSha256':evidence['imageSha256']})
  r=self.collector.cycle('2026-10-22');snap=self.collector.db.snapshot('2026-10-22')
  self.assertEqual(snap['detectorTracksRecorded'],1);self.assertEqual(snap['sizeBreakdownOfVerifiedObservations']['mediano'],1)
  self.assertIsNone(snap['uniquePhysicalDeliveries']);self.assertEqual(r['sizeClassificationStatus'],'ready')
 def test_absent_size_model_preserves_unknown(self):
  self.proof();self.collector.size_runtime=types.SimpleNamespace(status='calibration_required',assess=lambda *a:None)
  self.collector.cycle('2026-10-22');self.assertEqual(self.collector.db.snapshot('2026-10-22')['sizeBreakdownOfVerifiedObservations']['unknown'],1)
 def test_size_model_failure_does_not_drop_detection(self):
  self.proof();self.collector.size_runtime=types.SimpleNamespace(status='invalid',assess=lambda *a:(_ for _ in ()).throw(ValueError('bad-model')))
  r=self.collector.cycle('2026-10-22');self.assertEqual(self.collector.db.snapshot('2026-10-22')['detectorTracksRecorded'],1)
  self.assertEqual(r['invalidEvidence'][0]['reason'],'size_calibration_unavailable')
 def test_source_rejection_cannot_retain_size(self):
  self.proof();self.collector.size_runtime=types.SimpleNamespace(status='ready',assess=lambda track,evidence:{'size':'chico','status':'classified'})
  self.collector.cycle('2026-10-22');db=sqlite3.connect(self.dbpath);db.execute('UPDATE event SET false_positive=1');db.commit();db.close()
  self.collector.cycle('2026-10-22');s=self.collector.db.snapshot('2026-10-22');self.assertEqual(s['sameFrameVerifiedObservations'],0);self.assertEqual(sum(s['sizeBreakdownOfVerifiedObservations'].values()),0)


 def test_owner_reference_classification_is_not_ai_assessment(self):
  self.proof();review={'label':'pint','sourceEventId':self.track['sourceEventId']}
  self.collector.size_runtime=types.SimpleNamespace(status='calibration_required',assess=lambda *a:{'size':'pint','basis':'owner_confirmed_reference','ownerReview':review})
  self.collector.cycle('2026-10-22');r=self.collector.db.rows('2026-10-22')[0]
  self.assertEqual(r['size'],'pint');self.assertEqual(r['sizeBasis'],'owner_confirmed_reference');self.assertNotIn('sizeAssessment',r)
 def test_owner_noncup_excluded_without_removing_observation(self):
  self.proof();self.collector.size_runtime=types.SimpleNamespace(status='ready',assess=lambda *a:{'size':'unknown','basis':'owner_confirmed_reference','ownerReview':{'label':'not_cup'}})
  self.collector.cycle('2026-10-22');r=self.collector.db.snapshot('2026-10-22')
  self.assertEqual(r['detectorTracksRecorded'],1);self.assertEqual(r['ownerExcludedNonCups'],1);self.assertEqual(r['sameFrameVerifiedObservations'],0);self.assertEqual(sum(r['sizeBreakdownOfVerifiedObservations'].values()),0)
 def test_previous_owner_annotation_survives_temporary_model_absence(self):
  self.proof();self.collector.size_runtime=types.SimpleNamespace(status='ready',assess=lambda *a:{'size':'litro','basis':'owner_confirmed_reference','ownerReview':{'label':'litro'}})
  self.collector.cycle('2026-10-22');self.collector.size_runtime=None;self.collector.cycle('2026-10-22')
  self.assertEqual(self.collector.db.rows('2026-10-22')[0]['size'],'litro')

if __name__=='__main__':unittest.main()
