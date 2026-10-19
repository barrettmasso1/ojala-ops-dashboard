#!/usr/bin/env python3
"""Review archived video through the private Manus task, then validate locally.

Never counts photographs/tracks, never sends directly to Frigate, never claims
full-day coverage. The existing bridge imports only the resulting exact ledger.
"""
import argparse
from datetime import datetime, timedelta, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import time
import zipfile
import manus_bridge as b
from receipt_collector import download_attachment

POLICY = 'physical-partial-video-review-v1'
MAX_RESPONSE = 128 * 1024
AI_REVIEWER = 'Manus AI — video review'

def need(ok, reason):
    b.require(ok, reason)

def save_new(path, content):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists():
        need(path.read_bytes() == content, 'immutable_review_file_conflict')
        return
    with path.open('xb') as f:
        os.chmod(path, 0o600)
        f.write(content); f.flush(); os.fsync(f.fileno())

def read_source(row, bridge_state):
    path = b.within(Path(row['path']), bridge_state)
    need(path.stat().st_size <= b.MAX_PACKAGE, 'review_package_too_large')
    need(b.digest(path.read_bytes()) == row['sha256'], 'review_package_hash_mismatch')
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        need(len(names) == len(set(names)), 'duplicate_archive_members')
        need(sum(i.file_size for i in z.infolist()) <= b.MAX_PACKAGE, 'expanded_package_too_large')
        manifest = json.loads(z.read('manifest.json'))
        need(b.digest(b.canonical(manifest)) == row['id'], 'review_manifest_binding_mismatch')
        need(manifest['businessDate'] == row['day'] and manifest['storeId'] == 1
             and manifest['cameraName'] == 'handoff', 'review_source_scope_mismatch')
        need(manifest.get('countRecordIncluded') is False, 'source_already_has_count')
        declared = {}
        for item in manifest['files']:
            p = PurePosixPath(item['path'])
            need(not p.is_absolute() and '..' not in p.parts and str(p) == item['path'],
                 'invalid_archive_member_path')
            need(item['path'] not in declared, 'duplicate_manifest_member')
            data = z.read(item['path'])
            need(len(data) == item['bytes'] and b.digest(data) == item['sha256'],
                 'review_source_file_hash_mismatch')
            declared[item['path']] = item
        need(set(names) == set(declared) | {'manifest.json'}, 'undeclared_archive_member')
    return manifest, path

def request_prompt(job, manifest):
    return f"""OJALA_PHYSICAL_REVIEW:{job['id']}
Owner-authorized automated video review. POLICY {POLICY}. This is review ONLY:
DO NOT import a count, change production, generate sales or retry Cloudflare.
The existing local validator and sender will handle an accepted record later.
Batch {job['batchId']}; ZIP SHA256 {job['packageSha256']}; Store 1; handoff;
business date {job['day']}, America/Mazatlan. Verify manifest hashes first.
Review ORIGINAL VIDEO across candidate windows, using snapshot/zone sidecars for
context. Establish distinct filled gelato cups with a person inside handoff_zone.
Two appearances of the same persistent cup are one unit. A photo, track ID,
visibleCupCount or POS total is NOT a unique cup. Deduplicate overlapping windows,
returns, occlusions and reappearances. Simultaneously distinct cups can be separate.
Exclude covered/unknown contents, ambiguous identity and unsupported zone membership.
Do not infer sizes, here/to-go, sales or ounces. No human sign-off is claimed.

Return exactly one downloadable JSON attachment named physical-review-{job['id']}.json,
under 128 KiB, with:
schemaVersion:1, policy:"{POLICY}", jobId:"{job['id']}",
batchId:"{job['batchId']}", packageSha256:"{job['packageSha256']}",
reviewerType:"ai", humanApproved:false, reviewedAt:actual offset-aware ISO timestamp,
status:"reviewed", and ledger with the following REQUIRED shape:
businessDate:"{job['day']}", storeId:1, cameraName:"handoff",
countBasis:"reviewed_unique_physical_cups", reviewedBy:"Manus AI — video review",
status:"approved", coverage:"partial",
candidateIds: ALL {len(manifest['events'])} cupEventId values in manifest.events (exact set),
evidence:[{{id:stable reference name, path:original manifest MP4 path under segments/,
sha256:original file hash, at:actual observed frame UTC ISO timestamp}}],
units:[{{id:stable unique physical-unit identity, decision:"confirmed",
personAndFilledCup:true, inHandoffZone:true, evidenceIds:[at least two references
at DISTINCT original times], identityReason:concrete visual explanation}}],
cases:[{{id:unique case, candidateIds:[original event IDs handled by this case],
disposition:one of counted/duplicate/returned_or_repacked/non_service_container/
false_positive/pending, unitIds:[supported physical-unit IDs only],
evidenceIds:[actual evidence reference IDs]}}],
dailyReview:{{scope:"confirmed_units_in_partial_evidence",completed:true,
gaps:[specific unreviewed intervals, ambiguous cases and incomplete candidate coverage]}}.
Every candidate ID must appear in exactly one case. Use only original MP4 references;
timestamps must fall inside that segment's manifest startTime/endTime AND this local
business date. Multiple observations within the same segment are allowed, with actual
different frame times. Never fabricate times or confirmation flags to satisfy the schema.
Pending/rejected cases do not create units. Unknown is not zero.
If no qualifying units are supported, return status:"no_supported_units", units:[],
and the actual reviewed/pending cases; NEVER export a daily zero.
If original video is unavailable, report the missing paths, do not fabricate a ledger.
This task is only AI review; later hash validation cannot prove model accuracy.
No code changes, migrations, deployment, notifications to people or unrelated tests."""

def job_id(batch_id, replay):
    return b.digest(b.canonical({'policy':POLICY,'batchId':batch_id,'replay':replay}))

def normalize_review(document, job, row, base):
    need(document.get('schemaVersion') == 1 and document.get('policy') == POLICY,
         'review_policy_mismatch')
    for k, value in [('jobId',job['id']),('batchId',job['batchId']),
                     ('packageSha256',job['packageSha256'])]:
        need(document.get(k) == value, 'review_request_binding_mismatch')
    need(document.get('reviewerType') == 'ai' and document.get('humanApproved') is False,
         'reviewer_attribution_missing')
    need(document.get('status') in ('reviewed','no_supported_units'), 'review_status_invalid')
    at = datetime.fromisoformat(document['reviewedAt'].replace('Z','+00:00'))
    need(at.tzinfo is not None and job['sentAt']-5 <= at.timestamp() <= time.time()+300,
         'review_timestamp_invalid')
    manifest, package = read_source(row, base/'manus-bridge/state')
    ledger = json.loads(json.dumps(document['ledger']))
    need(ledger.get('businessDate') == job['day'] and ledger.get('storeId') == 1
         and ledger.get('cameraName') == 'handoff', 'review_ledger_scope_mismatch')
    need(ledger.get('coverage') == 'partial' and ledger.get('status') == 'approved'
         and ledger.get('countBasis') == 'reviewed_unique_physical_cups',
         'review_cannot_assert_full_day')
    need(ledger.get('reviewedBy') == AI_REVIEWER,
         'reviewer_attribution_missing')
    need(ledger.get('dailyReview',{}).get('scope') == 'confirmed_units_in_partial_evidence'
         and ledger['dailyReview'].get('completed') is True
         and bool(ledger['dailyReview'].get('gaps')), 'partial_scope_and_gaps_required')
    wanted = {e['cupEventId'] for e in manifest['events']}
    need(set(ledger['candidateIds']) == wanted and len(ledger['candidateIds']) == len(wanted),
         'review_candidate_universe_mismatch')
    files = {f['path']:f for f in manifest['files']}
    segments = {}
    for event in manifest['events']:
        for seg in event['segments']:
            old = segments.setdefault(seg['path'],seg)
            need(old == seg, 'inconsistent_segment_bounds')
    original_refs={ref['id']:ref['path'] for ref in ledger['evidence']}
    event_segments={event['cupEventId']:{seg['path'] for seg in event['segments']} for event in manifest['events']}
    for case in ledger['cases']:
        need(set(case['candidateIds']) <= wanted, 'case_has_foreign_candidate')
        for candidate in case['candidateIds']:
            need(any(original_refs.get(ref) in event_segments[candidate] for ref in case['evidenceIds']),
                 'candidate_video_reference_missing')
    gaps=ledger['dailyReview']['gaps']
    need(isinstance(gaps,list) and all(isinstance(g,str) and g.strip() for g in gaps),
         'invalid_partial_gaps')
    folder = base/'pilot-reports'/job['day']/'automatic-count-review'/job['id']
    with zipfile.ZipFile(package) as z:
        for ref in ledger['evidence']:
            name = ref['path']
            need(name in files and name in segments and name.startswith('segments/')
                 and name.endswith('.mp4') and '/handoff/' in name, 'original_handoff_video_required')
            need(ref['sha256'] == files[name]['sha256'], 'review_evidence_hash_mismatch')
            frame = datetime.fromisoformat(ref['at'].replace('Z','+00:00'))
            need(frame.tzinfo is not None and frame.astimezone(b.TZ).date().isoformat() == job['day'],
                 'review_evidence_date_mismatch')
            need(segments[name]['startTime'] <= frame.timestamp() <= segments[name]['endTime'],
                 'review_frame_outside_original_segment')
            dest = folder/'source'/name
            need(dest.resolve().is_relative_to(folder.resolve()), 'external_review_evidence')
            save_new(dest,z.read(name))
            ref['path'] = str(dest.relative_to(base))
    ledger['approvedAt'] = document['reviewedAt']
    ledger['provenance'] = {'reviewerType':'ai','humanApproved':False,'policy':POLICY,
        'jobId':job['id'],'batchId':job['batchId'],'packageSha256':job['packageSha256'],
        'originalResponseSha256':b.digest(b.canonical(document)),
        'normalization':'Only source paths rebased to immutable local copies; decisions preserved.'}
    review = b.load_module(base/'count-review/review_counts.py','automatic_ledger_validation')
    result = review.evaluate(ledger,base)
    need(result['reviewedCandidateCount'] == result['candidateCount'], 'candidate_partition_incomplete')
    if document['status'] == 'no_supported_units':
        need(not ledger['units'], 'no_units_status_conflict')
        save_new(folder/'review.response.json',b.canonical(document))
        save_new(folder/'review-ledger.json',json.dumps(ledger,sort_keys=True).encode())
        return None, folder, result
    record = review.export_partial_record(ledger,base,document['reviewedAt'])
    push = b.load_module(base/'scripts/frigate_push_counts.py','automatic_push_validation')
    need(push.validate_record(record,job['day']) is None,'invalid_generated_partial')
    push.approval_timestamp(record)
    save_new(folder/'review.response.json',b.canonical(document))
    save_new(folder/'review-ledger.json',json.dumps(ledger,sort_keys=True).encode())
    save_new(folder/'record.json',json.dumps(record,sort_keys=True).encode())
    return record, folder, result

def publish_record(record, job, base):
    target = base/'scripts/approved_counts'/(job['day']+'.json')
    content = json.dumps(record,sort_keys=True).encode()
    if target.exists():
        need(json.loads(target.read_text()) == record, 'existing_count_preserved')
    else:
        save_new(target,content)
    # A crash after publication is safe: repeat validation and idempotent staging.
    manifest, files = b.assemble(job['day'],base)
    return b.stage(manifest,files,base/'manus-bridge/state')

def update_job(path, job, **changes):
    job.update(changes); b.private_json(path,job)

def private_task(api):
    task = api.call('task.detail',{'task_id':b.TASK})['task']
    need(task.get('id') == b.TASK and task.get('share_visibility') == 'private',
         'review_task_not_private')
    return task

def receive_jobs(db, api, base, jobs):
    recovered=[]
    for path in jobs.glob('*/state.json'):
        job=json.loads(path.read_text())
        if job['status']=='validated' and not job['replay']:
            folder=base/'pilot-reports'/job['day']/'automatic-count-review'/job['id']
            response=json.loads((folder/'review.response.json').read_text())
            row=db.execute('SELECT * FROM batches WHERE id=?',(job['batchId'],)).fetchone()
            record,_,_=normalize_review(response,job,row,base)
            staged=publish_record(record,job,base)
            update_job(path,job,status='count_queued',countBatchId=staged['batchId'],
                       dashboardReceived=False,recordSha256=b.digest(json.dumps(record,sort_keys=True).encode()))
            recovered.append({'jobId':job['id'],'status':'count_queued','recoveredAfterInterruption':True})
        if job['status']=='count_queued':
            row=db.execute('SELECT status FROM batches WHERE id=?',(job['countBatchId'],)).fetchone()
            if row and row['status']=='admin_receipt_verified':
                update_job(path,job,status='count_receipt_verified',dashboardReceived=True,directFrigateVerified=False)
                recovered.append({'jobId':job['id'],'status':'count_receipt_verified','cupsDetected':job['cupCount']})
    active = [p for p in jobs.glob('*/state.json')
              if json.loads(p.read_text()).get('status') in ('dispatching','awaiting_review','validated')]
    if not active: return recovered
    private_task(api)
    messages=[];cursor=None
    earliest=min(json.loads(p.read_text())['sentAt'] for p in active)-2
    for _ in range(8):
        params={'task_id':b.TASK,'limit':100,'order':'desc'}
        if cursor:params['cursor']=cursor
        page=api.call('task.listMessages',params)
        items=page.get('messages',[]);messages.extend(items)
        if any(float(x.get('timestamp',0))/1000<earliest for x in items) or not page.get('has_more'):break
        following=page.get('next_cursor')
        if not following or following==cursor:break
        cursor=following
    results=recovered
    for path in active:
        job=json.loads(path.read_text())
        row=db.execute('SELECT * FROM batches WHERE id=?',(job['batchId'],)).fetchone()
        need(row is not None,'review_batch_missing')
        for msg in messages:
            if float(msg.get('timestamp',0))/1000 < job['sentAt']-2:continue
            if msg.get('type') != 'assistant_message':continue
            for attachment in msg.get('assistant_message',{}).get('attachments',[]):
                if attachment.get('filename') != 'physical-review-'+job['id']+'.json':continue
                try:
                    raw=download_attachment(attachment)
                    need(len(raw)<=MAX_RESPONSE,'review_response_too_large')
                    document=json.loads(raw)
                    record, folder, result=normalize_review(document,job,row,base)
                    if record is None:
                        update_job(path,job,status='no_supported_units',cupCount=None,
                                   reviewResult=result,responseSha256=b.digest(raw))
                    elif job['replay']:
                        update_job(path,job,status='replay_validated',cupCount=record['cupsDetected'],
                                   responseSha256=b.digest(raw),ledgerDirectory=str(folder),productionWritten=False)
                    else:
                        update_job(path,job,status='validated',cupCount=record['cupsDetected'],
                                   responseSha256=b.digest(raw),ledgerDirectory=str(folder))
                        staged=publish_record(record,job,base)
                        update_job(path,job,status='count_queued',countBatchId=staged['batchId'],
                                   dashboardReceived=False,recordSha256=b.digest(json.dumps(record,sort_keys=True).encode()))
                    results.append({'jobId':job['id'],'status':job['status'],'cupsDetected':job.get('cupCount')})
                except (b.BridgeError,ValueError,KeyError,TypeError,OSError) as e:
                    update_job(path,job,status='review_validation_failed',
                               reason=str(e) if isinstance(e,b.BridgeError) else 'invalid_review_response')
                    results.append({'jobId':job['id'],'status':job['status'],'reason':job['reason']})
                break
            if job['status'] not in ('dispatching','awaiting_review','validated'):break
    return results

def dispatch(db, api, base, day, replay=False):
    need(datetime.strptime(day,'%Y-%m-%d').strftime('%Y-%m-%d') == day,'invalid_date')
    need(day < datetime.now(b.TZ).date().isoformat() or
         (day == datetime.now(b.TZ).date().isoformat() and datetime.now(b.TZ).hour>=22),
         'operating_day_not_finished')
    state=base/'manus-bridge/state'
    if not replay:
        if (base/'scripts/approved_counts'/(day+'.json')).exists():
            return {'status':'existing_local_count_preserved','day':day}
        if (state/'physical-reviews/existing-production'/ (day+'.json')).exists():
            return {'status':'existing_production_count_preserved','day':day}
    rows=db.execute("SELECT * FROM batches WHERE day=? AND sent_at IS NOT NULL "
                    "AND file_id IS NOT NULL ORDER BY sent_at DESC",(day,)).fetchall()
    row=None
    for item in rows:
        try:
            manifest,package=read_source(item,state)
            row=item;break
        except b.BridgeError as e:
            if str(e) != 'source_already_has_count':raise
    if row is None:return {'status':'waiting_for_source_batch','day':day}
    ident=job_id(row['id'],replay);path=state/'physical-reviews'/ident/'state.json'
    if path.exists():return {'status':json.loads(path.read_text())['status'],'jobId':ident}
    task=private_task(api)
    if task.get('status')!='stopped' or task.get('has_running_background_jobs'):
        return {'status':'task_busy','day':day}
    # Reuse the previously authorized upload; never re-upload an expired source automatically.
    info=api.call('file.detail',{'file_id':row['file_id']})['file']
    need(info.get('id')==row['file_id'] and info.get('status')=='uploaded'
         and int(info['bytes'])==package.stat().st_size,'source_upload_unavailable')
    job={'id':ident,'policy':POLICY,'day':day,'batchId':row['id'],
         'packageSha256':row['sha256'],'replay':replay,'sentAt':time.time(),'status':'dispatching'}
    update_job(path,job)
    try:
        response=api.call('task.sendMessage',{'task_id':b.TASK,'message':{'content':[
            {'type':'text','text':request_prompt(job,manifest)},
            {'type':'file','file_id':row['file_id']}]}},post=True)
        need(response.get('task_id')==b.TASK and response.get('request_id'),'invalid_review_task_ack')
        update_job(path,job,status='awaiting_review',requestId=response['request_id'])
    except b.BridgeError:
        # Persist dispatching, then reconcile attachments; never blindly resend.
        return {'status':'dispatching','jobId':ident,'reason':'review_dispatch_uncertain'}
    return {'status':job['status'],'jobId':ident,'day':day,'productionWritten':False}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('action',choices=['run','request','status'])
    p.add_argument('--date')
    p.add_argument('--replay',action='store_true')
    p.add_argument('--base',type=Path,default=b.BASE)
    a=p.parse_args();state=a.base/'manus-bridge/state';jobs=state/'physical-reviews'
    jobs.mkdir(parents=True,exist_ok=True,mode=0o700)
    with (state/'worker.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        db=b.queue_db(state)
        try:
            if a.action=='status':
                print(json.dumps([json.loads(x.read_text()) for x in jobs.glob('*/state.json')]))
                return
            need(not db.execute("SELECT 1 FROM controls WHERE key='api_auth_hold'").fetchone(),
                 'api_auth_hold')
            api=b.ManusApi(b.read_key(a.base/'manus-bridge/config.private.json'))
            result={'reviews':receive_jobs(db,api,a.base,jobs)}
            if a.action=='request':
                need(bool(a.date),'review_date_required')
                result['request']=dispatch(db,api,a.base,a.date,a.replay)
            else:
                settings=json.loads((jobs/'settings.json').read_text())
                if settings.get('enabled') is True:
                    now=datetime.now(b.TZ)
                    latest=(now.date() if now.hour>=22 else now.date()-timedelta(days=1)).isoformat()
                    earliest=max(settings['startDate'],(now.date()-timedelta(days=7)).isoformat())
                    waiting=any(json.loads(p.read_text()).get('status')=='count_queued' for p in jobs.glob('*/state.json'))
                    result['countReceiptPending']=waiting
                    if not waiting:
                        for (day,) in db.execute('SELECT DISTINCT day FROM batches WHERE day BETWEEN ? AND ? AND sent_at IS NOT NULL ORDER BY day',(earliest,latest)):
                            request=dispatch(db,api,a.base,day)
                            result['request']=request
                            if request['status'] in ('task_busy','awaiting_review','dispatching'):break
            print(json.dumps(result,ensure_ascii=False))
        finally:db.close()

if __name__=='__main__':
    os.umask(0o077)
    try:main()
    except BlockingIOError:print(json.dumps({'status':'worker_busy'}))
    except (b.BridgeError,ValueError,KeyError,TypeError,OSError,zipfile.BadZipFile) as e:
        print(json.dumps({'status':'blocked','reason':str(e) if isinstance(e,b.BridgeError)
                          else 'local_or_response_error'}))
        raise SystemExit(2)
