from __future__ import annotations

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
        self.image.write_bytes(b"fixture-verified-handoff-image")

    def tearDown(self) -> None:
        self.patch.stop()
        self.temp_dir.cleanup()

    def test_rejects_snapshot_outside_verified_directory(self) -> None:
        outside = Path(self.temp_dir.name) / "automatic.jpg"
        outside.write_bytes(b"legacy-auto-snapshot")
        with self.assertRaises(sender.SenderError):
            sender.require_verified_path(outside)

    def test_deduplicates_verified_image_and_marks_terminal_response_sent(self) -> None:
        connection = sender.open_queue(self.queue_path)
        self.assertTrue(sender.enqueue_verified_snapshot(connection, self.image))
        self.assertFalse(sender.enqueue_verified_snapshot(connection, self.image))

        with patch.object(sender, "post_snapshot", return_value=("approved_by_ai", False)) as post:
            result = sender.send_due_snapshots(connection, "https://example.test", "test-key")

        self.assertEqual(result, {"sent": 1, "retry": 0, "skipped": 0})
        payload = post.call_args.args[1]
        self.assertNotIn("storeId", payload)
        self.assertEqual(payload["cameraName"], "handoff")
        self.assertTrue(payload["cupEventId"].startswith("snapshot-"))
        status = connection.execute("SELECT status FROM verified_snapshot_queue").fetchone()[0]
        self.assertEqual(status, "sent")

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
