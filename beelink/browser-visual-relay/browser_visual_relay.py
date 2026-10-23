#!/usr/bin/env python3
"""Original camera photos through the published, authenticated Firefox admin import.
No credential extraction, Frigate POST, physical cup counts, sales or inventory writes.
"""
import argparse,fcntl,hashlib,json,os,signal,sqlite3,sys,time,urllib.request,zipfile
from datetime import datetime,timedelta,timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ORIGIN='https://ojaladarsh-m6piugsr.manus.space'
BROWSER_SCRIPT=r'''
const input=arguments[0], day=arguments[1], write=arguments[2], done=arguments[arguments.length-1];
const unpack=x=>x?.result?.data?.json??x?.result?.data;
const fail=code=>{throw Error(code);};
let postStarted=false;
const query=async()=>{
 const q=encodeURIComponent(JSON.stringify({json:{businessDate:day,status:'all',limit:200}}));
 const r=await fetch('/api/trpc/dashboard.handoffVisualEvents?input='+q,{credentials:'same-origin',cache:'no-store',redirect:'error'});
 if(!r.ok)fail('readback_http_'+r.status);
 const rows=unpack(await r.json());if(!Array.isArray(rows))fail('readback_shape');return rows;
};
(async()=>{
 if(location.origin!=='https://ojaladarsh-m6piugsr.manus.space')fail('origin_mismatch');
 const ar=await fetch('/api/trpc/auth.me',{credentials:'same-origin',cache:'no-store',redirect:'error'});
 if(!ar.ok){done({status:'needs_session',postStarted:false});return;}
 const user=unpack(await ar.json());
 if(user?.role!=='admin'||user?.storeId!==1){done({status:'needs_owner_store_session',postStarted:false});return;}
 let rows=await query();let row=rows.find(e=>e.cupEventId===input.capture.cup_event_id);let mutation=null;
 if(!row&&rows.length>=200)fail('readback_limit_reached');
 if(!row&&write){
  postStarted=true;
  try{
   const res=await fetch('/api/trpc/dashboard.importVerifiedSnapshotHandoffFrame',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({json:input}),redirect:'error'});
   const body=await res.json();const value=unpack(body);
   mutation={httpStatus:res.status,eventId:value?.eventId,success:value?.success===true,disposition:value?.disposition,automaticPushVerified:value?.automaticPushVerified};
  }catch(e){mutation={responseUnknown:true};}
  rows=await query();row=rows.find(e=>e.cupEventId===input.capture.cup_event_id);
 }
 if(!row){done({status:postStarted?'awaiting_readback':'absent',postStarted,mutation});return;}
 if(row.storeId!==1||row.businessDate!==day||row.cameraName!==input.capture.camera||row.imageSha256!==input.capture.image_sha256||row.evidenceOrigin!=='verified_snapshot'||!Number.isInteger(row.id)||row.id<=0)fail('persisted_identity_conflict');
 let meta;try{meta=JSON.parse(row.captureMetadataJson);}catch(e){fail('persisted_metadata_invalid');}
 if(meta.cup_event_id!==input.capture.cup_event_id||meta.image_sha256!==input.capture.image_sha256||meta.zone_config_sha256!==input.capture.zone_config_sha256)fail('persisted_metadata_conflict');
 if(typeof row.imageKey!=='string'||!row.imageKey)fail('persisted_image_key_missing');
 const visible=Array.from(document.images).some(e=>e.alt==='Verified handoff visual event '+row.cupEventId&&e.complete&&e.naturalWidth>0);
 const keys=['id','storeId','businessDate','cameraName','cupEventId','imageSha256','imageKey','capturedAt','receivedAt','evidenceOrigin','analysisStatus','captureMetadataJson','sourceDetail'];
 done({status:'persisted',postStarted,mutation,row:Object.fromEntries(keys.map(k=>[k,row[k]])),persistedImageSha256:row.imageSha256,imageContentHashDownloaded:false,imageVisibleInCurrentView:visible,readBackAt:new Date().toISOString(),automaticDirectPushVerified:false,physicalCupCountCreated:false});
})().catch(e=>done({status:'held',postStarted,error:String(e.message).slice(0,120)}));
'''

class RelayError(ValueError):pass

def need(value,code):
 if not value:raise RelayError(code)

def sha(data):return hashlib.sha256(data).hexdigest()

def atomic(path,value):
 path=Path(path);temp=path.with_name(path.name+'.tmp')
 with temp.open('w') as f:json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 os.chmod(temp,0o600);os.replace(temp,path)

def check_receipt(result,item,day):
 need(result.get('status')=='persisted','not_persisted');r=result.get('row',{});capture=item['capture']
 need(type(r.get('id')) is int and r['id']>0,'invalid_row_id')
 for key,want in [('storeId',1),('businessDate',day),('cameraName','handoff'),('cupEventId',capture['cup_event_id']),('imageSha256',capture['image_sha256']),('evidenceOrigin','verified_snapshot')]:need(r.get(key)==want,'receipt_'+key+'_mismatch')
 need(result.get('persistedImageSha256')==capture['image_sha256'],'persisted_hash_mismatch')
 need(isinstance(r.get('imageKey'),str) and bool(r['imageKey']),'missing_image_reference')
 need(result.get('imageContentHashDownloaded') is False,'unverified_download_claim')
 need(result.get('automaticDirectPushVerified') is False and result.get('physicalCupCountCreated') is False,'receipt_scope_mismatch')
 meta=json.loads(r['captureMetadataJson'])
 need(meta.get('image_sha256')==capture['image_sha256'] and meta.get('cup_event_id')==capture['cup_event_id'],'metadata_identity_mismatch')
 need(meta.get('zone_config_sha256')==capture['zone_config_sha256'],'zone_mismatch')
 a=datetime.fromisoformat(meta['captured_at_utc'].replace('Z','+00:00'));b=datetime.fromisoformat(capture['captured_at_utc'].replace('Z','+00:00'))
 need(a.tzinfo is not None and b.tzinfo is not None and a==b,'capture_time_changed')
 need(a.astimezone(ZoneInfo('America/Mazatlan')).date().isoformat()==day,'business_date_mismatch')
 return r

class Browser:
 def __init__(self,path):
  info=json.loads(Path(path).read_text());need(info.get('baseUrl')=='http://127.0.0.1:4444','untrusted_control_endpoint')
  self.base=info['baseUrl']+'/session/'+info['sessionId'];self.window=info.get('relayWindow') or info['dashboardWindow']
 def call(self,method,path,data=None,timeout=100):
  req=urllib.request.Request(self.base+path,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json'},method=method)
  try:
   with urllib.request.urlopen(req,timeout=timeout) as r:return json.load(r)['value']
  except Exception:raise RelayError('browser_control_unavailable') from None
 def deliver(self,item,day,allow_write):
  self.call('POST','/window',{'handle':self.window},timeout=8)
  self.call('POST','/timeouts',{'script':90000,'pageLoad':30000,'implicit':0},timeout=8)
  return self.call('POST','/execute/async',{'script':BROWSER_SCRIPT,'args':[item,day,bool(allow_write)]})

class Relay:
 def __init__(self,config):
  need(config.get('schemaVersion')==1 and config.get('origin')==ORIGIN and config.get('storeId')==1,'configuration_scope')
  self.config=config;self.base=Path(config['basePath']);self.root=Path(config['stateRoot']);self.tz=ZoneInfo('America/Mazatlan')
  sys.path.insert(0,str(self.base/'manus-bridge'));sys.path.insert(0,str(self.base/'handoff-visual-sender'))
  from package_storage import verify_external
  import handoff_visual_sender,export_verified_snapshot_import
  self.guard=verify_external;self.sender=handoff_visual_sender;self.exporter=export_verified_snapshot_import
  self.images=self.base/'config/verified_snapshots/handoff';self.sender.VERIFIED_SNAPSHOT_DIR=self.images
  self.guard(self.base,self.root,writable=True,required_bytes=20*1024*1024)
  self.db=sqlite3.connect(self.root/'state/queue.sqlite3',timeout=10);self.db.row_factory=sqlite3.Row
  self.db.execute('PRAGMA journal_mode=WAL');self.db.execute('PRAGMA synchronous=FULL')
  self.db.execute('CREATE TABLE IF NOT EXISTS events(event_id TEXT PRIMARY KEY,day TEXT NOT NULL,image_sha TEXT NOT NULL,package_path TEXT NOT NULL,package_sha TEXT NOT NULL,status TEXT NOT NULL DEFAULT "pending",attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,receipt_path TEXT,updated_at TEXT NOT NULL)');self.db.commit()
  self.db.execute('UPDATE events SET status="delivery_unknown",last_error="interrupted_dispatch_requires_readback" WHERE status="dispatching"');self.db.commit()
 def now(self):return datetime.now(self.tz).isoformat()
 def scan(self):
  day=datetime.now(self.tz).date();prefixes={day.strftime('%Y%m%d'),(day+timedelta(days=1)).strftime('%Y%m%d')};added=0;invalid=0
  for image in sorted(self.images.glob('*')):
   if image.suffix.lower() not in self.sender.ALLOWED_SUFFIXES or image.name[:8] not in prefixes:continue
   if time.time()-image.stat().st_mtime<2:continue
   sidecar=self.sender.sidecar_path(image)
   if image.is_symlink() or sidecar.is_symlink() or image.resolve().parent!=self.images.resolve():continue
   if not sidecar.is_file() or time.time()-sidecar.stat().st_mtime<2:continue
   try:
    raw_meta=sidecar.read_bytes();source=json.loads(raw_meta)
    if source.get('schema_version')!=3 or not source.get('people') or not source.get('cup'):continue
    at=datetime.fromisoformat(source['captured_at_utc'].replace('Z','+00:00'));need(at.tzinfo is not None,'timestamp_zone')
    if at.astimezone(self.tz).date()!=day:continue
    existing=self.db.execute('SELECT * FROM events WHERE event_id=?',(source['cup_event_id'],)).fetchone()
    if existing:
     need(existing['image_sha']==source['image_sha256'],'local_event_identity_changed');continue
    metadata,digest=self.sender.event_metadata(image);data=image.read_bytes();need(sha(data)==digest,'source_image_changed')
    key=sha(('store1/handoff/'+metadata['cup_event_id']+'/'+digest).encode())
    package=self.root/'packages'/('firefox-'+key[:40]+'.zip')
    names={'snapshots/'+image.name:data,'snapshots/'+sidecar.name:raw_meta}
    manifest={'schemaVersion':1,'storeId':1,'cameraName':'handoff','businessDate':day.isoformat(),'events':[{'cupEventId':metadata['cup_event_id'],'capturedAt':metadata['captured_at_utc'],'image':'snapshots/'+image.name,'metadata':'snapshots/'+sidecar.name,'source':'verified_snapshot','segments':[]}],'files':[{'path':n,'bytes':len(b),'sha256':sha(b)} for n,b in names.items()],'countRecordIncluded':False,'cupsDetected':None,'transport':'firefox_authenticated_admin_relay'}
    if not package.exists():
     temp=package.with_suffix('.tmp')
     with zipfile.ZipFile(temp,'w',compression=zipfile.ZIP_STORED) as z:
      z.writestr('manifest.json',json.dumps(manifest,sort_keys=True))
      for name,content in names.items():z.writestr(name,content)
     with temp.open('rb') as f:os.fsync(f.fileno())
     os.replace(temp,package);os.chmod(package,0o600)
    doc,summary=self.exporter.convert(package);need(len(doc['items'])==1 and doc['items'][0]['capture']['cup_event_id']==metadata['cup_event_id'],'package_identity')
    self.db.execute('INSERT INTO events(event_id,day,image_sha,package_path,package_sha,status,updated_at) VALUES(?,?,?,?,?,"pending",?)',(metadata['cup_event_id'],day.isoformat(),digest,str(package),sha(package.read_bytes()),self.now()));self.db.commit();added+=1
   except Exception:invalid+=1
  return added,invalid
 def cycle(self,reconcile_only=False):
  self.guard(self.base,self.root,writable=True,required_bytes=20*1024*1024)
  added,invalid=self.scan();results=[]
  rows=self.db.execute('SELECT * FROM events WHERE status IN ("pending","delivery_unknown","awaiting_readback","needs_session","needs_owner_store_session","held") ORDER BY updated_at,event_id LIMIT ?',(self.config.get('maxEventsPerCycle',5),)).fetchall()
  for row in rows:
   package=Path(row['package_path']);need(package.parent==self.root/'packages' and not package.is_symlink(),'package_path');need(sha(package.read_bytes())==row['package_sha'],'package_integrity')
   doc,_=self.exporter.convert(package);item={'packageReference':doc['packageReference'],**doc['items'][0]};allow=row['status'] in ('pending','needs_session','needs_owner_store_session') and not reconcile_only
   if allow:
    self.db.execute('UPDATE events SET status="dispatching",attempts=attempts+1,updated_at=? WHERE event_id=?',(self.now(),row['event_id']));self.db.commit()
   try:result=Browser(self.config['browserSessionPath']).deliver(item,row['day'],allow)
   except RelayError:result={'status':'delivery_unknown' if allow else row['status'],'error':'browser_control_unavailable'}
   status=result.get('status','delivery_unknown');error=result.get('error');receipt_path=None
   if status=='persisted':
    try:
     check_receipt(result,item,row['day']);result.update(transport='firefox_authenticated_admin_relay',originalEventId=row['event_id'],originalPackageSha256=row['package_sha'],browserSessionRequired=True,checkedAt=self.now())
     receipt_path=self.root/'receipts'/(sha(row['event_id'].encode())+'.json');atomic(receipt_path,result)
    except Exception:status='held';error='receipt_validation_failed'
   elif status=='absent':status='pending' if not allow and row['status']=='pending' else 'awaiting_readback'
   if status not in ('persisted','pending','needs_session','needs_owner_store_session','held','delivery_unknown','awaiting_readback'):status='held'
   self.db.execute('UPDATE events SET status=?,last_error=?,receipt_path=COALESCE(?,receipt_path),updated_at=? WHERE event_id=?',(status,error,str(receipt_path) if receipt_path else None,self.now(),row['event_id']));self.db.commit()
   results.append({'eventId':row['event_id'],'status':status,'rowId':result.get('row',{}).get('id'),'postStarted':result.get('postStarted',False),'error':error})
   if status in ('needs_session','needs_owner_store_session') or error in ('browser_control_unavailable','origin_mismatch'):break
  health={'checkedAt':self.now(),'status':'checked','transport':'firefox_authenticated_admin_relay','discovered':added,'invalidSources':invalid,'states':dict(self.db.execute('SELECT status,count(*) FROM events GROUP BY status').fetchall()),'results':results,'automaticDirectFrigateVerified':False,'physicalCountCreated':False,'browserSessionRequired':True,'heavyFilesOnExternal':True}
  atomic(self.root/'state/health.json',health);return health

def main():
 p=argparse.ArgumentParser();p.add_argument('--config',required=True,type=Path);p.add_argument('--daemon',action='store_true');p.add_argument('--reconcile-only',action='store_true');a=p.parse_args();os.umask(0o077)
 config=json.loads(a.config.read_text());need(config.get('enabled') is True,'relay_disabled');root=Path(config['stateRoot'])
 with (root/'state/worker.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);relay=Relay(config);stop=[False]
  def finish(*_):stop[0]=True
  signal.signal(signal.SIGTERM,finish);signal.signal(signal.SIGINT,finish)
  try:
   while not stop[0]:
    try:
     result=relay.cycle(a.reconcile_only)
     if not a.daemon or result['results'] or result['discovered']:print(json.dumps(result),flush=True)
    except Exception as e:
     result={'checkedAt':datetime.now(timezone.utc).isoformat(),'status':'paused','reason':str(e) if isinstance(e,RelayError) else type(e).__name__,'physicalCountCreated':False}
     print(json.dumps(result),flush=True)
     if not a.daemon:raise SystemExit(2)
    if not a.daemon:break
    for _ in range(max(1,config.get('pollSeconds',5))):
     if stop[0]:break
     time.sleep(1)
  finally:relay.db.close()
if __name__=='__main__':main()
