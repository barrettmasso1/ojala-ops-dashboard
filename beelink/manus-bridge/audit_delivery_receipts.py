#!/usr/bin/env python3
"""Reconcile existing local receipts without resending or rewriting queue history."""
import hashlib,json,sqlite3
from pathlib import Path
from collections import Counter
from datetime import datetime
from zoneinfo import ZoneInfo
import manus_bridge as b
import receipt_collector as rc


def audit(base=b.BASE):
 state=base/'manus-bridge/state';db=sqlite3.connect((state/'queue.sqlite3').as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
 accepted={};batches=[];errors=[];counts=[];row_states=Counter()
 try:
  states=dict(db.execute('SELECT status,count(*) FROM batches GROUP BY status').fetchall())
  for row in db.execute("SELECT * FROM batches WHERE status='admin_receipt_verified' ORDER BY day,id"):
   try:
    manifest=rc.package_manifest(row,state)
    folder=state/'receipts'/row['id'];path=folder/'receipt.automatic.json'
    receipt=json.loads(path.read_text());proof=json.loads((folder/'automatic-verification.json').read_text())
    b.require(proof.get('receiptSha256')==b.digest(path.read_bytes()),'saved_receipt_hash_mismatch')
    b.require(proof.get('batchId')==row['id'] and proof.get('packageSha256')==row['sha256'],'saved_receipt_binding_mismatch')
    validation=rc.validate_receipt(receipt,row,manifest)
    filemap={v['path']:v for v in manifest['files']};eventmap={e['cupEventId']:e for e in manifest['events']}
    for item in receipt.get('visualRows',receipt.get('rows',[])):
     key=(1,row['day'],'handoff',item['cupEventId']);event=eventmap[item['cupEventId']]
     expected=filemap[event['image']]['sha256']
     if key in accepted:b.require(accepted[key]['rowId']==item['id'] and accepted[key]['imageSha256']==expected,'receipt_identity_conflict')
     accepted[key]={'rowId':item['id'],'imageSha256':expected,'analysisStatus':item['status']}
    if receipt['countRow'] is not None:
     c=receipt['countRow'];counts.append({k:c[k] for k in ['id','storeId','businessDate','cameraName','cupsDetected','coverage','recordSha256']})
    batches.append({'batchId':row['id'],'day':row['day'],'visualRows':validation['visualRows'],'readBackAt':receipt['readBackAt']})
   except Exception as exc:
    errors.append({'batchId':row['id'],'reason':str(exc) if isinstance(exc,b.BridgeError) else 'cached_receipt_validation_failed','errorType':type(exc).__name__})
 finally:db.close()
 bydate={};matched=0;retired=0;legacy=0;unmatched=0;mismatch=0
 q=sqlite3.connect((base/'handoff-visual-sender/state/queue.sqlite3').as_uri()+'?mode=ro',uri=True);q.row_factory=sqlite3.Row
 try:
  for row in q.execute('SELECT cup_event_id,camera_name,business_date,image_sha256,capture_metadata_json FROM verified_snapshot_queue'):
   if row['business_date']=='2026-09-27':retired+=1;continue
   day=bydate.setdefault(row['business_date'],{'localEvidenceRows':0,'receiptMatched':0,'noMatchingOfficialReceipt':0,'legacyGeometry':0})
   day['localEvidenceRows']+=1;key=(1,row['business_date'],row['camera_name'],row['cup_event_id'])
   known=accepted.get(key)
   if known is not None and known['imageSha256']==row['image_sha256']:
    matched+=1;day['receiptMatched']+=1
   else:
    unmatched+=1;day['noMatchingOfficialReceipt']+=1
    if known is not None:mismatch+=1
   try:old=json.loads(row['capture_metadata_json']).get('schema_version')!=3
   except (ValueError,TypeError):old=True
   legacy+=int(old);day['legacyGeometry']+=int(old)
 finally:q.close()
 result={'schemaVersion':1,'checkedAt':datetime.now(ZoneInfo('America/Mazatlan')).isoformat(),
 'scope':'local_receipts_revalidated_against_original_package_hashes_not_a_new_production_query',
 'bridgeStates':states,'verifiedBatchReceipts':len(batches),'uniquePersistedVisualRecords':len(accepted),
 'localEvidenceMatchedByIdAndHash':matched,'withoutMatchingOfficialReceipt':unmatched,
 'retiredDateExcluded':retired,'legacyGeometryRows':legacy,'identityMismatches':mismatch,
 'errors':errors,'byBusinessDate':bydate,'countReceipts':list({c['id']:c for c in counts}.values()),
 'directFrigateVerified':False,'networkWrites':0,'queueRowsModified':0,
 'limitations':['No matching official receipt does not prove absence after a separate administrative recovery import.',
 'Retired dates are excluded, never replayed.','Images and partial camera counts are not full-day deliveries.']}
 return result

if __name__=='__main__':
 report=audit();stamp=datetime.now(ZoneInfo('America/Mazatlan'))
 path=b.BASE/'pilot-reports'/stamp.date().isoformat()/'receipt-reconciliation'/('audit-'+stamp.strftime('%H%M%S%f')+'.json')
 b.private_json(path,report);b.private_json(b.BASE/'manus-bridge/state/effective-delivery-status.json',dict(report,report=str(path)))
 print(json.dumps({k:v for k,v in report.items() if k not in {'byBusinessDate','limitations','countReceipts'}}))
 print('REPORT',path)
