import copy,unittest
from run_pickups import observed_count_availability
class AvailabilityTests(unittest.TestCase):
 def test_unresolved_video_is_not_zero_delivery(self):
  result=observed_count_availability({'estimatedPickups':0,'unresolved':18,'sizeBreakdown':{'chico':0}},[{}]*18)
  self.assertIsNone(result['estimatedPickups']);self.assertIsNone(result['sizeBreakdown']);self.assertEqual(result['acceptedAlgorithmCandidates'],0);self.assertEqual(result['countAvailability'],'no_conclusive_route')
 def test_positive_partial_still_visible(self):
  result=observed_count_availability({'estimatedPickups':2,'unresolved':3,'sizeBreakdown':{'chico':2}},[{}]*5)
  self.assertEqual(result['estimatedPickups'],2);self.assertEqual(result['countAvailability'],'partial_unresolved')
 def test_resolved_estimate_still_not_full_day(self):
  result=observed_count_availability({'estimatedPickups':1,'unresolved':0,'sizeBreakdown':{'chico':1}},[{}])
  self.assertEqual(result['countAvailability'],'partial_estimate')
 def test_no_windows_preserves_technical_zero_only(self):
  result=observed_count_availability({'estimatedPickups':0,'unresolved':0,'sizeBreakdown':{}},[])
  self.assertEqual(result['acceptedAlgorithmCandidates'],0);self.assertIsNone(result['estimatedPickups'])
 def test_summary_not_mutated(self):
  summary={'estimatedPickups':0,'unresolved':18,'sizeBreakdown':{'chico':0}};before=copy.deepcopy(summary);observed_count_availability(summary,[{}]);self.assertEqual(summary,before)
if __name__=='__main__':unittest.main()
