"""Durable local detection ledger. No browser, language model, or cloud dependency.

One Frigate source event is recorded once. Distinct tracks are NOT silently
promoted to unique physical deliveries. Cross-track similarities are warnings,
not automatic deletions or invented sales. Existing Frigate databases are read
only by collector.py; this module owns a separate external SQLite database.
"""
from __future__ import annotations
import hashlib,json,math,re,sqlite3
from datetime import datetime,timezone
from pathlib import Path
from zoneinfo import ZoneInfo

SCHEMA='ojala_local_cup_observation_v1'
EVENT_RE=re.compile(r'^[A-Za-z0-9_.-]{8,128}$')
SHA_RE=re.compile(r'^[a-f0-9]{64}$')
SIZES=('chico','mediano','pint','litro','unknown')
class InvalidEvidence(ValueError):pass

def require(ok:bool,code:str):
    if not ok:raise InvalidEvidence(code)

def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False)

def digest(value):return hashlib.sha256(value if isinstance(value,bytes) else value.encode()).hexdigest()

def finite(value):return type(value) in (int,float) and math.isfinite(value)

def timestamp(value):
    require(finite(value) and value>0,'invalid_timestamp')
    return datetime.fromtimestamp(value,timezone.utc).isoformat()

def parse_aware(value):
    require(isinstance(value,str),'missing_timestamp')
    try:r=datetime.fromisoformat(value.replace('Z','+00:00'))
    except (TypeError,ValueError):raise InvalidEvidence('invalid_timestamp') from None
    require(r.tzinfo is not None,'timestamp_missing_zone');return r

def box(value):
    require(isinstance(value,list) and len(value)==4 and all(finite(v) for v in value),'invalid_box')
    x,y,w,h=value
    require(0<=x<=1 and 0<=y<=1 and 0<w<=1 and 0<h<=1 and x+w<=1.001 and y+h<=1.001,'box_outside_image')
    return [float(v) for v in value]

def inside(point,polygon):
    x,y=point;out=False
    require(isinstance(polygon,list) and 3<=len(polygon)<=16,'invalid_polygon')
    for i,a in enumerate(polygon):
        b=polygon[(i+1)%len(polygon)]
        require(isinstance(a,list) and len(a)==2 and all(finite(v) and 0<=v<=1 for v in a),'invalid_polygon')
        ax,ay=a;bx,by=b
        cross=(x-ax)*(by-ay)-(y-ay)*(bx-ax)
        if abs(cross)<1e-9 and min(ax,bx)-1e-9<=x<=max(ax,bx)+1e-9 and min(ay,by)-1e-9<=y<=max(ay,by)+1e-9:return True
        if (ay>y)!=(by>y) and x<(bx-ax)*(y-ay)/(by-ay)+ax:out=not out
    return out

def normalize_track(raw,device_id,model_sha,time_zone='America/Mazatlan'):
    require(SHA_RE.fullmatch(model_sha) is not None,'invalid_model_fingerprint')
    require(isinstance(device_id,str) and 1<=len(device_id)<=80,'invalid_device')
    require(raw.get('camera')=='handoff' and raw.get('label')=='cup','wrong_source')
    eid=raw.get('id');require(isinstance(eid,str) and EVENT_RE.fullmatch(eid),'invalid_event_id')
    start=raw.get('start_time');timestamp(start)
    end=raw.get('end_time')
    require(end is None or finite(end) and end>=start,'invalid_end_time')
    data=raw.get('data') or {}
    if isinstance(data,str):data=json.loads(data)
    require(isinstance(data,dict),'invalid_event_data')
    zones=raw.get('zones') or []
    if isinstance(zones,str):zones=json.loads(zones)
    require(isinstance(zones,list) and all(isinstance(z,str) for z in zones),'invalid_zones')
    score=data.get('top_score',raw.get('top_score'))
    require(finite(score) and 0<=score<=1,'invalid_score')
    rect=data.get('box') or raw.get('box')
    if isinstance(rect,str):rect=json.loads(rect)
    rect=box(rect)
    event_key=digest(device_id+'/handoff/'+eid)
    return {'schema':SCHEMA,'observationId':event_key,'deviceId':device_id,'cameraName':'handoff',
      'sourceEventId':eid,'businessDate':datetime.fromtimestamp(start,ZoneInfo(time_zone)).date().isoformat(),
      'startedAt':timestamp(start),'endedAt':None if end is None else timestamp(end),
      'detectorModelSha256':model_sha,'detectorScore':float(score),'targetBox':rect,
      'enteredHandoffZone':'handoff_zone' in zones,'sourceFalsePositive':bool(raw.get('false_positive')),
      'verification':'detector_track_only','size':'unknown','sizeBasis':'local_model_has_no_size_classes',
      'physicalDeliveryConfirmed':False,'salesCreated':False,'sameFrameEvidence':None}

def verify_sidecar(meta,image_bytes,track):
    require(isinstance(meta,dict) and meta.get('schema_version')==3,'unsupported_sidecar')
    require(meta.get('camera')=='handoff' and meta.get('cup_zone')=='handoff_zone','wrong_capture_scope')
    require(meta.get('cup_event_id')==track['sourceEventId'],'event_identity_mismatch')
    require(not track['sourceFalsePositive'],'source_marked_false_positive')
    require(len(image_bytes)<=8*1024*1024 and image_bytes.startswith(b'\xff\xd8\xff'),'invalid_jpeg')
    require(meta.get('image_sha256')==digest(image_bytes),'image_hash_mismatch')
    at=parse_aware(meta.get('captured_at_utc'));start=parse_aware(track['startedAt'])
    end=parse_aware(track['endedAt']) if track['endedAt'] else None
    require(start.timestamp()-2<=at.timestamp()<=start.timestamp()+600,'capture_outside_event_window')
    require(end is None or at.timestamp()<=end.timestamp()+2,'capture_after_event_end')
    require(at.astimezone(ZoneInfo('America/Mazatlan')).date().isoformat()==track['businessDate'],'capture_day_mismatch')
    dims=meta.get('image_dimensions');require(isinstance(dims,dict) and all(type(dims.get(k)) is int and 1<=dims[k]<=16384 for k in ('width','height')),'invalid_dimensions')
    geometry=meta.get('zone_geometry');require(isinstance(geometry,dict) and geometry.get('coordinate_system')=='normalized' and geometry.get('membership_rule')=='box_bottom_center','invalid_geometry')
    require(digest(canonical(geometry))==meta.get('zone_config_sha256'),'geometry_hash_mismatch')
    cup=meta.get('cup');require(isinstance(cup,dict) and finite(cup.get('score')) and 0.45<=cup['score']<=1,'invalid_local_cup')
    rect=box(cup.get('box'));x,y,w,h=rect
    require(inside((x+w/2,y+h),geometry.get('polygon')),'local_cup_outside_zone')
    people=meta.get('people');require(isinstance(people,list) and 1<=len(people)<=100,'missing_local_person')
    valid_people=[]
    for person in people:
        require(isinstance(person,dict) and finite(person.get('score')) and 0.45<=person['score']<=1,'invalid_person_score')
        p=person.get('box');require(isinstance(p,list) and len(p)==4 and all(finite(v) and 0<=v<=1 for v in p),'invalid_person_box')
        require(p[2]>p[0] and p[3]>p[1],'invalid_person_box');valid_people.append(person)
    return {'imageSha256':meta['image_sha256'],'capturedAt':meta['captured_at_utc'],
      'sourceMetadataSha256':digest(canonical(meta)),'sourceZoneSha256':meta['zone_config_sha256'],
      'targetBox':rect,'cupScore':cup['score'],'personDetections':len(valid_people),
      'gateVersion':str(meta.get('gate_version','unknown'))[:100],
      'inferenceLocation':'local_beelink','generativeAiUsed':False}

def overlap(a,b):
    ax,ay,aw,ah=a;bx,by,bw,bh=b
    inter=max(0,min(ax+aw,bx+bw)-max(ax,bx))*max(0,min(ay+ah,by+bh)-max(ay,by))
    return inter/(aw*ah+bw*bh-inter) if inter else 0.0

def possible_repeats(records,max_gap_seconds=15):
    result={};ordered=sorted(records,key=lambda r:(r['startedAt'],r['observationId']))
    for index,current in enumerate(ordered):
        found=[]
        for earlier in reversed(ordered[:index]):
            if not earlier['endedAt'] or earlier['cameraName']!=current['cameraName'] or earlier['deviceId']!=current['deviceId'] or earlier['businessDate']!=current['businessDate']:continue
            gap=(parse_aware(current['startedAt'])-parse_aware(earlier['endedAt'])).total_seconds()
            if gap<0 or gap>max_gap_seconds:continue
            if overlap(earlier['targetBox'],current['targetBox'])>=0.75:found.append(earlier['observationId'])
        if found:result[current['observationId']]=found
    return result

class Ledger:
    def __init__(self,path):
        self.path=Path(path);self.db=sqlite3.connect(self.path,timeout=10);self.db.row_factory=sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL');self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS observations(id TEXT PRIMARY KEY,day TEXT NOT NULL,source_id TEXT NOT NULL,device_id TEXT NOT NULL,payload TEXT NOT NULL,payload_sha TEXT NOT NULL,revision INTEGER NOT NULL,first_seen TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(device_id,source_id));
        CREATE INDEX IF NOT EXISTS observation_day ON observations(day);
        CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload_sha TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,receipt TEXT);
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,event_id TEXT,action TEXT NOT NULL,detail TEXT NOT NULL);
        """);self.db.commit()
    def close(self):self.db.close()
    def put(self,track,evidence=None,now=None):
        at=now or datetime.now(timezone.utc).isoformat();value=json.loads(canonical(track));eid=value['observationId']
        old=self.db.execute('SELECT * FROM observations WHERE id=?',(eid,)).fetchone()
        if old:
            previous=json.loads(old['payload'])
            for field in ('sourceEventId','startedAt','deviceId','cameraName','detectorModelSha256'):
                require(previous[field]==value[field],'immutable_identity_conflict')
            if previous['sameFrameEvidence']:
                value['sameFrameEvidence']=previous['sameFrameEvidence'];value['verification']='same_frame_local_cv'
            if previous['endedAt'] and value['endedAt'] is None:value['endedAt']=previous['endedAt']
            if previous.get('ownerSizeReview') and not value.get('ownerSizeReview'):
                value['ownerSizeReview']=previous['ownerSizeReview'];value['size']=previous['size'];value['sizeBasis']='owner_confirmed_reference';value.pop('sizeAssessment',None)
        if evidence:
            require(not value['sourceFalsePositive'],'source_marked_false_positive')
            if value['sameFrameEvidence']:require(value['sameFrameEvidence']['imageSha256']==evidence['imageSha256'],'evidence_replacement_forbidden')
            value['sameFrameEvidence']=evidence;value['verification']='same_frame_local_cv'
        if value['sourceFalsePositive']:value['verification']='detector_rejected'
        text=canonical(value);sha=digest(text)
        if old and old['payload_sha']==sha:return False
        revision=old['revision']+1 if old else 1
        with self.db:
            self.db.execute('INSERT INTO observations VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,payload_sha=excluded.payload_sha,revision=excluded.revision,updated_at=excluded.updated_at',(eid,value['businessDate'],value['sourceEventId'],value['deviceId'],text,sha,revision,old['first_seen'] if old else at,at))
            self.db.execute('INSERT INTO outbox(id,revision,payload_sha,status) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload_sha=excluded.payload_sha,status=excluded.status,last_error=NULL,receipt=NULL',(eid,revision,sha,'pending'))
            self.db.execute('INSERT INTO audit(at,event_id,action,detail) VALUES(?,?,?,?)',(at,eid,'updated' if old else 'created',canonical({'revision':revision,'payloadSha256':sha})))
        return True
    def rows(self,day):return [json.loads(r[0]) for r in self.db.execute('SELECT payload FROM observations WHERE day=? ORDER BY first_seen,id',(day,))]
    def snapshot(self,day):
        rows=self.rows(day);repeats=possible_repeats(rows);counts={k:0 for k in SIZES}
        raw_verified=[r for r in rows if r['verification']=='same_frame_local_cv']
        owner_excluded=[r for r in raw_verified if r.get('ownerSizeReview',{}).get('label')=='not_cup']
        verified=[r for r in raw_verified if r.get('ownerSizeReview',{}).get('label')!='not_cup']
        for r in verified:counts[r['size']]+=1
        return {'schema':'ojala_local_cup_ledger_v1','businessDate':day,'semantics':'detector_observations_not_certified_deliveries',
          'detectorTracksRecorded':len(rows),'sameFrameVerifiedObservations':len(verified),'rawSameFrameVerifiedObservations':len(raw_verified),'ownerExcludedNonCups':len(owner_excluded),
          'detectorOnlyObservations':sum(r['verification']=='detector_track_only' for r in rows),
          'rejectedSourceObservations':sum(r['verification']=='detector_rejected' for r in rows),
          'potentialRepeatObservations':len(repeats),'possibleRepeatLinks':repeats,'sizeBreakdownOfVerifiedObservations':counts,
          'uniquePhysicalDeliveries':None,'manualCount':None,'posCount':None,'externalAiRequired':False,
          'observations':rows,'outboxStates':dict(self.db.execute('SELECT status,count(*) FROM outbox GROUP BY status').fetchall())}
    def mark_dispatched(self,eid):
        with self.db:self.db.execute('UPDATE outbox SET status=?,attempts=attempts+1 WHERE id=?',('delivery_unknown',eid))
    def acknowledge(self,eid,receipt):
        row=self.db.execute('SELECT * FROM outbox WHERE id=?',(eid,)).fetchone();require(row is not None,'outbox_event_not_found')
        require(isinstance(receipt,dict) and receipt.get('protocol')=='ojala_local_cup_receipt_v1','receipt_protocol')
        require(receipt.get('observationId')==eid and type(receipt.get('revision')) is int and receipt['revision']==row['revision'] and receipt.get('payloadSha256')==row['payload_sha'],'receipt_identity')
        require(receipt.get('persisted') is True and receipt.get('externalAiInvoked') is False and receipt.get('physicalDeliveryCountCreated') is False,'receipt_scope')
        with self.db:self.db.execute('UPDATE outbox SET status=?,receipt=?,last_error=NULL WHERE id=?',('acknowledged',canonical(receipt),eid))
