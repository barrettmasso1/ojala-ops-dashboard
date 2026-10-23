import math,unittest
from pathlib import Path
from offline_search_region import candidate_allowed
from post_close_recovery_audit import guard_reason

class SearchAreaTests(unittest.TestCase):
 def allow(self,box=(0.1,0.1,0.3,0.3),inside=False,area='full_frame',low=100,high=5000):
  return candidate_allowed(box,100,100,low,high,inside,area)
 def test_outside_zone_available_for_review(self):self.assertTrue(self.allow())
 def test_legacy_gate_still_excludes_outside(self):self.assertFalse(self.allow(area='handoff_zone'))
 def test_inside_remains_available(self):self.assertTrue(self.allow(inside=True,area='handoff_zone'))
 def test_full_frame_includes_inside(self):self.assertTrue(self.allow(inside=True))
 def test_invalid_mode_rejected(self):
  with self.assertRaises(ValueError):self.allow(area='unknown')
 def test_small_area_still_rejected(self):self.assertFalse(self.allow(low=500))
 def test_large_area_still_rejected(self):self.assertFalse(self.allow(high=200))
 def test_inverted_box_rejected(self):self.assertFalse(self.allow(box=(.5,.3,.4,.4)))
 def test_empty_box_rejected(self):self.assertFalse(self.allow(box=(.1,.1,.1,.3)))
 def test_outside_image_rejected(self):self.assertFalse(self.allow(box=(-.1,.1,.2,.3)))
 def test_nonfinite_rejected(self):
  for value in [float('nan'),float('inf'),float('-inf')]:self.assertFalse(self.allow(box=(.1,.1,value,.3)))
 def test_invalid_area_bounds_rejected(self):self.assertFalse(self.allow(low=5000,high=100))
 def test_invalid_dimensions_rejected(self):self.assertFalse(candidate_allowed((.1,.1,.3,.3),0,100,0,1000,True,'full_frame'))
 def test_default_is_legacy(self):self.assertFalse(candidate_allowed((.1,.1,.3,.3),100,100,0,1000,False))
 def test_result_is_only_boolean_candidate(self):self.assertIs(type(self.allow()),bool)

class ThermalTests(unittest.TestCase):
 def test_heat_stops(self):self.assertEqual(guard_reason(83,False),'offline_scan_paused_high_temperature')
 def test_active_camera_stops(self):self.assertEqual(guard_reason(65,True),'offline_scan_camera_running_or_unknown')
 def test_unknown_camera_stops(self):self.assertEqual(guard_reason(65,None),'offline_scan_camera_running_or_unknown')
 def test_unknown_temperature_stops(self):self.assertEqual(guard_reason(None,False),'offline_scan_temperature_unknown')
 def test_cool_idle_continues(self):self.assertIsNone(guard_reason(74,False))
 def test_worker_uses_ro_and_no_network(self):
  src=(Path(__file__).parent/'post_close_recovery_audit.py').read_text()
  self.assertIn("'--network','none'",src);self.assertIn("'--cpus','0.25'",src);self.assertIn("'fullShiftReviewCompleted':False",src)
  self.assertIn("'dailyUniqueCupCount':None",src);self.assertIn("'--search-area',args.search_area",src);self.assertIn("'scope.json'",src)
if __name__=='__main__':unittest.main()
