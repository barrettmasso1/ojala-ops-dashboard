#!/usr/bin/env python3
"""Read-only demo preflight. Never creates counts, uploads images, or launches browsers."""
from pathlib import Path
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
from contextlib import closing
import argparse,json,os,sqlite3,subprocess,sys,shutil,time,collections
ROOT=Path('/tmp/externo/home-ojala/ojala-active-evidence-20261017/recovery-debug-20261102/agent')
BASE=Path('/home/ojala/frigate')
ZONE=ZoneInfo('America/Mazatlan')

def read(path):
 try:return json.loads(path.read_text())
 except (OSError,ValueError):return {}

def freshness(value,now,max_age=180):
 try:
  stamp=value.get('checkedAt') or value.get('checked_at');at=datetime.fromisoformat(stamp.replace('Z','+00:00'));
  if at.tzinfo is None:raise ValueError('missing_timezone')
  age=now-at.timestamp()
  return {'fresh':-0.000001<=age<=max_age,'ageSeconds':round(max(0,age),1),'checkedAt':stamp}
 except (TypeError,ValueError,AttributeError):return {'fresh':False,'ageSeconds':None,'checkedAt':None}

def safe_error(exc):
 text=str(exc)
 return text if len(text)<120 and '://' not in text and not any(w in text.lower() for w in ['token','password','key','secret']) else type(exc).__name__

def probe(mode,day):
 if mode=='ledger':
  sys.path.insert(0,str(ROOT/'ledger-code'))
  from native_sync import NativeHttp,validate_receipt
  c=read(ROOT/'ledger-config.private.json');transport=NativeHttp(c['apiOrigin'],c['machineCredentialFile'],c['storeId'])
  with closing(sqlite3.connect((ROOT/'ledger-state/ledger.sqlite3').as_uri()+'?mode=ro',uri=True)) as db:
   db.row_factory=sqlite3.Row;row=db.execute('SELECT * FROM native_sync WHERE day=?',(day,)).fetchone()
   if not row:return {'status':'no_local_record','sameDayVerified':False}
   envelope={'sequence':row['sequence'],'documentJson':row['document_json'],'documentSha256':row['document_sha']}
  receipt=transport.receipt(c['deviceId'],day)
  if receipt and receipt.get('sequence',0)>envelope['sequence']:return {'status':'updated_during_read','sameDayVerified':False}
  validate_receipt(receipt,envelope,c['storeId'],c['deviceId'],day)
  return {'status':'readback_verified','sameDayVerified':True,'sequence':receipt['sequence'],'documentSha256':receipt['documentSha256'],'receivedAt':receipt['receivedAt'],'records':receipt['observationsPersisted'],'salesCreated':False}
 sys.path.insert(0,str(ROOT/'photo-code'))
 from native_photos import PhotoHttp,validate_photo_receipt
 from native_photo_validation import validation_state
 c=read(ROOT/'photo-config.private.json');transport=PhotoHttp(c['apiOrigin'],c['machineCredentialFile'],c['storeId']);results=[]
 with closing(sqlite3.connect((ROOT/'photo-state/photos.sqlite3').as_uri()+'?mode=ro',uri=True)) as db:
  rows=db.execute("SELECT observation,attempts FROM photos WHERE day=? AND status='acknowledged' ORDER BY id DESC LIMIT 2",(day,)).fetchall()
 for text,attempts in rows:
  o=json.loads(text);receipt=transport.receipt(o);validate_photo_receipt(receipt,o,c['storeId']);state=validation_state(receipt,o,c['storeId'])
  results.append({'eventId':receipt['eventId'],'businessDate':receipt['businessDate'],'imageSha256':receipt['imageSha256'],'validation':state,'uploadAttempts':attempts,'receivedAt':receipt['receivedAt']})
 return {'status':'sample_readbacks_verified' if results else 'no_photo_sample','sampleSize':len(results),'notWholeDayCountCertification':True,'samples':results}

def run_probe(mode,day):
 try:
  p=subprocess.run([sys.executable,'-B',__file__,'--date',day,'--probe',mode],capture_output=True,text=True,timeout=115)
  return json.loads(p.stdout) if p.returncode==0 else {'status':'probe_failed','reason':'isolated_probe_error'}
 except (OSError,ValueError,subprocess.TimeoutExpired) as exc:return {'status':'probe_unavailable','reason':type(exc).__name__}

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--date');ap.add_argument('--probe',choices=['ledger','photos']);ap.add_argument('--offline',action='store_true');ap.add_argument('--output',type=Path);a=ap.parse_args()
 day=a.date or datetime.now(ZONE).date().isoformat();date=datetime.fromisoformat(day).date()
 if date.isoformat()!=day or day<'2026-10-30' or date>datetime.now(ZONE).date():raise ValueError('unsupported_business_date')
 if a.probe:
  try:print(json.dumps(probe(a.probe,day)))
  except Exception as exc:print(json.dumps({'status':'probe_unavailable','reason':safe_error(exc)}))
  return
 now=time.time();report={'checkedAt':datetime.now(ZONE).isoformat(),'businessDate':day,'storeId':1,'reportMode':'read_only_preflight','businessDataWrites':0,'browserOpened':False,'sourceStorageRepaired':False,'salesOrUniqueDeliveriesCertified':False,'manualComparison':None,'shopifyComparison':None,'sameIntervalMatchPercentage':None}
 health={k:read(ROOT/p) for k,p in {'capture':'ledger-state/health.json','sync':'ledger-state/sync-health.json','photos':'photo-state/health.json','optical':'optical-state/health.json','trajectories':'metadata-state/health.json'}.items()}
 report['health']={k:{**freshness(v,now),'status':v.get('status')} for k,v in health.items()}
 with closing(sqlite3.connect((ROOT/'ledger-state/ledger.sqlite3').as_uri()+'?mode=ro',uri=True)) as db:
  db.execute('PRAGMA query_only=ON');obs=[json.loads(r[0]) for r in db.execute('SELECT payload FROM observations WHERE day=?',(day,))];valid=[o for o in obs if o['verification']=='same_frame_local_cv' and o.get('ownerSizeReview',{}).get('label')!='not_cup']
  report['observations']={'tracks':len(obs),'withEvidence':len(valid),'sizeAssignments':dict(collections.Counter(o['size'] for o in valid)),'provisionalSizeAssignments':sum(o.get('sizeAssessment',{}).get('provisional') is True for o in valid),'notSalesOrPhysicalCount':True}
 with closing(sqlite3.connect((ROOT/'photo-state/photos.sqlite3').as_uri()+'?mode=ro',uri=True)) as db:
  db.execute('PRAGMA query_only=ON');report['photoQueue']=[{'status':r[0],'automaticValidation':r[1],'rows':r[2],'uploadAttempts':r[3]} for r in db.execute('SELECT p.status,v.status,count(*),sum(p.attempts) FROM photos p LEFT JOIN photo_auto_validation v ON p.id=v.id WHERE p.day=? GROUP BY p.status,v.status',(day,))]
 optical=health['optical'];report['optical']={k:optical.get(k) for k in ['businessDate','status','countAvailability','estimatedPickups','jobs','transport']}
 if optical.get('businessDate')!=day:report['optical']={'status':'other_day_not_substituted','estimatedPickups':None}
 report['camera']={k:v for k,v in read(BASE/'config/ojala_operational_status.json').items() if k in ['checked_at','max_temperature_c','camera_fps','process_fps','skipped_fps','external_storage']}
 report['storage']={'freeInternalGiB':round(shutil.disk_usage('/home/ojala').free/1024**3,3),'freeExternalGiB':round(shutil.disk_usage(ROOT).free/1024**3,3),'minimumReserveGiB':8,'agentQuotaMiB':256,'mode':'external_reconciled','fullFilesystemIntegrityCertified':False}
 report['cloudProof']={'ledger':run_probe('ledger',day),'photos':run_probe('photos',day)} if not a.offline else {'status':'not_requested_offline'}
 report['demoVerdict']={'photoPipelineLocallyFresh':all(report['health'][k]['fresh'] for k in ['capture','sync','photos']),'cloudSameDayLedgerVerified':report['cloudProof'].get('ledger',{}).get('sameDayVerified',False),'fullAutonomousSalesCounterReady':False,'manualAndShopifyComparableSourcesLoaded':False,'physicalCountMayNotBeReplacedWithPhotoCount':True}
 text=json.dumps(report,indent=2,ensure_ascii=False)+'\n'
 if a.output:
  out=a.output.absolute();allowed=Path(__file__).resolve().parent
  if not out.is_relative_to(allowed) or out.is_symlink():raise ValueError('output_scope')
  temp=out.with_suffix('.tmp');temp.write_text(text);os.chmod(temp,0o600);os.replace(temp,out)
 print(text)
if __name__=='__main__':main()
