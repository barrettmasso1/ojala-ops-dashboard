import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.request

import manus_bridge as b


class FakeApi:
    def __init__(self, failure=None):
        self.calls = []
        self.failure = failure
        self.visibility = 'private'
        self.task_status = 'stopped'
        self.bytes = 0
        self.messages = []

    def call(self, method, params=None, post=False):
        self.calls.append((method, params))
        if self.failure and self.failure[0] == method:
            raise self.failure[1]
        if method == 'task.detail':
            return {'task': {'id': b.TASK, 'share_visibility': self.visibility,
                             'status': self.task_status}}
        if method == 'file.upload':
            return {'file': {'id': 'file1'}, 'upload_url': 'https://bucket.s3.us-west-2.amazonaws.com/a'}
        if method == 'file.detail':
            return {'file': {'id': 'file1', 'status': 'uploaded', 'bytes': str(self.bytes)}}
        if method == 'task.sendMessage':
            return {'ok': True, 'task_id': b.TASK, 'request_id': 'req1'}
        if method == 'task.listMessages':
            return {'messages': self.messages, 'has_more': False}

    def upload(self, url, content):
        self.bytes = len(content)


class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.manifest = {'businessDate': '2026-10-16', 'events': [{'cupEventId': 'example'}],
                         'countRecordIncluded': False, 'cupsDetected': None}
        self.files = {'snapshots/example.json': b'{"example":true}'}
        self.result = b.stage(self.manifest, self.files, self.root)
        self.db = b.queue_db(self.root)

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def status(self):
        return self.db.execute('SELECT status FROM batches').fetchone()[0]

    def test_duplicate_collection_does_not_queue_another_job(self):
        duplicate = b.stage(self.manifest, self.files, self.root)
        self.assertTrue(duplicate['deduplicated'])
        self.assertEqual(self.db.execute('SELECT count(*) FROM batches').fetchone()[0], 1)

    def test_task_acceptance_never_means_dashboard_received(self):
        api = FakeApi()
        result = b.deliver_one(self.db, api)
        self.assertTrue(result['taskAccepted'])
        self.assertFalse(result['dashboardReceived'])
        self.assertFalse(result['directFrigateVerified'])
        self.assertEqual(self.status(), 'awaiting_dashboard_receipt')
        self.assertEqual(b.deliver_one(self.db, api)['status'], 'nothing_due')
        self.assertEqual(sum(method == 'task.sendMessage' for method, _ in api.calls), 1)

    def test_public_task_blocks_before_uploading_images(self):
        api = FakeApi()
        api.visibility = 'public'
        b.deliver_one(self.db, api)
        self.assertEqual(self.status(), 'blocked')
        self.assertEqual(len(api.calls), 1)

    def test_busy_task_does_not_interrupt_existing_work(self):
        api = FakeApi()
        api.task_status = 'running'
        self.assertEqual(b.deliver_one(self.db, api, now=100)['status'], 'task_busy_or_waiting')
        self.assertEqual(len(api.calls), 1)
        self.assertEqual(b.deliver_one(self.db, api, now=101)['status'], 'nothing_due')

    def test_changed_package_is_not_uploaded(self):
        path = Path(self.db.execute('SELECT path FROM batches').fetchone()[0])
        path.write_bytes(b'changed')
        api = FakeApi()
        b.deliver_one(self.db, api)
        self.assertEqual(self.status(), 'blocked')
        self.assertEqual(len(api.calls), 1)

    def test_send_timeout_is_held_and_never_blindly_retried(self):
        api = FakeApi(('task.sendMessage', b.BridgeError('api_network_or_response_error')))
        b.deliver_one(self.db, api)
        self.assertEqual(self.status(), 'delivery_unknown')
        self.assertEqual(b.deliver_one(self.db, api)['status'], 'nothing_due')

    def test_crash_after_dispatch_can_reconcile_original_marker(self):
        b.update(self.db, self.result['batchId'], status='dispatching')
        api = FakeApi()
        api.messages = [{'type': 'user_message', 'user_message': {
            'content': 'OJALA_BRIDGE_BATCH:'+self.result['batchId']}}]
        self.assertEqual(b.reconcile(self.db, api)['reconciled'], 1)
        self.assertEqual(self.status(), 'awaiting_dashboard_receipt')
        self.assertFalse(any(m == 'task.sendMessage' for m, _ in api.calls))

    def test_no_marker_keeps_unknown_delivery_for_investigation(self):
        b.update(self.db, self.result['batchId'], status='delivery_unknown')
        self.assertEqual(b.reconcile(self.db, FakeApi())['reconciled'], 0)
        self.assertEqual(self.status(), 'delivery_unknown')

    def test_403_stops_retries(self):
        b.deliver_one(self.db, FakeApi(('task.sendMessage', b.ApiError(403))))
        self.assertEqual(self.status(), 'blocked')
        self.assertEqual(b.deliver_one(self.db, FakeApi())['status'], 'api_auth_hold')

    def test_429_has_backoff(self):
        b.deliver_one(self.db, FakeApi(('task.sendMessage', b.ApiError(429))), now=100)
        self.assertEqual(self.status(), 'retry')
        self.assertEqual(b.deliver_one(self.db, FakeApi(), now=101)['status'], 'nothing_due')

    def test_five_failures_stop(self):
        b.update(self.db, self.result['batchId'], attempts=4)
        b.deliver_one(self.db, FakeApi(('file.upload', b.BridgeError('api_network_or_response_error'))))
        self.assertEqual(self.status(), 'blocked')

    def test_key_file_must_be_owner_only_and_not_symlink(self):
        config = self.root/'config'
        config.write_text(json.dumps({'manusApiKey': 'test-only-key-not-a-real-key'}))
        config.chmod(0o644)
        with self.assertRaises(b.BridgeError):
            b.read_key(config)
        config.chmod(0o600)
        self.assertEqual(b.read_key(config), 'test-only-key-not-a-real-key')
        link = self.root/'link'
        link.symlink_to(config)
        with self.assertRaises(b.BridgeError):
            b.read_key(link)

    def test_upload_does_not_leak_manus_key(self):
        api = b.ManusApi('test-only-key-not-real')
        class Opener:
            def open(self, request, timeout):
                self.request = request
                return self
            def __enter__(self):
                self.status = 200
                return self
            def __exit__(self, *args):
                return False
        api.opener = Opener()
        api.upload('https://bucket.s3.us-west-2.amazonaws.com/item?signature=private', b'data')
        self.assertNotIn('X-manus-api-key', dict(api.opener.request.header_items()))

    def test_upload_destination_is_restricted(self):
        api = b.ManusApi('unused')
        for url in ['https://evil.invalid/item', 'http://bucket.s3.us-west-2.amazonaws.com/a',
                    'https://bucket.s3.us-west-2.amazonaws.com.evil.invalid/a',
                    'https://user:pass@bucket.s3.us-west-2.amazonaws.com/a']:
            with self.subTest(url=url), self.assertRaises(b.BridgeError):
                api.upload(url, b'data')

    def test_redirects_are_not_followed(self):
        req = urllib.request.Request(b.API+'user.me')
        self.assertIsNone(b.NoRedirect().redirect_request(req, None, 302, '', {}, 'https://elsewhere.invalid'))

    def test_source_paths_cannot_escape(self):
        other = self.root/'other'
        other.mkdir()
        (other/'outside').symlink_to(self.root/'queue.sqlite3')
        with self.assertRaises(b.BridgeError):
            b.within(other/'outside', other)

    def test_prompt_explicitly_prevents_photo_to_count_conversion(self):
        row = self.db.execute('SELECT * FROM batches').fetchone()
        text = b.prompt(row)
        self.assertIn('no crees un conteo', text)
        self.assertIn('pending_review', text)
        self.assertIn('countRow=null', text)
        self.assertNotIn('apiKey', text)

    def test_reviewed_count_prompt_uses_existing_import_and_no_overwrite(self):
        row = self.db.execute('SELECT * FROM batches').fetchone()
        text = b.prompt(row, count_included=True)
        self.assertIn('dashboard.importReviewedCameraCount', text)
        self.assertIn('no lo sobrescribas', text)
        self.assertNotIn('countRow=null', text)


if __name__ == '__main__':
    unittest.main()
