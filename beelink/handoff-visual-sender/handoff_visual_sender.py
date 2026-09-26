#!/usr/bin/env python3
"""Persistent, local-only sender for verified Frigate handoff snapshots.

This process intentionally reads only VERIFIED_SNAPSHOT_DIR. It does not inspect
or publish automatic snapshot folders, Frigate tracks, or video clips.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

VERIFIED_SNAPSHOT_DIR = Path("/home/ojala/frigate/config/verified_snapshots/handoff")
ALLOWED_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
MIME_BY_SUFFIX = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
MAX_IMAGE_BYTES = 8 * 1024 * 1024
BACKOFF_START_SECONDS = 60
BACKOFF_MAX_SECONDS = 60 * 60


class SenderError(RuntimeError):
    pass


class AwaitingMetadata(SenderError):
    """A verified image is retained locally until its required JSON sidecar appears."""


EVENT_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")


def now_epoch() -> int:
    return int(time.time())


def utc_timestamp(epoch_seconds: float) -> str:
    return datetime.fromtimestamp(epoch_seconds, tz=UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def business_date(epoch_seconds: float) -> str:
    return datetime.fromtimestamp(epoch_seconds, tz=ZoneInfo("America/Mazatlan")).date().isoformat()


def load_config(path: Path) -> dict[str, Any]:
    config = json.loads(path.read_text(encoding="utf-8"))
    for field in ("endpoint", "api_key_env"):
        if not isinstance(config.get(field), str) or not config[field].strip():
            raise SenderError(f"config field {field!r} is required")
    if not config["endpoint"].startswith("https://"):
        raise SenderError("endpoint must use HTTPS")
    return config


def open_queue(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS verified_snapshot_queue (
          cup_event_id TEXT PRIMARY KEY,
          source_path TEXT NOT NULL UNIQUE,
          camera_name TEXT NOT NULL,
          business_date TEXT NOT NULL,
          captured_at TEXT NOT NULL,
          image_sha256 TEXT NOT NULL,
          capture_metadata_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('queued', 'retry', 'sent')),
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL,
          last_error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
        """
    )
    columns = {row[1] for row in connection.execute("PRAGMA table_info(verified_snapshot_queue)")}
    if "capture_metadata_json" not in columns:
        connection.execute("ALTER TABLE verified_snapshot_queue ADD COLUMN capture_metadata_json TEXT")
    return connection


def has_expected_image_signature(image_path: Path) -> bool:
    prefix = image_path.read_bytes()[:12]
    suffix = image_path.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        return prefix.startswith(b"\xff\xd8\xff")
    if suffix == ".png":
        return prefix.startswith(b"\x89PNG\r\n\x1a\n")
    return len(prefix) >= 12 and prefix[:4] == b"RIFF" and prefix[8:12] == b"WEBP"


def require_verified_path(candidate: Path) -> Path:
    root = VERIFIED_SNAPSHOT_DIR.resolve(strict=True)
    resolved = candidate.resolve(strict=True)
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise SenderError("refusing a snapshot outside the verified handoff directory") from error
    if resolved.suffix.lower() not in ALLOWED_SUFFIXES:
        raise SenderError("refusing a non-image file")
    size = resolved.stat().st_size
    if size <= 0 or size > MAX_IMAGE_BYTES:
        raise SenderError("refusing an empty or oversized verified snapshot")
    if not has_expected_image_signature(resolved):
        raise SenderError("refusing a corrupt verified snapshot")
    return resolved


def sidecar_path(image_path: Path) -> Path:
    candidates = [
        image_path.with_suffix(image_path.suffix + ".json"),
        image_path.with_suffix(".json"),
    ]
    for candidate in candidates:
        if candidate.exists():
            root = VERIFIED_SNAPSHOT_DIR.resolve(strict=True)
            resolved = candidate.resolve(strict=True)
            try:
                resolved.relative_to(root)
            except ValueError as error:
                raise SenderError("refusing metadata outside the verified handoff directory") from error
            if not resolved.is_file() or resolved.stat().st_size > 64 * 1024:
                raise SenderError("refusing invalid verified snapshot metadata")
            return resolved
    raise AwaitingMetadata("verified image is awaiting its required JSON sidecar")


def parse_sidecar_metadata(image_path: Path, image_digest: str) -> dict[str, Any]:
    try:
        parsed = json.loads(sidecar_path(image_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SenderError("verified snapshot metadata is unreadable") from error
    if not isinstance(parsed, dict):
        raise SenderError("verified snapshot metadata must be a JSON object")

    camera = parsed.get("camera")
    cup_zone = parsed.get("cup_zone")
    cup_event_id = parsed.get("cup_event_id")
    captured_at_utc = parsed.get("captured_at_utc")
    image_sha256 = parsed.get("image_sha256")
    if camera != "handoff" or cup_zone != "handoff_zone":
        raise SenderError("verified snapshot metadata camera or cup_zone is invalid")
    if not isinstance(cup_event_id, str) or not EVENT_ID_PATTERN.fullmatch(cup_event_id):
        raise SenderError("verified snapshot metadata cup_event_id is invalid")
    if not isinstance(image_sha256, str) or not SHA256_PATTERN.fullmatch(image_sha256) or image_sha256 != image_digest:
        raise SenderError("verified snapshot metadata image_sha256 does not match the image")
    if not isinstance(captured_at_utc, str) or not captured_at_utc.endswith("Z"):
        raise SenderError("verified snapshot metadata captured_at_utc is invalid")
    try:
        captured = datetime.fromisoformat(captured_at_utc.replace("Z", "+00:00"))
    except ValueError as error:
        raise SenderError("verified snapshot metadata captured_at_utc is invalid") from error
    if captured.tzinfo is None or captured.utcoffset() != UTC.utcoffset(captured):
        raise SenderError("verified snapshot metadata captured_at_utc must be UTC")
    return {
        "camera": camera,
        "cup_zone": cup_zone,
        "cup_event_id": cup_event_id,
        "captured_at_utc": captured.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "image_sha256": image_sha256,
    }


def event_metadata(image_path: Path) -> tuple[dict[str, Any], str]:
    verified = require_verified_path(image_path)
    contents = verified.read_bytes()
    digest = hashlib.sha256(contents).hexdigest()
    return parse_sidecar_metadata(verified, digest), digest


def enqueue_verified_snapshot(connection: sqlite3.Connection, image_path: Path) -> bool:
    verified = require_verified_path(image_path)
    metadata, digest = event_metadata(verified)
    captured_epoch = datetime.fromisoformat(metadata["captured_at_utc"].replace("Z", "+00:00")).timestamp()
    now = now_epoch()
    cursor = connection.execute(
        """
        INSERT OR IGNORE INTO verified_snapshot_queue
          (cup_event_id, source_path, camera_name, business_date, captured_at, image_sha256, capture_metadata_json, status, attempts, next_attempt_at, created_at, updated_at)
        VALUES (?, ?, 'handoff', ?, ?, ?, ?, 'queued', 0, ?, ?, ?)
        """,
        (metadata["cup_event_id"], str(verified), business_date(captured_epoch), metadata["captured_at_utc"], digest, json.dumps(metadata, separators=(",", ":")), now, now, now),
    )
    connection.commit()
    return cursor.rowcount == 1


def discover_verified_snapshots(connection: sqlite3.Connection) -> tuple[int, int]:
    root = VERIFIED_SNAPSHOT_DIR.resolve(strict=True)
    added = 0
    awaiting_metadata = 0
    for path in sorted(root.iterdir()):
        if not path.is_file() or path.suffix.lower() not in ALLOWED_SUFFIXES:
            continue
        try:
            added += int(enqueue_verified_snapshot(connection, path))
        except AwaitingMetadata:
            awaiting_metadata += 1
        except SenderError:
            continue
    return added, awaiting_metadata


def backoff_seconds(attempts: int) -> int:
    return min(BACKOFF_MAX_SECONDS, BACKOFF_START_SECONDS * 2 ** min(max(attempts - 1, 0), 6))


def build_payload(row: sqlite3.Row, api_key: str) -> dict[str, Any]:
    image_path = require_verified_path(Path(row["source_path"]))
    image_bytes = image_path.read_bytes()
    image_sha256 = hashlib.sha256(image_bytes).hexdigest()
    if image_sha256 != row["image_sha256"]:
        raise SenderError("verified image bytes changed after queueing")
    try:
        capture = json.loads(row["capture_metadata_json"])
    except (TypeError, json.JSONDecodeError) as error:
        raise SenderError("queued capture metadata is invalid") from error
    if not isinstance(capture, dict) or capture.get("image_sha256") != image_sha256:
        raise SenderError("queued capture metadata no longer matches the image")
    suffix = image_path.suffix.lower()
    image_data_url = f"data:{MIME_BY_SUFFIX[suffix]};base64," + base64.b64encode(image_bytes).decode("ascii")
    return {
        "apiKey": api_key,
        "imageDataUrl": image_data_url,
        "capture": capture,
        "sourceDetail": "verified_snapshot_sender",
    }


def find_status(value: Any) -> str | None:
    if isinstance(value, dict):
        status = value.get("status")
        if isinstance(status, str):
            return status
        for child in value.values():
            found = find_status(child)
            if found:
                return found
    if isinstance(value, list):
        for child in value:
            found = find_status(child)
            if found:
                return found
    return None


def find_retryable(value: Any) -> bool | None:
    if isinstance(value, dict):
        retryable = value.get("retryable")
        if isinstance(retryable, bool):
            return retryable
        for child in value.values():
            found = find_retryable(child)
            if found is not None:
                return found
    if isinstance(value, list):
        for child in value:
            found = find_retryable(child)
            if found is not None:
                return found
    return None


def post_snapshot(endpoint: str, payload: dict[str, Any]) -> tuple[str, bool]:
    body = json.dumps({"0": {"json": payload}}, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        endpoint.rstrip("/") + "/api/trpc/frigate.submitHandoffVisual?batch=1",
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            decoded = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise SenderError(f"remote HTTP {error.code}") from error
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise SenderError("remote request failed") from error

    status = find_status(decoded)
    if status not in {"pending_review", "approved_by_ai", "discarded", "approved_by_manager", "discarded_by_manager"}:
        raise SenderError("remote response did not contain a recognized visual status")
    retryable = find_retryable(decoded)
    if retryable is None:
        raise SenderError("remote response did not contain retry guidance")
    return status, retryable


def send_due_snapshots(connection: sqlite3.Connection, endpoint: str, api_key: str, limit: int = 20) -> dict[str, int]:
    now = now_epoch()
    rows = connection.execute(
        """
        SELECT * FROM verified_snapshot_queue
        WHERE status IN ('queued', 'retry') AND next_attempt_at <= ?
        ORDER BY next_attempt_at, created_at
        LIMIT ?
        """,
        (now, limit),
    ).fetchall()
    result = {"sent": 0, "retry": 0, "skipped": 0}
    for row in rows:
        try:
            status, retryable = post_snapshot(endpoint, build_payload(row, api_key))
            attempts = int(row["attempts"]) + 1
            if retryable:
                connection.execute(
                    "UPDATE verified_snapshot_queue SET status = 'retry', attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ? WHERE cup_event_id = ?",
                    (attempts, now + backoff_seconds(attempts), "remote review/analysis pending", now, row["cup_event_id"]),
                )
                result["retry"] += 1
            else:
                connection.execute(
                    "UPDATE verified_snapshot_queue SET status = 'sent', attempts = ?, next_attempt_at = ?, last_error = NULL, updated_at = ? WHERE cup_event_id = ?",
                    (attempts, now, now, row["cup_event_id"]),
                )
                result["sent"] += 1
        except (OSError, SenderError):
            attempts = int(row["attempts"]) + 1
            connection.execute(
                "UPDATE verified_snapshot_queue SET status = 'retry', attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ? WHERE cup_event_id = ?",
                (attempts, now + backoff_seconds(attempts), "send deferred", now, row["cup_event_id"]),
            )
            result["retry"] += 1
    connection.commit()
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Queue and send only verified Frigate handoff snapshots")
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--queue", type=Path, default=Path("./state/handoff-visual-queue.sqlite3"))
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()

    try:
        config = load_config(args.config)
        api_key = os.environ.get(config["api_key_env"], "")
        if not api_key:
            raise SenderError(f"missing API key environment variable {config['api_key_env']}")
        connection = open_queue(args.queue)
        discovered, awaiting_metadata = discover_verified_snapshots(connection)
        outcome = send_due_snapshots(connection, config["endpoint"], api_key, max(1, min(args.limit, 100)))
        print(json.dumps({"discovered": discovered, "awaiting_metadata": awaiting_metadata, **outcome}, separators=(",", ":")))
        return 0
    except (OSError, SenderError) as error:
        print(f"handoff visual sender: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
