#!/usr/bin/env python3
"""Host cron supervisor. Does not start Frigate or alter its configuration."""
import datetime as dt,fcntl,json,os,subprocess,time
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT=Path('/home/ojala/frigate/config/rescue_shadow')
STATE=ROOT/'supervisor.json'
HEALTH=ROOT/'state/health.json'
CMD='/config/rescue_shadow/rescue_shadow.py'

def write(value):
    temp=STATE.with_suffix('.tmp')
    with temp.open('w') as f:json.dump(value,f);f.flush();os.fsync(f.fileno())
    os.replace(temp,STATE)
    print(json.dumps(value))

def call(args,timeout=8):return subprocess.run(args,capture_output=True,text=True,timeout=timeout)

def main():
    now=time.time();local=dt.datetime.now(ZoneInfo('America/Mazatlan'))
    if not ROOT.exists():return
    lock=(ROOT/'supervisor.lock').open('w')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:return
    try:state=json.loads(STATE.read_text())
    except (OSError,ValueError):state={}
    starts=[s for s in state.get('starts',[]) if 0<=now-s<900]
    result={'checked_at':local.isoformat(),'starts':starts,'action':'none'}
    if not (ROOT/'enabled.json').exists():result['status']='disabled';write(result);return
    if local.weekday() not in (4,5,6) or not 12<=local.hour<21:result['status']='outside_existing_schedule';write(result);return
    container=call(['docker','inspect','frigate','--format','{{.State.Running}}'])
    if container.returncode or container.stdout.strip()!='true':result['status']='frigate_not_running';write(result);return
    # Read exact container command lines. Only this worker can be signalled.
    inspect="from pathlib import Path; import json; out=[]\nfor p in Path('/proc').iterdir():\n if p.name.isdigit():\n  try:\n   a=(p/'cmdline').read_bytes().split(b'\\0'); a=[x.decode() for x in a if x]\n   if len(a)>=3 and a[1]=='/config/rescue_shadow/rescue_shadow.py' and a[2]=='live':out.append(int(p.name))\n  except OSError:pass\nprint(json.dumps(out))"
    check=call(['docker','exec','frigate','python3','-c',inspect])
    if check.returncode:result['status']='process_check_failed';write(result);return
    pids=json.loads(check.stdout)
    try:health=json.loads(HEALTH.read_text())
    except (OSError,ValueError):health={}
    age=now-float(health.get('heartbeat_epoch',0));result['heartbeat_age_seconds']=round(age,1)
    if pids and age<120:result['status']='worker_alive';result['pids']=pids;write(result);return
    if pids and starts and now-starts[-1]<120:result['status']='worker_starting';write(result);return
    if len(starts)>=3:result['status']='restart_rate_limited';write(result);return
    if pids:
        stopped=call(['docker','exec','frigate','kill','-TERM',*[str(p) for p in pids]])
        result['status']='stale_worker_signalled' if not stopped.returncode else 'stop_failed'
        result['action']='stop_stale';write(result);return
    started=call(['docker','exec','-d','frigate','nice','-n','15','python3',CMD,'live'])
    result['status']='started' if not started.returncode else 'start_failed'
    if not started.returncode:result['starts']=starts+[now];result['action']='start'
    write(result)

if __name__=='__main__':
    try:main()
    except Exception as exc:
        print(json.dumps({'status':'supervisor_error','error_type':type(exc).__name__}))
        raise SystemExit(1)
