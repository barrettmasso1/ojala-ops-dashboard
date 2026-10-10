import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import ojala_guard as guard
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'rescue-shadow'))
import launch_shadow as rescue


class SupervisorTests(unittest.TestCase):
    def test_guard_stopped_container_outside_hours_stays_stopped(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            with patch.object(guard,'BASE',root), patch.object(guard,'STATUS',root/'status.json'), \
                 patch.object(guard,'in_hours',return_value=False), patch.object(guard,'call') as call, \
                 patch.object(guard,'start_worker') as start:
                call.return_value=subprocess.CompletedProcess([],0,'false\n','')
                guard.main()
                self.assertEqual(call.call_count,1)
                start.assert_not_called()
                self.assertEqual(json.loads((root/'status.json').read_text())['status'],'outside_operating_hours')

    def test_guard_recovers_capture_during_manual_session(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); script=root/'verified_capture.py'; script.write_text('fixture')
            with patch.object(guard,'BASE',root), patch.object(guard,'STATUS',root/'status.json'), \
                 patch.object(guard,'SCRIPT',script), patch.object(guard,'HEALTH',root/'health.json'), \
                 patch.object(guard,'in_hours',return_value=False), patch.object(guard,'call') as call, \
                 patch.object(guard,'process_ids',return_value=[]), \
                 patch.object(guard,'restart_allowed',return_value=True), \
                 patch.object(guard,'urlopen',side_effect=OSError), patch.object(guard,'start_worker') as start:
                call.return_value=subprocess.CompletedProcess([],0,'true\n','')
                guard.main()
                start.assert_called_once()
                self.assertEqual(call.call_count,1)  # no docker start
                self.assertTrue(json.loads((root/'status.json').read_text())['manual_session_outside_schedule'])

    def test_rescue_follows_running_container_on_any_day(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); (root/'enabled.json').write_text('{}')
            with patch.object(rescue,'ROOT',root), patch.object(rescue,'STATE',root/'state.json'), \
                 patch.object(rescue,'HEALTH',root/'health.json'), patch.object(rescue,'call') as call:
                call.side_effect=[subprocess.CompletedProcess([],0,'true\n',''),
                                  subprocess.CompletedProcess([],0,'[]\n',''),
                                  subprocess.CompletedProcess([],0,'','')]
                rescue.main()
                self.assertEqual(json.loads((root/'state.json').read_text())['status'],'started')
                commands=[c.args[0] for c in call.call_args_list]
                self.assertFalse(any(c[:2]==['docker','start'] for c in commands))

    def test_rescue_never_starts_stopped_frigate(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); (root/'enabled.json').write_text('{}')
            with patch.object(rescue,'ROOT',root), patch.object(rescue,'STATE',root/'state.json'), \
                 patch.object(rescue,'call') as call:
                call.return_value=subprocess.CompletedProcess([],0,'false\n','')
                rescue.main()
                self.assertEqual(call.call_count,1)
                self.assertEqual(json.loads((root/'state.json').read_text())['status'],'frigate_not_running')


if __name__=='__main__': unittest.main()
