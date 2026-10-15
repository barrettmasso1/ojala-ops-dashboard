import json
import tempfile
import unittest
from pathlib import Path
from export_admin_count import export
from frigate_push_counts import hashlib


class ExportTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / '2026-07-18.json'
        self.target = self.root / 'import.json'
        self.record = {'businessDate': '2026-07-18', 'cameraName': 'handoff', 'storeId': 1,
                       'status': 'approved', 'countBasis': 'reviewed_unique_physical_cups',
                       'cupsDetected': 1, 'uniqueCupIds': ['fixture'], 'reviewedBy': 'Fixture',
                       'approvedAt': '2026-07-19T02:00:00+00:00', 'coverage': 'partial',
                       'gapsDescription': 'One scene only',
                       'evidenceReferences': [{'path': 'fixture.mp4', 'sha256': 'a' * 64}]}
        self.source.write_text(json.dumps(self.record))

    def tearDown(self):
        self.temp.cleanup()

    def test_sender_identity_and_source_remain_exact(self):
        original = self.source.read_bytes()
        result = export(self.source, self.target)
        document = json.loads(self.target.read_text())
        self.assertEqual(document['recordJson'], json.dumps(self.record, sort_keys=True))
        self.assertEqual(result['recordSha256'], hashlib.sha256(document['recordJson'].encode()).hexdigest())
        self.assertEqual(self.source.read_bytes(), original)
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o600)
        self.assertFalse(result['posted'])

    def test_missing_review_rejected(self):
        self.record['status'] = 'pending'
        self.source.write_text(json.dumps(self.record))
        with self.assertRaises(ValueError): export(self.source, self.target)
        self.assertFalse(self.target.exists())

    def test_export_never_overwrites(self):
        self.target.write_text('existing')
        with self.assertRaises(FileExistsError): export(self.source, self.target)
        self.assertEqual(self.target.read_text(), 'existing')

    def test_secrets_rejected(self):
        self.record['apiKey'] = 'fixture-secret'
        self.source.write_text(json.dumps(self.record))
        with self.assertRaises(ValueError): export(self.source, self.target)
        self.assertFalse(self.target.exists())


if __name__ == '__main__':
    unittest.main()
