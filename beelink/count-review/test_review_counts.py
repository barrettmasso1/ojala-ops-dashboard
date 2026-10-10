import copy
import hashlib
import tempfile
import unittest
from pathlib import Path
from review_counts import evaluate, export_record, export_partial_record


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        evidence=[]
        for i in range(2):
            data=('synthetic frame '+str(i)).encode()
            (self.root/str(i)).write_bytes(data)
            evidence.append({'id':str(i),'path':str(i),'sha256':hashlib.sha256(data).hexdigest(),
                             'at':f'2026-10-04T13:00:0{i}-07:00'})
        self.ledger={'businessDate':'2026-10-04','storeId':1,'cameraName':'handoff',
                     'countBasis':'reviewed_unique_physical_cups','reviewedBy':'test fixture',
                     'candidateIds':['track-a','rescue-a'],'evidence':evidence,
                     'units':[{'id':'cup-a','decision':'confirmed','personAndFilledCup':True,
                               'inHandoffZone':True,'evidenceIds':['0','1'],'identityReason':'synthetic sequence'}],
                     'cases':[{'id':'a','candidateIds':['track-a','rescue-a'],'disposition':'counted',
                               'unitIds':['cup-a'],'evidenceIds':['0','1']}],
                     'coverage':'complete','status':'approved','approvedAt':'2026-10-05T00:00:00+00:00',
                     'dailyReview':{'scope':'full_operating_window','completed':True,'gaps':[]}}

    def tearDown(self):
        self.tmp.cleanup()

    def evaluate(self):
        return evaluate(self.ledger,self.root)

    def test_two_candidates_link_to_one_physical_unit(self):
        result=self.evaluate()
        self.assertEqual(result['dailyCupCount'],1)
        self.assertEqual(export_record(self.ledger,result)['uniqueCupIds'],['cup-a'])

    def test_candidate_windows_do_not_certify_daily_total(self):
        self.ledger['dailyReview']['scope']='candidate_video_windows'
        result=self.evaluate()
        self.assertEqual(result['confirmedUniqueCupsInReviewedEvidence'],1)
        self.assertIsNone(result['dailyCupCount'])
        with self.assertRaisesRegex(ValueError,'daily_review_not_complete'):
            export_record(self.ledger,result)

    def test_pending_case_blocks_export(self):
        self.ledger['cases'][0]['disposition']='pending'
        self.assertIn('unresolved_visual_cases',self.evaluate()['blockers'])

    def test_missing_candidate_blocks_export(self):
        self.ledger['candidateIds'].append('forgotten-track')
        self.assertIn('unreviewed_candidates',self.evaluate()['blockers'])

    def test_camera_gap_blocks_even_if_status_approved(self):
        self.ledger['dailyReview']['gaps']=['12:00-12:10 offline']
        self.assertIn('incomplete_recording_coverage',self.evaluate()['blockers'])

    def test_duplicate_unit_rejected(self):
        self.ledger['units'].append(copy.deepcopy(self.ledger['units'][0]))
        with self.assertRaisesRegex(ValueError,'duplicate_or_invalid_unit'):
            self.evaluate()

    def test_candidate_cannot_belong_to_two_cases(self):
        duplicate=copy.deepcopy(self.ledger['cases'][0]);duplicate['id']='b'
        self.ledger['cases'].append(duplicate)
        with self.assertRaisesRegex(ValueError,'candidate_partition_error'):
            self.evaluate()

    def test_single_photo_does_not_prove_identity(self):
        self.ledger['units'][0]['evidenceIds']=['0']
        with self.assertRaisesRegex(ValueError,'unit_temporal_evidence_missing'):
            self.evaluate()

    def test_tampered_frame_rejected(self):
        (self.root/'0').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'evidence_hash_mismatch'):
            self.evaluate()

    def test_other_day_frame_rejected(self):
        self.ledger['evidence'][0]['at']='2026-10-03T13:00:00-07:00'
        with self.assertRaisesRegex(ValueError,'evidence_date_mismatch'):
            self.evaluate()

    def test_false_positive_cannot_link_counted_unit(self):
        self.ledger['cases'][0]['disposition']='false_positive'
        with self.assertRaisesRegex(ValueError,'rejected_case_has_counted_unit'):
            self.evaluate()

    def test_another_store_cannot_export(self):
        self.ledger['storeId']=2
        with self.assertRaisesRegex(ValueError,'wrong_camera_or_store'):
            self.evaluate()

    def test_partial_exports_confirmed_units_and_preserves_pending_ledger(self):
        self.ledger.update(status='pending', coverage='partial')
        self.ledger['dailyReview']={'scope':'candidate_windows','completed':False,'gaps':['camera gap']}
        self.ledger['cases'].append({'id':'pending-case','candidateIds':[],
            'disposition':'pending','unitIds':[],'evidenceIds':['0']})
        original=copy.deepcopy(self.ledger)
        record=export_partial_record(self.ledger,self.root,'2026-10-05T00:00:00+00:00')
        self.assertEqual(record['cupsDetected'],1)
        self.assertEqual(record['coverage'],'partial')
        self.assertIsNone(record['dailyCupCount'])
        self.assertEqual(record['pendingCases'],['pending-case'])
        self.assertIn('camera gap',record['gapsDescription'])
        self.assertEqual(self.ledger,original)
        self.assertFalse(self.evaluate()['readyForDailyPush'])

    def test_partial_does_not_promote_ambiguous_unit(self):
        self.ledger['cases'][0]['disposition']='pending'
        with self.assertRaisesRegex(ValueError,'no_confirmed_partial_units'):
            export_partial_record(self.ledger,self.root,'2026-10-05T00:00:00+00:00')

    def test_partial_zero_is_not_an_invented_daily_zero(self):
        self.ledger['units']=[]
        self.ledger['cases'][0].update(disposition='false_positive',unitIds=[])
        with self.assertRaisesRegex(ValueError,'no_confirmed_partial_units'):
            export_partial_record(self.ledger,self.root,'2026-10-05T00:00:00+00:00')

    def test_partial_revalidates_evidence_and_approval_timestamp(self):
        for stamp in ['2026-10-05T00:00:00','2999-01-01T00:00:00+00:00']:
            with self.assertRaisesRegex(ValueError,'invalid_approval_timestamp'):
                export_partial_record(self.ledger,self.root,stamp)
        (self.root/'0').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'evidence_hash_mismatch'):
            export_partial_record(self.ledger,self.root,'2026-10-05T00:00:00+00:00')

    def test_partial_accepts_unreviewed_candidates_without_counting_them(self):
        self.ledger['candidateIds'].append('unknown')
        record=export_partial_record(self.ledger,self.root,'2026-10-05T00:00:00+00:00')
        self.assertEqual(record['uniqueCupIds'],['cup-a'])
        self.assertIn('unreviewed',record['gapsDescription'])
