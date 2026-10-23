#!/usr/bin/env python3
"""Collect every cup track and its verified local evidence, independently of chat.

Never starts Frigate, opens a browser, calls a language model, writes camera
configuration, creates approved_counts, or turns snapshots into sales.
"""
from __future__ import annotations
import argparse,fcntl,hashlib,json,os,signal,sqlite3,stat,sys,time
from contextlib import closing
from datetime import datetime,timedelta,timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from ledger import Ledger,InvalidEvidence,canonical,digest,normalize_track,verify_sidecar,EVENT_RE,require

MAX_SOURCE_ROWS=20000

def atomic(path:Path,value):
    tmp=path.with_name(path.name+'.tmp')
    require(not path.is_symlink() and not tmp.is_symlink(),'unsafe_output_path')
    with tmp.open('w') as f:
        os.chmod(tmp,0o600);f.write(canonical(value)+'\n');f.flush();os.fsync(f.fileno())
    os.replace(tmp,path)

def file_sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def read_tracks(source:Path,day:str,tz='America/Mazatlan'):
    begin=datetime.fromisoformat(day).replace(tzinfo=ZoneInfo(tz));end=begin+timedelta(days=1)
    require(source.is_file(),'source_database_missing')
    with closing(sqlite3.connect(source.resolve().as_uri()+'?mode=ro',uri=True,timeout=3)) as db:
        db.row_factory=sqlite3.Row;db.execute('PRAGMA query_only=ON')
        rows=db.execute('SELECT id,label,camera,start_time,end_time,top_score,false_positive,zones,box,data,model_hash,detector_type FROM event WHERE camera=? AND label=? AND start_time>=? AND start_time<? ORDER BY start_time,id LIMIT ?',('handoff','cup',begin.timestamp(),end.timestamp(),MAX_SOURCE_ROWS+1)).fetchall()
        require(len(rows)<=MAX_SOURCE_ROWS,'source_window_overflow_no_silent_truncation')
        return [dict(row) for row in rows]

class Collector:
    def __init__(self,config):
        require(config.get('schemaVersion')==1,'configuration_version')
        self.base=Path(config['basePath']);self.root=Path(config['stateRoot']);self.config=config
        self.zone=ZoneInfo(config.get('timezone','America/Mazatlan'))
        sys.path.insert(0,str(self.base/'manus-bridge'))
        from package_storage import verify_external
        self.guard=verify_external;self.guard(self.base,self.root,writable=True,required_bytes=32*1024*1024)
        self.root.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.db=Ledger(self.root/'ledger.sqlite3')
        self.source=self.base/'config/frigate.db';self.images=self.base/'config/verified_snapshots/handoff'
        self.model=self.base/'config/model_cache/ojala_cups_v4_640.onnx'
        require(self.model.is_file() and not self.model.is_symlink(),'model_unavailable')
        self.model_sha=file_sha(self.model)
        require(self.model_sha==config.get('expectedModelSha256'),'model_fingerprint_mismatch')
        self.model_stat=(self.model.stat().st_ino,self.model.stat().st_mtime_ns,self.model.stat().st_size)
        self.last_snapshot_sha={};self.sidecar_cache={}
    def close(self):self.db.close()
    def cycle(self,day=None):
        now=datetime.now(self.zone);day=day or now.date().isoformat()
        require(datetime.fromisoformat(day).date().isoformat()==day,'invalid_business_date')
        self.guard(self.base,self.root,writable=True,required_bytes=32*1024*1024)
        st=self.model.stat();require((st.st_ino,st.st_mtime_ns,st.st_size)==self.model_stat,'model_changed_reload_required')
        rows=read_tracks(self.source,day,str(self.zone));changed=0;bad=[];evidence_errors=[];verified=0
        for raw in rows:
            try:
                track=normalize_track(raw,self.config['deviceId'],self.model_sha,str(self.zone))
                track['sourceDetectorModelHash']=raw.get('model_hash')
                track['sourceDetectorType']=raw.get('detector_type')
                evidence=None
                stem=datetime.fromtimestamp(raw['start_time'],timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'_'+raw['id']
                meta_path=self.images/(stem+'.json');image=self.images/(stem+'.jpg')
                if meta_path.exists() and image.exists():
                    try:
                        require(not meta_path.is_symlink() and not image.is_symlink(),'evidence_symlink')
                        require(meta_path.parent==self.images and image.parent==self.images,'evidence_path')
                        sm=meta_path.stat();si=image.stat()
                        require(stat.S_ISREG(sm.st_mode) and stat.S_ISREG(si.st_mode),'evidence_not_regular')
                        require(0<sm.st_size<=65536 and 0<si.st_size<=8*1024*1024,'evidence_size')
                        if time.time()-max(sm.st_mtime,si.st_mtime)>=2:
                            cachekey=(sm.st_ino,sm.st_size,sm.st_mtime_ns,si.st_ino,si.st_size,si.st_mtime_ns)
                            cached=self.sidecar_cache.get(raw['id'])
                            if cached and cached[0]==cachekey:
                                evidence=cached[1]
                            else:
                                rawmeta=meta_path.read_bytes();meta=json.loads(rawmeta)
                                pixels=image.read_bytes();evidence=verify_sidecar(meta,pixels,track)
                                evidence['originalSidecarSha256']=digest(rawmeta)
                                self.guard(self.base,self.root,writable=True,required_bytes=len(pixels)+len(rawmeta)+65536)
                                folder=self.root/'evidence';folder.mkdir(mode=0o700,exist_ok=True)
                                for content,suffix in ((pixels,'.jpg'),(rawmeta,'.json')):
                                    target=folder/(digest(content)+suffix)
                                    require(not target.is_symlink(),'evidence_archive_symlink')
                                    if target.exists():require(file_sha(target)==digest(content),'evidence_archive_changed')
                                    else:
                                        tmp=target.with_suffix(target.suffix+'.tmp')
                                        require(not tmp.is_symlink(),'evidence_archive_symlink')
                                        with tmp.open('wb') as stream:
                                            os.chmod(tmp,0o600);stream.write(content);stream.flush();os.fsync(stream.fileno())
                                        os.replace(tmp,target)
                                evidence['storedImageRelativePath']='evidence/'+digest(pixels)+'.jpg'
                                evidence['storedSidecarRelativePath']='evidence/'+digest(rawmeta)+'.json'
                                self.sidecar_cache[raw['id']]=(cachekey,evidence)
                            verified+=1
                    except (OSError,ValueError,KeyError,TypeError) as exc:
                        evidence_errors.append({'sourceEventId':raw['id'],'reason':str(exc) if isinstance(exc,InvalidEvidence) else type(exc).__name__})
                changed+=self.db.put(track,evidence)
            except (OSError,ValueError,KeyError,TypeError) as exc:
                bad.append({'sourceEventId':raw.get('id'),'reason':str(exc) if isinstance(exc,InvalidEvidence) else type(exc).__name__})
        snap=self.db.snapshot(day);encoded=canonical(snap);snapshot_sha=digest(encoded)
        if self.last_snapshot_sha.get(day)!=snapshot_sha:
            atomic(self.root/(day+'.json'),snap);self.last_snapshot_sha[day]=snapshot_sha
        health={'checkedAt':now.isoformat(),'status':'attention_required' if bad or evidence_errors else 'recording_local_observations',
          'businessDate':day,'sourceDatabaseReadOnly':True,'sourceTracksRead':len(rows),'changedObservations':changed,
          'verifiedLocalEvidence':verified,'invalidTracks':bad,'invalidEvidence':evidence_errors,
          'snapshotSha256':snapshot_sha,'stateRoot':str(self.root),'networkWrites':0,'browserRequired':False,
          'generativeAiRequired':False,'usesExistingFrigateDetector':True,'startsCamera':False,
          'physicalDeliveryCountCreated':False,'productionApprovedCountsChanged':False,'cloudSyncStatus':'not_enabled'}
        atomic(self.root/'health.json',health);return health

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--config',required=True,type=Path);ap.add_argument('--date');ap.add_argument('--daemon',action='store_true');a=ap.parse_args()
    os.umask(0o077);config=json.loads(a.config.read_text());root=Path(config['stateRoot'])
    base=Path(config['basePath']);sys.path.insert(0,str(base/'manus-bridge'));from package_storage import verify_external
    verify_external(base,root,writable=True,required_bytes=32*1024*1024);root.mkdir(parents=True,exist_ok=True,mode=0o700)
    with (root/'collector.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);collector=Collector(config);stop=[False]
        def finish(*_):stop[0]=True
        signal.signal(signal.SIGTERM,finish);signal.signal(signal.SIGINT,finish)
        try:
            while not stop[0]:
                try:
                    result=collector.cycle(a.date)
                    if not a.daemon or result['changedObservations'] or result['status']=='attention_required':print(canonical(result),flush=True)
                except Exception as exc:
                    result={'checkedAt':datetime.now(timezone.utc).isoformat(),'status':'paused','reason':str(exc) if isinstance(exc,InvalidEvidence) else type(exc).__name__,'productionCountsWritten':False}
                    print(canonical(result),flush=True)
                    if not a.daemon:raise SystemExit(2)
                if not a.daemon:break
                for _ in range(max(1,int(config.get('pollSeconds',2)))*4):
                    if stop[0]:break
                    time.sleep(0.25)
        finally:collector.close()

if __name__=='__main__':main()
