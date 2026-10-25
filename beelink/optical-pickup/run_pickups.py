#!/usr/bin/env python3
"""External-first autonomous bounded video-pickup estimator.
Read-only native/photos/Frigate sources; no LLM/browser; no sales/count imports.
"""
from pathlib import Path
from contextlib import closing
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
import argparse,fcntl,hashlib,json,os,signal,sqlite3,subprocess,sys,time
from pickup_core import PROTOCOL,canonical,digest,identify,assess,summarize,validate_policy,require,epoch
from pickup_sync import Sync


def atomic(path,value):
 temp=path.with_suffix('.tmp')
 with temp.open('w') as f:f.write(canonical(value)+'\n');f.flush();os.fsync(f.fileno())
 os.chmod(temp,0o600);os.replace(temp,path)

def observations(path,start):
 with closing(sqlite3.connect(path.as_uri()+'?mode=ro',uri=True,timeout=3)) as db:
  db.execute('PRAGMA query_only=ON');rows=db.execute("SELECT o.payload FROM observations o JOIN outbox b ON b.id=o.id AND b.revision=o.revision AND b.payload_sha=o.payload_sha WHERE o.day>=? AND b.status='acknowledged' ORDER BY o.source_id DESC LIMIT 2001",(start,)).fetchall()
 require(len(rows)<=2000,'native_limit_no_truncation');return [json.loads(r[0]) for r in rows]

def photo_receipts(path):
 with closing(sqlite3.connect(path.as_uri()+'?mode=ro',uri=True,timeout=3)) as db:
  db.execute('PRAGMA query_only=ON');return {r[0]:json.loads(r[1]) for r in db.execute("SELECT id,receipt FROM photos WHERE status='acknowledged' AND receipt IS NOT NULL")}

def source_segments(base,at):
 with closing(sqlite3.connect((base/'config/frigate.db').as_uri()+'?mode=ro',uri=True,timeout=3)) as db:
  db.execute('PRAGMA query_only=ON');rows=db.execute("SELECT path,start_time,end_time FROM recordings WHERE camera='handoff' AND end_time>? AND start_time<? ORDER BY start_time",(at,at+24.3)).fetchall()
 require(1<=len(rows)<=8,'recording_segments_unavailable');result=[];root=base/'storage/recordings'
 for path,start,end in rows:
  rel=Path(path).relative_to('/media/frigate/recordings');require('..' not in rel.parts and len(rel.parts)==4 and rel.parts[2]=='handoff' and rel.suffix=='.mp4','recording_path')
  source=root/rel;require(not source.is_symlink() and source.resolve().is_relative_to(root.resolve()) and source.is_file(),'recording_missing')
  require(0<source.stat().st_size<32*1024*1024,'recording_size')
  if result:require(start>result[-1]['start'] and start>=result[-1]['end']-.5,'recording_ranges_invalid')
  with source.open('rb') as f:sha=hashlib.file_digest(f,'sha256').hexdigest()
  result.append({'path':path,'start':start,'end':end,'sha256':sha})
 return result

def thermal_state(path,now):
 try:
  s=json.loads(path.read_text());age=now-epoch(s['checked_at']);require(0<=age<180,'stale_thermal')
  temp=s.get('max_temperature_c');require(type(temp) in (int,float),'temperature_missing')
  if temp>=83:return 'paused_temperature'
  if s.get('operating_hours') and (s.get('process_fps') or 0)<4.5:return 'paused_primary_detector_load'
  return None
 except (OSError,ValueError,KeyError):return 'paused_health_unavailable'

class Jobs:
 def __init__(self,path):
  self.db=sqlite3.connect(path,timeout=5);self.db.row_factory=sqlite3.Row;self.db.execute('PRAGMA journal_mode=WAL');self.db.execute('PRAGMA synchronous=FULL')
  self.db.execute('CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,day TEXT NOT NULL,source_id TEXT NOT NULL,observation TEXT NOT NULL,status TEXT NOT NULL,record TEXT,reason TEXT,attempts INTEGER NOT NULL DEFAULT 0,last_attempt REAL)');self.db.commit()
 def close(self):self.db.close()
 def discover(self,rows,receipts,policy):
  with self.db:
   for o in rows:
    proof=o.get('sameFrameEvidence');receipt=receipts.get(o['observationId'])
    if not proof or not receipt:continue
    require(receipt.get('imageSha256')==proof['imageSha256'] and receipt.get('sourceEventId')==o['sourceEventId'],'photo_binding')
    excluded=o.get('sourceFalsePositive') or o.get('verification')!='same_frame_local_cv' or o.get('ownerSizeReview',{}).get('label')=='not_cup' or receipt.get('analysisStatus')=='discarded_by_manager'
    jid=identify(o,policy);old=self.db.execute('SELECT status FROM jobs WHERE id=?',(jid,)).fetchone()
    if old:
     self.db.execute('UPDATE jobs SET observation=? WHERE id=?',(canonical(o),jid))
     if excluded:self.db.execute("UPDATE jobs SET status='excluded',reason='source_excluded' WHERE id=?",(jid,))
     continue
    self.db.execute('INSERT INTO jobs(id,day,source_id,observation,status,reason) VALUES(?,?,?,?,?,?)',(jid,o['businessDate'],o['sourceEventId'],canonical(o),'excluded' if excluded else 'queued','source_excluded' if excluded else None))
 def process_one(self,c,policy,now):
  row=self.db.execute("SELECT * FROM jobs WHERE status='queued' AND (last_attempt IS NULL OR last_attempt<?) ORDER BY day DESC,source_id DESC LIMIT 1",(now-30,)).fetchone()
  if not row:return None
  o=json.loads(row['observation']);proof=o['sameFrameEvidence'];at=epoch(proof['capturedAt'])
  if now<at+30:return {'status':'waiting_recording_settle'}
  with self.db:self.db.execute('UPDATE jobs SET attempts=attempts+1,last_attempt=? WHERE id=?',(now,row['id']))
  try:
   root=Path(c['ledgerRoot']);image=root/proof['storedImageRelativePath'];require(not image.is_symlink() and image.resolve().is_relative_to(root.resolve()) and image.is_file(),'seed_image_path')
   with image.open('rb') as f:require(hashlib.file_digest(f,'sha256').hexdigest()==proof['imageSha256'],'seed_image_hash')
   segments=source_segments(Path(c['basePath']),at);payload={'capturedAt':proof['capturedAt'],'box':proof['targetBox'],'segments':segments}
   env=os.environ.copy();env['OMP_NUM_THREADS']='1';env['OPENBLAS_NUM_THREADS']='1';env['TMPDIR']=str(Path(c['stateRoot']).parent);env['PYTHONDONTWRITEBYTECODE']='1'
   child=subprocess.run([c['visionPython'],'-B',str(Path(__file__).with_name('video_flow.py')),str(Path(c['basePath'])/'storage/recordings')],input=canonical(payload),capture_output=True,text=True,env=env,timeout=90)
   require(child.returncode==0 and len(child.stdout)<256000,'video_probe_failed');flow=json.loads(child.stdout)
   require(flow.get('source')=='recorded_video_optical_flow' and flow.get('algorithm')=='sparse_lk_forward_backward_v1','flow_source')
   record={'eventId':row['id'],'sourceEventId':o['sourceEventId'],'observationId':o['observationId'],'businessDate':o['businessDate'],'imageSha256':proof['imageSha256'],'seedCapturedAt':proof['capturedAt'],'samples':flow['samples'],'segments':segments,'stopReason':flow['stopReason'],'source':flow['source'],'algorithm':flow['algorithm']}
   result=assess(record,o,policy)
   assess(record,o,policy)
   with self.db:self.db.execute("UPDATE jobs SET status='complete',record=?,reason=? WHERE id=?",(canonical(record),result['status'],row['id']))
   return {'id':row['id'],'status':'complete','result':result}
  except (OSError,ValueError,KeyError,subprocess.SubprocessError) as exc:
   reason=str(exc) if isinstance(exc,ValueError) else type(exc).__name__
   if len(reason)>100 or '://' in reason:reason=type(exc).__name__
   waiting=reason in ('recording_segments_unavailable','recording_missing') and row['attempts']<5
   with self.db:self.db.execute('UPDATE jobs SET status=?,reason=? WHERE id=?',('queued' if waiting else 'blocked',reason,row['id']))
   return {'id':row['id'],'status':'queued' if waiting else 'blocked','reason':reason}
 def document(self,day,policy):
  records=[json.loads(r[0]) for r in self.db.execute("SELECT record FROM jobs WHERE day=? AND record IS NOT NULL ORDER BY id",(day,))]
  require(len(records)<=2000,'pickup_record_limit_no_truncation')
  return {'protocol':PROTOCOL,'deviceId':policy['deviceId'],'cameraName':'handoff','businessDate':day,'policyJson':canonical(policy),'policySha256':digest(canonical(policy)),'records':records,'scope':'recording_optical_pickup_estimates_not_sales','coverage':'candidate_recording_windows_not_continuous_day','requiresPerImageApproval':False,'generativeAiUsed':False,'coversWholeBusinessDay':False,'physicalUniqueCountCertified':False}

def main():
 p=argparse.ArgumentParser();p.add_argument('--config',type=Path,required=True);p.add_argument('--once',action='store_true');a=p.parse_args();os.umask(0o077)
 c=json.loads(a.config.read_text());base=Path(c['basePath']);root=Path(c['stateRoot']);sys.path.insert(0,str(base/'manus-bridge'));sys.path.insert(0,c['nativeCodePath'])
 from package_storage import verify_external
 from native_sync import NativeHttp
 class Http(NativeHttp):
  def capabilities(self):return self._request('GET','frigate.counterPickupCapabilities')
  def send(self,envelope):return self._request('POST','frigate.submitCounterPickups',{'apiKey':self._key(),**envelope})
  def receipt(self,device,day):return self._request('POST','frigate.counterPickupReceipt',{'apiKey':self._key(),'deviceId':device,'businessDate':day}).get('receipt')
 verify_external(base,root,writable=True,required_bytes=64*1024*1024);root.mkdir(mode=0o700,parents=True,exist_ok=True);policy=validate_policy(json.loads(Path(c['policyFile']).read_text()))
 stop=[False];signal.signal(signal.SIGTERM,lambda *_:stop.__setitem__(0,True));signal.signal(signal.SIGINT,lambda *_:stop.__setitem__(0,True))
 with (root/'worker.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);jobs=Jobs(root/'jobs.sqlite3');sync=Sync(root/'sync.sqlite3',c,Http(c['apiOrigin'],c['machineCredentialFile'],c['storeId']))
  try:
   while not stop[0]:
    verify_external(base,root,writable=True,required_bytes=64*1024*1024)
    rows=observations(Path(c['ledgerRoot'])/'ledger.sqlite3',c['startDate']);receipts=photo_receipts(Path(c['photoDatabase']));jobs.discover(rows,receipts,policy)
    now=time.time();pause=thermal_state(base/'config/ojala_operational_status.json',now);result=None if pause else jobs.process_one(c,policy,now)
    day=datetime.fromtimestamp(now,ZoneInfo(c['timezone'])).date().isoformat();document=jobs.document(day,policy);atomic(root/(day+'.json'),document)
    local=summarize(document['records'],[o for o in rows if o['businessDate']==day],policy)
    transport={'status':'authorization_hold','networkAttempted':False} if (root/'authorization-hold.json').exists() else sync.cycle(document)
    if transport.get('reason') in ('http_401','http_403'):atomic(root/'authorization-hold.json',{'reason':transport['reason'],'createdAt':datetime.now(timezone.utc).isoformat()})
    report={'checkedAt':datetime.now(timezone.utc).isoformat(),'businessDate':day,'status':pause or 'running','latestJob':result,'jobs':dict(jobs.db.execute('SELECT status,count(*) FROM jobs GROUP BY status')),'estimatedPickups':local['estimatedPickups'],'sizeBreakdown':local['sizeBreakdown'],'unresolved':local['unresolved'],'transport':transport,'browserRequired':False,'generativeAiRequired':False,'createsSales':False,'coversWholeBusinessDay':False,'requiresPerImageApproval':False,'physicalUniqueCountCertified':False}
    atomic(root/'health.json',report)
    if a.once:print(canonical(report),flush=True);break
    for _ in range(20):
     if stop[0]:break
     time.sleep(.25)
  finally:jobs.close();sync.close()
if __name__=='__main__':main()
