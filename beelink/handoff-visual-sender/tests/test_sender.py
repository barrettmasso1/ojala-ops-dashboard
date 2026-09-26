from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import handoff_visual_sender as sender


class VerifiedSnapshotSenderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name) / "verified_snapshots" / "handoff"
        self.root.mkdir(parents=True)
        self.queue_path = Path(self.temp_dir.name) / "queue.sqlite3"
        self.patch = patch.object(sender, "VERIFIED_SNAPSHOT_DIR", self.root)
        self.patch.start()
        self.image = self.root / "confirmed.jpg"
        self.image.write_bytes(b"\xff\xd8\xfffixture-verified-handoff-image")
        self.write_sidecar(self.image)

    def tearDown(self) -> None:
        self.patch.stop()
        self.temp_dir.cleanup()

    def write_sidecar(self, image: Path, **overrides: object) -> None:
        metadata: dict[str, object] = {
            "camera": "handoff",
            "cup_zone": "handoff_zone",
            "cup_event_id": "cup-event-fixture-001",
            "captured_at_utc": "2026-09-26T20:15:30.000Z",
            "image_sha256": hashlib.sha256(image.read_bytes()).hexdigest(),
        }
        metadata.update(overrides)
        image.with_suffix(".json").write_text(json.dumps(metadata), encoding="utf-8")

    def test_rejects_snapshot_outside_verified_directory(self) -> None:
        outside = Path(self.temp_dir.name) / "automatic.jpg"
        outside.write_bytes(b"legacy-auto-snapshot")
        with self.assertRaises(sender.SenderError):
            sender.require_verified_path(outside)

    def test_waits_until_required_json_sidecar_exists(self) -> None:
        image = self.root / "missing-sidecar.jpg"
        image.write_bytes(b"\xff\xd8\xfffixture-without-sidecar")
        connection = sender.open_queue(self.queue_path)
        discovered, awaiting_metadata = sender.discover_verified_snapshots(connection)
        self.assertEqual(discovered, 1)  # the valid fixture from setUp
        self.assertEqual(awaiting_metadata, 1)
        self.assertEqual(connection.execute("SELECT COUNT(*) FROM verified_snapshot_queue WHERE source_path = ?", (str(image),)).fetchone()[0], 0)

    def test_rejects_corrupt_or_mismatched_sidecar_identity(self) -> None:
        self.write_sidecar(self.image, image_sha256="0" * 64)
        with self.assertRaisesRegex(sender.SenderError, "does not match"):
            sender.event_metadata(self.image)
        self.write_sidecar(self.image, camera="other")
        with self.assertRaisesRegex(sender.SenderError, "camera or cup_zone"):
            sender.event_metadata(self.image)

    def test_rejects_corrupt_image_even_if_a_sidecar_exists(self) -> None:
        corrupted = self.root / "corrupted.jpg"
        corrupted.write_bytes(b"not-a-jpeg")
        self.write_sidecar(corrupted, cup_event_id="cup-event-corrupted-001")
        with self.assertRaisesRegex(sender.SenderError, "corrupt"):
            sender.event_metadata(corrupted)

    def test_deduplicates_verified_pair_and_marks_terminal_response_sent(self) -> None:
        connection = sender.open_queue(self.queue_path)
        self.assertTrue(sender.enqueue_verified_snapshot(connection, self.image))
        self.assertFalse(sender.enqueue_verified_snapshot(connection, self.image))

        with patch.object(sender, "post_snapshot", return_value=("approved_by_ai", False)) as post:
            result = sender.send_due_snapshots(connection, "https://example.test", "test-key")

        self.assertEqual(result, {"sent": 1, "retry": 0, "skipped": 0})
        payload = post.call_args.args[1]
        self.assertNotIn("storeId", payload)
        self.assertNotIn("businessDate", payload)
        self.assertEqual(payload["capture"]["camera"], "handoff")
        self.assertEqual(payload["capture"]["cup_zone"], "handoff_zone")
        self.assertEqual(payload["capture"]["cup_event_id"], "cup-event-fixture-001")
        status = connection.execute("SELECT status FROM verified_snapshot_queue").fetchone()[0]
        self.assertEqual(status, "sent")

    def test_rejects_image_changed_after_queueing(self) -> None:
        connection = sender.open_queue(self.queue_path)
        sender.enqueue_verified_snapshot(connection, self.image)
        self.image.write_bytes(b"\xff\xd8\xffdifferent-image-bytes")
        with self.assertRaisesRegex(sender.SenderError, "changed after queueing"):
            sender.build_payload(connection.execute("SELECT * FROM verified_snapshot_queue").fetchone(), "test-key")

    def test_keeps_pending_review_response_in_durable_retry_queue(self) -> None:
        connection = sender.open_queue(self.queue_path)
        sender.enqueue_verified_snapshot(connection, self.image)

        with patch.object(sender, "post_snapshot", return_value=("pending_review", True)):
            result = sender.send_due_snapshots(connection, "https://example.test", "test-key")

        self.assertEqual(result, {"sent": 0, "retry": 1, "skipped": 0})
        row = connection.execute("SELECT status, attempts, last_error FROM verified_snapshot_queue").fetchone()
        self.assertEqual(row[0], "retry")
        self.assertEqual(row[1], 1)
        self.assertEqual(row[2], "remote review/analysis pending")

    def test_delivers_ambiguous_review_case_once_when_server_marks_it_non_retryable(self) -> None:
        connection = sender.open_queue(self.queue_path)
        sender.enqueue_verified_snapshot(connection, self.image)

        with patch.object(sender, "post_snapshot", return_value=("pending_review", False)):
            result = sender.send_due_snapshots(connection, "https://example.test", "test-key")

        self.assertEqual(result, {"sent": 1, "retry": 0, "skipped": 0})
        status = connection.execute("SELECT status FROM verified_snapshot_queue").fetchone()[0]
        self.assertEqual(status, "sent")


if __name__ == "__main__":
    unittest.main()
