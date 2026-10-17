"""Validate authenticated Manus read-back attachments; never submit app data.

The receipt is administrative read-back evidence, not a server signature and not
proof that the separate Frigate HTTP sender works. URLs are temporary and private.
"""
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

import manus_bridge as b

MAX_RECEIPT = 1024 * 1024
STATUSES = {'pending_review', 'approved_by_ai', 'discarded',
            'approved_by_manager', 'discarded_by_manager'}


def timestamp(value):
    b.require(isinstance(value, str), 'receipt_timestamp_missing')
    try:
        at = datetime.fromisoformat(value.replace('Z', '+00:00'))
        b.require(at.tzinfo is not None, 'receipt_timestamp_without_zone')
        return at.timestamp()
    except ValueError:
        raise b.BridgeError('invalid_receipt_timestamp') from None


def package_manifest(row, state):
    path = b.within(Path(row['path']), state)
    raw = path.read_bytes()
    b.require(len(raw) <= b.MAX_PACKAGE and b.digest(raw) == row['sha256'],
              'receipt_package_integrity_failed')
    with zipfile.ZipFile(path) as z:
        b.require(len(z.namelist()) == len(set(z.namelist())), 'duplicate_zip_members')
        info = z.getinfo('manifest.json')
        b.require(info.file_size <= MAX_RECEIPT, 'manifest_too_large')
        manifest = json.loads(z.read(info))
        b.require(b.digest(b.canonical(manifest)) == row['id'], 'manifest_batch_mismatch')
        b.require(manifest.get('storeId') == 1 and manifest.get('cameraName') == 'handoff'
                  and manifest.get('businessDate') == row['day'], 'manifest_scope_mismatch')
        if manifest.get('countRecordIncluded'):
            info = z.getinfo('reviewed-count/import-envelope.json')
            b.require(info.file_size <= MAX_RECEIPT, 'count_envelope_too_large')
            envelope = json.loads(z.read(info))
            exact = envelope['recordJson']
            b.require(b.digest(exact.encode()) == manifest['countRecord']['recordSha256'],
                      'count_source_hash_mismatch')
            manifest['_originalCount'] = json.loads(exact)
    return manifest


def validate_receipt(receipt, row, manifest, now=None):
    now = time.time() if now is None else now
    b.require(isinstance(receipt, dict), 'receipt_not_object')
    for key, value in [('batchId', row['id']), ('packageSha256', row['sha256']),
                       ('storeId', manifest['storeId']), ('businessDate', row['day'])]:
        b.require(receipt.get(key) == value, 'receipt_'+key+'_mismatch')
    b.require(type(receipt['storeId']) is int, 'receipt_invalid_store')
    b.require(receipt.get('automaticPushVerified', False) is False,
              'receipt_claims_direct_push')
    sent = row['sent_at']
    b.require(isinstance(sent, (int, float)) and sent > 0, 'batch_not_sent')
    read_at = timestamp(receipt.get('readBackAt'))
    b.require(sent-1 <= read_at <= now+120, 'receipt_readback_outside_window')
    visual = receipt.get('visualRows', receipt.get('rows'))
    if 'rows' in receipt and 'visualRows' in receipt:
        b.require(receipt['rows'] == receipt['visualRows'], 'receipt_ambiguous_visual_rows')
    b.require(isinstance(visual, list), 'receipt_visual_rows_missing')
    expected = {event['cupEventId'] for event in manifest['events']}
    b.require(len(expected) == len(manifest['events']), 'manifest_duplicate_events')
    actual, ids = set(), set()
    for item in visual:
        b.require(isinstance(item, dict), 'receipt_invalid_visual_row')
        pk, event = item.get('id'), item.get('cupEventId')
        b.require(type(pk) is int and pk > 0 and pk not in ids, 'receipt_duplicate_or_invalid_row_id')
        b.require(isinstance(event, str) and event in expected and event not in actual,
                  'receipt_duplicate_or_unexpected_event')
        b.require(item.get('source') == 'verified_snapshot' and item.get('status') in STATUSES,
                  'receipt_visual_provenance_or_status_mismatch')
        b.require(item.get('storeId', 1) == 1 and item.get('cameraName', 'handoff') == 'handoff',
                  'receipt_visual_scope_mismatch')
        actual.add(event); ids.add(pk)
    b.require(actual == expected, 'receipt_visual_rows_incomplete')
    b.require('countRow' in receipt, 'receipt_count_disposition_missing')
    count = receipt['countRow']
    if not manifest.get('countRecordIncluded'):
        b.require(count is None, 'receipt_unrequested_count')
    else:
        b.require(isinstance(count, dict), 'receipt_expected_count_missing')
        original = manifest['_originalCount']
        source = manifest['countRecord']
        expected_fields = {'storeId':1, 'businessDate':row['day'], 'cameraName':'handoff',
                           'cupsDetected':original['cupsDetected'], 'coverage':original['coverage'],
                           'recordSha256':source['recordSha256'],
                           'sourceEventId':source['sourceEventId']}
        for key, value in expected_fields.items():
            b.require(count.get(key) == value, 'receipt_count_'+key+'_mismatch')
        b.require(type(count.get('id')) is int and count['id'] > 0
                  and type(count.get('cupsDetected')) is int, 'receipt_invalid_count_integer')
        b.require(int(timestamp(count.get('sourceEventAt'))) == int(timestamp(original['approvedAt'])),
                  'receipt_count_source_time_mismatch')
        received = timestamp(count.get('receivedAt'))
        # An already persisted, deduplicated count can predate this batch.
        b.require(timestamp(original['approvedAt'])-1 <= received <= read_at,
                  'receipt_count_receipt_time_mismatch')
        if 'reviewedBy' in count:
            b.require(count['reviewedBy'] == original['reviewedBy'], 'receipt_reviewer_mismatch')
    return {'visualRows':len(visual), 'visualRowIds':sorted(ids),
            'countRowId':count['id'] if count else None,
            'cupsDetected':count['cupsDetected'] if count else None,
            'coverage':count['coverage'] if count else None, 'readBackAt':receipt['readBackAt'],
            'provenance':'authenticated_manus_administrative_readback',
            'directFrigateVerified':False, 'dailyTotalInferredFromImages':False}


def download_attachment(attachment):
    url = attachment.get('url', '')
    try:
        parsed = urllib.parse.urlsplit(url)
        host = parsed.hostname or ''
        valid = host == 'private.manuscdn.com' or bool(re.fullmatch(r'private-[a-z0-9-]+\.manuscdn\.com', host))
        b.require(parsed.scheme == 'https' and valid and not parsed.username and not parsed.password
                  and parsed.port in (None,443), 'invalid_receipt_download_destination')
        req = urllib.request.Request(url, headers={'Accept':'application/json'})
        # Intentionally separate from ManusApi.call: no API key or redirects.
        with urllib.request.build_opener(b.NoRedirect()).open(req, timeout=25) as response:
            b.require(response.status == 200, 'receipt_download_failed')
            raw = response.read(MAX_RECEIPT+1)
        b.require(len(raw) <= MAX_RECEIPT, 'receipt_too_large')
        return raw
    except urllib.error.HTTPError as exc:
        raise b.BridgeError('receipt_download_http_'+str(exc.code)) from None
    except (OSError, ValueError):
        raise b.BridgeError('receipt_download_failed') from None


def receipt_messages(api, earliest):
    cursor, seen = None, set()
    for _ in range(8):
        params = {'task_id':b.TASK, 'limit':100, 'order':'desc'}
        if cursor: params['cursor'] = cursor
        page = api.call('task.listMessages', params)
        oldest = None
        for item in page.get('messages', []):
            try:
                at = float(item.get('timestamp', 0))/1000
            except (TypeError, ValueError):
                continue
            oldest = at if oldest is None else min(oldest, at)
            if at < earliest-1 or item.get('type') != 'assistant_message': continue
            message = item.get('assistant_message', {})
            for attachment in message.get('attachments', []):
                name = attachment.get('filename', '')
                if not re.fullmatch(r'receipt(?:[-_][a-zA-Z0-9_-]+)?\.json', name): continue
                key = (item.get('id'), attachment.get('file_uid'), attachment.get('version_uid'),
                       attachment.get('path'), name)
                if key in seen: continue
                seen.add(key)
                yield item, attachment
        if (oldest is not None and oldest < earliest-1) or not page.get('has_more'): break
        following = page.get('next_cursor')
        if not following or following == cursor: break
        cursor = following


def collect_receipts(db, api, state, recheck=False, downloader=download_attachment):
    if db.execute("SELECT 1 FROM controls WHERE key='api_auth_hold'").fetchone():
        return {'status':'api_auth_hold','verified':0}
    statuses = ['awaiting_dashboard_receipt','dispatching','delivery_unknown']
    if recheck: statuses.append('admin_receipt_verified')
    rows = db.execute('SELECT * FROM batches WHERE sent_at IS NOT NULL AND status IN ('+
                      ','.join('?' for _ in statuses)+')', statuses).fetchall()
    if not rows: return {'verified':0,'waiting':0,'directFrigateVerified':False}
    task = api.call('task.detail', {'task_id':b.TASK})['task']
    b.require(task.get('id') == b.TASK and task.get('share_visibility') == 'private',
              'receipt_task_not_private_or_wrong')
    by_id = {row['id']:row for row in rows}
    manifests, verified, errors = {}, [], []
    for item, attachment in receipt_messages(api, min(row['sent_at'] for row in rows)):
        if len(verified) == len(rows): break
        if len(errors) >= 20: break
        try:
            raw = downloader(attachment)
            b.require(len(raw) <= MAX_RECEIPT, 'receipt_too_large')
            receipt = json.loads(raw)
            if not isinstance(receipt,dict): continue
            batch_id = receipt.get('batchId')
            if batch_id not in by_id or batch_id in verified: continue
            row = by_id[batch_id]
            if batch_id not in manifests: manifests[batch_id] = package_manifest(row,state)
            result = validate_receipt(receipt,row,manifests[batch_id])
            # Persist validated content before marking the outbox acknowledged.
            folder = state/'receipts'/batch_id
            saved = folder/'receipt.automatic.json'
            b.private_json(saved,receipt)
            proof = dict(result, batchId=batch_id, packageSha256=row['sha256'],
                         sourceAttachmentSha256=hashlib.sha256(raw).hexdigest(),
                         receiptPath=str(saved), receiptSha256=b.digest(saved.read_bytes()),
                         taskId=b.TASK, messageId=item.get('id'),
                         sourceFileUid=attachment.get('file_uid'),
                         sourceVersionUid=attachment.get('version_uid'),
                         verifiedAt=datetime.now().astimezone().isoformat(),
                         automaticallyCollected=True)
            b.private_json(folder/'automatic-verification.json',proof)
            db.execute('INSERT OR REPLACE INTO controls(key,value) VALUES(?,?)',
                       ('auto-receipt:'+batch_id,json.dumps(proof)))
            db.execute('UPDATE batches SET status=?,last_error=NULL WHERE id=?',
                       ('admin_receipt_verified',batch_id))
            db.commit(); verified.append(batch_id)
        except (b.BridgeError, ValueError, KeyError, TypeError, OSError, zipfile.BadZipFile) as exc:
            errors.append(str(exc) if isinstance(exc,b.BridgeError) else 'receipt_invalid_or_unavailable')
    result = {'verified':len(verified),'batchIds':verified,'waiting':len(rows)-len(verified),
              'errors':errors,'directFrigateVerified':False}
    b.private_json(state/'receipt-collector-latest.json',dict(result,checkedAt=datetime.now().astimezone().isoformat()))
    return result
