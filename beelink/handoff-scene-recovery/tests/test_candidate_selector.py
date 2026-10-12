from __future__ import annotations

import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from candidate_selector import CandidatePolicy, PersonZoneSignal, select_recovery_candidates


class CandidateSelectorTests(unittest.TestCase):
    def test_selects_the_real_case_style_in_zone_person_signal_without_creating_a_sale(self):
        candidates = select_recovery_candidates([
            PersonZoneSignal("handoff", 1790467358.0, 0.82, ("handoff_zone",)),
        ], camera="handoff")

        self.assertEqual(len(candidates), 1)
        self.assertTrue(candidates[0].requires_visual_filter)
        self.assertTrue(candidates[0].requires_manager_review)
        self.assertFalse(candidates[0].creates_operational_record)
        self.assertEqual(candidates[0].evidence_origin, "recording_extracted_frame")

    def test_deduplicates_one_scene_without_treating_frames_as_deliveries(self):
        candidates = select_recovery_candidates([
            PersonZoneSignal("handoff", 100.2, 0.62, ("handoff_zone",)),
            PersonZoneSignal("handoff", 104.8, 0.91, ("handoff_zone",)),
            PersonZoneSignal("handoff", 110.0, 0.95, ("handoff_zone",)),
        ], camera="handoff")

        self.assertEqual(len(candidates), 2)
        self.assertTrue(all(not candidate.creates_operational_record for candidate in candidates))
        self.assertEqual(candidates[0].source_timestamp_utc, 104.8)

    def test_rejects_out_of_zone_low_confidence_and_other_camera_signals(self):
        candidates = select_recovery_candidates([
            PersonZoneSignal("handoff", 100, 0.59, ("handoff_zone",)),
            PersonZoneSignal("handoff", 101, 0.99, ("other_zone",)),
            PersonZoneSignal("other-camera", 102, 0.99, ("handoff_zone",)),
        ], camera="handoff", policy=CandidatePolicy(minimum_person_confidence=0.60))

        self.assertEqual(candidates, [])


if __name__ == "__main__":
    unittest.main()
