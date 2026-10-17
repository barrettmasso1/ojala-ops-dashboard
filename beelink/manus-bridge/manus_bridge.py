#!/usr/bin/env python3
"""Supported Manus API transport, separate from direct Frigate delivery.

Packages verified snapshots and original archived segments, never invents counts.
An accepted Manus task is NOT a dashboard receipt. No direct sender state is read
or modified. API credentials are loaded from an owner-only local file.
"""
import argparse
from datetime import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from zoneinfo import ZoneInfo

BASE = Path('/home/ojala/frigate')
API = 'https://api.manus.ai/v2/'
TASK = 'bA6Dz0FRJW5d772yUd0S2B'
TZ = ZoneInfo('America/Mazatlan')
MAX_PACKAGE = 200 * 1024 * 1024


class BridgeError(Exception):
    """Only fixed, non-secret codes may be raised as BridgeError messages."""


class ApiError(BridgeError):
    def __init__(self, code):
        self.code = code
        super().__init__('api_http_' + str(code))


def require(ok, code):
    if not ok:
        raise BridgeError(code)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def private_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(value, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def within(path, root):
    resolved = path.resolve(strict=True)
    require(resolved.is_relative_to(root.resolve(strict=True)), 'external_source_path')
    require(resolved.is_file(), 'source_not_file')
    return resolved


def assemble(day, base=BASE):
    """Read-only collection. Images never leave this host except via Manus API."""
    require(datetime.strptime(day, '%Y-%m-%d').strftime('%Y-%m-%d') == day, 'invalid_date')
    sender = load_module(base/'handoff-visual-sender/handoff_visual_sender.py', 'visual_validation')
    image_root = base/'config/verified_snapshots/handoff'
    sender.VERIFIED_SNAPSHOT_DIR = image_root
    files, events, skipped = {}, [], 0
    archive_root = base/'pilot-archive/forward-20260929'
    db_path = archive_root/'index.sqlite3'
    archive = sqlite3.connect(db_path.as_uri()+'?mode=ro', uri=True) if db_path.exists() else None
    try:
        for image in sorted(image_root.glob('*')):
            if image.suffix.lower() not in sender.ALLOWED_SUFFIXES:
                continue
            if time.time() - image.stat().st_mtime < 60:
                continue
            try:
                metadata, sha = sender.event_metadata(image)
                at = datetime.fromisoformat(metadata['captured_at_utc'].replace('Z', '+00:00'))
                if at.astimezone(TZ).date().isoformat() != day:
                    continue
                sidecar = within(sender.sidecar_path(image), image_root)
                raw_sidecar = sidecar.read_bytes()
                source = json.loads(raw_sidecar)
                # Preserve original bytes and geometry; normalization above only validates.
                require(source.get('schema_version') == 3, 'geometry_required')
                require(bool(source.get('people')) and bool(source.get('cup')), 'visual_gate_missing')
                event_id = metadata['cup_event_id']
                require(not any(e['cupEventId'] == event_id for e in events), 'duplicate_capture_event')
                image_bytes = within(image, image_root).read_bytes()
                require(digest(image_bytes) == sha, 'image_changed_during_collection')
                image_name, meta_name = 'snapshots/'+image.name, 'snapshots/'+sidecar.name
                files[image_name] = image_bytes
                files[meta_name] = raw_sidecar
                start = source.get('cup_event_start', at.timestamp())
                require(isinstance(start, (float, int)) and abs(start-at.timestamp()) < 600,
                        'invalid_event_window')
                window_start, window_end = min(start, at.timestamp())-5, at.timestamp()+15
                segments = []
                if archive:
                    rows = archive.execute('SELECT archive_path,start_time,end_time,sha256 FROM segments '
                                           'WHERE start_time < ? AND end_time > ? ORDER BY start_time',
                                           (window_end, window_start))
                    for relative, begin, end, expected in rows:
                        if '/handoff/' not in relative:
                            continue
                        segment = within(archive_root/relative, archive_root)
                        content = segment.read_bytes()
                        require(digest(content) == expected, 'archive_hash_mismatch')
                        target = 'segments/'+relative
                        files[target] = content
                        segments.append({'path': target, 'startTime': begin, 'endTime': end})
                events.append({'cupEventId': event_id, 'capturedAt': metadata['captured_at_utc'],
                               'image': image_name, 'metadata': meta_name, 'source': 'verified_snapshot',
                               'reviewStatus': 'pending_review', 'segments': segments,
                               'requestedWindow': [window_start, window_end]})
            except (BridgeError, sender.SenderError, ValueError, OSError, KeyError):
                # A partial package must visibly report exclusions; never log raw metadata.
                skipped += 1
    finally:
        if archive:
            archive.close()
    # Preserve an existing reviewed count only after rechecking its complete
    # ledger/evidence chain. Never manufacture one from snapshot cardinality.
    count_info = attach_reviewed_count(day, base, files)
    manifest = {'schemaVersion': 1, 'storeId': 1, 'cameraName': 'handoff', 'businessDate': day,
                'transport': 'manus_official_api_administrative_review', 'coverage': 'partial',
                'countRecordIncluded': bool(count_info), 'countRecord': count_info,
                'cupsDetected': count_info['cupsDetected'] if count_info else None, 'events': events,
                'skippedSources': skipped,
                'limitations': ['Candidates are not unique physical cups.',
                                'Only candidate windows are included, not full-day coverage.',
                                'An upload or task acceptance is not a dashboard receipt.']}
    require(events or count_info, 'no_verified_evidence_for_date')
    manifest['files'] = [{'path': name, 'sha256': digest(data), 'bytes': len(data)}
                         for name, data in sorted(files.items())]
    require(sum(len(v) for v in files.values()) <= MAX_PACKAGE, 'package_too_large')
    return manifest, files


def attach_reviewed_count(day, base, files):
    path = base/'scripts/approved_counts'/(day+'.json')
    if not path.exists():
        return None
    source = within(path, base/'scripts/approved_counts').read_bytes()
    record = json.loads(source)
    push = load_module(base/'scripts/frigate_push_counts.py', 'count_validation')
    require(push.validate_record(record, day) is None, 'invalid_reviewed_count')
    push.approval_timestamp(record)
    review = load_module(base/'count-review/review_counts.py', 'ledger_validation')
    match = None
    for candidate in (base/'pilot-reports'/day).rglob('review-ledger.json'):
        ledger = json.loads(within(candidate, base/'pilot-reports'/day).read_bytes())
        if digest(json.dumps(ledger, sort_keys=True).encode()) == record.get('ledgerSha256'):
            match = ledger
            break
    require(match is not None, 'matching_review_ledger_missing')
    result = review.evaluate(match, base)
    expected = (review.export_partial_record(match, base, record['approvedAt'])
                if record['coverage'] == 'partial' else review.export_record(match, result))
    require(expected == record, 'reviewed_count_does_not_match_ledger')
    for item in match['evidence']:
        data = within(base/item['path'], base/'pilot-reports'/day).read_bytes()
        require(digest(data) == item['sha256'], 'review_evidence_hash_mismatch')
        files['evidence/'+item['path']] = data
    # Exact canonicalization used by frigate_push_counts.py is retained.
    raw = json.dumps(record, sort_keys=True)
    record_sha = digest(raw.encode())
    files['reviewed-count/record.original.json'] = source
    files['reviewed-count/import-envelope.json'] = canonical({
        'schemaVersion': 1, 'intendedProcedure': 'dashboard.importReviewedCameraCount', 'recordJson': raw})
    files['reviewed-count/review-ledger.json'] = json.dumps(match, sort_keys=True).encode()
    return {'cupsDetected': record['cupsDetected'], 'coverage': record['coverage'],
            'recordSha256': record_sha, 'ledgerSha256': record['ledgerSha256'],
            'sourceEventId': f'daily-reviewed-{day}-{record_sha[:32]}',
            'approvedAt': record['approvedAt']}


def queue_db(state):
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    db = sqlite3.connect(state/'queue.sqlite3')
    db.row_factory = sqlite3.Row
    db.execute('CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, day TEXT NOT NULL, '
               'path TEXT NOT NULL, sha256 TEXT NOT NULL, status TEXT NOT NULL, '
               'file_id TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_at REAL NOT NULL DEFAULT 0, '
               'sent_at REAL, last_error TEXT, task_id TEXT, request_id TEXT)')
    db.execute('CREATE TABLE IF NOT EXISTS controls (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    os.chmod(state/'queue.sqlite3', 0o600)
    return db


def stage(manifest, files, state):
    batch_id = digest(canonical(manifest))
    db = queue_db(state)
    try:
        existing = db.execute('SELECT * FROM batches WHERE id=?', (batch_id,)).fetchone()
        if existing:
            return {'batchId': batch_id, 'status': existing['status'], 'deduplicated': True}
        package = state/(batch_id+'.zip')
        with tempfile.NamedTemporaryFile(dir=state, delete=False) as out:
            temp = Path(out.name)
        try:
            with zipfile.ZipFile(temp, 'w', compression=zipfile.ZIP_STORED) as z:
                z.writestr('manifest.json', canonical(manifest))
                for name, data in sorted(files.items()):
                    z.writestr(name, data)
            require(temp.stat().st_size <= MAX_PACKAGE, 'package_too_large')
            sha = digest(temp.read_bytes())
            os.replace(temp, package)
        finally:
            temp.unlink(missing_ok=True)
        db.execute('INSERT INTO batches(id,day,path,sha256,status) VALUES(?,?,?,?,?)',
                   (batch_id, manifest['businessDate'], str(package), sha, 'queued'))
        db.commit()
        return {'batchId': batch_id, 'status': 'queued', 'snapshots': len(manifest['events']),
                'packageBytes': package.stat().st_size, 'cupsDetected': None}
    finally:
        db.close()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class ManusApi:
    def __init__(self, key):
        self.key = key
        self.opener = urllib.request.build_opener(NoRedirect())

    def call(self, method, params=None, post=False):
        require(method in {'user.me', 'task.detail', 'task.listMessages', 'file.upload',
                           'file.detail', 'task.sendMessage', 'task.update'}, 'unsupported_api_method')
        if method == 'task.update':
            # Setup may narrow sharing of this one authorized task only.
            require(post and params == {'task_id': TASK, 'share_visibility': 'private'},
                    'unsupported_task_update')
        url = API + method
        data = canonical(params or {}) if post else None
        if params and not post:
            url += '?' + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, data=data, headers={
            'x-manus-api-key': self.key, 'Content-Type': 'application/json',
            'User-Agent': 'Ojala-Manus-Bridge/1.0'}, method='POST' if post else 'GET')
        try:
            with self.opener.open(req, timeout=30) as response:
                result = json.loads(response.read(4*1024*1024))
        except urllib.error.HTTPError as e:
            raise ApiError(e.code) from None
        except (OSError, ValueError):
            raise BridgeError('api_network_or_response_error') from None
        require(result.get('ok') is True, 'api_response_not_ok')
        return result

    def upload(self, url, content):
        parsed = urllib.parse.urlsplit(url)
        # Only the presigned S3 URL returned by the authenticated API. No API key
        # is ever included on this request and redirects are never followed.
        host = parsed.hostname or ''
        require(parsed.scheme == 'https' and not parsed.username and not parsed.password
                and parsed.port in (None, 443) and host.endswith('.amazonaws.com')
                and ('.s3.' in host or '.s3-' in host), 'invalid_upload_destination')
        req = urllib.request.Request(url, data=content, method='PUT',
                                     headers={'Content-Type': 'application/zip'})
        try:
            with self.opener.open(req, timeout=120) as r:
                require(200 <= r.status < 300, 'upload_failed')
        except urllib.error.HTTPError as e:
            raise ApiError(e.code) from None
        except OSError:
            raise BridgeError('upload_network_error') from None


def read_key(config):
    info = config.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
            and info.st_mode & 0o077 == 0, 'private_config_permissions_required')
    value = json.loads(config.read_text())
    key = value.get('manusApiKey')
    # Manus documents no minimum token length; authentication belongs to its API.
    require(isinstance(key, str) and key and all(33 <= ord(c) <= 126 for c in key), 'invalid_api_key')
    return key


def prompt(row, count_included=False):
    count_instruction = (
        'El paquete incluye reviewed-count/import-envelope.json y el ledger/evidencia originales. '
        'Revalida todos sus hashes y deduplicación. Usa únicamente dashboard.importReviewedCameraCount '
        'para importar ese registro original, conservando recordJson/sourceEventId/sourceEventAt '
        'y su cobertura. Si ya existe igual, devuelve el recibo; si difiere, no lo sobrescribas. '
        'No cambies el registro para superar controles. Lee la fila de vuelta e inclúyela como countRow. '
        'Prioriza ese recibo y una captura autenticada descargable del dashboard antes de revisar '
        'las demás ventanas visuales; no lo condiciones a funciones nuevas ni a una publicación. '
        if count_included else
        'No existe conteo aprobado en este paquete: no crees un conteo diario a partir del número '
        'de imágenes ni de sugerencias de IA. El recibo debe indicar countRow=null. ')
    return (f'OJALA_BRIDGE_BATCH:{row["id"]}\n'
            f'Anhec es el responsable y autoriza esta importación administrativa en Store 1. '
            f'Paquete de evidencia real {row["day"]}, SHA-256 {row["sha256"]}. '
            +count_instruction+
            'Verifica todos los hashes del manifest.json. Importa por el flujo administrativo '
            'autenticado existente conservando cupEventId, fecha, cámara, geometría y origen '
            'verified_snapshot. Para snapshots originales usa el exportador auditado '
            'beelink/handoff-visual-sender/export_verified_snapshot_import.py y conserva '
            'normalizationProof; sigue notes/verified-snapshot-zone-normalization.md. '
            'No conviertas el objeto de zona a puntos conservando su hash anterior. '
            'Si el exportador o su soporte publicado no está disponible, conserva el paquete '
            'y reporta ese bloqueo sin improvisar metadatos. '
            'Deduplica por tienda/cámara/evento. Usa el flujo visual publicado y conserva '
            'sus resultados approved_by_ai, discarded o pending_review como evidencia visual; '
            'ningún estado equivale a un vaso físico único ni a una aprobación humana. '
            'No exijas un modo queueOnly nuevo ni sobrescribas decisiones existentes. Revisa los segmentos '
            'originales adjuntos para separar repeticiones del mismo vaso y vasos distintos. '
            'Entrega el ledger revisable y los IDs persistidos; las fotos o tracks NO son '
            'vasos únicos. Conserva los '
            'ambiguos y cobertura parcial. El 90% de coincidencia manual es un antecedente '
            'reportado por Anhec, no un multiplicador ni conteo. No hagas migraciones, '
            'no cambies ventas/inventario, no reintentes el endpoint Frigate ni alteres '
            'Cloudflare. Esta vía es administrativa mediante API oficial, no prueba del '
            'envío Frigate directo. Guarda y adjunta un receipt.json con batchId, '
            'packageSha256, storeId, businessDate, filas visuales leídas de vuelta '
            '(id/cupEventId/source/status), countRow, readBackAt y limitaciones. '
            'Si falta sesión administrativa conserva el paquete y reporta el bloqueo, '
            'sin afirmar recepción en el dashboard.')


def update(db, batch_id, **fields):
    db.execute('UPDATE batches SET '+','.join(k+'=?' for k in fields)+' WHERE id=?',
               (*fields.values(), batch_id))
    db.commit()


def deliver_one(db, api, now=None):
    now = time.time() if now is None else now
    if db.execute("SELECT 1 FROM controls WHERE key='api_auth_hold'").fetchone():
        return {'status': 'api_auth_hold', 'dashboardReceived': False}
    # Ambiguous/crashed sends are held, not resent blindly (API has no documented
    # idempotency key). They can be reconciled against task history separately.
    row = db.execute("SELECT * FROM batches WHERE status IN ('queued','retry') AND next_at<=? "
                     'ORDER BY day,id LIMIT 1', (now,)).fetchone()
    if not row:
        return {'status': 'nothing_due', 'dashboardReceived': False}
    attempts = row['attempts']+1
    phase = 'preflight'
    try:
        task = api.call('task.detail', {'task_id': TASK})['task']
        require(task['id'] == TASK, 'wrong_task')
        require(task.get('share_visibility') == 'private', 'task_must_be_private')
        if task.get('status') != 'stopped' or task.get('has_running_background_jobs'):
            update(db, row['id'], next_at=now+1800, last_error='task_busy_or_waiting')
            return {'status': 'task_busy_or_waiting', 'dashboardReceived': False}
        path = within(Path(row['path']), Path(row['path']).parent)
        content = path.read_bytes()
        require(len(content) <= MAX_PACKAGE and digest(content) == row['sha256'], 'package_integrity_failed')
        with zipfile.ZipFile(path) as z:
            count_included = json.loads(z.read('manifest.json')).get('countRecordIncluded') is True
        update(db, row['id'], attempts=attempts)
        # Re-upload after a failed attempt: input files expire after 48 hours.
        uploaded = api.call('file.upload', {'filename': 'ojala-'+row['day']+'-'+row['id'][:12]+'.zip'}, post=True)
        file_id = uploaded['file']['id']
        api.upload(uploaded['upload_url'], content)
        detail = api.call('file.detail', {'file_id': file_id})['file']
        require(detail['id'] == file_id and detail['status'] == 'uploaded'
                and int(detail['bytes']) == len(content), 'upload_not_confirmed')
        update(db, row['id'], status='dispatching', file_id=file_id, sent_at=now, task_id=TASK)
        phase = 'dispatch'
        result = api.call('task.sendMessage', {'task_id': TASK, 'message': {'content': [
            {'type': 'text', 'text': prompt(row, count_included)}, {'type': 'file', 'file_id': file_id}]}}, post=True)
        require(result.get('task_id') == TASK and result.get('request_id'), 'invalid_task_ack')
        update(db, row['id'], status='awaiting_dashboard_receipt', request_id=result['request_id'],
               last_error=None)
        return {'status': 'awaiting_dashboard_receipt', 'batchId': row['id'],
                'taskAccepted': True, 'dashboardReceived': False, 'directFrigateVerified': False}
    except (BridgeError, KeyError, TypeError, ValueError, OSError) as e:
        code = str(e) if isinstance(e, BridgeError) else 'invalid_response_or_local_file'
        forbidden = isinstance(e, ApiError) and e.code in (401, 403)
        if forbidden:
            db.execute("INSERT OR REPLACE INTO controls VALUES ('api_auth_hold', ?)", (code,))
        explicit_rejection = isinstance(e, ApiError) and 400 <= e.code < 500
        uncertain = phase == 'dispatch' and not explicit_rejection
        status = 'delivery_unknown' if uncertain else 'blocked' if forbidden or attempts >= 5 else 'retry'
        if code in {'task_must_be_private', 'wrong_task', 'package_integrity_failed'}:
            status = 'blocked'
        update(db, row['id'], status=status, attempts=attempts, last_error=code,
               next_at=now+min(86400, 1800*2**(attempts-1)))
        return {'status': status, 'reason': code, 'dashboardReceived': False}


def reconcile(db, api):
    if db.execute("SELECT 1 FROM controls WHERE key='api_auth_hold'").fetchone():
        return {'status': 'api_auth_hold', 'dashboardReceived': False}
    rows = db.execute("SELECT * FROM batches WHERE status IN ('dispatching','delivery_unknown')").fetchall()
    if not rows:
        return {'reconciled': 0}
    markers, cursor = set(), None
    for _ in range(5):
        params = {'task_id': TASK, 'limit': 200, 'order': 'desc'}
        if cursor:
            params['cursor'] = cursor
        page = api.call('task.listMessages', params)
        for item in page.get('messages', []):
            if item.get('type') == 'user_message':
                markers.update(re.findall(r'OJALA_BRIDGE_BATCH:([a-f0-9]{64})',
                                           item.get('user_message', {}).get('content', '')))
        if not page.get('has_more'):
            break
        cursor = page.get('next_cursor')
        if not cursor:
            break
    count = 0
    for row in rows:
        if row['id'] in markers:
            update(db, row['id'], status='awaiting_dashboard_receipt', last_error=None)
            count += 1
    return {'reconciled': count, 'dashboardReceived': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['collect', 'send', 'reconcile', 'status', 'check-key'])
    parser.add_argument('--date', default=datetime.now(TZ).date().isoformat())
    parser.add_argument('--base', type=Path, default=BASE)
    args = parser.parse_args()
    state = args.base/'manus-bridge/state'
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (state/'worker.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        db = queue_db(state)
        try:
            if args.action == 'collect':
                manifest, files = assemble(args.date, args.base)
                result = stage(manifest, files, state)
            elif args.action == 'status':
                result = {'states': dict(db.execute('SELECT status,count(*) FROM batches GROUP BY status').fetchall()),
                          'configured': (args.base/'manus-bridge/config.private.json').exists(),
                          'directFrigateVerified': False}
            else:
                config = args.base/'manus-bridge/config.private.json'
                require(config.exists(), 'manus_api_key_missing')
                api = ManusApi(read_key(config))
                if args.action == 'check-key':
                    api.call('user.me')
                    task = api.call('task.detail', {'task_id': TASK})['task']
                    result = {'apiAuthenticated': True, 'taskAccessible': task['id'] == TASK,
                              'taskPrivate': task.get('share_visibility') == 'private'}
                elif args.action == 'reconcile':
                    result = reconcile(db, api)
                else:
                    result = deliver_one(db, api)
        finally:
            db.close()
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except BridgeError as e:
        print(json.dumps({'status': 'blocked', 'reason': str(e), 'dashboardReceived': False}))
        raise SystemExit(2)
    except (OSError, ValueError, KeyError, TypeError):
        print(json.dumps({'status': 'blocked', 'reason': 'local_or_response_error', 'dashboardReceived': False}))
        raise SystemExit(2)
