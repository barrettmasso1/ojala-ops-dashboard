#!/usr/bin/env python3
"""Read-only offline candidate recovery, independent of the narrow handoff gate.

No count creation, cloud writes, camera/config changes or deletion of originals.
"""
import argparse,datetime as dt,fcntl,hashlib,json,os,subprocess,sys,time
from pathlib import Path
from zoneinfo import ZoneInfo
TZ=ZoneInfo('America/Mazatlan');BASE=Path('/home/ojala/frigate')
EXTERNAL=Path('/tmp/externo/home-ojala/ojala-active-evidence-20261017/post-close-recovery')
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'manus-bridge'))
from package_storage import verify_external,offline_preflight,snapshot_atomic,temperature_c

def sha(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
def atomic_json(path,obj):
 path.parent.mkdir(parents=True,exist_ok=True,mode=0o700);temp=path.with_name(path.name+'.tmp')
 with temp.open('w') as f:json.dump(obj,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 os.replace(temp,path)
def run(cmd):return subprocess.run(cmd,check=True,text=True,capture_output=True,timeout=60)
def guard_reason(temp,frigate_running):
 if frigate_running is not False:return 'offline_scan_camera_running_or_unknown'
 if temp is None:return 'offline_scan_temperature_unknown'
 if temp>=83:return 'offline_scan_paused_high_temperature'
 return None

def run_scan_guarded(command,name,log_path,max_seconds=3600):
 started=time.monotonic();reason=None
 with log_path.open('w') as log:
  child=subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT,text=True)
  try:
   while child.poll() is None:
    state=subprocess.run(['docker','inspect','frigate','--format','{{.State.Running}}'],capture_output=True,text=True,timeout=4)
    running=False if state.returncode==0 and state.stdout.strip()=='false' else True
    reason=guard_reason(temperature_c(),running)
    if not reason and time.monotonic()-started>=max_seconds:reason='offline_scan_bounded_runtime_reached'
    if reason:break
    time.sleep(2)
   if reason:
    subprocess.run(['docker','stop','--time','5',name],capture_output=True,timeout=12)
    try:child.wait(timeout=12)
    except subprocess.TimeoutExpired:
     subprocess.run(['docker','kill',name],capture_output=True,timeout=8);child.terminate();child.wait(timeout=8)
    raise RuntimeError(reason)
   if child.returncode!=0:raise RuntimeError('offline_scan_failed_see_private_log')
  finally:
   if child.poll() is None:
    subprocess.run(['docker','stop','--time','5',name],capture_output=True,timeout=12)
    try:child.wait(timeout=12)
    except subprocess.TimeoutExpired:child.terminate()
 return {'elapsedSeconds':round(time.monotonic()-started,3)}

def main():
 os.umask(0o077)
 ap=argparse.ArgumentParser();ap.add_argument('--date');ap.add_argument('--source-db');ap.add_argument('--limit',type=int,default=100)
 ap.add_argument('--search-area',choices=['handoff_zone','full_frame'],default='full_frame')
 args=ap.parse_args();day=args.date or dt.datetime.now(TZ).date().isoformat();date=dt.date.fromisoformat(day)
 if not 1<=args.limit<=2000:raise ValueError('invalid_offline_window_limit')
 if not args.date and date.weekday() not in (4,5,6):
  print(json.dumps({'status':'skipped_non_operating_day','businessDate':day}));return
 lock=BASE/'pilot-tools/post-close-recovery.lock'
 with lock.open('a') as handle:
  try:fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:print(json.dumps({'status':'already_running','businessDate':day}));return
  status_path=BASE/f'pilot-reports/{day}/post-close-recovery-status.json'
  result={'schemaVersion':2,'businessDate':day,'checkedAt':dt.datetime.now(TZ).isoformat(),'searchArea':args.search_area,
   'readOnlySources':True,'productionModified':False,'productionThresholdModified':False,'fullShiftReviewCompleted':False,
   'dailyUniqueCupCount':None,'approvedCountsWritten':False,'networkWrites':0,'dockerCpuLimit':0.25,'thermalPauseAtC':83}
  try:
   verify_external(BASE,EXTERNAL,writable=True);offline_preflight(BASE)
   root=EXTERNAL/day;root.mkdir(parents=True,exist_ok=True,mode=0o700)
   snapshot=root/'frigate-close-snapshot.sqlite3';source=Path(args.source_db) if args.source_db else BASE/'config/frigate.db'
   snapshot_atomic(source,snapshot)
   run(['/usr/bin/python3',str(BASE/'pilot-tools/full_shift_gap_audit.py'),'--date',day,'--db',str(snapshot),'--top',str(args.limit)])
   audit=BASE/f'pilot-reports/{day}/full-shift-gap-audit/audit.json';audit_doc=json.loads(audit.read_text())
   scope={'snapshotSha256':sha(snapshot),'auditSha256':sha(audit),'scannerSha256':sha(BASE/'pilot-tools/full_shift_offline_rescue_scan.py'),
    'regionHelperSha256':sha(BASE/'pilot-tools/offline_search_region.py'),'modelSha256':sha(BASE/'config/model_cache/ojala_cups_v4_640.onnx'),
    'configSha256':sha(BASE/'config/config.yaml'),'searchArea':args.search_area,'limit':args.limit}
   scope_id=hashlib.sha256(json.dumps(scope,sort_keys=True,separators=(',',':')).encode()).hexdigest()
   out=root/('offline-rescue-'+args.search_area+'-'+scope_id[:12]);verify_external(BASE,out,writable=True)
   out.mkdir(parents=True,exist_ok=True,mode=0o700);atomic_json(out/'scope.json',scope)
   report=out/'report.json'
   if not report.exists():
    image=run(['docker','inspect','frigate','--format','{{.Config.Image}}']).stdout.strip();name='ojala-offline-review-'+str(os.getpid())
    cmd=['docker','run','--rm','--name',name,'--cpus','0.25','--network','none','--entrypoint','python3',
     '-v',str(BASE/'pilot-tools/full_shift_offline_rescue_scan.py')+':/scan.py:ro',
     '-v',str(BASE/'pilot-tools/offline_search_region.py')+':/offline_search_region.py:ro',
     '-v',str(audit)+':/audit.json:ro','-v',str(BASE/'pilot-archive/forward-20260929')+':/archive:ro',
     '-v',str(BASE/'config/config.yaml')+':/config.yaml:ro',
     '-v',str(BASE/'config/model_cache/ojala_cups_v4_640.onnx')+':/models/cup.onnx:ro',
     '-v',str(BASE/'pilot-tools/offline-models')+':/models/person:ro','-v',str(out)+':/output',image,
     '/scan.py','--audit','/audit.json','--archive','/archive','--config','/config.yaml','--cup-model','/models/cup.onnx',
     '--person-model','/models/person/ssdlite_mobilenet_v2.xml','--output','/output','--limit',str(args.limit),
     '--cup-threshold','0.10','--search-area',args.search_area]
    result['run']=run_scan_guarded(cmd,name,out/'run.log')
   scan=json.loads(report.read_text())
   if scan.get('searchArea')!=args.search_area or scan.get('windowsRequested')!=min(args.limit,len(audit_doc.get('topWindows',[]))):raise RuntimeError('cached_scan_scope_mismatch')
   result.update(status='sampled_recovery_complete',snapshotPath=str(snapshot),snapshotSha256=scope['snapshotSha256'],scopeFingerprint=scope_id,
    recordingMetadataCoveragePct=audit_doc.get('recordingMetadataCoveragePct'),fullShiftRankingValid=audit_doc.get('fullShiftRankingValid'),
    offlineFramesScanned=scan.get('framesScanned'),candidateWindows=scan.get('candidateWindows'),decodeErrors=scan.get('decodeErrors'),externalOutput=str(out),
    note='Full-frame SEARCH still samples prioritized windows. Candidates are not a complete physical-cup total.')
   atomic_json(out/'status.json',result)
  except Exception as exc:
   known=str(exc) if isinstance(exc,(RuntimeError,ValueError)) and str(exc).startswith(('offline_','external_','internal_','cached_','snapshot_')) else 'offline_scan_failed'
   result.update(status='paused_or_failed',reason=known,errorType=type(exc).__name__,partialEvidencePreserved=True)
   atomic_json(status_path,result);print(json.dumps(result));raise SystemExit(2)
  atomic_json(status_path,result);print(json.dumps(result,indent=2))
if __name__=='__main__':main()
