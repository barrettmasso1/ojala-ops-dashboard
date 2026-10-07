from __future__ import annotations
import copy
from contextlib import closing
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import handoff_visual_sender as sender


class CaptureWorkerZoneCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "handoff"
        self.root.mkdir()
        self.image = self.root / "fixture.jpg"
        self.image.write_bytes(b"\xff\xd8\xffisolated-geometry-fixture")
        self.queue = Path(self.temp.name) / "queue.sqlite3"
        self.geometry = {
            "name": "handoff_zone", "coordinate_system": "normalized",
            "polygon": [[0.45, 0.55], [0.609, 0.564], [0.605, 0.685], [0.453, 0.675]],
            "reference_width": 2304, "reference_height": 1296,
            "membership_rule": "box_bottom_center",
        }
        self.patcher = patch.object(sender, "VERIFIED_SNAPSHOT_DIR", self.root)
        self.patcher.start()
        self.write()

    def tearDown(self):
        self.patcher.stop()
        self.temp.cleanup()

    def write(self, geometry=None, **overrides):
        geometry = self.geometry if geometry is None else geometry
        sidecar = {
            "schema_version": 3, "camera": "handoff", "cup_zone": "handoff_zone",
            "cup_event_id": "geometry-fixture-001",
            "captured_at_utc": "2026-10-04T22:10:01.123456+00:00",
            "image_sha256": hashlib.sha256(self.image.read_bytes()).hexdigest(),
            "zone_geometry": geometry,
            "zone_config_sha256": hashlib.sha256(json.dumps(geometry, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
            "image_dimensions": {"width": 2304, "height": 1296},
        }
        sidecar.update(overrides)
        self.image.with_suffix(".json").write_text(json.dumps(sidecar))
        return sidecar

    def test_adapts_worker_object_and_preserves_original_pair_and_provenance(self):
        original_image = self.image.read_bytes()
        original_sidecar = self.image.with_suffix(".json").read_bytes()
        with closing(sender.open_queue(self.queue)) as db:
            self.assertTrue(sender.enqueue_verified_snapshot(db, self.image))
            row = db.execute("SELECT * FROM verified_snapshot_queue").fetchone()
            payload = sender.build_payload(row, "isolated-test-key")
        capture = payload["capture"]
        expected = [{"x": x, "y": y} for x, y in self.geometry["polygon"]]
        self.assertEqual(capture["zone_geometry"], expected)
        self.assertEqual(capture["zone_config_sha256"], hashlib.sha256(sender.canonical_zone_geometry(expected).encode()).hexdigest())
        self.assertEqual(capture["captured_at_utc"], "2026-10-04T22:10:01.123456Z")
        self.assertEqual(capture["cup_event_id"], "geometry-fixture-001")
        self.assertNotIn("_source_zone_config_sha256", capture)
        self.assertIn("adapter=beelink_object_v3", payload["sourceDetail"])
        self.assertIn(hashlib.sha256(original_sidecar).hexdigest(), payload["sourceDetail"])
        self.assertEqual(self.image.read_bytes(), original_image)
        self.assertEqual(self.image.with_suffix(".json").read_bytes(), original_sidecar)

    def test_rejects_tampered_source_geometry_hash(self):
        self.write(zone_config_sha256="0" * 64)
        with self.assertRaisesRegex(sender.SenderError, "zone_config_sha256"):
            sender.event_metadata(self.image)

    def test_rejects_reference_dimensions_different_from_capture(self):
        geometry = copy.deepcopy(self.geometry)
        geometry["reference_width"] = 1920
        self.write(geometry)
        with self.assertRaisesRegex(sender.SenderError, "reference dimensions"):
            sender.event_metadata(self.image)

    def test_rejects_unsupported_zone_meaning_even_with_matching_hash(self):
        for field, value in [("coordinate_system", "pixels"), ("membership_rule", "any_overlap"), ("name", "entrance")]:
            geometry = copy.deepcopy(self.geometry)
            geometry[field] = value
            self.write(geometry)
            with self.assertRaisesRegex(sender.SenderError, "unsupported"):
                sender.event_metadata(self.image)

    def test_rejects_bad_polygon_types_ranges_and_duplicates(self):
        for polygon in [[[True, .5], [.6, .5], [.6, .7]],
                        [[2, .5], [.6, .5], [.6, .7]],
                        [[.4, .5], [.4, .5], [.6, .7]],
                        [[.4, .5], [.6, .5]],
                        [[.4, .5, .6], [.6, .5], [.6, .7]]]:
            geometry = copy.deepcopy(self.geometry)
            geometry["polygon"] = polygon
            self.write(geometry)
            with self.assertRaises(sender.SenderError):
                sender.event_metadata(self.image)

    def test_rejects_boolean_image_dimensions(self):
        self.write(image_dimensions={"width": True, "height": 1296})
        with self.assertRaisesRegex(sender.SenderError, "image_dimensions"):
            sender.event_metadata(self.image)

    def test_detects_source_sidecar_change_after_queueing(self):
        with closing(sender.open_queue(self.queue)) as db:
            sender.enqueue_verified_snapshot(db, self.image)
            row = db.execute("SELECT * FROM verified_snapshot_queue").fetchone()
            self.write(captured_at_utc="2026-10-04T22:10:02.123456Z")
            with self.assertRaisesRegex(sender.SenderError, "sidecar changed"):
                sender.build_payload(row, "isolated-test-key")

    def test_adapted_pair_survives_reopen_and_is_not_queued_twice(self):
        db = sender.open_queue(self.queue)
        self.assertTrue(sender.enqueue_verified_snapshot(db, self.image))
        db.close()
        db = sender.open_queue(self.queue)
        self.assertFalse(sender.enqueue_verified_snapshot(db, self.image))
        row = db.execute("SELECT * FROM verified_snapshot_queue").fetchone()
        self.assertIn("adapter=beelink_object_v3", sender.build_payload(row, "isolated-test-key")["sourceDetail"])
        self.assertEqual(db.execute("SELECT COUNT(*) FROM verified_snapshot_queue").fetchone()[0], 1)
        db.close()


if __name__ == "__main__":
    unittest.main()
