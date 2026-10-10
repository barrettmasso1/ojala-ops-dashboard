#!/usr/bin/env python3
"""Recover capture whenever Frigate runs; auto-start Frigate only in its schedule."""
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import time
from urllib.request import urlopen
from zoneinfo import ZoneInfo

BASE=Path("/home/ojala/frigate/config")
HEALTH=BASE/"verified_capture_health.json"
STATUS=BASE/"ojala_operational_status.json"
RESTARTS=BASE/"ojala_guard_restarts.json"
SCRIPT=BASE/"verified_capture.py"
TZ=ZoneInfo("America/Mazatlan")
PROCESS_CODE=r"""
import os,sys,signal,json
ids=[]
for n in os.listdir('/proc'):
    if n.isdigit():
        try:
            a=open('/proc/'+n+'/cmdline','rb').read().split(b'\0')
            if len(a)>1 and a[1]==b'/config/verified_capture.py':
                ids.append(int(n))
        except (FileNotFoundError,PermissionError,ProcessLookupError): pass
if len(sys.argv)>1 and sys.argv[1]=='stop':
    for pid in ids:
        try: os.kill(pid,signal.SIGTERM)
        except ProcessLookupError: pass
print(json.dumps(ids))
"""
def call(args,timeout=15):
    return subprocess.run(args,capture_output=True,text=True,timeout=timeout)
def read_json(path,default):
    try: return json.loads(path.read_text())
    except (OSError,ValueError): return default
def write_json(path,obj):
    tmp=path.with_name(path.name+".tmp")
    with open(tmp,"w") as f:
        f.write(json.dumps(obj,indent=2)+"\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp,path)
    sync_directory(path.parent)
def sync_directory(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)
def append_history(path,obj):
    # A power-interrupted tail must not be joined to the next JSON record.
    # Preserve that tail for audit rather than silently discarding it.
    created=not path.exists()
    with open(path,"a+b") as f:
        f.seek(0,os.SEEK_END)
        if f.tell():
            f.seek(-1,os.SEEK_END)
            if f.read(1)!=b"\n": f.write(b"\n")
        f.write((json.dumps(obj)+"\n").encode())
        f.flush()
        os.fsync(f.fileno())
    if created: sync_directory(path.parent)
def host_health():
    metrics={"load_1m":round(os.getloadavg()[0],2),"warnings":[]}
    try:
        metrics["host_uptime_seconds"]=round(float(Path('/proc/uptime').read_text().split()[0]),1)
        metrics["boot_id"]=Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    except (OSError,ValueError): pass
    temperatures=[]
    for p in Path('/sys/class/thermal').glob('thermal_zone*/temp'):
        try:
            value=float(p.read_text())/1000
            if 0<value<130: temperatures.append(value)
        except (OSError,ValueError): pass
    if temperatures:
        metrics["max_temperature_c"]=max(temperatures)
        if max(temperatures)>=85: metrics["warnings"].append('high_temperature')
    return metrics
def in_hours(now):
    return now.weekday() in (4,5,6) and 12<=now.hour<21
def process_ids(stop=False):
    args=["docker","exec","frigate","python3","-c",PROCESS_CODE]
    if stop: args.append("stop")
    r=call(args)
    return json.loads(r.stdout) if r.returncode==0 else None
def restart_allowed(now,reason):
    previous=read_json(RESTARTS,{"times":[]})
    recent=[x for x in previous.get("times",[]) if now-x<900]
    if len(recent)>=3: return False
    recent.append(now)
    write_json(RESTARTS,{"times":recent,"reason":reason,"last_epoch":now})
    return True
def start_worker():
    log_path=BASE/"verified_capture_bootstrap.log"
    if log_path.exists() and log_path.stat().st_size>1024**2:
        os.replace(log_path,log_path.with_suffix(".previous.log"))
    with open(log_path,"a") as log:
        subprocess.Popen([str(BASE/"run_verified_capture.sh")],
                         stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
def main():
    lock=open("/tmp/ojala_guard.lock","w")
    try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError: return
    now=dt.datetime.now(TZ);epoch=time.time()
    report={"checked_at":now.isoformat(),"checked_epoch":epoch,
            "operating_hours":in_hours(now),"actions":[],
            "disk_free_gib":round(shutil.disk_usage(BASE).free/1024**3,2)}
    report.update(host_health())
    try:
        r=call(["docker","inspect","-f","{{.State.Running}}","frigate"])
        if r.returncode!=0:
            report["status"]="container_missing"
            return
        if r.stdout.strip()!="true":
            if not in_hours(now):
                report["status"]="outside_operating_hours"
                return
            if not restart_allowed(epoch,"container_stopped"):
                report["status"]="recovery_rate_limited"
                return
            r=call(["docker","start","frigate"],30)
            report["actions"].append("start_frigate")
            if r.returncode:
                report["status"]="container_start_failed"
                return
            time.sleep(2)
        report["manual_session_outside_schedule"] = not in_hours(now)
        health=read_json(HEALTH,{})
        ids=process_ids()
        age=epoch-float(health.get("heartbeat_epoch",0))
        report["worker_processes"]=len(ids) if ids is not None else None
        report["worker_heartbeat_age_seconds"]=round(age,1)
        report["worker_status"]=health.get("status","unknown")
        current_hash=hashlib.sha256(SCRIPT.read_bytes()).hexdigest()
        stale=bool(ids) and (age>150 or health.get("source_sha256")!=current_hash)
        duplicate=ids is not None and len(ids)>1
        if ids==[] or stale or duplicate:
            reason="missing_worker" if ids==[] else "duplicate_or_stalled_worker"
            if restart_allowed(epoch,reason):
                if ids:
                    process_ids(stop=True);time.sleep(2)
                start_worker()
                report["actions"].append("start_verified_capture")
            else:
                report["status"]="recovery_rate_limited"
        try:
            with urlopen("http://127.0.0.1:5000/api/stats",timeout=4) as resp:
                cam=json.load(resp)["cameras"]["handoff"]
            report.update({k:cam.get(k) for k in ("camera_fps","process_fps","skipped_fps")})
        except Exception as exc:
            report["api_error_type"]=type(exc).__name__
        try:
            con=sqlite3.connect("file:"+str(BASE/"frigate.db")+"?mode=ro",uri=True,timeout=2)
            row=con.execute("SELECT max(end_time) FROM recordings WHERE camera='handoff'").fetchone()
            con.close()
            report["recording_age_seconds"]=round(epoch-float(row[0]),1) if row[0] else None
        except Exception as exc:
            report["recording_error_type"]=type(exc).__name__
        report["verified_snapshots"]=len(list((BASE/"verified_snapshots/handoff").glob("*.json")))
        if "status" not in report:
            if report.get("camera_fps",0)<1:
                report["status"]="camera_or_api_unavailable"
            elif report.get("recording_age_seconds",9999)>120:
                report["status"]="recording_stale"
            elif report["disk_free_gib"]<1:
                report["status"]="disk_low"
            elif report.get("skipped_fps",0)>1:
                report["status"]="detection_processing_lag"
            elif health.get("status")=="degraded":
                report["status"]="capture_degraded"
            else:
                report["status"]="recovering" if report["actions"] else "healthy"
    except Exception as exc:
        report["status"]="guard_error";report["error_type"]=type(exc).__name__
    finally:
        write_json(STATUS,report)
        history=BASE/"health_reports"
        history.mkdir(exist_ok=True)
        append_history(history/(now.strftime("%Y-%m-%d")+".jsonl"),report)
        for old in history.glob("*.jsonl"):
            if time.time()-old.stat().st_mtime>30*86400:
                old.unlink()
        print(json.dumps(report))
if __name__=="__main__": main()
