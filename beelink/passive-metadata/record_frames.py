#!/usr/bin/env python3
"""Bounded, low-overhead recorder of the existing detector's per-frame metadata.
Original Frigate files are read-only. New data lives on the guarded external disk.
"""
from pathlib import Path
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
import argparse,fcntl,hashlib,json,math,os,selectors,signal,sqlite3,subprocess,sys,time

def canonical(x):return json.dumps(x,sort_keys=True,separators=(',',':'),allow_nan=False)
def stamp(t):return datetime.fromtimestamp(t,timezone.utc).isoformat()
def atomic(p,x):
    tmp=p.with_name(p.name+'.tmp')
    with tmp.open('w') as f:f.write(canonical(x)+'\n');f.flush();os.fsync(f.fileno())
    os.replace(tmp,p)
def validate(packet,now):
    if not isinstance(packet,dict) or packet.get('schema')!='ojala_frigate_frame_metadata_v1' or packet.get('cameraName')!='handoff':raise ValueError('frame_scope')
    t=packet.get('frameAt')
    if type(t) not in (int,float) or not math.isfinite(t) or t<=0 or abs(now-t)>5:raise ValueError('frame_not_live')
    if not isinstance(packet.get('objects'),list) or len(packet['objects'])>200:raise ValueError('object_limit')
    seen=set()
    for obj in packet['objects']:
        if not isinstance(obj,dict) or obj.get('label')!='cup' or not isinstance(obj.get('id'),str) or not 1<=len(obj['id'])<=128 or obj['id'] in seen:raise ValueError('object_identity')
        seen.add(obj['id'])
        box=obj.get('box');ft=obj.get('frame_time')
        if not isinstance(box,list) or len(box)!=4 or not all(type(v) in (int,float) and math.isfinite(v) for v in box):raise ValueError('object_box')
        if not(0<=box[0]<box[2]<=2304 and 0<=box[1]<box[3]<=1296):raise ValueError('object_box_bounds')
        if type(ft) not in (int,float) or not math.isfinite(ft):raise ValueError('object_time')
    if type(packet.get('droppedSincePrevious')) is not int or packet['droppedSincePrevious']<0:raise ValueError('invalid_dropped_count')
    return t

def main():
    p=argparse.ArgumentParser();p.add_argument('--config',type=Path,required=True);p.add_argument('--seconds',type=float,default=0);a=p.parse_args()
    os.umask(0o077);c=json.loads(a.config.read_text());base=Path(c['basePath']);root=Path(c['stateRoot']);sys.path.insert(0,str(base/'manus-bridge'))
    from emergency_storage import verify_emergency as verify_external
    verify_external(base,root,writable=True,required_bytes=32*1024*1024);root.mkdir(mode=0o700,parents=True,exist_ok=True)
    stop=[False];signal.signal(signal.SIGTERM,lambda *_:stop.__setitem__(0,True));signal.signal(signal.SIGINT,lambda *_:stop.__setitem__(0,True))
    started=time.monotonic();dbpath=root/'frames.sqlite3'
    with (root/'recorder.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        db=sqlite3.connect(dbpath,timeout=5)
        db.execute('PRAGMA journal_mode=WAL');db.execute('PRAGMA synchronous=FULL')
        db.executescript('''CREATE TABLE IF NOT EXISTS frames(frame_at REAL PRIMARY KEY,day TEXT NOT NULL,received_at REAL NOT NULL,payload TEXT NOT NULL,sha256 TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS frames_day ON frames(day);
        CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY,started_at REAL,ended_at REAL,reason TEXT);''');db.commit()
        count=0;invalid=0;dropped=0;last=None;last_write=0;child=None;last_empty=-float("inf");empty_omitted=0
        try:
            while not stop[0] and (a.seconds<=0 or time.monotonic()-started<a.seconds):
                verify_external(base,root,writable=True,required_bytes=32*1024*1024)
                if sum(x.stat().st_size for x in root.glob('frames.sqlite3*'))>=int(c.get('maxDatabaseBytes',256*1024*1024)):
                    atomic(root/'health.json',{'checkedAt':stamp(time.time()),'status':'paused_metadata_quota','originalsDeleted':False,'countsCreated':False});return 2
                source=Path(c['sourceFile']).read_text()
                child_started=time.monotonic()
                child=subprocess.Popen(['docker','exec','-i','frigate','python3','-B','-u','-'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,bufsize=0)
                child.stdin.write(source.encode());child.stdin.close();os.set_blocking(child.stdout.fileno(),False)
                selector=selectors.DefaultSelector();selector.register(child.stdout,selectors.EVENT_READ);buffer=b''
                session=db.execute('INSERT INTO sessions(started_at,reason) VALUES(?,?)',(time.time(),'readonly_subscriber')).lastrowid;db.commit()
                while not stop[0] and child.poll() is None and (a.seconds<=0 or time.monotonic()-started<a.seconds):
                    for key,_ in selector.select(timeout=.5):
                        chunk=os.read(key.fileobj.fileno(),65536)
                        if not chunk:break
                        buffer+=chunk
                        if len(buffer)>128000:raise ValueError('source_line_limit')
                        while b'\n' in buffer:
                            line,buffer=buffer.split(b'\n',1)
                            try:
                                packet=json.loads(line);at=validate(packet,time.time());text=canonical(packet);day=datetime.fromtimestamp(at,ZoneInfo(c['timezone'])).date().isoformat()
                                last=max(last or at,at);dropped+=packet['droppedSincePrevious']
                                if not packet['objects'] and not packet['droppedSincePrevious'] and at-last_empty<1:
                                    empty_omitted+=1;continue
                                if not packet['objects']:last_empty=at
                                changed=db.execute('INSERT OR IGNORE INTO frames VALUES(?,?,?,?,?)',(at,day,time.time(),text,hashlib.sha256(text.encode()).hexdigest())).rowcount
                                count+=changed
                            except (ValueError,TypeError,KeyError):invalid+=1
                    if time.monotonic()-last_write>=2:
                        db.commit();verify_external(base,root,writable=True,required_bytes=32*1024*1024)
                        status='receiving' if last and time.time()-last<5 else 'waiting_for_live_frames'
                        atomic(root/'health.json',{'checkedAt':stamp(time.time()),'status':status,'lastFrameAt':stamp(last) if last else None,'newFramesThisRun':count,'emptyFramesIntentionallyOmitted':empty_omitted,'emptySamplingSeconds':1,'nonEmptyFramesSubsampled':False,'rejectedPackets':invalid,'reportedDroppedFrames':dropped,'source':'existing_frigate_video_subscriber','newInference':False,'sourceDatabaseWritten':False,'browserRequired':False,'generativeAiUsed':False})
                        last_write=time.monotonic()
                        if sum(x.stat().st_size for x in root.glob('frames.sqlite3*'))>=int(c.get('maxDatabaseBytes',256*1024*1024)):stop[0]=True
                selector.close()
                child.stdout.close()
                if child.poll() is None:
                    child.terminate()
                    try:child.wait(3)
                    except subprocess.TimeoutExpired:child.kill()
                db.execute('UPDATE sessions SET ended_at=? WHERE id=?',(time.time(),session));db.commit()
                if not stop[0]:
                    for _ in range(4 if time.monotonic()-child_started>=3000 else 120):
                        if stop[0]:break
                        time.sleep(.25)
        finally:
            db.commit();db.close()
            if child and child.poll() is None:
                child.stdout.close();child.terminate()
    return 0
if __name__=='__main__':raise SystemExit(main())
