#!/usr/bin/env python3
"""Persist original local photographs through a credential-scoped native API.
No browser, language-model calls, fabricated events, sales or physical counts.
Uses a separate durable queue. Legacy sender holds are not read or changed.
"""
from __future__ import annotations
import argparse,base64,fcntl,hashlib,json,os,signal,sqlite3,sys,time
from pathlib import Path
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
from native_sync import NativeHttp,SyncError,ORIGIN
from ledger import require,canonical,digest,InvalidEvidence,parse_aware
from collector import atomic
PROTOCOL='ojala_local_cup_evidence_v1'
RECEIPT='ojala_local_cup_evidence_receipt_v1'

class PhotoHttp(NativeHttp):
 def _key(self):return super()._key(ORIGIN+'/api/trpc/frigate.submitLocalCupEvidence')
 def capabilities(self):return self._request('GET','frigate.localEvidenceCapabilities')
 def receipt(self,o):return self._request('POST','frigate.localCupEvidenceReceipt',{'apiKey':self._key(),'deviceId':o['deviceId'],'businessDate':o['businessDate'],'observationId':o['observationId']}).get('receipt')
 def send(self,payload):return self._request('POST','frigate.submitLocalCupEvidence',{'apiKey':self._key(),**payload})

def validate_photo_receipt(r,o,store):
 require(isinstance(r,dict) and r.get('protocol')==RECEIPT,'photo_receipt_protocol')
 require(r.get('persisted') is True and r.get('externalAiInvoked') is False and r.get('physicalDeliveryCountCreated') is False and r.get('countsAreSales') is False,'photo_receipt_scope')
 proof=o['sameFrameEvidence']
 expected={'storeId':store,'deviceId':o['deviceId'],'businessDate':o['businessDate'],'cameraName':'handoff','observationId':o['observationId'],'sourceEventId':o['sourceEventId'],'imageSha256':proof['imageSha256'],'capturedAt':proof['capturedAt'],'evidenceOrigin':'verified_snapshot'}
 for k,v in expected.items():require(r.get(k)==v and (type(r[k]) is int if type(v) is int else isinstance(r[k],str)),'photo_receipt_identity_'+k)
 require(type(r.get('eventId')) is int and r['eventId']>0,'photo_receipt_event_id')
 require(parse_aware(r.get('receivedAt')).timestamp()<=time.time()+120,'photo_receipt_future')
 return r

def safe_evidence(root,relative,expected,max_bytes):
 require(isinstance(relative,str) and not Path(relative).is_absolute(),'photo_evidence_path')
 p=root/relative
 require(not p.is_symlink() and p.resolve().is_relative_to(root.resolve()) and p.is_file(),'photo_evidence_path')
 require(0<p.stat().st_size<=max_bytes,'photo_evidence_size');raw=p.read_bytes();require(digest(raw)==expected,'photo_evidence_hash')
 return raw

def photo_payload(o,root,base,time_zone):
 require(isinstance(time_zone,str) and bool(time_zone),'photo_tenant_timezone_required')
 zone=ZoneInfo(time_zone)
 proof=o['sameFrameEvidence'];raw=safe_evidence(root,proof['storedSidecarRelativePath'],proof['originalSidecarSha256'],65536)
 image=safe_evidence(root,proof['storedImageRelativePath'],proof['imageSha256'],8*1024*1024)
 require(image.startswith(b'\xff\xd8\xff'),'photo_not_jpeg');s=json.loads(raw)
 require(s.get('cup_event_id')==o['sourceEventId'] and s.get('image_sha256')==proof['imageSha256'] and s.get('captured_at_utc')==proof['capturedAt'] and s.get('schema_version')==3 and s.get('camera')=='handoff' and s.get('cup_zone')=='handoff_zone','photo_original_metadata_mismatch')
 require(parse_aware(s['captured_at_utc']).astimezone(zone).date().isoformat()==o['businessDate'],'photo_day_mismatch')
 sys.path.insert(0,str(base/'handoff-visual-sender'));from handoff_visual_sender import normalize_capture_zone
 geometry,original_hash=normalize_capture_zone(s['zone_geometry'],s['zone_config_sha256'],s['image_dimensions'])
 original_geometry=canonical(s['zone_geometry']);require(original_hash==proof['sourceZoneSha256'] and digest(original_geometry)==proof['sourceZoneSha256'],'photo_geometry_binding')
 capture={k:s[k] for k in ['schema_version','camera','cup_zone','cup_event_id','captured_at_utc','image_sha256','image_dimensions']}
 capture.update(zone_geometry=json.loads(geometry),zone_config_sha256=digest(geometry))
 return {'deviceId':o['deviceId'],'businessDate':o['businessDate'],'observationId':o['observationId'],
  'imageDataUrl':'data:image/jpeg;base64,'+base64.b64encode(image).decode(), 'capture':capture,
  'normalizationProof':{'adapter':'beelink_object_v3','sourceMetadataJson':raw.decode('utf-8'),'sourceMetadataSha256':digest(raw),'sourceZoneCanonicalJson':original_geometry}}

class PhotoQueue:
 def __init__(self,path):
  self.db=sqlite3.connect(path,timeout=10);self.db.row_factory=sqlite3.Row
  self.db.execute('PRAGMA journal_mode=WAL');self.db.execute('PRAGMA synchronous=FULL')
  self.db.execute('CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY,day TEXT NOT NULL,image_sha TEXT NOT NULL,observation TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,dispatched REAL,absent_reads INTEGER NOT NULL DEFAULT 0,last_error TEXT,receipt TEXT)');self.db.commit()
 def close(self):self.db.close()
 def discover(self,observations):
  for o in observations:
   if not o.get('sameFrameEvidence'):continue
   proof=o['sameFrameEvidence'];old=self.db.execute('SELECT * FROM photos WHERE id=?',(o['observationId'],)).fetchone()
   excluded=o.get('sourceFalsePositive') or o.get('verification')!='same_frame_local_cv' or o.get('ownerSizeReview',{}).get('label')=='not_cup'
   if old:
    require(old['image_sha']==proof['imageSha256'],'photo_original_image_changed')
    status=old['status']
    if excluded and status not in ('acknowledged','delivery_unknown'):status='excluded'
    elif not excluded and status=='excluded':status='queued'
    with self.db:self.db.execute('UPDATE photos SET observation=?,status=? WHERE id=?',(canonical(o),status,o['observationId']))
   else:
    with self.db:self.db.execute('INSERT INTO photos(id,day,image_sha,observation,status) VALUES(?,?,?,?,?)',(o['observationId'],o['businessDate'],proof['imageSha256'],canonical(o),'excluded' if excluded else 'queued'))
 def acknowledge(self,o,r,store):
  validate_photo_receipt(r,o,store)
  with self.db:self.db.execute('UPDATE photos SET status=?,receipt=?,last_error=NULL WHERE id=?',('acknowledged',canonical(r),o['observationId']))
 def cycle(self,transport,config,build_payload,limit=2):
  if config.get('networkEnabled') is not True:return {'status':'disabled','networkAttempted':False}
  results=[]
  for row in self.db.execute("SELECT * FROM photos WHERE status IN ('queued','delivery_unknown') ORDER BY day DESC,id LIMIT ?",(limit,)).fetchall():
   o=json.loads(row['observation']);eid=row['id']
   try:
    caps=transport.capabilities();require(caps.get('protocol')==PROTOCOL and caps.get('scopedByCredential') is True and caps.get('browserRequired') is False and caps.get('externalAiRequired') is False and caps.get('requiresPersistedLocalObservation') is True and caps.get('persistedReadbackRequired') is True,'photo_protocol_not_ready')
    # Always reconcile by original identity before uploading or retrying.
    receipt=transport.receipt(o)
    if receipt is not None:
     self.acknowledge(o,receipt,config['storeId']);results.append({'id':eid,'status':'acknowledged','uploaded':False});continue
    if o.get('sourceFalsePositive') or o.get('verification')!='same_frame_local_cv' or o.get('ownerSizeReview',{}).get('label')=='not_cup':
     with self.db:self.db.execute("UPDATE photos SET status='excluded' WHERE id=?",(eid,))
     results.append({'id':eid,'status':'excluded','uploaded':False});continue
    if row['status']=='delivery_unknown':
     absent=row['absent_reads']+1;settled=row['dispatched'] is not None and time.time()-row['dispatched']>=120 and absent>=2
     status='blocked' if settled and row['attempts']>=3 else 'queued' if settled else 'delivery_unknown'
     with self.db:self.db.execute('UPDATE photos SET status=?,absent_reads=?,last_error=? WHERE id=?',(status,absent,'verified_absence' if settled else 'awaiting_settled_readback',eid))
     results.append({'id':eid,'status':status,'uploaded':False});continue
    payload=build_payload(o)
    with self.db:self.db.execute("UPDATE photos SET status='delivery_unknown',attempts=attempts+1,dispatched=?,absent_reads=0 WHERE id=?",(time.time(),eid))
    reply=transport.send(payload);require(reply.get('success') is True,'photo_application_not_confirmed')
    self.acknowledge(o,reply.get('receipt'),config['storeId']);results.append({'id':eid,'status':'acknowledged','uploaded':True})
   except (SyncError,InvalidEvidence,ValueError,OSError,KeyError) as exc:
    reason=str(exc) if isinstance(exc,(SyncError,InvalidEvidence)) else type(exc).__name__
    if len(reason)>120 or '://' in reason:reason=type(exc).__name__
    status=self.db.execute('SELECT status FROM photos WHERE id=?',(eid,)).fetchone()[0]
    auth_failure=reason in ('http_401','http_403')
    uncertain=status=='delivery_unknown' and reason in ('http_409','http_500','http_502','http_503','network_or_response_uncertain')
    if not uncertain and (reason.startswith('photo_receipt_') or reason.startswith('photo_evidence_') or reason in ('photo_protocol_not_ready','photo_original_metadata_mismatch','photo_geometry_binding','photo_day_mismatch','photo_not_jpeg','http_400','http_401','http_403','http_404','http_405','http_409','http_301','http_302','http_303','http_307','http_308','private_key_permissions','credential_scope_mismatch','machine_credential_missing')):status='blocked'
    with self.db:self.db.execute('UPDATE photos SET status=?,last_error=? WHERE id=?',(status,reason,eid))
    results.append({'id':eid,'status':status,'reason':reason,'uploaded':False})
    if auth_failure:return {'status':'authorization_hold','holdReason':reason,'results':results,'networkAttempted':True}
  return {'status':'checked','results':results,'states':dict(self.db.execute('SELECT status,count(*) FROM photos GROUP BY status').fetchall()),'networkAttempted':bool(results)}

def acknowledged_observations(root,start_date,device_id):
 with sqlite3.connect((root/'ledger.sqlite3').as_uri()+'?mode=ro',uri=True,timeout=5) as db:
  db.execute('PRAGMA query_only=ON')
  rows=db.execute("SELECT o.payload FROM observations o JOIN outbox b ON o.id=b.id AND o.revision=b.revision AND o.payload_sha=b.payload_sha WHERE o.day>=? AND b.status='acknowledged' ORDER BY o.day DESC,o.id LIMIT 2001",(start_date,)).fetchall()
 require(len(rows)<=2000,'photo_window_overflow_no_truncation')
 result=[json.loads(r[0]) for r in rows]
 require(all(o['deviceId']==device_id and o['cameraName']=='handoff' for o in result),'photo_device_scope')
 return result

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config',type=Path,required=True);p.add_argument('--daemon',action='store_true');p.add_argument('--limit',type=int,default=2);a=p.parse_args();os.umask(0o077)
 c=json.loads(a.config.read_text());base=Path(c['basePath']);root=Path(c['stateRoot']);ledger_root=Path(c['ledgerRoot']);sys.path.insert(0,str(base/'manus-bridge'));from package_storage import verify_external
 verify_external(base,root,writable=True,required_bytes=32*1024*1024);root.mkdir(mode=0o700,parents=True,exist_ok=True);require(1<=a.limit<=2,'photo_batch_limit')
 with (root/'worker.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);q=PhotoQueue(root/'photos.sqlite3');transport=PhotoHttp(c['apiOrigin'],c['machineCredentialFile'],c['storeId']);stop=[False]
  def finish(*_):stop[0]=True
  signal.signal(signal.SIGTERM,finish);signal.signal(signal.SIGINT,finish)
  try:
   while not stop[0]:
    verify_external(base,root,writable=True,required_bytes=32*1024*1024)
    q.discover(acknowledged_observations(ledger_root,c['startDate'],c['deviceId']))
    if (root/'authorization-hold.json').exists():result={'status':'authorization_hold','networkAttempted':False}
    else:result=q.cycle(transport,c,lambda o:photo_payload(o,ledger_root,base,c['timezone']),limit=a.limit)
    if result.get('status')=='authorization_hold' and result.get('holdReason'):atomic(root/'authorization-hold.json',{'createdAt':datetime.now(timezone.utc).isoformat(),'reason':result['holdReason'],'requiresSupportedCorrection':True})
    report={'checkedAt':datetime.now(timezone.utc).isoformat(),'browserRequired':False,'externalAiRequired':False,'physicalCountCreated':False,'photoStateCounts':dict(q.db.execute('SELECT status,count(*) FROM photos GROUP BY status').fetchall()),**result};atomic(root/'health.json',report)
    if not a.daemon:print(canonical(report),flush=True);break
    for _ in range(20):
     if stop[0]:break
     time.sleep(.25)
  finally:q.close()
if __name__=='__main__':main()
