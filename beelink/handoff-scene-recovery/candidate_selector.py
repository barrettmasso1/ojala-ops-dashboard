#!/usr/bin/env python3
"""Select review-only recovery scenes without creating operational events.

This proposal consumes server-local detector metadata from a separate person
signal in the handoff zone. It deliberately does not use an absent cup event as
proof that nothing happened. Every selected candidate still requires the
existing visual filter to verify person + gelato cup + configured zone before a
manager can review it. The selector never sends a network request, reads a
credential, or changes a count, sale, delivery, inventory, or revenue value.
"""
from __future__ import annotations

from dataclasses import dataclass
from math import floor
from typing import Iterable


@dataclass(frozen=True)
class PersonZoneSignal:
    camera: str
    timestamp_utc: float
    confidence: float
    zones: tuple[str, ...]


@dataclass(frozen=True)
class RecoveryCandidate:
    camera: str
    scene_id: str
    source_timestamp_utc: float
    evidence_origin: str = "recording_extracted_frame"
    requires_visual_filter: bool = True
    requires_manager_review: bool = True
    creates_operational_record: bool = False


@dataclass(frozen=True)
class CandidatePolicy:
    zone_name: str = "handoff_zone"
    minimum_person_confidence: float = 0.60
    scene_bucket_seconds: int = 10


def select_recovery_candidates(
    signals: Iterable[PersonZoneSignal],
    *,
    camera: str,
    policy: CandidatePolicy = CandidatePolicy(),
) -> list[RecoveryCandidate]:
    """Deduplicate in-zone person scenes for the downstream visual filter.

    A signal outside the configured zone or below confidence threshold is never
    selected. The bucket is a review-candidate dedupe boundary only: it does not
    represent a transaction, cup count, or delivery.
    """
    if policy.scene_bucket_seconds < 1:
        raise ValueError("scene_bucket_seconds must be at least one")
    if not 0 < policy.minimum_person_confidence <= 1:
        raise ValueError("minimum_person_confidence must be in (0, 1]")

    selected: dict[int, PersonZoneSignal] = {}
    for signal in signals:
        if signal.camera != camera:
            continue
        if signal.confidence < policy.minimum_person_confidence:
            continue
        if policy.zone_name not in signal.zones:
            continue
        bucket = floor(signal.timestamp_utc / policy.scene_bucket_seconds)
        existing = selected.get(bucket)
        if existing is None or signal.confidence > existing.confidence:
            selected[bucket] = signal

    return [
        RecoveryCandidate(
            camera=camera,
            scene_id=f"recovery-{camera}-{bucket * policy.scene_bucket_seconds:.3f}",
            source_timestamp_utc=signal.timestamp_utc,
        )
        for bucket, signal in sorted(selected.items())
    ]
