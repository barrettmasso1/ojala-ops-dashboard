#!/usr/bin/env python3
"""Validate a video review ledger; distinguish partial evidence from daily totals.

This is an evidence validator, not an object detector or an automatic reviewer.
Candidate windows can establish a lower bound, never full-day recall.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo('America/Mazatlan')


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def stamp(value, day):
    parsed = dt.datetime.fromisoformat(value)
    require(parsed.tzinfo is not None, 'naive_evidence_timestamp')
    require(parsed.astimezone(TZ).date().isoformat() == day, 'evidence_date_mismatch')
    return parsed


def evaluate(ledger, evidence_root):
    root = evidence_root.resolve()
    day = ledger['businessDate']
    require(dt.date.fromisoformat(day).isoformat() == day, 'invalid_business_date')
    require(ledger.get('storeId') == 1 and ledger.get('cameraName') == 'handoff', 'wrong_camera_or_store')
    require(ledger.get('countBasis') == 'reviewed_unique_physical_cups', 'wrong_count_basis')
    require(isinstance(ledger.get('reviewedBy'), str) and bool(ledger['reviewedBy'].strip()), 'reviewer_missing')
    candidates = ledger['candidateIds']
    require(isinstance(candidates, list) and all(isinstance(x, str) and x for x in candidates)
            and len(candidates) == len(set(candidates)), 'invalid_candidate_universe')
    evidence = {}
    for item in ledger['evidence']:
        key = item['id']
        require(key not in evidence, 'duplicate_evidence_id')
        path = (root / item['path']).resolve()
        require(path.is_relative_to(root) and path.is_file(), 'missing_or_external_evidence')
        require(hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256'], 'evidence_hash_mismatch')
        stamp(item['at'], day)
        evidence[key] = item
    unit_ids = set()
    for unit in ledger['units']:
        key = unit['id']
        require(isinstance(key, str) and bool(key) and key not in unit_ids, 'duplicate_or_invalid_unit')
        unit_ids.add(key)
        require(unit.get('decision') == 'confirmed', 'unconfirmed_unit_in_count')
        require(unit.get('personAndFilledCup') is True and unit.get('inHandoffZone') is True,
                'unit_visual_requirements_missing')
        refs = unit['evidenceIds']
        require(len(set(refs)) >= 2 and set(refs) <= set(evidence), 'unit_temporal_evidence_missing')
        require(len({evidence[x]['at'] for x in refs}) >= 2, 'unit_temporal_evidence_missing')
        require(isinstance(unit.get('identityReason'), str) and bool(unit['identityReason'].strip()),
                'unit_identity_reason_missing')
    seen_candidates, seen_cases, linked_units, pending = set(), set(), set(), []
    allowed = {'counted', 'duplicate', 'returned_or_repacked', 'non_service_container', 'false_positive', 'pending'}
    for case in ledger['cases']:
        require(case['id'] not in seen_cases, 'duplicate_case_id')
        seen_cases.add(case['id'])
        require(case['disposition'] in allowed, 'invalid_case_disposition')
        ids = case['candidateIds']
        require(isinstance(ids, list) and len(ids) == len(set(ids))
                and not (set(ids) & seen_candidates) and set(ids) <= set(candidates), 'candidate_partition_error')
        seen_candidates.update(ids)
        refs = case['evidenceIds']
        require(bool(refs) and set(refs) <= set(evidence), 'case_evidence_missing')
        links = case.get('unitIds', [])
        require(len(links) == len(set(links)) and set(links) <= unit_ids, 'unknown_or_duplicate_unit_link')
        if case['disposition'] in {'counted', 'duplicate'}:
            require(bool(links), 'counted_case_without_unit')
        if case['disposition'] in {'false_positive', 'non_service_container'}:
            require(not links, 'rejected_case_has_counted_unit')
        linked_units.update(links)
        if case['disposition'] == 'pending':
            pending.append(case['id'])
    require(linked_units == unit_ids, 'orphan_unit')
    blockers = []
    if seen_candidates != set(candidates):
        blockers.append('unreviewed_candidates')
    if pending:
        blockers.append('unresolved_visual_cases')
    review = ledger.get('dailyReview', {})
    if review.get('scope') != 'full_operating_window' or review.get('completed') is not True:
        blockers.append('full_operating_window_not_reviewed')
    if ledger.get('coverage') != 'complete' or review.get('gaps') != []:
        blockers.append('incomplete_recording_coverage')
    if ledger.get('status') != 'approved':
        blockers.append('daily_count_not_approved')
    return {'businessDate': day, 'confirmedUniqueCupsInReviewedEvidence': len(unit_ids),
            'candidateCount': len(candidates), 'reviewedCandidateCount': len(seen_candidates),
            'pendingCases': pending, 'verifiedEvidenceFiles': len(evidence),
            'dailyCupCount': len(unit_ids) if not blockers else None,
            'readyForDailyPush': not blockers, 'blockers': blockers,
            'limitations': 'Visual identity is asserted by the named reviewer. Hash checks establish file integrity, not detection accuracy. No POS/manual totals inferred.'}


def export_record(ledger, result):
    require(result['readyForDailyPush'], 'daily_review_not_complete')
    approved_at = ledger.get('approvedAt')
    require(isinstance(approved_at, str), 'approval_timestamp_missing')
    parsed = dt.datetime.fromisoformat(approved_at)
    require(parsed.tzinfo is not None and parsed <= dt.datetime.now(dt.timezone.utc), 'invalid_approval_timestamp')
    return {'businessDate': ledger['businessDate'], 'cameraName': 'handoff', 'storeId': 1,
            'status': 'approved', 'countBasis': ledger['countBasis'],
            'cupsDetected': result['dailyCupCount'], 'uniqueCupIds': sorted(u['id'] for u in ledger['units']),
            'reviewedBy': ledger['reviewedBy'], 'approvedAt': approved_at, 'coverage': 'complete',
            'evidenceReferences': [{'path': e['path'], 'sha256': e['sha256']} for e in ledger['evidence']],
            'ledgerSha256': hashlib.sha256(json.dumps(ledger, sort_keys=True).encode()).hexdigest()}


def export_partial_record(ledger, evidence_root, approved_at):
    # Revalidate the actual ledger and files; do not trust a supplied summary.
    result = evaluate(ledger, evidence_root)
    parsed = dt.datetime.fromisoformat(approved_at)
    require(parsed.tzinfo is not None and parsed <= dt.datetime.now(dt.timezone.utc),
            'invalid_approval_timestamp')
    counted = {uid for case in ledger['cases']
               if case['disposition'] in {'counted', 'duplicate'} for uid in case.get('unitIds', [])}
    ambiguous = {uid for case in ledger['cases']
                 if case['disposition'] not in {'counted', 'duplicate'} for uid in case.get('unitIds', [])}
    selected = counted - ambiguous
    require(bool(selected), 'no_confirmed_partial_units')
    units = [unit for unit in ledger['units'] if unit['id'] in selected]
    refs = {key for unit in units for key in unit['evidenceIds']}
    gaps = list(ledger.get('dailyReview', {}).get('gaps') or [])
    gaps.append('Partial reviewed evidence only; the full-day cup total is unknown.')
    if result['pendingCases']:
        gaps.append('Pending cases excluded: ' + ', '.join(result['pendingCases']))
    if result['reviewedCandidateCount'] < result['candidateCount']:
        gaps.append('Some detection candidates remain unreviewed.')
    return {'businessDate': ledger['businessDate'], 'cameraName': 'handoff', 'storeId': 1,
            'status': 'approved', 'countBasis': ledger['countBasis'],
            'cupsDetected': len(selected), 'uniqueCupIds': sorted(selected),
            'reviewedBy': ledger['reviewedBy'], 'approvedAt': approved_at,
            'coverage': 'partial', 'gapsDescription': ' '.join(gaps),
            'reviewScope': 'confirmed_units_in_partial_evidence',
            'dailyCupCount': None, 'pendingCases': result['pendingCases'],
            'evidenceReferences': [{'path': e['path'], 'sha256': e['sha256']}
                                   for e in ledger['evidence'] if e['id'] in refs],
            'ledgerSha256': hashlib.sha256(json.dumps(ledger, sort_keys=True).encode()).hexdigest()}


def write_new(path, value):
    # Never replace an approved record or a receipt. Reconciliation is explicit.
    with open(path, 'x', encoding='utf-8') as f:
        os.chmod(path, 0o600)
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.write('\n')
        f.flush()
        os.fsync(f.fileno())


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('ledger', type=Path)
    p.add_argument('--evidence-root', type=Path, required=True)
    exports = p.add_mutually_exclusive_group()
    exports.add_argument('--approve-to', type=Path, help='Existing approved_counts directory; blocked unless complete')
    exports.add_argument('--export-partial-to', type=Path,
                         help='Export confirmed units with partial coverage; never a full-day total')
    a = p.parse_args()
    ledger = json.loads(a.ledger.read_text())
    result = evaluate(ledger, a.evidence_root)
    if a.approve_to:
        record = export_record(ledger, result)
        write_new(a.approve_to/(ledger['businessDate']+'.json'), record)
    if a.export_partial_to:
        record = export_partial_record(ledger, a.evidence_root, dt.datetime.now(dt.timezone.utc).isoformat())
        write_new(a.export_partial_to/(ledger['businessDate']+'.json'), record)
        result['partialExport'] = {'cupsDetected': record['cupsDetected'], 'coverage': 'partial',
                                   'dailyCupCount': None, 'posted': False}
    print(json.dumps(result, ensure_ascii=False, indent=2))
