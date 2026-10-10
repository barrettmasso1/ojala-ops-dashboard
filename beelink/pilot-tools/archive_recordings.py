#!/usr/bin/env python3
"""Copy finished handoff recordings outside Frigate cleanup, with bounded storage.

Reads Frigate SQLite read-only. The separate archive is not a cup counter and
does not certify decoded video, camera coverage, or physical disk redundancy.
Never deletes original files or earlier evidence. Stops visibly at the quota.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import time

BASE = Path('/home/ojala/frigate')
SINCE = dt.datetime(2026, 9, 29, tzinfo=dt.timezone(dt.timedelta(hours=-7))).timestamp()
MAX_BYTES = 16 * 1024**3
MIN_FREE = 8 * 1024**3


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024**2), b''):
            h.update(block)
    return h.hexdigest()


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_json(path, value):
    tmp = path.with_suffix('.tmp')
    with tmp.open('w') as f:
        json.dump(value, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    sync_dir(path.parent)


def recording_paths(root, archive, path):
    rel = Path(path).relative_to('/media/frigate/recordings')
    if '..' in rel.parts or len(rel.parts) != 4 or rel.parts[2] != 'handoff' or rel.suffix != '.mp4':
        raise ValueError('invalid_recording_path')
    source_root = root / 'storage' / 'recordings'
    source = source_root / rel
    if source.resolve() != source_root.resolve() / rel:
        raise ValueError('source_symlink')
    target_root = archive / 'recordings'
    target = target_root / rel
    if target.resolve() != target_root.resolve() / rel:
        raise ValueError('archive_symlink')
    return source, target


def copy_checked(source, target):
    before = source.stat()
    if before.st_size <= 0:
        raise ValueError('empty_source')
    if target.exists():
        sha = digest(source)
        if target.stat().st_size != before.st_size or digest(target) != sha:
            raise ValueError('archive_conflict')
        return sha
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    part = target.with_suffix('.mp4.part')
    if part.is_symlink():
        raise ValueError('partial_symlink')
    h = hashlib.sha256()
    with source.open('rb') as src, part.open('wb') as dst:
        os.chmod(part, 0o600)
        for block in iter(lambda: src.read(1024**2), b''):
            h.update(block)
            dst.write(block)
        dst.flush()
        os.fsync(dst.fileno())
    after = source.stat()
    if (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
        raise ValueError('source_changed_during_copy')
    sha = h.hexdigest()
    if part.stat().st_size != before.st_size or digest(part) != sha:
        raise ValueError('copy_verification_failed')
    os.replace(part, target)
    sync_dir(target.parent)
    return sha


def archive_once(root=BASE, now=None, max_bytes=MAX_BYTES, min_free=MIN_FREE):
    now = time.time() if now is None else now
    archive = root / 'pilot-archive' / 'forward-20260929'
    archive.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(archive, 0o700)
    lock = (archive / 'run.lock').open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        return {'status': 'already_running'}
    report = {'version': '2026-09-29.1', 'checked_at_utc': dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat(),
              'status': 'ok', 'copied_segments': 0, 'indexed_existing': 0, 'missing_sources': 0,
              'errors': 0, 'max_archive_bytes': max_bytes, 'minimum_free_bytes': min_free,
              'source_database_mode': 'read_only', 'video_decode_verified': False,
              'physical_cups': None, 'automatic_deletion': False}
    index = None
    try:
        index = sqlite3.connect(archive / 'index.sqlite3')
        index.execute('PRAGMA synchronous=FULL')
        index.execute('''CREATE TABLE IF NOT EXISTS segments
            (source_path TEXT PRIMARY KEY, archive_path TEXT NOT NULL, start_time REAL,
             end_time REAL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL)''')
        index.commit()
        source_db = sqlite3.connect((root / 'config' / 'frigate.db').resolve().as_uri()+'?mode=ro', uri=True, timeout=3)
        try:
            source_db.execute('PRAGMA query_only=ON')
            rows = source_db.execute('''SELECT path,start_time,end_time FROM recordings
                WHERE camera='handoff' AND start_time>=? AND end_time<=?
                ORDER BY start_time''', (max(SINCE, now-2*86400), now-45)).fetchall()
        finally:
            source_db.close()
        # Include orphan and interrupted files in the quota after a power cut.
        used = sum(p.stat().st_size for p in (archive/'recordings').rglob('*') if p.is_file())
        known = {r[0] for r in index.execute('SELECT source_path FROM segments')}
        started = time.monotonic()
        for path, start, end in rows:
            if time.monotonic()-started > 45 or report['copied_segments']+report['indexed_existing'] >= 600:
                report['status'] = 'catching_up'
                break
            try:
                src, dst = recording_paths(root, archive, path)
                if path in known and dst.is_file():
                    continue
                if not src.is_file():
                    report['missing_sources'] += 1
                    continue
                size = src.stat().st_size
                exists = dst.exists()
                if not exists and (used+size > max_bytes or shutil.disk_usage(archive).free-size < min_free):
                    report['status'] = 'paused_storage_limit'
                    break
                sha = copy_checked(src, dst)
                index.execute('INSERT OR REPLACE INTO segments VALUES(?,?,?,?,?,?)',
                              (path, str(dst.relative_to(archive)), start, end, size, sha))
                index.commit()
                if exists:
                    report['indexed_existing'] += 1
                else:
                    report['copied_segments'] += 1
                    used += size
            except (OSError, ValueError, sqlite3.Error) as exc:
                report['errors'] += 1
                report['last_error_type'] = type(exc).__name__
        totals = index.execute('SELECT count(*),COALESCE(sum(bytes),0),min(start_time),max(end_time) FROM segments').fetchone()
        report.update(archived_segments=totals[0], indexed_bytes=totals[1], first_segment_epoch=totals[2], last_segment_epoch=totals[3],
                      archive_bytes=used, disk_free_bytes=shutil.disk_usage(archive).free)
        if report['status'] == 'ok' and (report['errors'] or report['missing_sources']):
            report['status'] = 'incomplete'
    except (OSError, ValueError, sqlite3.Error) as exc:
        report.update(status='error', last_error_type=type(exc).__name__)
    finally:
        if index:
            index.close()
        atomic_json(archive / 'status.json', report)
        lock.close()
    return report


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--root', type=Path, default=BASE)
    args = ap.parse_args()
    outcome = archive_once(args.root)
    print(json.dumps(outcome))
    raise SystemExit(2 if outcome['status'] in ('error','incomplete','paused_storage_limit') else 0)
