import json
import tempfile
import unittest
from pathlib import Path
from urllib.error import URLError
from frigate_push_counts import process_day, validate_record, pending_dates, ENDPOINT, ZONE
import datetime as dt

DAY = '2026-09-27'


class PushTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / 'approved_counts').mkdir()
        (self.root / 'push_state').mkdir()
        self.record = {'businessDate': DAY, 'cameraName': 'handoff', 'storeId': 1,
            'status': 'approved', 'countBasis': 'reviewed_unique_physical_cups',
            'cupsDetected': 2, 'uniqueCupIds': ['fixture-A', 'fixture-B'],
            'reviewedBy': 'test fixture', 'evidenceReferences': ['synthetic-test-only'],
            'coverage': 'complete'}
        self.config = {'endpoint': ENDPOINT, 'storeId': 1, 'apiKey': 'test-secret',
                       'productionContractVerified': True}
        self.write()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self):
        (self.root / 'approved_counts' / (DAY+'.json')).write_text(json.dumps(self.record))
        cfg = self.root / 'push_config.json'
        cfg.write_text(json.dumps(self.config))
        cfg.chmod(0o600)

    def test_reject_tracks_and_ounces(self):
        for basis in ['frigate_tracks', 'ounces', 'photos']:
            self.record['countBasis'] = basis
            self.assertEqual(validate_record(self.record, DAY), 'unverified_count_basis')

    def test_reject_duplicate_cups(self):
        self.record['uniqueCupIds'] = ['a', 'a']
        self.assertEqual(validate_record(self.record, DAY), 'duplicate_or_mismatched_unique_cups')

    def test_reject_date_and_camera_mismatch(self):
        self.assertEqual(validate_record(self.record, '2026-09-28'), 'date_or_camera_mismatch')
        self.record['cameraName'] = 'entrance'
        self.assertEqual(validate_record(self.record, DAY), 'date_or_camera_mismatch')

    def test_reject_weighted_float_or_bool(self):
        for count in [2.5, True]:
            self.record['cupsDetected'] = count
            self.assertEqual(validate_record(self.record, DAY), 'invalid_integer_count')

    def test_unapproved_and_missing_config_never_send(self):
        self.record['status'] = 'pending'
        self.write()
        (self.root / 'push_config.json').unlink()
        result = process_day(self.root, DAY, send=lambda x: self.fail('unexpected network'))
        self.assertEqual(result['blockers'], ['unique_cup_count_not_approved', 'push_config_missing'])

    def test_ack_receipt_prevents_duplicate_send(self):
        calls=[]
        def send(payload):
            calls.append(payload)
            return 200, {'result': {'data': {'json': {'success': True}}}}
        first=process_day(self.root, DAY, send=send)
        second=process_day(self.root, DAY, send=send)
        self.assertEqual(first['status'], 'acknowledged')
        self.assertFalse(first['dashboardVerified'])
        self.assertEqual(second['status'], 'already_acknowledged')
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]['cupsDetected'], 2)
        self.assertEqual(calls[0]['businessDate'], DAY)
        self.assertNotIn('test-secret', json.dumps(first))

    def test_network_error_keeps_outbox_and_hides_secret(self):
        def fail(payload):
            raise URLError('test-secret')
        result=process_day(self.root, DAY, send=fail)
        self.assertEqual(result['status'], 'retry_pending')
        self.assertTrue((self.root/'approved_counts'/(DAY+'.json')).exists())
        self.assertFalse((self.root/'push_state'/(DAY+'.receipt.json')).exists())
        self.assertNotIn('test-secret', json.dumps(result))

    def test_malformed_success_is_not_acknowledged(self):
        for response in [{}, {'success': True}, {'result': {'data': {'json': {'success': False}}}}, []]:
            r=process_day(self.root, DAY, send=lambda x: (200, response))
            self.assertEqual(r['status'], 'retry_pending')

    def test_dry_run_never_sends(self):
        r=process_day(self.root, DAY, dry_run=True, send=lambda x: self.fail('network'))
        self.assertEqual(r['status'], 'ready_dry_run')

    def test_config_permissions_and_endpoint_guard(self):
        self.config['endpoint']='https://example.invalid'
        self.write()
        (self.root/'push_config.json').chmod(0o644)
        r=process_day(self.root, DAY, send=lambda x: self.fail('network'))
        self.assertIn('endpoint_or_store_not_confirmed', r['blockers'])
        self.assertIn('config_permissions_must_be_600', r['blockers'])

    def test_partial_zero_cannot_imply_no_sales(self):
        self.record.update(cupsDetected=0, uniqueCupIds=[], coverage='partial', gapsDescription='offline')
        self.assertEqual(validate_record(self.record, DAY), 'zero_with_incomplete_coverage')

    def test_changed_approved_total_cannot_silently_overwrite(self):
        process_day(self.root, DAY, send=lambda x: (200, {'result':{'data':{'json':{'success':True}}}}))
        self.record.update(cupsDetected=1, uniqueCupIds=['fixture-A'])
        self.write()
        r=process_day(self.root, DAY, send=lambda x: self.fail('network'))
        self.assertEqual(r['blockers'], ['changed_record_requires_reconciliation'])

    def test_restart_catches_missed_sunday_without_count_file(self):
        (self.root/'approved_counts'/(DAY+'.json')).unlink()
        dates=pending_dates(self.root, dt.datetime(2026,9,29,12,tzinfo=ZONE))
        self.assertEqual(dates, ['2026-09-27'])

    def test_pending_does_not_close_today_before_21(self):
        dates=pending_dates(self.root, dt.datetime(2026,10,2,20,tzinfo=ZONE))
        self.assertNotIn('2026-10-02', dates)
        dates=pending_dates(self.root, dt.datetime(2026,10,2,21,tzinfo=ZONE))
        self.assertIn('2026-10-02', dates)


if __name__ == '__main__':
    unittest.main()
