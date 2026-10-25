#!/usr/bin/env python3
"""Observe real detector frames, persist provisional handoffs, and synchronize.
Original detector and ledger databases remain read-only. Heavy files stay external.
"""
from pathlib import Path
from contextlib import closing
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
import argparse,fcntl,hashlib,json,os,signal,sqlite3,sys,time,urllib.request
from directional_core import Counter,canonical,digest,iso,require
from directional_sync import Sync


def atomic(path,value):
    temp=path.with_suffix('.tmp')
    with temp.open('w') as f:f.write(canonical(value)+'\n');f.flush();os.fsync(f.fileno())
    os.replace(temp,path)

def read_json(path):
    with urllib.request.urlopen(path,timeout=4) as f:return json.load(f)

def guard_source(c,policy):
    config=read_json('http://127.0.0.1:5000/api/config');camera=config.get('cameras',{}).get('handoff',{})
    require(config.get('model',{}).get('path')=='/config/model_cache/ojala_cups_v4_640.onnx','active_model_configuration_changed')
    coords=camera.get('zones',{}).get('handoff_zone',{}).get('coordinates')
    require(isinstance(coords,str),'active_geometry_not_available')
    flat=list(map(float,coords.split(',')));polygon=[flat[i:i+2] for i in range(0,len(flat),2)]
    require(polygon==policy['zones']['handoff'],'active_zone_changed')
    require(camera.get('detect',{}).get('width')==policy['width'] and camera.get('detect',{}).get('height')==policy['height'],'active_dimensions_changed')
    with Path(c['modelFile']).open('rb') as model_file:model_sha=hashlib.file_digest(model_file,'sha256').hexdigest()
    require(model_sha==policy['detectorModelSha256'],'active_model_changed')
    with urllib.request.urlopen('http://127.0.0.1:5000/api/version',timeout=4) as f:version=f.read(120).decode()
    require(version.startswith('0.17.2-'),'source_version_requires_adapter_review')
    return version

def native_observations(path,day):
    with closing(sqlite3.connect(path.as_uri()+'?mode=ro',uri=True,timeout=3)) as db:
        db.execute('PRAGMA query_only=ON')
        return [json.loads(r[0]) for r in db.execute("SELECT o.payload FROM observations o JOIN outbox b ON o.id=b.id AND o.revision=b.revision AND o.payload_sha=b.payload_sha WHERE o.day=? AND b.status='acknowledged'",(day,))]

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',type=Path,required=True);parser.add_argument('--once',action='store_true');a=parser.parse_args();os.umask(0o077)
    c=json.loads(a.config.read_text());base=Path(c['basePath']);root=Path(c['stateRoot']);sys.path.insert(0,str(base/'manus-bridge'));sys.path.insert(0,c['nativeCodePath'])
    from package_storage import verify_external
    from native_sync import NativeHttp
    class Http(NativeHttp):
        def capabilities(self):return self._request('GET','frigate.directionalHandoffCapabilities')
        def send(self,envelope):return self._request('POST','frigate.submitDirectionalHandoffs',{'apiKey':self._key(),**envelope})
        def receipt(self,device,day):return self._request('POST','frigate.directionalHandoffReceipt',{'apiKey':self._key(),'deviceId':device,'businessDate':day}).get('receipt')
    verify_external(base,root,writable=True,required_bytes=64*1024*1024);root.mkdir(mode=0o700,parents=True,exist_ok=True)
    policy=json.loads(Path(c['policyFile']).read_text());require(policy['deviceId']==c['deviceId'] and policy['storeId']==c['storeId'],'configured_scope')
    stop=[False];signal.signal(signal.SIGTERM,lambda *_:stop.__setitem__(0,True));signal.signal(signal.SIGINT,lambda *_:stop.__setitem__(0,True))
    with (root/'counter.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        counter=Counter(root/'counter.sqlite3',policy);sync=Sync(root/'sync.sqlite3',c,Http(c['apiOrigin'],c['machineCredentialFile'],c['storeId']))
        last_guard=0;last_report=0;version=None
        try:
            while not stop[0]:
                verify_external(base,root,writable=True,required_bytes=64*1024*1024)
                if time.monotonic()-last_guard>30:
                    version=guard_source(c,policy);last_guard=time.monotonic()
                frame_path=Path(c['frameDatabase']);require(frame_path.is_file(),'frame_source_not_started')
                with closing(sqlite3.connect(frame_path.as_uri()+'?mode=ro',uri=True,timeout=3)) as frames:
                    frames.execute('PRAGMA query_only=ON')
                    rows=frames.execute('SELECT payload,sha256,received_at FROM frames WHERE frame_at>? ORDER BY frame_at LIMIT 256',(counter.cursor(),)).fetchall()
                for text,sha,received_at in rows:
                    require(digest(text)==sha,'original_metadata_checksum');counter.ingest_frame(json.loads(text),received_at)
                now=datetime.now(ZoneInfo(c['timezone']));day=now.date().isoformat()
                counter.reconcile(native_observations(Path(c['nativeLedgerDatabase']),day))
                if a.once and len(rows)==256:continue
                if a.once or time.monotonic()-last_report>=5:
                    document=counter.document(day);atomic(root/(day+'.json'),document)
                    if (root/'authorization-hold.json').exists():transport={'status':'authorization_hold','networkAttempted':False}
                    else:transport=sync.cycle(document)
                    if transport.get('reason') in ('http_401','http_403'):atomic(root/'authorization-hold.json',{'createdAt':now.isoformat(),'reason':transport['reason'],'requiresSupportedCorrection':True})
                    last=counter.cursor();source_fresh=last>0 and time.time()-last<=5
                    status='observing' if source_fresh else 'source_stale' if last else 'waiting_for_frames'
                    totals={k:0 for k in ('chico','mediano','pint','litro','unknown')}
                    for record in document['records']:
                        if record['status']=='estimated':totals[record['size']]+=1
                    report={'checkedAt':now.isoformat(),'status':status,'businessDate':day,'observedFrom':document['windows'][0]['from'] if document['windows'] else None,'observedUntil':document['windows'][-1]['until'] if document['windows'] else None,
                      'sourceFrames':sum(w['frames'] for w in document['windows']),'observedWindows':len(document['windows']),'candidateRoutes':len(document['records']),
                      'estimatedHandoffs':sum(totals.values()) if document['windows'] else None,'sizeBreakdown':totals if document['windows'] else None,'heldCandidates':sum(r['status']!='estimated' for r in document['records']),
                      'transport':transport,'documentSha256':digest(canonical(document)),'geometryCalibration':policy['geometryCalibration'],'sourceVersion':version,
                      'requiresPerImageApproval':False,'newInference':False,'generativeAiUsed':False,'browserRequired':False,'wholeDayCount':False,'physicalUniqueCountCertified':False,'salesCreated':False}
                    atomic(root/'health.json',report);last_report=time.monotonic()
                    if a.once:print(canonical(report),flush=True);break
                if not rows:time.sleep(.25)
        except Exception as exc:
            reason=str(exc) if isinstance(exc,ValueError) else type(exc).__name__
            if len(reason)>120 or '://' in reason:reason=type(exc).__name__
            failure={'checkedAt':iso(time.time()),'status':'paused','reason':reason,'salesCreated':False,'partial':True}
            atomic(root/'health.json',failure)
            with (root/'failures.jsonl').open('a') as log:log.write(canonical(failure)+'\n');log.flush();os.fsync(log.fileno())
            print(canonical(failure),flush=True);raise SystemExit(2)
        finally:sync.close();counter.close()
if __name__=='__main__':main()
