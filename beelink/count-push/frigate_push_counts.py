#!/usr/bin/env python3
"""Transport reviewed unique camera-cup totals. Never derives totals from tracks/POS.

No dependencies outside Python's standard library. Files in approved_counts are
the persistent outbox; acknowledged records have atomic receipts in push_state.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

ZONE = ZoneInfo('America/Mazatlan')
ENDPOINT = 'https://ojaladarsh-m6piugsr.manus.space/api/trpc/frigate.submitCounts'
VERSION = '2026-10-05.1'
PUSH_HOUR = 22
TRACKING_START = dt.date(2026, 9, 27)


def retired_dates(root):
    path = root / 'push_state' / 'retired_dates.json'
    if not path.exists():
        return set()
    entries = json.loads(path.read_text())
    if not isinstance(entries, dict):
        raise ValueError('invalid_retirement_policy')
    for day, reason in entries.items():
        if dt.date.fromisoformat(day).isoformat() != day or not isinstance(reason, str) or not reason.strip():
            raise ValueError('invalid_retirement_policy')
    return set(entries)


def pending_dates(root, now):
    # Existing Ojala schedule is Fri-Sun. Include elapsed open days even when the
    # computer was off at close; this records a missing count rather than zero.
    days = {p.stem for p in (root / 'approved_counts').glob('*.json')}
    start = max(TRACKING_START, now.date() - dt.timedelta(days=30))
    end = now.date() if now.hour >= PUSH_HOUR else now.date() - dt.timedelta(days=1)
    while start <= end:
        if start.weekday() in (4, 5, 6):
            days.add(start.isoformat())
        start += dt.timedelta(days=1)
    days.update(p.name.removesuffix('.latest.json') for p in (root/'push_state').glob('*.latest.json'))
    return sorted(days - retired_dates(root))


def atomic_json(path, value):
    tmp = path.with_suffix(path.suffix + '.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        os.chmod(tmp, 0o600)
        json.dump(value, f, ensure_ascii=False, sort_keys=True)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def configuration_binding(config):
    # Private receipt binding, never returned in console output. A receipt for an
    # old credential must not verify a subsequently replaced credential.
    fields = {k: config.get(k) for k in ('endpoint', 'storeId', 'protocol', 'apiKey')}
    return hashlib.sha256(json.dumps(fields, sort_keys=True).encode()).hexdigest()


def mark_configuration_verified(path, config, receipt):
    if (receipt.get('status') != 'acknowledged' or receipt.get('posted') is not True
            or receipt.get('configurationBinding') != configuration_binding(config)):
        return False
    try:
        current = json.loads(path.read_text())
        if (not isinstance(current, dict) or path.stat().st_mode & 0o077
                or configuration_binding(current) != configuration_binding(config)):
            return False
        current.update(productionContractVerified=True,
                       productionVerification={
                           'verifiedAt': receipt['checkedAt'],
                           'businessDate': receipt['businessDate'],
                           'recordSha256': receipt['recordSha256'],
                           'evidence': 'accepted_approved_payload',
                           'dashboardVerified': False})
        current['verificationNote'] = ('The public endpoint accepted the approved payload '
            'identified in productionVerification. Dashboard and tenant isolation '
            'still require independent verification.')
        atomic_json(path, current)
        return True
    except (OSError, ValueError, TypeError, KeyError):
        # Receipt was saved first, so a config write failure must not resend it.
        return False


def validate_record(record, day):
    if record.get('businessDate') != day or record.get('cameraName') != 'handoff':
        return 'date_or_camera_mismatch'
    if record.get('status') != 'approved':
        return 'unique_cup_count_not_approved'
    if record.get('countBasis') != 'reviewed_unique_physical_cups':
        return 'unverified_count_basis'
    n = record.get('cupsDetected')
    ids = record.get('uniqueCupIds')
    if type(n) is not int or n < 0 or not isinstance(ids, list):
        return 'invalid_integer_count'
    if any(not isinstance(x, str) or not x.strip() for x in ids):
        return 'invalid_unique_cup_id'
    if len(ids) != len(set(ids)) or n != len(ids):
        return 'duplicate_or_mismatched_unique_cups'
    if not isinstance(record.get('reviewedBy'), str) or not record['reviewedBy'].strip():
        return 'reviewer_missing'
    if not record.get('evidenceReferences') or not isinstance(record['evidenceReferences'], list):
        return 'evidence_missing'
    if record.get('coverage') not in ('complete', 'partial'):
        return 'coverage_missing'
    if record['coverage'] == 'partial' and not record.get('gapsDescription'):
        return 'coverage_gaps_missing'
    if n == 0 and record['coverage'] != 'complete':
        return 'zero_with_incomplete_coverage'
    if record.get('storeId') != 1:
        return 'store_binding_mismatch'
    return None


def approval_timestamp(record):
    # Timestamp of the reviewed aggregate's approval, not an invented cup event.
    value = record.get('approvedAt')
    if not isinstance(value, str):
        raise ValueError('approval_timestamp_missing')
    stamp = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if stamp.tzinfo is None or stamp > dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5):
        raise ValueError('invalid_approval_timestamp')
    return stamp.astimezone(dt.timezone.utc).isoformat(timespec='microseconds').replace('+00:00','Z')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def post(payload):
    req = urllib.request.Request(ENDPOINT,
        data=json.dumps({'json': payload}).encode(),
        headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.build_opener(NoRedirect).open(req, timeout=20) as response:
        status = response.status
        body = response.read(65537)
        if len(body) > 65536:
            return status, {}
        return status, json.loads(body)


def process_day(root, day, dry_run=False, send=post):
    result = {'version': VERSION, 'checkedAt': dt.datetime.now(ZONE).isoformat(),
              'businessDate': day, 'cameraName': 'handoff', 'posted': False,
              'dashboardVerified': False}
    if day in retired_dates(root):
        return dict(result, status='retired', blockers=[])
    blockers = []
    record_path = root / 'approved_counts' / (day + '.json')
    config_path = root / 'push_config.json'
    record = config = None
    try:
        record = json.loads(record_path.read_text())
        if not isinstance(record, dict):
            raise ValueError()
        error = validate_record(record, day)
        if error:
            blockers.append(error)
    except FileNotFoundError:
        blockers.append('approved_count_file_missing')
    except (ValueError, TypeError):
        blockers.append('invalid_count_file')
    try:
        config = json.loads(config_path.read_text())
        if not isinstance(config, dict):
            raise ValueError()
        if config_path.stat().st_mode & 0o077:
            blockers.append('config_permissions_must_be_600')
        if config.get('endpoint') != ENDPOINT or config.get('storeId') != 1:
            blockers.append('endpoint_or_store_not_confirmed')
        if (config.get('productionContractVerified') is not True
                and not (config.get('productionContractVerified') is False
                         and config.get('verificationMode') == 'first_approved_payload')):
            blockers.append('production_contract_not_verified')
        if config.get('protocol') not in ('legacy_v1', 'tenant_event_v1'):
            blockers.append('production_protocol_not_confirmed')
        if not isinstance(config.get('apiKey'), str) or not config['apiKey'].strip():
            blockers.append('api_key_missing')
    except FileNotFoundError:
        blockers.append('push_config_missing')
    except (ValueError, TypeError):
        blockers.append('invalid_push_config')
    source_at = None
    if config and config.get('protocol') == 'tenant_event_v1' and record:
        try:
            source_at = approval_timestamp(record)
        except (ValueError, TypeError, OverflowError):
            blockers.append('valid_approval_timestamp_required')
    if blockers:
        return dict(result, status='blocked', blockers=blockers)
    # The published daily tile does not display sourceDetail/coverage. A partial
    # total would be presented as an ordinary daily count and compared with POS.
    # Retain the evidence locally until that production contract is upgraded.
    if record['coverage'] != 'complete':
        return dict(result, status='blocked', blockers=['partial_count_not_displayable'])
    result['productionContractVerified'] = config['productionContractVerified']
    digest = hashlib.sha256(json.dumps(record, sort_keys=True).encode()).hexdigest()
    receipt = root / 'push_state' / (day + '.receipt.json')
    if receipt.exists():
        prior = json.loads(receipt.read_text())
        if prior.get('recordSha256') == digest and not config['productionContractVerified']:
            result['productionContractVerified'] = mark_configuration_verified(config_path, config, prior)
        return dict(result, status='already_acknowledged' if prior.get('recordSha256') == digest
                    else 'blocked', blockers=[] if prior.get('recordSha256') == digest
                    else ['changed_record_requires_reconciliation'])
    result.update(cupsDetected=record['cupsDetected'], unit='physical_cups',
                  coverage=record['coverage'], recordSha256=digest)
    if dry_run:
        return dict(result, status='ready_dry_run')
    detail = json.dumps({'basis': record['countBasis'], 'recordSha256': digest,
                        'coverage': record['coverage'],
                        'gaps': str(record.get('gapsDescription', ''))[:500]})
    payload = {'apiKey': config['apiKey'], 'businessDate': day,
               'cameraName': 'handoff', 'cupsDetected': record['cupsDetected'],
               'peopleEntries': 0, 'sourceDetail': detail}
    if config['protocol'] == 'tenant_event_v1':
        payload.update(sourceEventId='daily-reviewed-'+day+'-'+digest[:32], sourceEventAt=source_at)
    try:
        code, body = send(payload)
        result['httpStatus'] = code
        success = (code == 200 and isinstance(body, dict) and
                   body.get('result', {}).get('data', {}).get('json', {}).get('success') is True)
        if not success:
            return dict(result, status='retry_pending', error='server_did_not_acknowledge')
        if config['protocol'] == 'tenant_event_v1':
            disposition = body['result']['data']['json'].get('disposition')
            if disposition == 'stale':
                return dict(result, status='blocked', blockers=['server_has_newer_record'], serverDisposition='stale')
            if disposition not in ('apply', 'replay'):
                return dict(result, status='retry_pending', error='unknown_server_disposition')
            result['serverDisposition'] = disposition
        result.update(status='acknowledged', posted=True)
        proof = dict(result, configurationBinding=configuration_binding(config))
        atomic_json(receipt, proof)
        if not config['productionContractVerified']:
            result['productionContractVerified'] = mark_configuration_verified(config_path, config, proof)
        return result
    except urllib.error.HTTPError as exc:
        return dict(result, status='retry_pending', httpStatus=exc.code, error='http_error')
    except (OSError, ValueError, TypeError, AttributeError):
        # Never print exception text or response bodies: they may contain credentials.
        return dict(result, status='retry_pending', error='transport_or_response_error')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--date', help='Business date YYYY-MM-DD in America/Mazatlan')
    ap.add_argument('--pending', action='store_true', help='Retry dated outbox files')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--root', type=Path, default=Path(__file__).resolve().parent)
    args = ap.parse_args()
    if args.date and args.pending:
        ap.error('choose --date or --pending')
    root = args.root
    state = root / 'push_state'
    state.mkdir(parents=True, exist_ok=True)
    os.chmod(state, 0o700)
    now = dt.datetime.now(ZONE)
    with open(state / 'run.lock', 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({'status': 'already_running'}))
            return 0
        try:
            days = (pending_dates(root, now)
                    if args.pending else [args.date or (now.date() - dt.timedelta(days=1)).isoformat()])
        except (OSError, ValueError, TypeError):
            print(json.dumps({'status': 'blocked', 'error': 'invalid_retirement_policy'}))
            return 2
        failed = False
        for day in days:
            try:
                parsed = dt.date.fromisoformat(day)
                if parsed.isoformat() != day:
                    raise ValueError()
            except ValueError:
                print(json.dumps({'status': 'blocked', 'error': 'invalid_business_date'}))
                failed = True
                continue
            if parsed > now.date():
                print(json.dumps({'businessDate':day, 'status':'blocked', 'error':'future_business_date'}))
                failed = True
                continue
            if args.pending and parsed == now.date() and now.hour < PUSH_HOUR:
                continue
            try:
                result = process_day(root, day, args.dry_run)
                atomic_json(state / (day + '.latest.json'), result)
            except (OSError, ValueError, TypeError):
                result = {'businessDate': day, 'status': 'blocked', 'error': 'local_state_error'}
            print(json.dumps(result, ensure_ascii=False), flush=True)
            failed |= result['status'] in ('blocked', 'retry_pending')
        if not days:
            print(json.dumps({'status': 'no_pending_records'}))
        return 2 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
