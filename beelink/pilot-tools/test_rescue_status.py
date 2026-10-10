import unittest
from pilot_audit import is_live_rescue_command

class RescueStatus(unittest.TestCase):
    def test_replay_is_not_live(self):
        self.assertFalse(is_live_rescue_command([b'python3',b'/config/rescue_shadow/rescue_shadow.py',b'replay']))
    def test_only_live_worker_is_live(self):
        self.assertTrue(is_live_rescue_command([b'python3',b'/config/rescue_shadow/rescue_shadow.py',b'live']))
        self.assertFalse(is_live_rescue_command([b'python3',b'/home/ojala/frigate/rescue_layer/ojala_rescue.py']))

if __name__=='__main__':unittest.main()
