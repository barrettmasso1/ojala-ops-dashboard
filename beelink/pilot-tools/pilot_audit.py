#!/usr/bin/env python3
"""Read-only Frigate audit. Tracks and photographs are never delivery totals."""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import time
from urllib.request import urlopen
from zoneinfo import ZoneInfo

VERSION = '2026-09-27.1'
TZ = ZoneInfo('America/Mazatlan')
BASE = Path('/home/ojala/frigate')


def json_read(path, default=None):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def json_write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.tmp')
    with temp.open('w') as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


def stamp(epoch):
    return dt.datetime.fromtimestamp(epoch, TZ).isoformat()


def coverage(ranges, start, end):
    """Union actual intervals; no double counting overlaps or filling gaps."""
    merged = []
    for a, b in sorted(ranges):
        a, b = max(a, start), min(b, end)
        if b <= a:
            continue
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    gaps = []
    cursor = start
    for a, b in merged:
        if a > cursor:
            gaps.append([cursor, a])
        cursor = b
    if end > cursor:
        gaps.append([cursor, end])
    covered = sum(b-a for a, b in merged)
    elapsed = max(0, end-start)
    return {
        'window_start': stamp(start), 'window_end': stamp(end),
        'elapsed_seconds': round(elapsed, 3),
        'recorded_seconds': round(covered, 3),
        'missing_seconds': round(elapsed-covered, 3),
        'recorded_percent': round(100*covered/elapsed, 3) if elapsed else None,
        'gaps_over_10_seconds': [{'start': stamp(a), 'end': stamp(b),
                                 'seconds': round(b-a, 3)} for a, b in gaps if b-a > 10],
        'intervals': [[stamp(a), stamp(b)] for a, b in merged],
    }


def snapshots_for_day(root, business_date):
    selected, errors = [], []
    for meta in sorted(root.glob('*.json')):
        try:
            data = json.loads(meta.read_text())
            when = dt.datetime.fromisoformat(data['captured_at_utc'].replace('Z', '+00:00'))
            if when.tzinfo is None:
                raise ValueError('naive_time')
            if when.astimezone(TZ).date().isoformat() != business_date:
                continue
            image = meta.with_suffix('.jpg')
            if image.is_symlink() or meta.is_symlink():
                raise ValueError('symlink')
            if data.get('camera') != 'handoff' or data.get('cup_zone') != 'handoff_zone':
                raise ValueError('wrong_source')
            if not data.get('cup') or not data.get('people'):
                raise ValueError('missing_gate_metadata')
            image_hash = hashlib.sha256(image.read_bytes()).hexdigest()
            if image_hash != data.get('image_sha256'):
                raise ValueError('image_hash_mismatch')
            selected.append({'file': image.name, 'cup_event_id': data['cup_event_id'],
                             'captured_at_local': when.astimezone(TZ).isoformat(),
                             'image_sha256': image_hash, 'schema_version': data.get('schema_version'),
                             'visual_review_status': 'not_reviewed_by_this_audit'})
        except (KeyError, OSError, ValueError) as exc:
            errors.append({'file': meta.name, 'error_type': type(exc).__name__})
    return selected, errors


def read_events(db_path, start, end):
    db = sqlite3.connect('file:'+str(db_path)+'?mode=ro', uri=True, timeout=2)
    db.row_factory = sqlite3.Row
    try:
        db.execute('PRAGMA query_only=ON')
        events = []
        for row in db.execute('SELECT id,label,camera,start_time,end_time,zones,false_positive '
                              'FROM event WHERE camera=? AND label=? AND start_time>=? '
                              'AND start_time<? ORDER BY start_time', ('handoff', 'cup', start, end)):
            event = dict(row)
            event['zones'] = json.loads(event['zones'])
            event['start_local'] = stamp(event['start_time'])
            events.append(event)
        segments = [dict(row) for row in db.execute(
            'SELECT path,start_time,end_time,duration FROM recordings '
            'WHERE camera=? AND end_time>? AND start_time<? ORDER BY start_time',
            ('handoff', start, end))]
        return events, segments
    finally:
        db.close()


def queue_summary(path, date):
    if not path.exists():
        return {'status': 'missing'}
    db = sqlite3.connect('file:'+str(path)+'?mode=ro', uri=True, timeout=2)
    try:
        db.execute('PRAGMA query_only=ON')
        rows = db.execute('SELECT status,count(*),sum(attempts) FROM verified_snapshot_queue '
                          'WHERE business_date=? GROUP BY status', (date,)).fetchall()
        return {'status': 'read', 'business_date': date,
                'groups': [{'status': status, 'items': count, 'attempts': attempts or 0}
                           for status, count, attempts in rows]}
    finally:
        db.close()


def is_live_rescue_command(args):
    # An offline replay/import is not a live Rescue deployment.
    for i, arg in enumerate(args[:-1]):
        if arg.endswith(b'/rescue_shadow.py') and args[i+1] == b'live':
            return True
    return False


def rescue_running():
    found = []
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            args = (entry/'cmdline').read_bytes().split(b'\0')
            if is_live_rescue_command(args):
                found.append(int(entry.name))
        except OSError:
            pass
    return found


def audit(business_date, root=BASE):
    date = dt.date.fromisoformat(business_date)
    now = dt.datetime.now(TZ)
    # This is the installed Frigate schedule, not a claim of actual opening hours.
    start = dt.datetime.combine(date, dt.time(12), TZ).timestamp()
    scheduled_end = dt.datetime.combine(date, dt.time(21), TZ).timestamp()
    end = max(start, min(now.timestamp(), scheduled_end))
    config = root/'config'
    out = root/'pilot-reports'/business_date
    out.mkdir(parents=True, exist_ok=True)
    result = {'version': VERSION, 'business_date': business_date, 'timezone': str(TZ),
              'checked_at': now.isoformat(), 'reference_window_source': 'installed_frigate_schedule_12_to_21',
              'actual_opening_hours_confirmed': False,
              'manual_cups': None, 'pos_cups': None, 'camera_deliveries': None,
              'difference_cups': None, 'difference_percent': None,
              'ground_truth_started': None,
              'warning': 'Tracks, photos and Rescue candidates are not confirmed deliveries.',
              'blockers': []}
    try:
        events, segments = read_events(config/'frigate.db', start, end)
        existing, missing = [], 0
        for row in segments:
            # Only read known Frigate recording paths inside its mounted directory.
            path = Path(row['path'])
            try:
                rel = path.relative_to('/media/frigate')
                actual = root/'storage'/rel
                if not actual.is_file():
                    missing += 1
                    continue
                existing.append([row['start_time'], row['end_time']])
            except ValueError:
                missing += 1
        result['tracks'] = {'all_cup': len(events),
                            'in_handoff_zone': sum('handoff_zone' in x['zones'] for x in events),
                            'marked_false_positive': sum(bool(x['false_positive']) for x in events),
                            'unfinished': sum(x['end_time'] is None for x in events)}
        result['recording'] = coverage(existing, start, end)
        result['recording'].update({'segments_in_db': len(segments), 'missing_files': missing,
                                    'files_exist_checked': True, 'decode_integrity_checked': False})
        json_write(out/'cup_tracks.json', events)
        json_write(out/'recording_segments.json', segments)
    except (sqlite3.Error, OSError, ValueError) as exc:
        result['blockers'].append('frigate_read_'+type(exc).__name__)
    source = config/'verified_snapshots/handoff'
    pairs, errors = snapshots_for_day(source, business_date)
    result['photos'] = {'candidate_pairs': len(pairs), 'pair_errors': errors,
                       'human_validated_cups': None}
    if shutil.disk_usage(out).free > 2*1024**3:
        archive = out/'candidate_photos'; archive.mkdir(exist_ok=True)
        for item in pairs:
            for p in [source/item['file'], (source/item['file']).with_suffix('.json')]:
                target = archive/p.name
                if not target.exists():
                    shutil.copy2(p, target)
        result['photos']['archived_candidate_pairs'] = len(pairs)
    else:
        result['blockers'].append('archive_low_disk')
    json_write(out/'candidate_manifest.json', pairs)
    try:
        result['queue'] = queue_summary(root/'handoff-visual-sender/state/queue.sqlite3', business_date)
    except sqlite3.Error as exc:
        result['queue'] = {'status': type(exc).__name__}
    result['capture_worker'] = json_read(config/'verified_capture_health.json', {})
    result['operational_health'] = json_read(config/'ojala_operational_status.json', {})
    try:
        with urlopen('http://127.0.0.1:5000/api/stats', timeout=4) as response:
            stats = json.load(response)
        result['camera'] = {k: stats['cameras']['handoff'].get(k)
                            for k in ('camera_fps', 'process_fps', 'skipped_fps', 'detection_enabled')}
    except Exception as exc:
        result['camera'] = {'status': type(exc).__name__}
    try:
        with urlopen('http://127.0.0.1:5000/api/config', timeout=4) as response:
            active = json.load(response)
        result['active_model'] = {name: {'type': spec.get('type'),
                                        'model_path': spec.get('model', {}).get('path')}
                                  for name, spec in active.get('detectors', {}).items()}
        result['active_cup_threshold'] = active['cameras']['handoff']['objects']['filters']['cup']['threshold']
    except Exception as exc:
        result['active_model'] = {'status': type(exc).__name__}
    model = config/'model_cache/ojala_cups_v4_640.onnx'
    result['model_file_sha256'] = hashlib.sha256(model.read_bytes()).hexdigest() if model.exists() else None
    cron = subprocess.run(['crontab', '-l'], capture_output=True, text=True, timeout=5)
    result['cron'] = {'readable': cron.returncode == 0,
                      'verified_visual_sender_queue_only': any('--queue-only' in line and
                            'handoff_visual_sender.py' in line for line in cron.stdout.splitlines()
                            if not line.lstrip().startswith('#')),
                      'count_push_script_verified': False}
    result['rescue'] = {'running_process_ids': rescue_running(),
                        'legacy_script_exists': (root/'rescue_layer/ojala_rescue.py').exists(),
                        'production_delivery_counter_validated': False}
    shadow_health = config/'rescue_shadow/state/health.json'
    if shadow_health.exists():
        try:
            health = json.loads(shadow_health.read_text())
            result['rescue']['shadow_health'] = health
            result['rescue']['mode'] = 'shadow_pending_review'
            result['rescue']['heartbeat_fresh'] = 0 <= now.timestamp() - float(health.get('heartbeat_epoch', 0)) < 120
            result['rescue']['enabled'] = (config/'rescue_shadow/enabled.json').exists()
        except (OSError, ValueError, TypeError):
            result['rescue']['heartbeat_fresh'] = False
    result['blockers'] += ['manual_ground_truth_not_yet_confirmed', 'pos_total_not_observed',
                           'production_count_push_not_verified', 'multi_tenant_production_not_verified']
    if not result['rescue']['running_process_ids']:
        result['blockers'].append('rescue_not_running')
    elif not result['rescue'].get('heartbeat_fresh', False):
        result['blockers'].append('rescue_heartbeat_stale')
    result['blockers'].append('rescue_delivery_validation_pending')
    json_write(out/'latest.json', result)
    json_write(out/'checks'/(now.strftime('%Y%m%dT%H%M%S')+'.json'), result)
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--date', default=dt.datetime.now(TZ).date().isoformat())
    args = ap.parse_args()
    lock = open('/tmp/ojala_pilot_audit.lock', 'w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:
        return
    result = audit(args.date)
    print(json.dumps({key: result.get(key) for key in ['checked_at', 'tracks', 'photos', 'queue', 'blockers']},
                     ensure_ascii=False))


if __name__ == '__main__':
    main()
