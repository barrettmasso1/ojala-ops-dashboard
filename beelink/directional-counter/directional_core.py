"""Conservative forward-only handoff ESTIMATES from real per-frame metadata.
No frame approval, network, cloud inference, sales writes or guessed size labels.
A static photograph, ended track or stored trajectory never creates a handoff.
"""
from pathlib import Path
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
import hashlib,json,math,re,sqlite3

PROTOCOL='ojala_directional_handoffs_v1'
SIZES=('chico','mediano','pint','litro','unknown')
SHA=re.compile(r'^[a-f0-9]{64}$')
EVENT=re.compile(r'^[A-Za-z0-9_.-]{8,128}$')

def canonical(x):return json.dumps(x,sort_keys=True,separators=(',',':'),allow_nan=False)
def digest(x):return hashlib.sha256(x.encode() if isinstance(x,str) else x).hexdigest()
def iso(t):return datetime.fromtimestamp(t,timezone.utc).isoformat()
def timestamp(s):
    d=datetime.fromisoformat(s.replace('Z','+00:00'))
    if d.tzinfo is None:raise ValueError('timestamp_timezone_required')
    return d.timestamp()
def require(x,reason):
    if not x:raise ValueError(reason)
def finite(x):return type(x) in (int,float) and math.isfinite(x)
def inside(point,poly):
    x,y=point;result=False
    for i,(ax,ay) in enumerate(poly):
        bx,by=poly[(i+1)%len(poly)]
        if abs((x-ax)*(by-ay)-(y-ay)*(bx-ax))<1e-10 and min(ax,bx)<=x<=max(ax,bx) and min(ay,by)<=y<=max(ay,by):return True
        if (ay>y)!=(by>y) and x<(bx-ax)*(y-ay)/(by-ay)+ax:result=not result
    return result

def validate_policy(p):
    require(p.get('schema')=='ojala_directional_policy_v1' and p.get('cameraName')=='handoff','policy_scope')
    require(type(p.get('storeId')) is int and p['storeId']>0,'store_required')
    require(isinstance(p.get('deviceId'),str) and bool(p['deviceId']),'device_required')
    for k in ['detectorModelSha256','sourceZoneSha256','referenceImageSha256']:require(isinstance(p.get(k),str) and SHA.fullmatch(p[k]),'policy_hash')
    require(p.get('geometryCalibration')=='provisional_visual_orientation' and p.get('commercialAccuracyValidated') is False,'unvalidated_geometry_must_be_explicit')
    require(p.get('minimumSamplesPerZone')==2 and p.get('maxSampleGapSeconds')==1.5 and p.get('minimumScore')==.45,'policy_thresholds')
    require(p.get('width')==2304 and p.get('height')==1296,'unreviewed_frame_size')
    ZoneInfo(p['timezone'])
    require(set(p['zones'])=={'origin','handoff','destination'},'three_zones_required')
    for polygon in p['zones'].values():
        require(isinstance(polygon,list) and 3<=len(polygon)<=16,'invalid_polygon')
        require(all(isinstance(v,list) and len(v)==2 and all(finite(a) and 0<=a<=1 for a in v) for v in polygon),'invalid_polygon')
        area=sum(polygon[i][0]*polygon[(i+1)%len(polygon)][1]-polygon[(i+1)%len(polygon)][0]*polygon[i][1] for i in range(len(polygon)))
        require(abs(area)>1e-7,'zero_polygon')
    return p

def region(rect,p):
    x,y,w,h=rect;names=[n for n,poly in p['zones'].items() if inside((x+w/2,y+h),poly)]
    return names[0] if len(names)==1 else 'ambiguous' if names else 'outside'

def sample(obj,frame_at,p):
    require(obj.get('label')=='cup' and isinstance(obj.get('id'),str) and EVENT.fullmatch(obj['id']),'object_scope')
    at=obj.get('frame_time');require(finite(at) and abs(at-frame_at)<=.3,'not_current_object_sample')
    require(obj.get('false_positive') is False,'unaccepted_detector_object')
    require(obj.get('end_time') is None,'ended_track_is_not_sample')
    require(obj.get('disappeared') in (None,0),'predicted_missing_sample')
    score=obj.get('score');require(finite(score) and .45<=score<=1,'detector_score')
    b=obj.get('box');require(isinstance(b,list) and len(b)==4 and all(finite(v) for v in b),'sample_box')
    x1,y1,x2,y2=b;require(0<=x1<x2<=p['width'] and 0<=y1<y2<=p['height'],'sample_box_bounds')
    rect=[x1/p['width'],y1/p['height'],(x2-x1)/p['width'],(y2-y1)/p['height']]
    v={'schema':'ojala_directional_sample_v1','deviceId':p['deviceId'],'cameraName':'handoff','sourceEventId':obj['id'],'at':iso(at),'box':rect,'score':score,'falsePositive':False}
    text=canonical(v);return v,{'metadataJson':text,'metadataSha256':digest(text)}

def empty_state():return {'phase':'unarmed','lastRegion':None,'run':[],'route':[],'lastAt':None}

class Counter:
    def __init__(self,path,policy):
        self.policy=validate_policy(policy);self.policy_json=canonical(policy);self.policy_sha=digest(self.policy_json)
        self.db=sqlite3.connect(path,timeout=5);self.db.row_factory=sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL');self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript('''CREATE TABLE IF NOT EXISTS settings(name TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS windows(id INTEGER PRIMARY KEY,day TEXT NOT NULL,first_at REAL NOT NULL,last_at REAL NOT NULL,frames INTEGER NOT NULL,dropped INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS states(source_id TEXT PRIMARY KEY,last_at REAL NOT NULL,state TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS candidates(event_id TEXT PRIMARY KEY,source_id TEXT UNIQUE NOT NULL,day TEXT NOT NULL,completed_at REAL NOT NULL,route TEXT NOT NULL,status TEXT NOT NULL,size TEXT NOT NULL DEFAULT 'unknown',evidence TEXT,identity_reason TEXT);
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at REAL,source_id TEXT,reason TEXT);
        ''')
        old=self.db.execute("SELECT value FROM settings WHERE name='policy'").fetchone()
        if old is not None and old[0]!=self.policy_sha:
            self.db.close();raise ValueError('policy_changed_requires_new_partition')
        with self.db:self.db.execute("INSERT OR IGNORE INTO settings VALUES('policy',?)",(self.policy_sha,))
    def close(self):self.db.close()
    def cursor(self):
        r=self.db.execute("SELECT value FROM settings WHERE name='last_frame'").fetchone();return float(r[0]) if r else 0
    def ingest_frame(self,packet,received_at):
        p=self.policy;require(packet.get('schema')=='ojala_frigate_frame_metadata_v1' and packet.get('cameraName')=='handoff','frame_scope')
        at=packet.get('frameAt');require(finite(at) and at>0 and finite(received_at) and abs(at-received_at)<=5,'frame_timestamp_not_live_at_receipt')
        require(isinstance(packet.get('objects'),list) and len(packet['objects'])<=200,'objects_limit')
        require(type(packet.get('droppedSincePrevious')) is int and packet['droppedSincePrevious']>=0,'dropped_count')
        day=datetime.fromtimestamp(at,ZoneInfo(p['timezone'])).date().isoformat();gap=p['maxSampleGapSeconds'];events=0
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            if at<=self.cursor():return 0
            previous=self.db.execute('SELECT * FROM windows ORDER BY last_at DESC LIMIT 1').fetchone()
            if previous and previous['day']==day and at-previous['last_at']<=gap and packet['droppedSincePrevious']==0:
                self.db.execute('UPDATE windows SET last_at=?,frames=frames+1 WHERE id=?',(at,previous['id']))
            else:
                self.db.execute('INSERT INTO windows(day,first_at,last_at,frames,dropped) VALUES(?,?,?,1,?)',(day,at,at,packet['droppedSincePrevious']))
                self.db.execute('DELETE FROM states')
            for obj in packet['objects']:
                identity=obj.get('id')
                if isinstance(identity,str) and obj.get('false_positive') is True:
                    self.db.execute("UPDATE candidates SET status='source_rejected' WHERE source_id=?",(identity,));self.db.execute('DELETE FROM states WHERE source_id=?',(identity,));continue
                try:v,proof=sample(obj,at,p)
                except ValueError:continue
                sid=v['sourceEventId'];sample_at=timestamp(v['at'])
                if self.db.execute('SELECT 1 FROM candidates WHERE source_id=?',(sid,)).fetchone():continue
                row=self.db.execute('SELECT * FROM states WHERE source_id=?',(sid,)).fetchone()
                if row and sample_at<=row['last_at']:continue
                state=json.loads(row['state']) if row and sample_at-row['last_at']<=gap else empty_state()
                r=region(v['box'],p)
                state['run']=(state['run']+[proof])[-2:] if r==state['lastRegion'] else [proof]
                state['lastRegion']=r
                if r=='origin' and len(state['run'])==2:state['phase']='origin';state['route']=list(state['run'])
                elif r=='handoff' and state['phase'] in ('origin','handoff'):
                    state['route'].append(proof)
                    if len(state['run'])==2:state['phase']='handoff'
                elif r=='destination' and state['phase']=='handoff':
                    state['route'].append(proof)
                    if len(state['run'])==2:
                        route=state['route'];values=[json.loads(q['metadataJson']) for q in route];times=[timestamp(q['at']) for q in values]
                        regions=[region(q['box'],p) for q in values]
                        handoff_count=sum(q=='handoff' for q in regions)
                        good_regions=regions==['origin']*2+['handoff']*handoff_count+['destination']*2
                        if 6<=len(route)<=160 and handoff_count>=2 and good_regions and all(0<b-a<=gap for a,b in zip(times,times[1:])) and times[-1]-times[0]<=30:
                            eid=digest(p['deviceId']+'/handoff/'+sid+'/'+self.policy_sha)
                            self.db.execute("INSERT INTO candidates(event_id,source_id,day,completed_at,route,status) VALUES(?,?,?,?,?,'awaiting_local_evidence')",(eid,sid,day,sample_at,canonical(route)));events+=1
                        state=empty_state()
                elif r not in ('origin','handoff','destination') or (r=='destination' and state['phase']!='handoff'):state=empty_state()
                if state['route'] and sample_at-timestamp(json.loads(state['route'][0]['metadataJson'])['at'])>30:state=empty_state()
                state['lastAt']=sample_at
                self.db.execute('INSERT INTO states VALUES(?,?,?) ON CONFLICT(source_id) DO UPDATE SET last_at=excluded.last_at,state=excluded.state',(sid,sample_at,canonical(state)))
            self.db.execute("INSERT INTO settings VALUES('last_frame',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",(str(at),))
        return events
    def reconcile(self,observations):
        byid={o['sourceEventId']:o for o in observations};p=self.policy
        with self.db:
            for c in self.db.execute('SELECT * FROM candidates ORDER BY completed_at,event_id').fetchall():
                if c['status']=='source_rejected':continue
                o=byid.get(c['source_id'])
                if not o:continue
                require(o['deviceId']==p['deviceId'] and o['cameraName']=='handoff','evidence_scope')
                require(o['detectorModelSha256']==p['detectorModelSha256'],'detector_changed')
                state='awaiting_local_evidence';size='unknown';evidence=None;reason=None
                if o.get('sourceFalsePositive') or o.get('verification')=='detector_rejected':state='source_rejected'
                elif o.get('ownerSizeReview',{}).get('label')=='not_cup':state='owner_excluded'
                elif o.get('verification')=='same_frame_local_cv' and o.get('sameFrameEvidence'):
                    ev=o['sameFrameEvidence'];route=json.loads(c['route']);t=[timestamp(json.loads(q['metadataJson'])['at']) for q in route]
                    captured=timestamp(ev['capturedAt'])
                    if ev['sourceZoneSha256']!=p['sourceZoneSha256']:state='evidence_conflict'
                    elif not(t[2]-2<=captured<=t[-3]+2):state='evidence_not_at_crossing'
                    elif o.get('size') not in SIZES:state='evidence_conflict'
                    else:
                        state='estimated';size=o['size'];evidence={'observationId':o['observationId'],'imageSha256':ev['imageSha256'],'capturedAt':ev['capturedAt'],'size':size,'sizeBasis':o['sizeBasis']}
                        current=json.loads(route[-1]['metadataJson'])['box'];cx=current[0]+current[2]/2;cy=current[1]+current[3]
                        for earlier in self.db.execute("SELECT * FROM candidates WHERE status='estimated' AND day=? AND completed_at<? AND completed_at>=?",(c['day'],c['completed_at'],c['completed_at']-15)):
                            last=json.loads(json.loads(earlier['route'])[-1]['metadataJson'])['box'];distance=math.hypot(cx-last[0]-last[2]/2,cy-last[1]-last[3])
                            earliest=timestamp(json.loads(route[0]['metadataJson'])['at'])
                            if distance<.04 and earlier['completed_at']<=earliest:
                                state='identity_ambiguous';reason=earlier['event_id'];break
                self.db.execute('UPDATE candidates SET status=?,size=?,evidence=?,identity_reason=? WHERE event_id=?',(state,size,canonical(evidence) if evidence else None,reason,c['event_id']))
    def document(self,day):
        windows=[dict(r) for r in self.db.execute('SELECT first_at,last_at,frames,dropped FROM windows WHERE day=? ORDER BY first_at',(day,))]
        require(len(windows)<=2000,'window_limit_no_silent_truncation')
        records=[]
        for r in self.db.execute('SELECT * FROM candidates WHERE day=? ORDER BY completed_at,event_id',(day,)):
            records.append({'eventId':r['event_id'],'sourceEventId':r['source_id'],'businessDate':day,'completedAt':iso(r['completed_at']),'status':r['status'],'size':r['size'],'samples':json.loads(r['route']),'localEvidence':json.loads(r['evidence']) if r['evidence'] else None,'possibleDuplicateOf':r['identity_reason']})
        require(len(records)<=2000,'event_limit_no_silent_truncation')
        return {'protocol':PROTOCOL,'deviceId':self.policy['deviceId'],'cameraName':'handoff','businessDate':day,'policyJson':self.policy_json,'policySha256':self.policy_sha,
          'windows':[{'from':iso(w['first_at']),'until':iso(w['last_at']),'frames':w['frames'],'droppedFrames':w['dropped']} for w in windows],
          'records':records,'scope':'directional_handoff_estimates_not_sales','requiresPerImageApproval':False,'generativeAiUsed':False,'commercialAccuracyValidated':False,'coversWholeBusinessDay':False,'physicalUniqueCountCertified':False}
