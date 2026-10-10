#!/usr/bin/env python3
"""Independent v4 image gate; only local pending-review evidence, never sales.

The live mode writes exclusively beneath /config/rescue_shadow/state. It does
not change Frigate configuration, models, its database, or verified sender queue.
"""
import argparse, datetime as dt, fcntl, hashlib, json, os, signal, sqlite3, sys, time, uuid
from pathlib import Path
from urllib.request import urlopen
from shadow_core import associate, nms, valid_box, healthy_for_shadow, iou

VERSION='2026-09-27.1'
BASE=Path('/config/rescue_shadow')
STATE=BASE/'state'
ENABLED=BASE/'enabled.json'
API='http://127.0.0.1:5000/api'
MODEL='/config/model_cache/ojala_cups_v4_640.onnx'
EXPECTED_MODEL='69a9fc1e2d629b1b8e950e9d02de2c7f8e063484ba83128a0b18be549e89ce54'
PERSON='/openvino-model/ssdlite_mobilenet_v2.xml'
STOP=False

def utc(epoch=None):
    return dt.datetime.fromtimestamp(time.time() if epoch is None else epoch,dt.timezone.utc).isoformat()

def atomic(path, data):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+'.tmp')
    with tmp.open('wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
    os.replace(tmp,path)
    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)

def write_json(path,value):atomic(path,(json.dumps(value,indent=2)+'\n').encode())
def fetch(path):
    with urlopen(API+path,timeout=4) as r:return r.read()
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def load_geometry():
    config=json.loads(fetch('/config'))['cameras']['handoff']
    coordinates=config['zones']['handoff_zone']['coordinates']
    if not isinstance(coordinates,str):raise ValueError('unsupported zone geometry')
    numbers=[float(x) for x in coordinates.split(',')]
    polygon=list(zip(numbers[::2],numbers[1::2]))
    if len(numbers)%2 or len(polygon)<3 or any(not 0<=x<=1 for x in numbers):raise ValueError('invalid polygon')
    f=config['objects']['filters']['cup']
    geom={'polygon':polygon,'width':int(config['detect']['width']),'height':int(config['detect']['height']),
          'min_area':float(f['min_area']),'max_area':float(f['max_area'])}
    # Keep the existing same-frame capture threshold; never lower primary config.
    geom['score_threshold']=max(.45,float(f.get('threshold',.4)))
    geom['sha256']=hashlib.sha256(json.dumps(geom,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return geom

class Detector:
    def __init__(self, geom):
        import cv2,numpy as np,openvino as ov
        self.cv2,self.np=cv2,np;cv2.setNumThreads(1)
        if digest(MODEL)!=EXPECTED_MODEL:raise ValueError('active model changed; validation required')
        self.geom=geom;core=ov.Core();settings={'INFERENCE_NUM_THREADS':1}
        self.cup=core.compile_model(MODEL,'CPU',settings)
        self.person=core.compile_model(PERSON,'CPU',settings)
    def inspect(self,jpeg):
        cv2,np=self.cv2,self.np
        frame=cv2.imdecode(np.frombuffer(jpeg,dtype=np.uint8),cv2.IMREAD_COLOR)
        if frame is None:raise ValueError('invalid image')
        h,w=frame.shape[:2]
        if abs(w/h-self.geom['width']/self.geom['height'])>.02:raise ValueError('camera aspect ratio changed')
        # Frigate-compatible top-left square with black padding below the frame.
        # Normalize to actual source width, including 1280x720 recording replays.
        size=max(w,h);square=np.zeros((size,size,3),np.uint8);square[:h,:w]=frame
        rgb=cv2.cvtColor(cv2.resize(square,(640,640)),cv2.COLOR_BGR2RGB)
        tensor=rgb.transpose(2,0,1)[None].astype(np.float32)/255.
        pred=self.cup(tensor)[self.cup.output(0)].squeeze().T
        cups=[]
        for row in pred:
            score=float(row[4])
            if not np.isfinite(score) or score<self.geom['score_threshold']:continue
            cx,cy=float(row[0])*size/(640*w),float(row[1])*size/(640*h)
            bw,bh=float(row[2])*size/(640*w),float(row[3])*size/(640*h)
            box=[cx-bw/2,cy-bh/2,bw,bh]
            g=self.geom
            if valid_box(box,g['polygon'],g['width'],g['height'],g['min_area'],g['max_area']):
                cups.append({'score':round(score,5),'box':[round(x,6) for x in box]})
        cups=nms(cups);people=[]
        if cups:
            tensor=cv2.resize(frame,(300,300),interpolation=cv2.INTER_AREA)[None]
            detections=self.person([tensor])[self.person.output(0)][0,0]
            for row in detections:
                x1,y1,x2,y2=[float(x) for x in row[3:7]]
                if int(row[1])==1 and float(row[2])>=.45 and (x2-x1)*(y2-y1)>=.015:
                    people.append({'score':round(float(row[2]),4),'box':[round(x,5) for x in (x1,y1,x2,y2)]})
        return {'cups':cups,'people':people,'person_detection_ran':bool(cups),'width':w,'height':h,'eligible':bool(cups and people)}

class Journal:
    def __init__(self, root, geometry_hash):
        self.root=Path(root);self.root.mkdir(parents=True,exist_ok=True)
        self.db=sqlite3.connect(self.root/'shadow.sqlite3',timeout=5)
        self.db.row_factory=sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL');self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS tracks(id TEXT PRIMARY KEY, first_seen REAL NOT NULL,last_seen REAL NOT NULL,
          hits INTEGER NOT NULL, box_json TEXT NOT NULL, emitted INTEGER NOT NULL DEFAULT 0,geometry_hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS candidates(id TEXT PRIMARY KEY, captured_at TEXT NOT NULL,image_sha256 TEXT NOT NULL UNIQUE,
          metadata_path TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending_review');
        CREATE INDEX IF NOT EXISTS tracks_recent ON tracks(last_seen);
        ''')
        self.geometry_hash=geometry_hash
        # A power loss after JSON publication but before the SQLite commit is
        # repaired using complete, hash-verified pairs, without rewriting photos.
        for p in (self.root/'pending').glob('shadow-*.json'):
            try:
                m=json.loads(p.read_text());img=p.with_suffix('.jpg')
                if m.get('status')!='pending_review' or not img.is_file() or digest(img)!=m['image_sha256']:continue
                self.db.execute('INSERT OR IGNORE INTO candidates(id,captured_at,image_sha256,metadata_path) VALUES(?,?,?,?)',
                    (m['candidate_id'],m['captured_at_utc'],m['image_sha256'],str(p)))
                for tid in m.get('track_ids',[]):self.db.execute('UPDATE tracks SET emitted=1 WHERE id=?',(tid,))
            except (OSError,KeyError,ValueError,TypeError):continue
        self.db.commit()
    def advance(self,detections,now):
        rows=self.db.execute('SELECT * FROM tracks WHERE last_seen>=? AND geometry_hash=?',(now-7,self.geometry_hash)).fetchall()
        old=[{'id':r['id'],'last_seen':r['last_seen'],'box':json.loads(r['box_json'])} for r in rows]
        matched=associate(old,detections,now);previous={r['id']:dict(r) for r in rows};active=[]
        for index,d in enumerate(detections):
            tid=matched.get(index) or 'shadow-track-'+uuid.uuid4().hex
            previous_row=previous.get(tid)
            if previous_row and now<=previous_row['last_seen']:continue
            hits=previous_row['hits']+1 if previous_row else 1
            first=previous_row['first_seen'] if previous_row else now
            emitted=previous_row['emitted'] if previous_row else 0
            self.db.execute('INSERT INTO tracks VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,hits=excluded.hits,box_json=excluded.box_json',
                (tid,first,now,hits,json.dumps(d['box']),emitted,self.geometry_hash))
            active.append({'id':tid,'hits':hits,'emitted':bool(emitted),'first_seen':first,'last_seen':now,**d})
        # Ineligible/absent frames break temporal continuity, preserving emitted IDs.
        inactive=[r['id'] for r in rows if r['id'] not in {t['id'] for t in active}]
        for tid in inactive:self.db.execute('UPDATE tracks SET hits=0 WHERE id=?',(tid,))
        self.db.commit();return active
    def save(self,jpeg,result,tracks,epoch,origin,source=None,primary_matches=None):
        ready=[t for t in tracks if t['hits']>=2 and not t['emitted']]
        if not result['eligible'] or not result['cups'] or not result['people'] or not ready:return None
        sha=hashlib.sha256(jpeg).hexdigest()
        existing=self.db.execute('SELECT id FROM candidates WHERE image_sha256=?',(sha,)).fetchone()
        if existing:
            for t in ready:self.db.execute('UPDATE tracks SET emitted=1 WHERE id=?',(t['id'],))
            self.db.commit();return None
        candidate_id='shadow-'+hashlib.sha256((origin+'handoff'+utc(epoch)+sha).encode()).hexdigest()[:24]
        img=self.root/'pending'/(candidate_id+'.jpg');meta=img.with_suffix('.json')
        payload={'schema_version':1,'version':VERSION,'candidate_id':candidate_id,'camera':'handoff',
            'origin':origin,'cup_event_id':None,'captured_at_utc':utc(epoch),'timestamp_source':'source_video_offset' if source else 'beelink_received_at',
            'timestamp_precision':'approximate_video_offset' if source else 'receipt_time_not_camera_clock',
            'status':'pending_review','delivery_confirmed':False,'cup_count_semantics':'model boxes in this frame, not deliveries',
            'cups':result['cups'],'people':result['people'],'track_ids':[t['id'] for t in tracks],
            'image_sha256':sha,'image_dimensions':{'width':result['width'],'height':result['height']},
            'zone_geometry_sha256':self.geometry_hash,'model_sha256':EXPECTED_MODEL,'source':source,
            'possible_primary_duplicates':primary_matches or []}
        atomic(img,jpeg);write_json(meta,payload)
        self.db.execute('INSERT OR IGNORE INTO candidates(id,captured_at,image_sha256,metadata_path) VALUES(?,?,?,?)',(candidate_id,utc(epoch),sha,str(meta)))
        for t in ready:self.db.execute('UPDATE tracks SET emitted=1 WHERE id=?',(t['id'],))
        self.db.commit();return candidate_id
    def close(self):self.db.close()

def primary_matches(tracks,epoch):
    matches=[]
    for p in Path('/config/verified_snapshots/handoff').glob('*.json'):
        try:
            d=json.loads(p.read_text());when=dt.datetime.fromisoformat(d['captured_at_utc']).timestamp()
            if abs(epoch-when)>12:continue
            if any(iou(t['box'],d['cup']['box'])>.15 for t in tracks):matches.append(d['cup_event_id'])
        except (ValueError,KeyError,OSError,TypeError):continue
    return sorted(set(matches))

def live():
    import shutil
    global STOP
    STATE.mkdir(parents=True,exist_ok=True)
    lock=(STATE/'runtime.lock').open('w')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:return
    if not ENABLED.exists():return
    settings=json.loads(ENABLED.read_text())
    geom=load_geometry()
    if settings.get('model_sha256')!=EXPECTED_MODEL or settings.get('geometry_sha256')!=geom['sha256']:
        raise ValueError('enable manifest mismatch')
    detector=Detector(geom);journal=Journal(STATE,geom['sha256'])
    state={'version':VERSION,'pid':os.getpid(),'started_at_utc':utc(),'mode':'shadow_pending_review',
           'model_sha256':EXPECTED_MODEL,'geometry_sha256':geom['sha256'],'source_sha256':digest(__file__),
           'samples':0,'eligible_frames':0,'saved':0,'errors':0,'load_pauses':0,'external_requests':0}
    def heartbeat(status):
        state.update(status=status,heartbeat_epoch=time.time(),heartbeat_utc=utc())
        write_json(STATE/'health.json',state)
    def stop(*_):
        global STOP
        STOP=True
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    last_jpeg=None;last_config=0
    heartbeat('running')
    try:
        while not STOP and ENABLED.exists():
            start=time.monotonic()
            try:
                camera=json.loads(fetch('/stats'))['cameras']['handoff']
                state['primary_fps']={k:camera.get(k) for k in ('camera_fps','process_fps','skipped_fps')}
                if not healthy_for_shadow(camera):
                    state['load_pauses']+=1;journal.advance([],time.time())
                    heartbeat('paused_for_primary_fps');time.sleep(10);continue
                if time.monotonic()-last_config>60:
                    if load_geometry()['sha256']!=geom['sha256']:heartbeat('stopped_geometry_changed');break
                    last_config=time.monotonic()
                if shutil.disk_usage(STATE).free<2*1024**3:heartbeat('paused_disk_low');time.sleep(30);continue
                if sum(p.stat().st_size for p in (STATE/'pending').glob('*.jpg'))>512*1024**2:
                    heartbeat('paused_evidence_limit');time.sleep(30);continue
                jpeg=fetch('/handoff/latest.jpg');epoch=time.time();sha=hashlib.sha256(jpeg).hexdigest()
                if sha==last_jpeg:heartbeat('unchanged_frame');time.sleep(3);continue
                last_jpeg=sha;result=detector.inspect(jpeg);state['samples']+=1
                state['last_sample_utc']=utc(epoch);state['last_frame_cups']=len(result['cups']);state['last_frame_people']=len(result['people'])
                state['eligible_frames']+=int(result['eligible'])
                tracks=journal.advance(result['cups'] if result['eligible'] else [],epoch)
                saved=journal.save(jpeg,result,tracks,epoch,'independent_live_shadow',primary_matches=primary_matches(tracks,epoch))
                if saved:state['saved']+=1;state['last_candidate_id']=saved;state['last_saved_utc']=utc(epoch)
                state['last_work_seconds']=round(time.monotonic()-start,3)
                heartbeat('running')
            except Exception as exc:
                state['errors']+=1;state['last_error_type']=type(exc).__name__;heartbeat('degraded');time.sleep(10)
            time.sleep(max(.1,3-(time.monotonic()-start)))
    finally:
        journal.close();heartbeat('stopped')

def replay(args):
    import cv2
    geom=load_geometry();detector=Detector(geom);out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    write_json(out/'geometry.json',geom)
    if args.images:
        results=[]
        for p in sorted(Path(args.images).glob('*.jpg')):
            result=detector.inspect(p.read_bytes());results.append({'image':p.name,'sha256':digest(p),**result})
        write_json(out/'images_result.json',{'version':VERSION,'model_sha256':EXPECTED_MODEL,'results':results,'production_writes':0})
        print(json.dumps(results));return
    if not args.video or not args.start_time:raise ValueError('video and offset-aware start time required')
    epoch=dt.datetime.fromisoformat(args.start_time)
    if epoch.tzinfo is None:raise ValueError('source start time needs timezone')
    sha=digest(args.video);cap=cv2.VideoCapture(args.video);journal=Journal(out,geom['sha256']);rows=[]
    try:
        for offset in range(args.from_second,args.to_second,3):
            cap.set(cv2.CAP_PROP_POS_MSEC,offset*1000);ok,frame=cap.read()
            if not ok:rows.append({'offset':offset,'error':'decode_failed'});continue
            ok,encoded=cv2.imencode('.jpg',frame,[cv2.IMWRITE_JPEG_QUALITY,95])
            if not ok:raise ValueError('jpeg encoding failed')
            jpeg=encoded.tobytes();result=detector.inspect(jpeg);when=epoch.timestamp()+offset
            tracks=journal.advance(result['cups'] if result['eligible'] else [],when)
            candidate=journal.save(jpeg,result,tracks,when,'recording_extracted_frame',{'video_sha256':sha,'offset_seconds':offset,'video_name':Path(args.video).name})
            rows.append({'offset':offset,'candidate_id':candidate,**result})
    finally:cap.release();journal.close()
    payload={'version':VERSION,'source_video_sha256':sha,'model_sha256':EXPECTED_MODEL,'window':[args.from_second,args.to_second],
             'sample_seconds':3,'rows':rows,'production_writes':0,'external_requests':0,'interpretation':'pending review candidates, not delivery totals'}
    write_json(out/'video_result.json',payload);print(json.dumps({'frames':len(rows),'saved_candidates':len(list((out/'pending').glob('*.json'))),'output':str(out)}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['live','replay'])
    parser.add_argument('--images');parser.add_argument('--video');parser.add_argument('--start-time')
    parser.add_argument('--from-second',type=int,default=330);parser.add_argument('--to-second',type=int,default=366)
    parser.add_argument('--output',default='/config/rescue_shadow_tests/replay')
    args=parser.parse_args()
    live() if args.mode=='live' else replay(args)
