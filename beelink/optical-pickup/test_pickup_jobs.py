import copy,json,sqlite3,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from datetime import datetime,timezone
from test_pickup_core import fixture,P,T
from pickup_core import identify,canonical
from run_pickups import Jobs,thermal_state,observations,photo_receipts
class JobTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.jobs=Jobs(self.root/'jobs.sqlite3');self.record,self.o=fixture();self.receipt={'imageSha256':self.o['sameFrameEvidence']['imageSha256'],'sourceEventId':self.o['sourceEventId'],'analysisStatus':'approved_by_ai'}
 def tearDown(self):self.jobs.close();self.tmp.cleanup()
 def discover(self):self.jobs.discover([self.o],{self.o['observationId']:self.receipt},P)
 def test_one_original_identity_creates_one_job(self):
  self.discover();self.discover();self.assertEqual(self.jobs.db.execute('SELECT count(*) FROM jobs').fetchone()[0],1)
 def test_no_photo_receipt_does_not_queue(self):
  self.jobs.discover([self.o],{},P);self.assertEqual(self.jobs.db.execute('SELECT count(*) FROM jobs').fetchone()[0],0)
 def test_wrong_photo_binding_rejected(self):
  self.receipt['imageSha256']='0'*64
  with self.assertRaises(ValueError):self.discover()
 def test_rejection_before_processing_stops_job(self):
  self.discover();self.o['sourceFalsePositive']=True;self.discover();self.assertEqual(self.jobs.db.execute('SELECT status FROM jobs').fetchone()[0],'excluded')
 def test_manual_rejection_preserved(self):
  self.receipt['analysisStatus']='discarded_by_manager';self.discover();self.assertEqual(self.jobs.db.execute('SELECT status FROM jobs').fetchone()[0],'excluded')
 def test_completed_record_retained_on_later_exclusion(self):
  self.discover();raw=canonical(self.record);self.jobs.db.execute("UPDATE jobs SET status='complete',record=?",(raw,));self.jobs.db.commit();self.o['ownerSizeReview']={'label':'not_cup'};self.discover();r=self.jobs.db.execute('SELECT status,record FROM jobs').fetchone();self.assertEqual(r['status'],'excluded');self.assertEqual(r['record'],raw)
 def test_restart_preserves_queue(self):
  self.discover();self.jobs.close();self.jobs=Jobs(self.root/'jobs.sqlite3');self.discover();self.assertEqual(self.jobs.db.execute('SELECT count(*) FROM jobs').fetchone()[0],1)
 def test_recording_must_settle_before_decode(self):
  self.discover();r=self.jobs.process_one({},P,T+10);self.assertEqual(r['status'],'waiting_recording_settle');self.assertEqual(self.jobs.db.execute('SELECT attempts FROM jobs').fetchone()[0],0)
 def test_missing_thermal_health_pauses(self):self.assertEqual(thermal_state(self.root/'missing',T),'paused_health_unavailable')
 def health(self,temp,fps,age=0):
  p=self.root/'health.json';p.write_text(json.dumps({'checked_at':datetime.fromtimestamp(T-age,timezone.utc).isoformat(),'max_temperature_c':temp,'operating_hours':True,'process_fps':fps}));return p
 def test_hot_device_pauses(self):self.assertEqual(thermal_state(self.health(89,5),T),'paused_temperature')
 def test_exact_temperature_boundary_pauses(self):self.assertEqual(thermal_state(self.health(83,5),T),'paused_temperature')
 def test_primary_camera_degradation_pauses(self):self.assertEqual(thermal_state(self.health(72,2),T),'paused_primary_detector_load')
 def test_safe_healthy_device_can_run(self):self.assertIsNone(thermal_state(self.health(72,5),T))
 def test_stale_thermal_data_pauses(self):self.assertEqual(thermal_state(self.health(72,5,181),T),'paused_health_unavailable')
 def test_no_records_have_partial_not_whole_day_scope(self):
  d=self.jobs.document('2026-10-24',P);self.assertEqual(d['records'],[]);self.assertFalse(d['coversWholeBusinessDay']);self.assertFalse(d['physicalUniqueCountCertified'])
 def test_empty_worker_does_not_report_zero_estimate(self):
  from run_pickups import observed_count_availability
  result=observed_count_availability({'estimatedPickups':0,'unresolved':0,'sizeBreakdown':{}},[])
  self.assertIsNone(result['estimatedPickups']);self.assertEqual(result['countAvailability'],'no_analyzed_windows')

if __name__=='__main__':unittest.main()
