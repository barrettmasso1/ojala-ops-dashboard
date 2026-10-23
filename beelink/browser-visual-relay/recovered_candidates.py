"""Recover actual recording frames for completed primary tracks without a verified still.
This does not change v4, thresholds, camera geometry or physical cup counts.
Recovered frames retain their own origin and are NOT verified snapshots.
"""
import base64,hashlib,json,math,os,re,sqlite3,subprocess,time,zipfile
from pathlib import Path
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
from PIL import Image

def sha(data):return hashlib.sha256(data).hexdigest()
def need(v,code):
 if not v:raise ValueError(code)
def groups(events):
 groups=[]
 for event in sorted(events,key=lambda x:x['start_time']):
  box=event.get('data',{}).get('box');center=None
  if isinstance(box,list) and len(box)==4 and all(isinstance(x,(float,int)) and math.isfinite(x) for x in box):center=(box[0]+box[2]/2,box[1]+box[3]/2)
  match=None
  for g in reversed(groups):
   last=g[-1];other=last.get('data',{}).get('box')
   if event['start_time']-last['end_time']>25:break
   if center and isinstance(other,list) and len(other)==4 and abs(center[0]-(other[0]+other[2]/2))<0.07 and abs(center[1]-(other[1]+other[3]/2))<0.07 and event['start_time']-g[0]['start_time']<120:match=g;break
  if match is None:groups.append([event])
  else:match.append(event)
 return groups

def load_package(package):
 with zipfile.ZipFile(package) as z:
  need(set(z.namelist())=={'manifest.json','frame.jpg','capture.json','provenance.json'},'recovery_package_members')
  need(sum(i.file_size for i in z.infolist())<12*1024**2,'recovery_package_size')
  manifest=json.loads(z.read('manifest.json'));image=z.read('frame.jpg');capture=json.loads(z.read('capture.json'));provenance=json.loads(z.read('provenance.json'))
  need(manifest.get('origin')=='recording_extracted_frame' and capture['cup_event_id'].startswith('rec-'),'recovery_origin')
  for name,expected in manifest['hashes'].items():need(sha(z.read(name))==expected,'recovery_package_hash')
  need(sha(image)==capture['image_sha256'] and image[:3]==b'\xff\xd8\xff','recovery_image_integrity')
  need(provenance.get('physicalCount') is None,'recovery_not_a_count')
  return {'caseReference':manifest['caseReference'],'imageDataUrl':'data:image/jpeg;base64,'+base64.b64encode(image).decode(),'capture':capture}

def stage_recovered(relay,max_groups=1):
 from package_storage import temperature_c
 temp=temperature_c()
 if temp is None or temp>=83:return {'status':'paused_thermal','temperatureC':temp,'staged':0}
 now=time.time();day=datetime.now(relay.tz).date();start=datetime.combine(day,datetime.min.time(),tzinfo=relay.tz).timestamp()
 start=max(start,float(relay.config.get('recoveryStartEpoch',start)))
 refs=[];verified=set()
 for p in relay.images.glob('*.json'):
  try:
   d=json.loads(p.read_text());t=datetime.fromisoformat(d['captured_at_utc'].replace('Z','+00:00')).timestamp()
   verified.add(d['cup_event_id'])
   if d.get('schema_version')==3 and datetime.fromtimestamp(t,relay.tz).date()==day:refs.append((t,p,d))
  except (ValueError,KeyError,OSError):continue
 refs.sort(key=lambda x:x[0])
 completed=set()
 for row in relay.db.execute('SELECT source_tracks_json FROM events WHERE origin="recording_extracted_frame"'):
  try:completed.update(json.loads(row[0] or '[]'))
  except (ValueError,TypeError):pass
 db=sqlite3.connect((relay.base/'config/frigate.db').resolve().as_uri()+'?mode=ro',uri=True)
 try:rows=db.execute('SELECT id,start_time,end_time,zones,data,false_positive FROM event WHERE camera=? AND label=? AND start_time>=? AND end_time IS NOT NULL AND end_time<? ORDER BY start_time LIMIT 500',('handoff','cup',start,now-30)).fetchall()
 finally:db.close()
 candidates=[]
 for eid,begin,end,zones,data,fp in rows:
  if eid in verified or eid in completed or fp or not re.fullmatch('[A-Za-z0-9_.-]{8,100}',eid):continue
  try:
   zones=json.loads(zones) if isinstance(zones,str) else zones;data=json.loads(data) if isinstance(data,str) else data
   if 'handoff_zone' not in (zones or []):continue
   candidates.append({'id':eid,'start_time':begin,'end_time':end,'data':data or {}})
  except (ValueError,TypeError):continue
 archive=relay.base/'pilot-archive/forward-20260929';index=sqlite3.connect((archive/'index.sqlite3').resolve().as_uri()+'?mode=ro',uri=True)
 staged=0;missing=0
 try:
  for g in groups(candidates)[:max_groups]:
   best=max(g,key=lambda e:float(e['data'].get('top_score') or e['data'].get('score') or 0))
   at=best['start_time']+min(1.0,(best['end_time']-best['start_time'])/2)
   references=[r for r in refs if r[0]<=at]
   if not references:missing+=1;continue
   _,ref_path,ref=references[-1]
   seg=index.execute('SELECT archive_path,start_time,end_time,sha256 FROM segments WHERE start_time<=? AND end_time>? ORDER BY start_time DESC LIMIT 1',(at,at)).fetchone()
   if not seg:missing+=1;continue
   relative,begin,end,expected=seg;src=(archive/relative).resolve();need(src.is_relative_to(archive.resolve()),'archive_escape')
   if not src.is_file():missing+=1;continue
   need(sha(src.read_bytes())==expected,'archive_hash_mismatch')
   source_ids=sorted(e['id'] for e in g);key=sha(('/'.join(source_ids)+'/'+str(at)).encode())
   event_id='rec-'+day.strftime('%Y%m%d')+'-auto-'+key[:32];package=relay.root/'packages'/('recovered-'+key[:40]+'.zip')
   if not package.exists():
    frame=relay.root/'packages'/(key+'.frame.jpg')
    if not frame.exists():
     run=subprocess.run(['nice','-n','15','ffmpeg','-nostdin','-hide_banner','-loglevel','error','-threads','1','-ss',str(at-begin),'-i',str(src),'-frames:v','1','-q:v','3','-threads','1',str(frame)],capture_output=True,timeout=15)
     need(run.returncode==0 and frame.is_file(),'frame_decode_failed')
    image=frame.read_bytes()
    with Image.open(frame) as im:width,height=im.size
    geometry,_=relay.sender.normalize_capture_zone(ref['zone_geometry'],ref['zone_config_sha256'],ref['image_dimensions'])
    capture={'schema_version':3,'camera':'handoff','cup_zone':'handoff_zone','cup_event_id':event_id,'captured_at_utc':datetime.fromtimestamp(at,timezone.utc).isoformat(),'image_sha256':sha(image),'zone_geometry':json.loads(geometry),'zone_config_sha256':sha(geometry.encode()),'image_dimensions':{'width':width,'height':height}}
    provenance={'origin':'recording_extracted_frame','originalTrackIds':source_ids,'selectedTrackId':best['id'],'sourceSegment':relative,'sourceSegmentSha256':expected,'segmentStart':begin,'segmentEnd':end,'requestedFrameEpoch':at,'timestampBasis':'recording_segment_start_plus_seek_nearest_decodable_frame','zoneReferenceSidecar':str(ref_path),'zoneReferenceSha256':sha(ref_path.read_bytes()),'physicalCount':None,'verifiedSnapshot':False,'reason':'completed_primary_track_missing_verified_still'}
    data={'frame.jpg':image,'capture.json':json.dumps(capture,separators=(',',':')).encode(),'provenance.json':json.dumps(provenance,separators=(',',':')).encode()}
    manifest={'origin':'recording_extracted_frame','businessDate':day.isoformat(),'caseReference':'auto-recovery-'+key[:32],'hashes':{k:sha(v) for k,v in data.items()}}
    temp_path=package.with_suffix('.tmp')
    with zipfile.ZipFile(temp_path,'w',compression=zipfile.ZIP_STORED) as z:
     z.writestr('manifest.json',json.dumps(manifest));
     for name,content in data.items():z.writestr(name,content)
    with temp_path.open('rb') as f:os.fsync(f.fileno())
    os.replace(temp_path,package);os.chmod(package,0o600)
   item=load_package(package)
   relay.db.execute('INSERT OR IGNORE INTO events(event_id,day,image_sha,package_path,package_sha,status,updated_at,origin,source_tracks_json) VALUES(?,?,?,?,?,"pending",?,?,?)',(event_id,day.isoformat(),item['capture']['image_sha256'],str(package),sha(package.read_bytes()),relay.now(),'recording_extracted_frame',json.dumps(source_ids)));relay.db.commit();staged+=1
 finally:index.close()
 return {'status':'checked','staged':staged,'missingSourceOrGeometry':missing,'candidateTracks':len(candidates),'physicalCountCreated':False}
