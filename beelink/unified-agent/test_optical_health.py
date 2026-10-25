import unittest,copy
from test_agent_health import baseline,NOW,DAY,at
from agent_health import summarize
class OpticalHealth(unittest.TestCase):
 def setUp(self):
  self.r,self.s=baseline();self.s['ojala-optical-pickup.service']='active';self.r['opticalPickup']={'checkedAt':at(),'businessDate':DAY,'status':'running','jobs':{'queued':2},'estimatedPickups':None,'transport':{'status':'acknowledged'},'coversWholeBusinessDay':False}
 def report(self):return summarize(self.r,self.s,NOW,DAY,1,'device-test')
 def test_no_fabricated_total_when_no_video_processed(self):self.assertIsNone(self.report()['opticalPickup']['estimatedPickups'])
 def test_thermal_hold_visible_not_green(self):
  self.r['opticalPickup']['status']='paused_temperature';self.assertIn('optical_pickup_paused_temperature',self.report()['issues'])
 def test_degraded_primary_hold_visible(self):
  self.r['opticalPickup']['status']='paused_primary_detector_load';self.assertIn('optical_pickup_paused_primary_detector_load',self.report()['issues'])
 def test_missing_heartbeat_visible(self):
  self.r['opticalPickup']['checkedAt']=at(-200);self.assertIn('optical_pickup_missing_or_stale',self.report()['issues'])
 def test_disabled_service_visible(self):
  self.s['ojala-optical-pickup.service']='inactive';self.assertIn('service_not_active:ojala-optical-pickup.service',self.report()['issues'])
 def test_uncertain_receipt_visible(self):
  self.r['opticalPickup']['transport']['status']='delivery_unknown';self.assertIn('optical_pickup_not_received',self.report()['issues'])
 def test_wrong_date_not_today(self):
  self.r['opticalPickup']['businessDate']='2026-10-23';self.assertIn('optical_pickup_wrong_day',self.report()['issues'])
 def test_rejected_candidate_does_not_hide(self):
  self.r['opticalPickup']['jobs']['blocked']=1;self.assertIn('optical_pickup_candidates_blocked',self.report()['issues'])
 def test_running_not_commercial_certification(self):self.assertFalse(self.report()['commercialAcceptanceComplete']);self.assertFalse(self.report()['uniquePhysicalCountValidated'])
 def test_records_unchanged(self):
  before=copy.deepcopy(self.r);self.report();self.assertEqual(self.r,before)
if __name__=='__main__':unittest.main()
