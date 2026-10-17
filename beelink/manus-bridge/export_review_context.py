#!/usr/bin/env python3
"""Export longer, timestamp-mapped review context from a read-only archive.

No network, source edits, database writes, AI decisions or daily counts.
Joined videos are convenience derivatives; originals and all gaps are retained.
"""
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import zipfile


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def merge_windows(events, before=60, after=120):
    windows = []
    for event in sorted(events, key=lambda e: e['capturedAt']):
        at = datetime.fromisoformat(event['capturedAt'].replace('Z', '+00:00')).timestamp()
        start, end = at - before, at + after
        if windows and start <= windows[-1]['endTime']:
            windows[-1]['endTime'] = max(windows[-1]['endTime'], end)
            windows[-1]['eventIds'].append(event['cupEventId'])
        else:
            windows.append({'startTime': start, 'endTime': end, 'eventIds': [event['cupEventId']]})
    return windows


def coverage_gaps(start, end, segments):
    """Exact interval union: even small archive timestamp gaps stay explicit."""
    cursor, gaps = start, []
    for s in sorted(segments, key=lambda x: x['startTime']):
        a, b = max(start, s['startTime']), min(end, s['endTime'])
        if b <= a:
            continue
        if a > cursor:
            gaps.append({'startTime': cursor, 'endTime': a, 'seconds': a - cursor})
        cursor = max(cursor, b)
    if cursor < end:
        gaps.append({'startTime': cursor, 'endTime': end, 'seconds': end - cursor})
    return gaps


def split_for_playback(segments, tolerance=0.5):
    """Do not join across large gaps or overlaps; smaller differences are mapped."""
    groups = []
    for s in sorted(segments, key=lambda x: x['startTime']):
        if not groups or abs(s['startTime'] - groups[-1][-1]['endTime']) > tolerance:
            groups.append([s])
        else:
            groups[-1].append(s)
    return groups


def export(package, archive, destination):
    os.umask(0o077)
    if destination.exists() or destination.with_suffix('.zip').exists():
        raise ValueError('destination_exists')
    with zipfile.ZipFile(package) as z:
        m = json.loads(z.read('manifest.json'))
        if m.get('storeId') != 1 or m.get('cameraName') != 'handoff':
            raise ValueError('wrong_store_or_camera')
        for item in m['files']:
            data = z.read(item['path'])
            if len(data) != item['bytes'] or hashlib.sha256(data).hexdigest() != item['sha256']:
                raise ValueError('source_package_integrity')
    destination.mkdir(mode=0o700)
    originals = destination / 'originals'; originals.mkdir()
    joined = destination / 'review'; joined.mkdir()
    manifest = {'schemaVersion': 1, 'storeId': 1, 'cameraName': 'handoff',
                'businessDate': m['businessDate'], 'sourcePackageSha256': sha(package),
                'purpose': 'extended_context_review_only', 'coverage': 'partial',
                'cupsDetected': None, 'uniqueCupsConfirmed': None,
                'sourceEvents': m['events'], 'scenes': [], 'files': [],
                'limitations': ['Candidate context is not a full-day count.',
                    'Playback derivatives do not preserve wall-clock pauses; use the timestamp mapping and gaps.',
                    'AI image approval and visibleCupCount do not establish distinct physical cups.']}
    inventory = {}
    db = sqlite3.connect((archive / 'index.sqlite3').resolve().as_uri() + '?mode=ro', uri=True)
    try:
        for index, window in enumerate(merge_windows(m['events']), 1):
            rows = db.execute('SELECT archive_path,start_time,end_time,sha256 FROM segments '
                              'WHERE start_time < ? AND end_time > ? ORDER BY start_time',
                              (window['endTime'], window['startTime'])).fetchall()
            segments, missing = [], []
            for relative, begin, end, expected in rows:
                if '/handoff/' not in relative:
                    continue
                source = (archive / relative).resolve()
                if not source.is_relative_to(archive.resolve()):
                    raise ValueError('source_outside_archive')
                if not source.is_file():
                    missing.append({'archivePath': relative, 'startTime': begin, 'endTime': end})
                    continue
                if relative not in inventory:
                    if sha(source) != expected:
                        raise ValueError('archive_hash_mismatch')
                    target = originals / f'segment-{len(inventory) + 1:04}.mp4'
                    shutil.copyfile(source, target)
                    if sha(target) != expected:
                        raise ValueError('copied_hash_mismatch')
                    probe = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                                            '-of', 'json', str(target)], check=True, capture_output=True, text=True, timeout=15)
                    duration = float(json.loads(probe.stdout)['format']['duration'])
                    inventory[relative] = {'path': str(target.relative_to(destination)), 'archivePath': relative,
                        'sha256': expected, 'bytes': target.stat().st_size, 'durationSeconds': duration,
                        'startTime': begin, 'endTime': end}
                segments.append(inventory[relative])
            scene = {**window, 'sceneId': f'context-{index:02}', 'segments': segments,
                     'missingSourceFiles': missing, 'gaps': coverage_gaps(window['startTime'], window['endTime'], segments),
                     'playbackParts': []}
            for part, group in enumerate(split_for_playback(segments), 1):
                stem = f'context-{index:02}-part-{part:02}'
                concat = joined / f'{stem}.ffconcat'
                concat.write_text('ffconcat version 1.0\n' + ''.join(f"file '../{s['path']}'\n" for s in group))
                video = joined / f'{stem}.mp4'
                command = ['ffmpeg', '-nostdin', '-v', 'warning', '-f', 'concat', '-safe', '0', '-i', str(concat),
                           '-map', '0', '-c', 'copy', '-movflags', '+faststart', str(video)]
                result = subprocess.run(command, capture_output=True, text=True, timeout=60)
                if result.returncode:
                    raise ValueError('playback_derivative_failed')
                offset, mapping = 0.0, []
                for s in group:
                    mapping.append({'sourcePath': s['path'], 'sourceSha256': s['sha256'],
                                    'playbackStartSeconds': offset, 'playbackEndSeconds': offset + s['durationSeconds'],
                                    'archiveStartTime': s['startTime'], 'archiveEndTime': s['endTime']})
                    offset += s['durationSeconds']
                scene['playbackParts'].append({'path': str(video.relative_to(destination)), 'derived': True,
                    'encoding': 'stream_copy', 'mapping': mapping, 'ffmpegWarnings': result.stderr[:8000]})
            manifest['scenes'].append(scene)
    finally:
        db.close()
    for p in sorted(destination.rglob('*')):
        if p.is_file():
            manifest['files'].append({'path': str(p.relative_to(destination)), 'sha256': sha(p), 'bytes': p.stat().st_size})
    if sum(f['bytes'] for f in manifest['files']) > 200 * 1024 * 1024:
        raise ValueError('review_package_exceeds_200mb')
    (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    zip_path = destination.with_suffix('.zip')
    with zipfile.ZipFile(zip_path, 'x', compression=zipfile.ZIP_STORED) as z:
        for p in sorted(destination.rglob('*')):
            if p.is_file():
                z.write(p, str(p.relative_to(destination)))
    print(json.dumps({'package': str(zip_path), 'sha256': sha(zip_path), 'bytes': zip_path.stat().st_size,
                      'sourceSegments': len(inventory), 'contextScenes': len(manifest['scenes']),
                      'playbackParts': sum(len(s['playbackParts']) for s in manifest['scenes']),
                      'gapSeconds': sum(g['seconds'] for s in manifest['scenes'] for g in s['gaps']),
                      'countsCreated': False, 'uploaded': False}))


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('package', type=Path)
    p.add_argument('archive', type=Path)
    p.add_argument('destination', type=Path)
    a = p.parse_args()
    export(a.package, a.archive, a.destination)
