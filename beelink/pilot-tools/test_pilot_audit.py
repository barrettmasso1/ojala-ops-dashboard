import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import pilot_audit as audit


class AuditTests(unittest.TestCase):
    def test_overlaps_do_not_inflate_coverage(self):
        r = audit.coverage([(10,40), (20,60), (50,80)], 0, 100)
        self.assertEqual(r['recorded_seconds'], 70)
        self.assertEqual(r['missing_seconds'], 30)

    def test_clip_and_record_real_gaps(self):
        r = audit.coverage([(-10, 30), (50, 120)], 0, 100)
        self.assertEqual(r['recorded_seconds'], 80)
        self.assertEqual(r['gaps_over_10_seconds'][0]['seconds'], 20)

    def test_missing_camera_is_not_full_coverage(self):
        r = audit.coverage([], 0, 100)
        self.assertEqual(r['recorded_percent'], 0)

    def test_zero_duration_does_not_invent_percentage(self):
        self.assertIsNone(audit.coverage([], 0, 0)['recorded_percent'])

    def pair(self, root, when='2026-09-27T01:00:00Z'):
        p = root/'event.jpg'; p.write_bytes(b'fixture')
        p.with_suffix('.json').write_text(json.dumps({
            'camera': 'handoff', 'cup_zone': 'handoff_zone', 'cup_event_id': 'example01',
            'cup': {'score': .5}, 'people': [{'score': .8}],
            'captured_at_utc': when, 'image_sha256': hashlib.sha256(b'fixture').hexdigest()}))
        return p

    def test_utc_is_grouped_by_mazatlan_business_day(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); self.pair(root)
            rows, errors = audit.snapshots_for_day(root, '2026-09-26')
            self.assertEqual(len(rows), 1); self.assertEqual(errors, [])
            rows, _ = audit.snapshots_for_day(root, '2026-09-27')
            self.assertEqual(rows, [])

    def test_damaged_photo_not_archived_as_valid_pair(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); self.pair(root).write_bytes(b'changed')
            rows, errors = audit.snapshots_for_day(root, '2026-09-26')
            self.assertEqual(rows, []); self.assertEqual(len(errors), 1)

    def test_naive_timestamp_is_not_accepted(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); self.pair(root, '2026-09-26T13:00:00')
            rows, errors = audit.snapshots_for_day(root, '2026-09-26')
            self.assertEqual(rows, []); self.assertEqual(len(errors), 1)

    def test_missing_person_is_not_a_valid_pair(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); p = self.pair(root).with_suffix('.json')
            data = json.loads(p.read_text()); data['people'] = []
            p.write_text(json.dumps(data))
            rows, errors = audit.snapshots_for_day(root, '2026-09-26')
            self.assertEqual(rows, []); self.assertEqual(len(errors), 1)

    def test_reading_sqlite_preserves_database_bytes(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/'sample.db'
            db = sqlite3.connect(p)
            db.executescript('''CREATE TABLE event(id,label,camera,start_time,end_time,zones,false_positive);
                CREATE TABLE recordings(path,start_time,end_time,duration,camera);
                INSERT INTO event VALUES('e','cup','handoff',15,20,'["handoff_zone"]',0);
                INSERT INTO recordings VALUES('/media/frigate/recordings/a.mp4',10,30,20,'handoff');''')
            db.commit(); db.close()
            before = p.read_bytes()
            events, segments = audit.read_events(p, 0, 100)
            self.assertEqual(len(events), 1); self.assertEqual(len(segments), 1)
            self.assertEqual(p.read_bytes(), before)


if __name__ == '__main__':
    unittest.main(verbosity=2)
