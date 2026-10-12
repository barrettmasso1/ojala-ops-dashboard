#!/usr/bin/env python3
"""Offline-only replay for missed Frigate handoff scenes.

This tool is intentionally not a Frigate sender. It never imports the visual
sender, opens a network connection, reads API keys, or writes an Ojala database.
It extracts candidate frames only from an operator-supplied evidence archive and
writes a manifest for a manager to review. A later, separate manager-only import
can use a selected frame as `recording_extracted_frame` evidence; that path must
not be called an automatic Frigate success.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024
MAX_EXTRACTED_FILES = 2_000
MAX_EXTRACTED_BYTES = 6 * 1024 * 1024 * 1024
SUPPORTED_VIDEO_SUFFIXES = {".mp4", ".mkv", ".mov", ".avi"}
AUTOMATIC_ORIGIN = "automatic_frigate_capture"
RECOVERY_ORIGIN = "recording_extracted_frame"


class ReplayError(RuntimeError):
    pass


@dataclass(frozen=True)
class Scene:
    scene_id: str
    offset_seconds: float
    source: str
    expected_kind: str
    note: str


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def require_inside(root: Path, candidate: Path) -> Path:
    resolved = candidate.resolve(strict=True)
    try:
        resolved.relative_to(root.resolve(strict=True))
    except ValueError as error:
        raise ReplayError("archive entry escapes the isolated workspace") from error
    return resolved


def safe_extract_archive(archive: Path, destination: Path) -> list[Path]:
    if archive.suffix.lower() != ".zip":
        raise ReplayError("evidence archive must be a .zip file")
    if not archive.is_file() or archive.stat().st_size <= 0 or archive.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ReplayError("evidence archive is missing, empty, or exceeds the safety limit")

    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    extracted: list[Path] = []
    total = 0
    with zipfile.ZipFile(archive) as source:
        infos = source.infolist()
        if len(infos) > MAX_EXTRACTED_FILES:
            raise ReplayError("evidence archive contains too many entries")
        for info in infos:
            candidate = destination / info.filename
            if Path(info.filename).is_absolute() or ".." in Path(info.filename).parts:
                raise ReplayError("evidence archive contains an unsafe path")
            if info.is_dir():
                candidate.mkdir(mode=0o700, parents=True, exist_ok=True)
                continue
            total += info.file_size
            if total > MAX_EXTRACTED_BYTES:
                raise ReplayError("evidence archive expands beyond the safety limit")
            candidate.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with source.open(info) as input_file, candidate.open("xb") as output_file:
                shutil.copyfileobj(input_file, output_file)
            extracted.append(require_inside(destination, candidate))
    return extracted


def load_case_manifest(path: Path) -> dict[str, Any]:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ReplayError("case manifest is unreadable") from error
    if not isinstance(manifest, dict):
        raise ReplayError("case manifest must be a JSON object")
    for field in ("case_id", "camera", "window_local", "automatic_frigate_observations", "recording_only_scene"):
        if field not in manifest:
            raise ReplayError(f"case manifest is missing {field}")
    return manifest


def find_evidence_manifest(extracted: list[Path]) -> Path | None:
    names = {"case_manifest.json", "CASE_MANIFEST.json", "evidence_manifest.json"}
    candidates = [path for path in extracted if path.name in names]
    return candidates[0] if len(candidates) == 1 else None


def find_video(extracted: list[Path]) -> Path:
    videos = [path for path in extracted if path.suffix.lower() in SUPPORTED_VIDEO_SUFFIXES]
    if len(videos) != 1:
        raise ReplayError("evidence archive must contain exactly one source recording for this replay")
    return videos[0]


def parse_scene_offset(window_start: str, scene_time: str) -> float:
    start = datetime.fromisoformat(window_start)
    target = datetime.fromisoformat(scene_time)
    seconds = (target - start).total_seconds()
    if not 0 <= seconds <= 20 * 60:
        raise ReplayError("recording-only scene is outside the allowed replay window")
    return seconds


def ffmpeg_extract(video: Path, offset_seconds: float, destination: Path) -> None:
    command = [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-ss", f"{offset_seconds:.3f}",
        "-i", str(video), "-frames:v", "1", "-q:v", "2", "-y", str(destination),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    if completed.returncode != 0 or not destination.is_file() or destination.stat().st_size <= 0:
        raise ReplayError("ffmpeg could not extract the requested frame")


def build_report(case: dict[str, Any], archive: Path, archive_sha256: str, extracted: list[Path], video: Path, frame: Path, scene: Scene, evidence_manifest: Path | None) -> dict[str, Any]:
    automatic = case["automatic_frigate_observations"]
    recording = case["recording_only_scene"]
    known = case.get("known_result_at_manifest_creation", {})
    return {
        "report_type": "Ojala handoff scene-recovery replay",
        "generated_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "offline_only": True,
        "network_requests": 0,
        "database_writes": 0,
        "case_id": case["case_id"],
        "window_local": case["window_local"],
        "archive": {
            "basename": archive.name,
            "sha256": archive_sha256,
            "extracted_file_count": len(extracted),
            "embedded_manifest": evidence_manifest.name if evidence_manifest else None,
        },
        "automatic_frigate": {
            "cup_tracks": automatic["cup_tracks"],
            "cup_event_ids": automatic["cup_event_ids"],
            "automatic_capture_pairs": automatic["automatic_capture_pairs"],
            "automatic_capture_local_time": automatic["automatic_capture_local_time"],
            "origin": AUTOMATIC_ORIGIN,
            "is_recovery_success": False,
        },
        "recording_extracted_candidate": {
            "scene_id": scene.scene_id,
            "source_recording_basename": video.name,
            "source_recording_sha256": sha256_file(video),
            "frame_basename": frame.name,
            "frame_sha256": sha256_file(frame),
            "offset_seconds": scene.offset_seconds,
            "approximate_local_time": recording["approximate_local_time"],
            "origin": RECOVERY_ORIGIN,
            "automatic_frigate_event": False,
            "automatic_frigate_capture": False,
            "automatic_success": False,
            "requires_manager_review": True,
            "ai_review_executed": False,
            "boxes": [],
            "confidences": [],
            "discard_cause": "not_evaluated_pending_isolated_vision_run",
        },
        "human_reference": case["human_reference"],
        "separate_measures": {
            "operator_reported_cups": case["human_reference"]["operator_reported_medium_gelato_cups_sold"],
            "frigate_tracks": automatic["cup_tracks"],
            "automatic_captures": automatic["automatic_capture_pairs"],
            "recovery_candidates": 1,
            "validated_visible_cups_from_original_evidence": known.get("visible_cups_validated_from_original_image_or_video"),
            "ai_reviews_of_original_evidence": known.get("ai_reviews_executed_against_original_evidence", 0),
        },
        "root_cause": {
            "status": "not_attributed",
            "evidence": "The recording scene is replayed as an isolated candidate, but no detector trace, box log, or original automatic-capture metadata has been evaluated by this tool.",
        },
        "operational_mutations": {
            "frigate_cup_counts": 0,
            "sales": 0,
            "deliveries": 0,
            "inventory": 0,
            "revenue": 0,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Replay one missed handoff scene from a local evidence ZIP without contacting Ojala services")
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--case", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    try:
        case = load_case_manifest(args.case.resolve(strict=True))
        if args.output.exists():
            raise ReplayError("output directory must not already exist")
        with tempfile.TemporaryDirectory(prefix="ojala-handoff-replay-") as temporary:
            isolated = Path(temporary) / "evidence"
            extracted = safe_extract_archive(args.archive.resolve(strict=True), isolated)
            evidence_manifest = find_evidence_manifest(extracted)
            video = find_video(extracted)
            window_start = str(case["window_local"]["start"])
            scene_time = str(case["recording_only_scene"]["approximate_local_time"])
            scene = Scene("recording-scene-170238", parse_scene_offset(window_start, scene_time), str(video), RECOVERY_ORIGIN, str(case["recording_only_scene"]["operator_observation"]))
            args.output.mkdir(mode=0o700, parents=True)
            frame = args.output / "recording-scene-170238.jpg"
            ffmpeg_extract(video, scene.offset_seconds, frame)
            report = build_report(case, args.archive, sha256_file(args.archive), extracted, video, frame, scene, evidence_manifest)
            (args.output / "replay-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
            print(json.dumps({"case_id": case["case_id"], "frame": frame.name, "report": "replay-report.json", "network_requests": 0, "database_writes": 0}, separators=(",", ":")))
        return 0
    except (OSError, ReplayError, KeyError, TypeError, ValueError) as error:
        print(f"handoff scene recovery: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
