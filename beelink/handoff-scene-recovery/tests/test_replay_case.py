from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPLAY = ROOT / "replay_case.py"


class HandoffSceneRecoveryTests(unittest.TestCase):
    def write_case(self, path: Path) -> None:
        path.write_text(json.dumps({
            "case_id": "fixture-2026-09-26-170000-170100",
            "camera": "handoff",
            "window_local": {"start": "2026-09-26T17:00:00", "end": "2026-09-26T17:01:00"},
            "human_reference": {"operator_reported_medium_gelato_cups_sold": 2, "is_automatically_validated_size": False},
            "automatic_frigate_observations": {
                "cup_tracks": 1,
                "cup_event_ids": ["1790467493.946143-9rdbpk"],
                "automatic_capture_pairs": 1,
                "automatic_capture_local_time": "2026-09-26T17:00:30.000",
                "sender_queue_records": 1,
                "sender_successful_sends": 0,
            },
            "recording_only_scene": {
                "approximate_local_time": "2026-09-26T17:00:00",
                "operator_observation": "fixture recording scene",
                "automatic_event_or_capture": False,
                "requires_original_sequence": True,
            },
            "known_result_at_manifest_creation": {
                "ai_reviews_executed_against_original_evidence": 0,
                "visible_cups_validated_from_original_image_or_video": None,
            },
        }), encoding="utf-8")

    def test_replays_zip_offline_and_labels_extracted_frame_as_review_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_video = root / "source.mp4"
            subprocess.run([
                "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=64x48:d=1",
                "-frames:v", "1", "-y", str(source_video),
            ], check=True)
            embedded = root / "case_manifest.json"
            self.write_case(embedded)
            archive = root / "evidence.zip"
            with zipfile.ZipFile(archive, "w") as output:
                output.write(source_video, "source.mp4")
                output.write(embedded, "case_manifest.json")
            external_case = root / "case.json"
            self.write_case(external_case)
            destination = root / "result"

            result = subprocess.run([
                "python3", str(REPLAY), "--archive", str(archive), "--case", str(external_case), "--output", str(destination),
            ], capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads((destination / "replay-report.json").read_text(encoding="utf-8"))
            self.assertTrue(report["offline_only"])
            self.assertEqual(report["network_requests"], 0)
            self.assertEqual(report["database_writes"], 0)
            self.assertEqual(report["automatic_frigate"]["origin"], "automatic_frigate_capture")
            recovered = report["recording_extracted_candidate"]
            self.assertEqual(recovered["origin"], "recording_extracted_frame")
            self.assertFalse(recovered["automatic_success"])
            self.assertTrue(recovered["requires_manager_review"])
            self.assertEqual(recovered["ai_review_executed"], False)
            self.assertEqual(report["operational_mutations"], {
                "frigate_cup_counts": 0,
                "sales": 0,
                "deliveries": 0,
                "inventory": 0,
                "revenue": 0,
            })

    def test_rejects_archive_path_traversal_before_extracting(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "unsafe.zip"
            with zipfile.ZipFile(archive, "w") as output:
                output.writestr("../outside.mp4", b"unsafe")
            case = root / "case.json"
            self.write_case(case)
            result = subprocess.run([
                "python3", str(REPLAY), "--archive", str(archive), "--case", str(case), "--output", str(root / "result"),
            ], capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 2)
            self.assertIn("unsafe path", result.stderr)


if __name__ == "__main__":
    unittest.main()
