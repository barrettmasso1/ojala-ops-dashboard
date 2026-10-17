#!/usr/bin/env python3
"""Local human confirmation of the concrete October 16 two-cup proposal.

Prepares hash-checked temporal evidence, then asks the actual operator to review
the video and confirm. No approval is generated on cancellation, no network POST,
and no existing approved record is overwritten. Originals remain unchanged.
"""
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile

BASE = Path('/home/ojala/frigate')
DOWNLOADS = Path('/home/ojala/Downloads')
DAY = '2026-10-16'
EVENT = '1792184815.511486-mfq37v'
PACKAGE_SHA = '6aa12a938f199cadd58d30155d84205b345d9b00899e729a054f5abcefb17c4d'
VIDEO = 'review/context-02-part-01.mp4'
WORK = BASE / 'pilot-reports' / DAY / 'manus-partial-approval'


def need(ok, reason):
    if not ok:
        raise ValueError(reason)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result


def exact_copy(path, data):
    if path.exists():
        need(path.read_bytes() == data, 'existing_evidence_differs')
        return
    with path.open('xb') as f:
        os.chmod(path, 0o600); f.write(data); f.flush(); os.fsync(f.fileno())


def state(status, **extra):
    WORK.mkdir(parents=True, exist_ok=True, mode=0o700)
    p = WORK / 'approval-state.json'
    temp = p.with_suffix('.tmp')
    temp.write_text(json.dumps({'status': status, 'at': datetime.now(timezone.utc).isoformat(), **extra}, indent=2))
    os.chmod(temp, 0o600); os.replace(temp, p)


def prepare():
    WORK.mkdir(parents=True, exist_ok=True, mode=0o700)
    draft_path = DOWNLOADS / ('borrador-conteo-parcial-' + DAY + '-requiere-aprobacion-humana.json')
    raw = draft_path.read_bytes(); draft = json.loads(raw); record = draft['proposedRecord']
    need(draft.get('documentType') == 'reviewed_camera_count_draft' and draft.get('notImportable') is True,
         'not_expected_draft')
    need(record.get('businessDate') == DAY and record.get('storeId') == 1 and record.get('cameraName') == 'handoff'
         and record.get('cupsDetected') == 2 and record.get('uniqueCupIds') == ['CTX02-R01', 'CTX02-R02']
         and record.get('coverage') == 'partial', 'proposal_changed_requires_new_review')
    package = DOWNLOADS / 'OJALA_CONTEXTO_AMPLIADO_16OCT.zip'
    package_bytes = package.read_bytes()
    need(sha(package_bytes) == PACKAGE_SHA, 'original_package_changed')
    with zipfile.ZipFile(package) as z:
        manifest_bytes = z.read('manifest.json'); manifest = json.loads(manifest_bytes)
        expected = {x['path']: x for x in manifest['files']}
        for ref in record['evidenceReferences']:
            if ref['path'] == package.name:
                need(ref['sha256'] == PACKAGE_SHA, 'package_reference_mismatch')
            else:
                need(sha(z.read(ref['path'])) == ref['sha256'], 'proposal_evidence_hash_mismatch')
        scene = next(s for s in manifest['scenes'] if EVENT in s['eventIds'])
        part = next(p for p in scene['playbackParts'] if p['path'] == VIDEO)
        evidence = []
        for index, position in enumerate([62.5, 72.5], 1):
            anchor = next(x for x in part['mapping'] if x['playbackStartSeconds'] <= position < x['playbackEndSeconds'])
            rel = anchor['sourcePath']; data = z.read(rel)
            need(sha(data) == expected[rel]['sha256'], 'temporal_source_hash_mismatch')
            dest = WORK / Path(rel).name; exact_copy(dest, data)
            at = anchor['archiveStartTime'] + position - anchor['playbackStartSeconds']
            evidence.append({'id': f'context02-anchor-{index}', 'path': str(dest.relative_to(BASE)),
                'sha256': sha(data), 'at': datetime.fromtimestamp(at, timezone.utc).isoformat(),
                'reviewVideo': VIDEO, 'playbackSeconds': position,
                'timestampBasis': 'archive mapping; approximate review anchor'})
        video = WORK / 'context02-review.mp4'
        data = z.read(VIDEO); need(sha(data) == expected[VIDEO]['sha256'], 'review_video_hash_mismatch')
        exact_copy(video, data)
    exact_copy(WORK / 'proposal.original.json', raw)
    return draft, evidence, video, sha(raw), sha(manifest_bytes)


def make_ledger(draft, evidence, reviewer, approved_at, draft_sha, manifest_sha):
    need(isinstance(reviewer, str) and 2 <= len(reviewer.strip()) <= 100, 'reviewer_required')
    need(len(evidence) == 2 and len({e['at'] for e in evidence}) == 2, 'two_temporal_anchors_required')
    proposal = draft['proposedRecord']
    refs = [e['id'] for e in evidence]
    return {'businessDate': DAY, 'storeId': 1, 'cameraName': 'handoff',
        'countBasis': 'reviewed_unique_physical_cups', 'coverage': 'partial', 'status': 'approved',
        'reviewedBy': reviewer.strip(), 'approvedAt': approved_at, 'candidateIds': [EVENT],
        'evidence': evidence,
        'units': [{'id': uid, 'decision': 'confirmed', 'personAndFilledCup': True, 'inHandoffZone': True,
                   'evidenceIds': refs, 'identityReason': proposal['decisionRationale'] +
                   ' The named operator explicitly confirmed both units in the local review dialog.'}
                  for uid in proposal['uniqueCupIds']],
        'cases': [{'id': 'context02-pair', 'candidateIds': [EVENT], 'disposition': 'counted',
                   'unitIds': proposal['uniqueCupIds'], 'evidenceIds': refs}],
        'dailyReview': {'scope': 'confirmed_units_in_partial_evidence', 'completed': True,
                        'gaps': [proposal['gapsDescription'], 'Other source events are outside this partial approval.']},
        'provenance': {'sourceDraftSha256': draft_sha, 'sourcePackageSha256': PACKAGE_SHA,
                       'sourceManifestSha256': manifest_sha, 'approvalMethod': 'local_human_confirmation'}}


def main():
    os.umask(0o077)
    from configure_private import gui_environment
    env = gui_environment()
    target = BASE / 'scripts/approved_counts' / (DAY + '.json')
    try:
        need(not target.exists(), 'approved_record_already_exists')
        draft, evidence, video, draft_sha, manifest_sha = prepare()
        state('awaiting_human_review', cupsProposed=2, coverage='partial')
        if shutil.which('ffplay'):
            subprocess.Popen(['ffplay', '-loglevel', 'error', '-ss', '55', '-t', '68',
                              '-autoexit', '-an', '-x', '960', '-y', '540', str(video)],
                             env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            subprocess.Popen(['xdg-open', str(video)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        review = subprocess.run(['zenity', '--question', '--default-cancel', '--width=620',
            '--title=Ojala: revisar 2 vasos del 16/10', '--ok-label=Confirmar los 2 vasos',
            '--cancel-label=Conservar pendiente', '--text=Revisa el video desde el segundo 55.\n\n'
            '¿Confirmas dos vasos de helado distintos (CTX02-R01 y R02), con persona y dentro '
            'de handoff_zone, sin sumar recipientes estacionarios ni reapariciones?\n\n'
            'Se registrará únicamente un parcial de 2, NO ventas ni el total del día.\n'
            'Si no puedes confirmarlo visualmente, conserva pendiente.'], env=env)
        if review.returncode:
            state('pending_human_review', cupsProposed=2); return 0
        name = subprocess.run(['zenity', '--entry', '--width=520', '--title=Ojala: revisor del parcial',
                               '--text=Escribe tu nombre como persona que acaba de revisar y confirmar los 2 vasos.'],
                              env=env, capture_output=True, text=True)
        if name.returncode:
            state('pending_human_review', cupsProposed=2); return 0
        approved_at = datetime.now(timezone.utc).isoformat()
        ledger = make_ledger(draft, evidence, name.stdout.strip(), approved_at, draft_sha, manifest_sha)
        validator = module(BASE / 'count-review/review_counts.py', 'review_approval_validation')
        record = validator.export_partial_record(ledger, BASE, approved_at)
        push = module(BASE / 'scripts/frigate_push_counts.py', 'push_approval_validation')
        need(push.validate_record(record, DAY) is None, 'record_validation_failed')
        need(not target.exists(), 'approved_record_already_exists')
        validator.write_new(WORK / 'review-ledger.json', ledger)
        envelope = {'schemaVersion': 1, 'intendedProcedure': 'dashboard.importReviewedCameraCount',
                    'recordJson': json.dumps(record, sort_keys=True)}
        output = DOWNLOADS / 'OJALA_CONTEO_PARCIAL_APROBADO_16OCT.json'
        validator.write_new(output, envelope)
        # Publish to the scheduled sender only once its ledger and import export exist.
        validator.write_new(target, record)
        state('approved_locally_not_uploaded', cupsDetected=2, coverage='partial',
              approvedAt=approved_at, importFile=str(output), ledgerPath=str(WORK / 'review-ledger.json'))
        try:
            subprocess.run(['python3', str(BASE / 'manus-bridge/manus_bridge.py'), 'collect', '--date', DAY],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90)
        except subprocess.SubprocessError:
            pass  # The approved file/ledger remain durable even if collection is interrupted.
        subprocess.Popen(['nautilus', '--select', str(output)], env=env,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(['zenity', '--info', '--width=560', '--text=El parcial de 2 quedó aprobado '
                        'localmente con tu nombre y hora real. El JSON para importar está seleccionado '
                        'en Descargas. Aún falta el acuse del dashboard; no se envió nada a Cloudflare.'], env=env)
        return 0
    except (ValueError, KeyError, OSError, StopIteration, subprocess.SubprocessError):
        state('approval_flow_stopped', reason='validation_or_local_step_failed')
        subprocess.run(['zenity', '--error', '--width=520', '--text=El flujo se detuvo. '
                        'No se enviaron datos. Se conservaron los originales y el estado local para revisión.'], env=env)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
