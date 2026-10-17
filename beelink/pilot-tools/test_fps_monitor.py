import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
import fps_monitor as m


def sample(t, process=0.1, camera=5.0, **kw):
    return dict(checked_epoch=t, checked_at=str(t), boot_id='one',
                operating_hours=True, process_fps=process, camera_fps=camera, **kw)


class FpsTests(unittest.TestCase):
    def run_samples(self, times, **kw):
        state={}; events=[]
        for t in times:
            state,event=m.advance(state,sample(t,**kw))
            if event: events.append(event)
        return state,events

    def test_no_early_alert_and_exact_five_minutes(self):
        self.assertEqual(self.run_samples(range(0,300,60))[1],[])
        state,events=self.run_samples(range(0,601,60))
        self.assertEqual(len(events),1)
        self.assertEqual(events[0]['observedSeconds'],300)

    def test_camera_ingress_alone_does_not_hide_stalled_processing(self):
        self.assertEqual(len(self.run_samples(range(0,301,60),camera=5.1)[1]),1)

    def test_detection_fps_is_not_a_trigger(self):
        state,events=self.run_samples(range(0,601,60),process=5,camera=5,detection_fps=0)
        self.assertEqual(events,[])
        self.assertEqual(state['status'],'healthy')

    def test_gap_does_not_count_as_low_telemetry(self):
        state,events=self.run_samples([0,60,120,600])
        self.assertEqual(events,[])
        self.assertEqual(state['low_since'],600)

    def test_missing_and_invalid_samples_reset_duration(self):
        for value in [None,float('nan'),-1,True]:
            state,_=self.run_samples([0,60,120,180,240])
            state,event=m.advance(state,sample(300,process=value))
            self.assertIsNone(event)
            self.assertIsNone(state['low_since'])
            state,event=m.advance(state,sample(360))
            self.assertIsNone(event)

    def test_boot_and_clock_resets(self):
        state,_=self.run_samples([0,60,120,180,240])
        r=sample(300);r['boot_id']='two'
        state,event=m.advance(state,r)
        self.assertIsNone(event)
        self.assertEqual(state['low_since'],300)
        state,event=m.advance(state,sample(100))
        self.assertIsNone(event)
        self.assertEqual(state['low_since'],100)

    def test_closed_hours_do_not_alert_but_manual_session_does(self):
        state={}
        for t in range(0,601,60):
            r=sample(t);r['operating_hours']=False
            state,event=m.advance(state,r)
            self.assertIsNone(event)
        self.assertEqual(state['status'],'inactive')
        state={};events=[]
        for t in range(0,301,60):
            r=sample(t);r.update(operating_hours=False,manual_session_outside_schedule=True)
            state,event=m.advance(state,r)
            if event:events.append(event)
        self.assertEqual(len(events),1)

    def test_recovery_requires_sustained_good_and_allows_new_incident(self):
        state,_=self.run_samples(range(0,301,60))
        state,e=m.advance(state,sample(360,process=5));self.assertIsNone(e)
        state,e=m.advance(state,sample(420,process=5));self.assertEqual(e['kind'],'recovered')
        events=[]
        for t in range(480,781,60):
            state,e=m.advance(state,sample(t))
            if e:events.append(e)
        self.assertEqual(len(events),1)

    def test_restart_keeps_pending_notification_and_does_not_repeat_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            notify=Mock(return_value=False)
            for t in range(0,301,60):m.check_report(sample(t),tmp,notify)
            self.assertEqual(notify.call_count,1)
            notify.return_value=True
            result=m.check_report(sample(360),tmp,notify)
            self.assertEqual(notify.call_count,2)
            self.assertEqual(result['pendingNotifications'],0)
            m.check_report(sample(420),tmp,notify)
            self.assertEqual(notify.call_count,2)
            self.assertEqual(len(list((Path(tmp)/'fps-alerts').glob('*.json'))),1)


if __name__=='__main__':unittest.main()
