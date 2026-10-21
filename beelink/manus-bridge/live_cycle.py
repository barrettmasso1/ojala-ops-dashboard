#!/usr/bin/env python3
"""Run the supported relay in normal or already-running manual camera sessions."""
import fcntl,json,os,sqlite3,subprocess,sys
from contextlib import closing
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import manus_bridge as b
TZ=ZoneInfo('America/Mazatlan')

def eligible(now,frigate_running):
    scheduled=now.weekday() in (4,5,6) and 12<=now.hour<=21
    return scheduled or frigate_running, 'scheduled_window' if scheduled else 'manual_camera_session' if frigate_running else 'inactive'

def camera_running():
    try:
        p=subprocess.run(['docker','inspect','frigate','--format','{{.State.Running}}'],capture_output=True,text=True,timeout=4,check=True)
        return p.stdout.strip()=='true'
    except (OSError,subprocess.SubprocessError):return False

def step(command):
    try:
        p=subprocess.run(command,capture_output=True,text=True,timeout=240)
        lines=p.stdout.strip().splitlines()
        value=json.loads(lines[-1]) if lines else {}
        allowed=['status','reason','batchId','dashboardReceived','directFrigateVerified','taskAccepted','selectedEvents','newEvents','reconciled','verified','waiting','errors','coveredEventIds']
        out={k:value[k] for k in allowed if k in value}
        if isinstance(value.get('receipts'),dict):out['receipts']={k:v for k,v in value['receipts'].items() if k in ('verified','waiting','errors')}
        out['exitCode']=p.returncode
        return out
    except subprocess.TimeoutExpired:return {'status':'step_timed_out','resultMayBeUnknown':True,'blindRetryAllowed':False}
    except Exception as exc:return {'status':'step_failed','errorType':type(exc).__name__}

def pending_delivery(base):
    """Read only; staged work survives the end of a manual camera session."""
    path=Path(base)/'manus-bridge/state/queue.sqlite3'
    if not path.exists():
        return False
    with closing(sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True,timeout=3)) as db:
        db.execute('PRAGMA query_only=ON')
        return db.execute("SELECT 1 FROM batches WHERE status IN ('queued','retry','dispatching','delivery_unknown','awaiting_dashboard_receipt') LIMIT 1").fetchone() is not None


def run(base=b.BASE):
    now=datetime.now(TZ);on=camera_running();ok,reason=eligible(now,on)
    result={'checkedAt':now.isoformat(),'businessDate':now.date().isoformat(),'cameraRunning':on,'trigger':reason,'startsCamera':False}
    followup_only=False
    if not ok:
        try:
            outstanding=pending_delivery(base)
        except (OSError,sqlite3.Error):
            result.update(status='blocked_pending_queue_unreadable',networkAttempted=False)
            return result
        if not outstanding:
            result['status']='inactive_no_network';return result
        followup_only=True
        result.update(trigger='pending_delivery_followup',newCaptureCollectionAllowed=False)
    lockpath=Path('/tmp/ojala_realtime_visual_cycle.lock')
    with lockpath.open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:result['status']='already_running';return result
        root=base/'manus-bridge';python='/usr/bin/python3'
        result['reconcile']=step([python,str(root/'manus_bridge.py'),'reconcile'])
        if followup_only:
            result['collect']={'status':'not_attempted_followup_only'}
        else:
            args=[python,str(root/'realtime_visual_bridge.py'),'--max-events','5']
            if reason=='manual_camera_session':args.append('--force')
            result['collect']=step(args)
        if result['collect'].get('status') not in ('blocked','api_auth_hold','step_failed','step_timed_out'):
            result['send']=step([python,str(root/'manus_bridge.py'),'send'])
        else:result['send']={'status':'not_attempted_due_to_local_block'}
        result['status']='followup_checked' if followup_only else 'cycle_checked';result['physicalCountCreatedByCycle']=False
        b.private_json(root/'state/realtime-cycle-latest.json',result)
    return result

if __name__=='__main__':
    os.umask(0o077)
    print(json.dumps(run()))
