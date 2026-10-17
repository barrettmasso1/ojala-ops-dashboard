#!/usr/bin/env python3
"""Local pilot evidence; never sends counts or writes Frigate's source database."""
import argparse
from contextlib import closing
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
from zoneinfo import ZoneInfo

TZ = ZoneInfo('America/Mazatlan')
BASE = Path('/home/ojala/frigate')
PILOT_DATES = ('2026-10-17', '2026-10-18')
MIN_FREE = 8 * 1024**3
VERSION = '2026-10-14.1'


def window(day):
    date = dt.date.fromisoformat(day)
    if date.isoformat() != day:
        raise ValueError('Use YYYY-MM-DD')
    start = dt.datetime.combine(date, dt.time(), TZ)
    return start, start + dt.timedelta(days=1)


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''):
            h.update(block)
    return h.hexdigest()


def atomic(path, data, replace=True):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink():
        raise ValueError('symlink destination')
    if path.exists() and not replace:
        return False
    tmp = path.with_name(path.name + '.tmp')
    with tmp.open('w') as f:
        os.chmod(tmp, 0o600)
        f.write(json.dumps(data, ensure_ascii=False, indent=2)+'\n')
        f.flush(); os.fsync(f.fileno())
    os.replace(tmp, path)
    return True


def template(day):
    window(day)
    return {'schemaVersion': 1, 'businessDate': day, 'timezone': str(TZ),
            'status': 'prepared_not_started', 'plannedSimulationCups': 48,
            'plannedCountIsResult': False, 'productionEligible': False,
            'observer': None, 'operator': None, 'actualStartAt': None, 'actualEndAt': None,
            'simulation': {'manualCups': None, 'cameraReviewedCups': None,
                           'posTestCups': None, 'posTestStatus': 'not_applicable_unless_separate_test_orders_exist',
                           'manualEvidence': None, 'cameraEvidence': None, 'posTestEvidence': None},
            'realOperation': {'manualCups': None, 'posCups': None, 'cameraReviewedCups': None,
                              'manualEvidence': None, 'posEvidence': None, 'cameraEvidence': None},
            'notes': [], 'metrics': {'precision': None, 'recall': None,
                                     'matchedCups': None, 'missedCups': None, 'falseSignals': None}}


def clean_log(text, secrets=()):
    for secret in secrets:
        if isinstance(secret, str) and len(secret) >= 6:
            text = text.replace(secret, '[REDACTED]')
    text = re.sub(r'(?i)\b(?:rtsp|rtsps)://[^\s\]\)]+', '[RTSP_REDACTED]', text)
    text = re.sub(r'(?i)(https?://)[^/\s:@]+:[^@\s]+@', r'\1[REDACTED]@', text)
    text = re.sub(r'(?i)(authorization\s*[:=]\s*)(?:bearer\s+)?[^\r\n,}]+', r'\1[REDACTED]', text)
    text = re.sub(r'(?i)((?:api_?key|password|secret|token)["\x27]?\s*[:=]\s*)["\x27]?[^\s,"\x27}]+', r'\1[REDACTED]', text)
    return text


def read_json(path, default=None):
    try:
        return json.loads(path.read_text())
    except (ValueError, OSError):
        return default


def readonly(path):
    db = sqlite3.connect(path.resolve().as_uri()+'?mode=ro', uri=True, timeout=5)
    db.execute('PRAGMA query_only=ON')
    return db


def verify_session_storage(root):
    """Check a relocated session disk before creating directories or opening SQLite."""
    logical = root/'local-simulations'
    config = root/'pilot-tools'/'session-storage.json'
    if not config.exists():
        if logical.is_symlink():
            raise ValueError('relocated_session_storage_config_missing')
        return
    data = json.loads(config.read_text())
    mount = Path(data['mountPoint'])
    expected = Path(data['sessionRootPath'])
    if (not mount.is_absolute() or not expected.is_absolute()
            or not expected.is_relative_to(mount) or expected == mount
            or not os.path.ismount(mount) or logical.resolve(strict=True) != expected):
        raise ValueError('session_mount_unavailable_or_changed')
    result = subprocess.run(['findmnt','-J','-T',str(expected),'-o','TARGET,UUID'],
                            capture_output=True,text=True,check=True,timeout=3)
    rows = json.loads(result.stdout).get('filesystems',[])
    if (len(rows) != 1 or rows[0].get('target') != str(mount)
            or not data.get('filesystemUuid')
            or rows[0].get('uuid') != data['filesystemUuid']):
        raise ValueError('session_filesystem_identity_mismatch')


def collect(day, root=BASE):
    os.umask(0o077)
    start, end = window(day)
    now = dt.datetime.now(TZ)
    if start > now:
        raise ValueError('Future date cannot contain observed evidence')
    try:
        verify_session_storage(root)
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
        report = {'status':'blocked_storage_unavailable','businessDate':day,
                  'checkedAt':now.isoformat(),'sourceDatabaseMode':'not_opened',
                  'networkWrites':0,'lastErrorType':type(exc).__name__}
        atomic(root/'pilot-tools'/'pilot-session-storage-status.json',report)
        return report
    out = root/'local-simulations'/'sessions'/day
    out.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (out/'collect.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'status': 'already_running', 'businessDate': day}
        atomic(out/'session.json', template(day), replace=False)
        stamp = now.strftime('%Y%m%dT%H%M%S')
        evidence = out/'evidence'/stamp
        evidence.mkdir(parents=True, mode=0o700)
        errors = []
        report = {'version': VERSION, 'checkedAt': now.isoformat(), 'businessDate': day,
                  'sourceDatabaseMode': 'read_only', 'networkWrites': 0,
                  'productionEligible': False, 'rawTracksAreDeliveries': False,
                  'manualCups': None, 'cameraReviewedCups': None, 'posCups': None,
                  'windowStart': start.isoformat(), 'windowEnd': min(now,end).isoformat(),
                  'errors': errors, 'evidenceDirectory': str(evidence)}
        secrets = []
        cfg = read_json(root/'scripts'/'push_config.json', {})
        for key in ('apiKey', 'token'):
            if cfg.get(key): secrets.append(cfg[key])
        if shutil.disk_usage(out).free < MIN_FREE:
            report['status'] = 'blocked_low_disk'
            atomic(out/'latest-collection.json', report)
            atomic(root/'pilot-tools'/'pilot-session-storage-status.json',report)
            return report
        db = None
        try:
            db = readonly(root/'config'/'frigate.db')
            db.row_factory = sqlite3.Row
            events = [dict(row) for row in db.execute(
                'SELECT id,label,camera,start_time,end_time,zones,false_positive FROM event '
                'WHERE camera=? AND label=? AND start_time>=? AND start_time<? ORDER BY start_time',
                ('handoff','cup',start.timestamp(),min(end,now).timestamp()))]
            atomic(evidence/'cup-tracks.json', events)
            report['rawCupTracks'] = len(events)
            report['rawCupTracksInZone'] = sum('handoff_zone' in json.loads(row['zones'] or '[]') for row in events)
            segments = [dict(row) for row in db.execute(
                'SELECT path,start_time,end_time,duration FROM recordings '
                'WHERE camera=? AND end_time>? AND start_time<? ORDER BY start_time',
                ('handoff',start.timestamp(),min(end,now).timestamp()))]
            atomic(evidence/'source-recordings.json', segments)
            snapshot = out/'frigate-readonly-snapshot.sqlite3'
            tmp = snapshot.with_suffix('.tmp.sqlite3')
            if tmp.is_symlink() or snapshot.is_symlink(): raise ValueError('snapshot symlink')
            with closing(sqlite3.connect(tmp)) as dest:
                db.backup(dest, pages=512, sleep=0.05)
                if dest.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                    raise ValueError('snapshot integrity failure')
            os.chmod(tmp,0o600)
            os.replace(tmp,snapshot)
            report['databaseSnapshotSha256'] = digest(snapshot)
        except (sqlite3.Error, OSError, ValueError) as exc:
            errors.append('frigate_read:'+type(exc).__name__)
        finally:
            if db is not None: db.close()
        archive = root/'pilot-archive'/'forward-20260929'
        index = None
        try:
            index = readonly(archive/'index.sqlite3')
            index.row_factory = sqlite3.Row
            rows = [dict(row) for row in index.execute(
                'SELECT source_path,archive_path,start_time,end_time,bytes,sha256 FROM segments '
                'WHERE end_time>? AND start_time<? ORDER BY start_time',
                (start.timestamp(),min(end,now).timestamp()))]
            missing = sum(not (archive/row['archive_path']).is_file() for row in rows)
            atomic(evidence/'preserved-video-index.json',rows)
            report['archivedSegments'] = len(rows)
            report['missingArchivedFiles'] = missing
            report['archiveStatus'] = read_json(archive/'status.json')
            if missing: errors.append('missing_archived_files')
        except (sqlite3.Error,OSError) as exc:
            errors.append('archive_read:'+type(exc).__name__)
        finally:
            if index is not None: index.close()
        try:
            logs = subprocess.run(['docker','logs','--timestamps','--since',start.isoformat(),
                                   '--until',min(end,now).isoformat(),'--tail','100000','frigate'],
                                  capture_output=True,text=True,timeout=30)
            sanitized = clean_log(logs.stdout+logs.stderr,secrets)
            (evidence/'frigate-sanitized.log').write_text(sanitized)
            report['logCapture'] = {'exitCode':logs.returncode,'tailLimit':100000,
                                    'possibleTruncation':len(sanitized.splitlines())>=100000}
            if logs.returncode: errors.append('docker_logs_failed')
        except (OSError,subprocess.TimeoutExpired) as exc:
            errors.append('docker_logs:'+type(exc).__name__)
        for label, path in {
            'operational-health': root/'config'/'ojala_operational_status.json',
            'capture-health': root/'config'/'verified_capture_health.json',
            'rescue-health': root/'config'/'rescue_shadow'/'state'/'health.json',
            'recording-audit': root/'pilot-reports'/day/'latest.json',
        }.items():
            data = read_json(path)
            if data is not None:
                (evidence/(label+'.json')).write_text(clean_log(json.dumps(data,indent=2),secrets)+'\n')
        report['diskFreeBytes'] = shutil.disk_usage(out).free
        report['status'] = 'evidence_saved' if not errors else 'evidence_incomplete'
        atomic(evidence/'collection-result.json',report)
        atomic(evidence/'sha256-manifest.json', {p.name:digest(p) for p in evidence.iterdir() if p.is_file()})
        atomic(out/'latest-collection.json',report)
        atomic(root/'pilot-tools'/'pilot-session-storage-status.json',report)
        return report


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('action', choices=('prepare','collect','scheduled'))
    ap.add_argument('--date')
    ap.add_argument('--root',type=Path,default=BASE)
    args = ap.parse_args()
    if args.action == 'scheduled':
        now = dt.datetime.now(TZ)
        if now.date().isoformat() not in PILOT_DATES or not 11 <= now.hour <= 23:
            print(json.dumps({'status':'outside_pilot_window'})); return
        result = collect(now.date().isoformat(),args.root)
    elif args.action == 'prepare':
        verify_session_storage(args.root)
        result = template(args.date)
        out = args.root/'local-simulations'/'sessions'/args.date/'session.json'
        created = atomic(out,result,replace=False)
        result = {'status':'prepared' if created else 'existing_preserved','path':str(out)}
    else:
        result = collect(args.date,args.root)
    print(json.dumps(result,ensure_ascii=False))
    if result.get('status') in ('evidence_incomplete','blocked_low_disk','blocked_storage_unavailable'):
        raise SystemExit(2)


if __name__ == '__main__':
    main()
