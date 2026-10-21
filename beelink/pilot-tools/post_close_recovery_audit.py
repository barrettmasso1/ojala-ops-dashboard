#!/usr/bin/env python3
"""Post-close read-only recovery audit for Ojala handoff video.

Preserves a SQLite snapshot, ranks high-motion windows without nearby cup events,
and runs the offline recovery scanner. Never writes approved counts or network data.
"""
import argparse, datetime as dt, fcntl, hashlib, json, os, sqlite3, subprocess, sys
from pathlib import Path
from zoneinfo import ZoneInfo

TZ=ZoneInfo("America/Mazatlan")
BASE=Path("/home/ojala/frigate")
EXTERNAL=Path("/tmp/externo/home-ojala/ojala-active-evidence-20261017/post-close-recovery")

def sha(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""): h.update(chunk)
    return h.hexdigest()

def atomic_json(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+".tmp")
    tmp.write_text(json.dumps(obj,indent=2)+"\n")
    os.replace(tmp,path)

def backup_sqlite(source,dest):
    from package_storage import snapshot_atomic
    snapshot_atomic(source,dest)


def run(cmd):
    return subprocess.run(cmd,check=True,text=True,capture_output=True)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--date")
    ap.add_argument("--source-db",default=None,help="Optional preserved Frigate SQLite snapshot for historical reconstruction")
    ap.add_argument("--limit",type=int,default=100)
    a=ap.parse_args()
    explicit=bool(a.date)
    day=a.date or dt.datetime.now(TZ).date().isoformat()
    parsed=dt.date.fromisoformat(day)
    if not explicit and parsed.weekday() not in (4,5,6):
        print(json.dumps({"status":"skipped_non_operating_day","businessDate":day}))
        return
    lock_path=BASE/"pilot-tools/post-close-recovery.lock"
    lock_path.parent.mkdir(parents=True,exist_ok=True)
    with lock_path.open("w") as lock:
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({"status":"already_running","businessDate":day})); return
        sys.path.insert(0,str(BASE/'manus-bridge'))
        from package_storage import verify_external, offline_preflight
        verify_external(BASE, EXTERNAL, writable=True)
        offline_preflight(BASE)
        outroot=EXTERNAL/day
        outroot.mkdir(parents=True,exist_ok=True)
        snapshot=outroot/"frigate-close-snapshot.sqlite3"
        source_db=Path(a.source_db) if a.source_db else BASE/"config/frigate.db"
        backup_sqlite(source_db,snapshot)
        audit_cmd=[
            "python3",str(BASE/"pilot-tools/full_shift_gap_audit.py"),
            "--date",day,"--db",str(snapshot),"--top",str(a.limit)
        ]
        audit=run(audit_cmd)
        audit_path=BASE/f"pilot-reports/{day}/full-shift-gap-audit/audit.json"
        audit_doc=json.loads(audit_path.read_text())
        scan_out=outroot/"offline-rescue"
        scan_out.mkdir(parents=True,exist_ok=True)
        scan_report=scan_out/"report.json"
        if not scan_report.exists():
            image=run(["docker","inspect","frigate","--format","{{.Config.Image}}"]).stdout.strip()
            cmd=[
                "docker","run","--rm","--cpus","1.0","--network","none","--entrypoint","python3",
                "-v",f"{BASE/'pilot-tools/full_shift_offline_rescue_scan.py'}:/scan.py:ro",
                "-v",f"{audit_path}:/audit.json:ro",
                "-v",f"{BASE/'pilot-archive/forward-20260929'}:/archive:ro",
                "-v",f"{BASE/'config/config.yaml'}:/config.yaml:ro",
                "-v",f"{BASE/'config/model_cache/ojala_cups_v4_640.onnx'}:/models/cup.onnx:ro",
                "-v",f"{BASE/'pilot-tools/offline-models'}:/models/person:ro",
                "-v",f"{scan_out}:/output",
                image,"/scan.py","--audit","/audit.json","--archive","/archive","--config","/config.yaml",
                "--cup-model","/models/cup.onnx","--person-model","/models/person/ssdlite_mobilenet_v2.xml",
                "--output","/output","--limit",str(a.limit),"--cup-threshold","0.10"
            ]
            run(cmd)
        scan=json.loads(scan_report.read_text())
        if scan.get('windowsRequested') != min(a.limit,len(audit_doc.get('topWindows',[]))):
            raise RuntimeError('cached_scan_scope_mismatch')
        status={
            "schemaVersion":1,"businessDate":day,"checkedAt":dt.datetime.now(TZ).isoformat(),
            "status":"sampled_recovery_complete","readOnlySources":True,"productionModified":False,
            "fullShiftReviewCompleted":False,"dailyUniqueCupCount":None,
            "approvedCountsWritten":False,"networkWrites":0,
            "sourceDb":str(source_db.resolve()),"snapshotPath":str(snapshot),"snapshotSha256":sha(snapshot),
            "recordingMetadataCoveragePct":audit_doc.get("recordingMetadataCoveragePct"),
            "fullShiftRankingValid":audit_doc.get("fullShiftRankingValid"),
            "silentMotionWindows":audit_doc.get("silentMotionWindows"),
            "offlineFramesScanned":scan.get("framesScanned"),
            "candidateWindows":scan.get("candidateWindows"),
            "decodeErrors":scan.get("decodeErrors"),
            "externalOutput":str(scan_out),
            "note":"Candidates require temporal review and deduplication; this process never creates a physical-cup total."
        }
        local_status=BASE/f"pilot-reports/{day}/post-close-recovery-status.json"
        atomic_json(local_status,status)
        atomic_json(outroot/"status.json",status)
        print(json.dumps(status,indent=2))
if __name__=="__main__":
    main()
