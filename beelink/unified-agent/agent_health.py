#!/usr/bin/env python3
"""One local entrypoint/health record for the Ojala camera agent.
Read-only checks never restart cameras, alter receipts, send data or fabricate counts.
"""
from __future__ import annotations
import argparse,json,os,signal,subprocess,sys,time
from datetime import datetime,timezone
from pathlib import Path
from zoneinfo import ZoneInfo
VERSION='ojala_agent_health_v1'
UNITS=('ojala-local-cup-ledger.service','ojala-local-cup-sync.service','ojala-local-size-calibration.service','ojala-local-photo-sync.service')

def stamp(value):
    if not isinstance(value,str):return None
    try:
        d=datetime.fromisoformat(value.replace('Z','+00:00'))
        return d.timestamp() if d.tzinfo else None
    except (ValueError,OverflowError):return None

def fresh(record,now,maximum):
    if not isinstance(record,dict):return False
    at=stamp(record.get('checkedAt') or record.get('checked_at') or record.get('checked_at_utc'))
    return at is not None and -30<=now-at<=maximum

def summarize(records,services,now,day,store,device):
    issues=[];components={}
    for key,max_age in [('capture',150),('collector',90),('ledgerSync',90),('photoSync',150),('calibration',180),('archive',420)]:
        r=records.get(key);valid=fresh(r,now,max_age)
        components[key]={'available':isinstance(r,dict),'fresh':valid,'reportedStatus':r.get('status') if isinstance(r,dict) else None,'checkedAt':(r.get('checkedAt') or r.get('checked_at') or r.get('checked_at_utc')) if isinstance(r,dict) else None}
        if not valid:issues.append(key+'_missing_or_stale')
    archive=records.get('archive') or {}
    if archive.get('status') not in ('ok','catching_up','already_running'):issues.append('recording_archive_not_healthy')
    used=archive.get('archive_bytes');limit=archive.get('max_archive_bytes')
    if type(used) is int and type(limit) is int and limit>0 and used>=limit*.95:issues.append('recording_archive_quota_nearly_full')
    camera=records.get('capture') or {};operating=camera.get('operating_hours') is True or camera.get('manual_session_outside_schedule') is True
    if operating and isinstance(camera.get('process_fps'),(int,float)) and camera['process_fps']<4.5:issues.append('camera_processing_degraded')
    temp=camera.get('max_temperature_c')
    if isinstance(temp,(int,float)) and temp>=83:issues.append('physical_cooling_attention')
    c=records.get('collector') or {}
    if c.get('invalidEvidence') or c.get('invalidTracks'):issues.append('capture_evidence_rejected')
    sync=records.get('ledgerSync') or {};today=[r for r in sync.get('results',[]) if isinstance(r,dict) and r.get('businessDate')==day]
    if not today:issues.append('today_ledger_reception_not_verified')
    elif any(r.get('status')!='acknowledged' for r in today):issues.append('ledger_reception_not_acknowledged')
    photos=records.get('photoSync') or {};counts=photos.get('photoStateCounts') or photos.get('states') or {}
    if photos.get('status') in ('authorization_hold','disabled','blocked'):issues.append('photo_transport_'+photos['status'])
    if counts.get('blocked',0):issues.append('photo_items_blocked')
    if counts.get('delivery_unknown',0):issues.append('photo_receipts_unresolved')
    automatic=photos.get('automaticValidation')
    if not isinstance(automatic,dict):
        issues.append('photo_automatic_validation_missing');automatic={}
    elif automatic.get('status') not in ('checked',):issues.append('photo_automatic_validation_'+str(automatic.get('status','unknown')))
    validation_counts=automatic.get('states') or {}
    if validation_counts.get('blocked',0):issues.append('photo_automatic_validation_blocked')
    if validation_counts.get('unknown',0):issues.append('photo_automatic_validation_readback_pending')
    backlog=sum(v for k,v in counts.items() if k in ('queued','delivery_unknown') and type(v) is int and v>=0)
    for unit in UNITS:
        if services.get(unit)!='active':issues.append('service_not_active:'+unit)
    optical=records.get('opticalPickup')
    if 'opticalPickup' in records:
        valid=fresh(optical,now,150)
        components['opticalPickup']={'available':isinstance(optical,dict),'fresh':valid,'reportedStatus':optical.get('status') if isinstance(optical,dict) else None,'checkedAt':optical.get('checkedAt') if isinstance(optical,dict) else None}
        if not valid:issues.append('optical_pickup_missing_or_stale')
        if services.get('ojala-optical-pickup.service')!='active':issues.append('service_not_active:ojala-optical-pickup.service')
        if isinstance(optical,dict):
            if optical.get('status')!='running':issues.append('optical_pickup_'+str(optical.get('status','unknown')))
            if (optical.get('transport') or {}).get('status')!='acknowledged':issues.append('optical_pickup_not_received')
            if optical.get('businessDate')!=day:issues.append('optical_pickup_wrong_day')
            if (optical.get('jobs') or {}).get('blocked',0):issues.append('optical_pickup_candidates_blocked')
            if optical.get('countAvailability')=='no_conclusive_route' or (optical.get('unresolved',0)>0 and optical.get('estimatedPickups') in (None,0)):issues.append('optical_pickup_no_conclusive_route')
            elif optical.get('unresolved',0)>0:issues.append('optical_pickup_incomplete_estimate')
    calibration=records.get('calibration') or {};supported=[s for s in calibration.get('supportedCategories',[]) if s in ('chico','mediano','pint','litro')]
    missing=[s for s in ('chico','mediano','pint','litro') if s not in supported]
    return {'protocol':VERSION,'checkedAt':datetime.fromtimestamp(now,timezone.utc).isoformat(),'businessDate':day,'storeId':store,'deviceId':device,
        'status':'attention_required' if issues else 'running','issues':issues,'components':components,'services':services,
        'cameraScheduledActive':operating,'processFps':camera.get('process_fps'),'temperatureC':temp,
        'todayLedgerAcknowledged':bool(today) and all(r.get('status')=='acknowledged' for r in today),'photoQueue':counts,'photoBacklog':backlog,'photoAutomaticValidation':validation_counts,
        'locallySupportedSizes':supported,'sizesNotYetValidated':missing,'uniquePhysicalCountValidated':False,'commercialAcceptanceComplete':False,
        'opticalPickup':{k:optical.get(k) for k in ['status','businessDate','jobs','estimatedPickups','acceptedAlgorithmCandidates','countAvailability','sizeBreakdown','unresolved','transport','coversWholeBusinessDay']} if isinstance(optical,dict) else None,
        'cameraObservationsAreSales':False,'generativeAiRequired':False,'browserRequired':False,'externalMessagesSent':False,
        'note':'Technical reception health is separate from counting accuracy, manual tally, POS and billing activation.'}

def read_json(p):
    if p.is_symlink() or not p.is_file() or p.stat().st_size>4*1024*1024:return None
    try:return json.loads(p.read_text())
    except (OSError,ValueError):return None

def atomic(path,value):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    if path.is_symlink():raise ValueError('health_output_symlink')
    temp=path.with_suffix('.tmp')
    with temp.open('w') as f:json.dump(value,f,ensure_ascii=True,sort_keys=True);f.write('\n');f.flush();os.fsync(f.fileno())
    os.chmod(temp,0o600);os.replace(temp,path)

def cycle(config):
    base=Path(config['basePath']);root=Path(config['stateRoot']);sys.path.insert(0,str(base/'manus-bridge'))
    from package_storage import verify_external
    verify_external(base,root,writable=True,required_bytes=8*1024*1024)
    records={k:read_json(Path(v)) for k,v in config['healthSources'].items()}
    units=UNITS+(('ojala-optical-pickup.service',) if 'opticalPickup' in config['healthSources'] else ())
    result=subprocess.run(['systemctl','--user','show',*units,'-p','Id','-p','ActiveState'],capture_output=True,text=True,timeout=8)
    services={}
    for part in result.stdout.split('\n\n'):
        fields=dict(line.split('=',1) for line in part.splitlines() if '=' in line)
        if fields.get('Id') in units:services[fields['Id']]=fields.get('ActiveState','unknown')
    now=time.time();day=datetime.fromtimestamp(now,ZoneInfo(config['timezone'])).date().isoformat()
    report=summarize(records,services,now,day,config['storeId'],config['deviceId']);atomic(root/'health.json',report);return report

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config',type=Path,required=True);p.add_argument('--daemon',action='store_true');args=p.parse_args();os.umask(0o077)
    config=json.loads(args.config.read_text());stop=[False]
    def finish(*_):stop[0]=True
    signal.signal(signal.SIGTERM,finish);signal.signal(signal.SIGINT,finish)
    while not stop[0]:
        try:
            r=cycle(config)
            if not args.daemon:print(json.dumps(r,ensure_ascii=True),flush=True)
        except Exception as exc:
            print(json.dumps({'status':'health_unavailable','errorType':type(exc).__name__}),flush=True)
            if not args.daemon:return 2
        if not args.daemon:break
        for _ in range(120):
            if stop[0]:break
            time.sleep(.25)
    return 0
if __name__=='__main__':raise SystemExit(main())
