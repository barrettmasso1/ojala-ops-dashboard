import unittest
from datetime import datetime,timezone
from capture_lifecycle import verify_capture_lifecycle
START=1792861200
def event(**kw):return dict({'id':'fixture-cup-1','camera':'handoff','label':'cup','start_time':START,'end_time':None,'false_positive':False},**kw)
def at(sec):return datetime.fromtimestamp(START+sec,timezone.utc).isoformat()
class LifecycleTests(unittest.TestCase):
 def test_current_event(self):self.assertTrue(verify_capture_lifecycle(event(),event(),at(1)))
 def test_event_ended_after_actual_capture(self):self.assertTrue(verify_capture_lifecycle(event(),event(end_time=START+5),at(1)))
 def test_late_frame_does_not_become_evidence(self):self.assertFalse(verify_capture_lifecycle(event(),event(end_time=START+1),at(5)))
 def test_wrong_identity(self):self.assertFalse(verify_capture_lifecycle(event(),event(id='other-event'),at(1)))
 def test_wrong_camera(self):self.assertFalse(verify_capture_lifecycle(event(),event(camera='other'),at(1)))
 def test_wrong_label(self):self.assertFalse(verify_capture_lifecycle(event(),event(label='person'),at(1)))
 def test_rejected_event(self):self.assertFalse(verify_capture_lifecycle(event(),event(false_positive=True),at(1)))
 def test_timezone_required(self):self.assertFalse(verify_capture_lifecycle(event(),event(),'2026-10-24T14:00:00'))
 def test_nan_rejected(self):self.assertFalse(verify_capture_lifecycle(event(),event(end_time=float('nan')),at(1)))
 def test_infinite_rejected(self):self.assertFalse(verify_capture_lifecycle(event(),event(end_time=float('inf')),at(1)))
 def test_end_before_start(self):self.assertFalse(verify_capture_lifecycle(event(),event(end_time=START-1),at(1)))
 def test_changed_start_rejected(self):self.assertFalse(verify_capture_lifecycle(event(),event(start_time=START+1),at(2)))
 def test_preexisting_timestamp_tolerance_unchanged(self):self.assertTrue(verify_capture_lifecycle(event(),event(end_time=START+1),at(3)));self.assertFalse(verify_capture_lifecycle(event(),event(end_time=START+1),at(3.01)))
 def test_stale_window_rejected(self):self.assertFalse(verify_capture_lifecycle(event(),event(),at(601)))
 def test_missing_latest_safe(self):self.assertFalse(verify_capture_lifecycle(event(),None,at(1)))
if __name__=='__main__':unittest.main()
