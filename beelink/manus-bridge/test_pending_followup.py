import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch
import live_cycle as live


class PendingFollowupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.state = self.base / 'manus-bridge/state'
        self.state.mkdir(parents=True)
        self.path = self.state / 'queue.sqlite3'

    def tearDown(self):
        self.temp.cleanup()

    def queue(self, status):
        with closing(sqlite3.connect(self.path)) as db:
            db.execute('CREATE TABLE batches (status TEXT)')
            db.execute('INSERT INTO batches VALUES (?)', (status,))
            db.commit()

    def run_inactive(self):
        with patch.object(live, 'camera_running', return_value=False), \
             patch.object(live, 'eligible', return_value=(False, 'inactive')), \
             patch.object(live, 'step', return_value={'status': 'nothing_due', 'exitCode': 0}) as step:
            result = live.run(self.base)
            return result, [call.args[0] for call in step.call_args_list]

    def test_missing_queue_no_network_or_creation(self):
        result, calls = self.run_inactive()
        self.assertEqual(result['status'], 'inactive_no_network')
        self.assertFalse(calls)
        self.assertFalse(self.path.exists())

    def test_pending_receipt_reconciles_without_collecting(self):
        self.queue('awaiting_dashboard_receipt')
        result, calls = self.run_inactive()
        self.assertEqual(result['status'], 'followup_checked')
        self.assertEqual(result['trigger'], 'pending_delivery_followup')
        self.assertFalse(result['startsCamera'])
        self.assertEqual([call[-1] for call in calls], ['reconcile', 'send'])
        self.assertFalse(any('realtime_visual_bridge.py' in ' '.join(call) for call in calls))
        self.assertFalse(result['physicalCountCreatedByCycle'])

    def test_known_queued_work_can_finish_after_camera_stops(self):
        self.queue('retry')
        self.assertTrue(live.pending_delivery(self.base))
        self.assertEqual(self.run_inactive()[0]['collect']['status'], 'not_attempted_followup_only')

    def test_verified_receipt_not_pending(self):
        self.queue('admin_receipt_verified')
        result, calls = self.run_inactive()
        self.assertEqual(result['status'], 'inactive_no_network')
        self.assertFalse(calls)

    def test_explicit_block_not_retried(self):
        self.queue('blocked')
        result, calls = self.run_inactive()
        self.assertEqual(result['status'], 'inactive_no_network')
        self.assertFalse(calls)

    def test_corrupt_queue_fails_closed(self):
        self.path.write_bytes(b'broken-sqlite')
        result, calls = self.run_inactive()
        self.assertEqual(result['status'], 'blocked_pending_queue_unreadable')
        self.assertFalse(result['networkAttempted'])
        self.assertFalse(calls)


if __name__ == '__main__':
    unittest.main()
