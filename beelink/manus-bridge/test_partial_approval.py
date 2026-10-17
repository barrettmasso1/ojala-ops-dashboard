import unittest
import approve_manus_partial as a


class ApprovalTest(unittest.TestCase):
    def setUp(self):
        self.draft = {'proposedRecord': {'uniqueCupIds': ['CTX02-R01', 'CTX02-R02'],
            'decisionRationale': 'Two separately visible cups', 'gapsDescription': 'Partial interval only'}}
        self.evidence = [{'id': 'first', 'at': '2026-10-16T21:07:00Z'},
                         {'id': 'second', 'at': '2026-10-16T21:07:10Z'}]

    def test_missing_reviewer_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'reviewer_required'):
            a.make_ledger(self.draft, self.evidence, '', '2026-10-17T19:00:00Z', 'a', 'b')

    def test_same_instant_is_not_temporal_evidence(self):
        self.evidence[1]['at'] = self.evidence[0]['at']
        with self.assertRaisesRegex(ValueError, 'two_temporal'):
            a.make_ledger(self.draft, self.evidence, 'TEST reviewer', '2026-10-17T19:00:00Z', 'a', 'b')

    def test_partial_approval_preserves_identity_and_scope(self):
        ledger = a.make_ledger(self.draft, self.evidence, ' TEST reviewer ', '2026-10-17T19:00:00Z', 'a', 'b')
        self.assertEqual(ledger['reviewedBy'], 'TEST reviewer')
        self.assertEqual(ledger['coverage'], 'partial')
        self.assertNotEqual(ledger['dailyReview']['scope'], 'full_operating_window')
        self.assertEqual([u['id'] for u in ledger['units']], ['CTX02-R01', 'CTX02-R02'])
        self.assertEqual(ledger['provenance']['sourceDraftSha256'], 'a')


if __name__ == '__main__':
    unittest.main()
