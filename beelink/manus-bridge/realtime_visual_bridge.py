#!/usr/bin/env python3
"""Stage small incremental visual-evidence batches for the supported Manus bridge.

This replaces the blocked direct Frigate POST operationally. It never creates a
physical-cup count, never changes sales/inventory, and performs no network I/O.
The existing authenticated bridge sender and receipt collector remain the only
network path.
"""
import argparse
from datetime import datetime
import fcntl
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import zipfile
from zoneinfo import ZoneInfo

import manus_bridge as b

TZ = ZoneInfo("America/Mazatlan")
ACTIVE = {"queued", "retry", "dispatching", "awaiting_dashboard_receipt", "delivery_unknown", "blocked"}
TERMINAL_COVERED = {"admin_receipt_verified", "covered_by_verified_batch"}


def atomic_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(value, f, ensure_ascii=False, indent=2)
            f.flush(); os.fsync(f.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def manifest_event_ids(path: Path):
    try:
        with zipfile.ZipFile(path) as z:
            manifest = json.loads(z.read("manifest.json"))
        return {e["cupEventId"] for e in manifest.get("events", []) if isinstance(e.get("cupEventId"), str)}
    except (OSError, ValueError, KeyError, zipfile.BadZipFile):
        return set()


def covered_and_active(db, state: Path, day: str):
    covered, active = set(), []
    rows = db.execute("SELECT * FROM batches WHERE day=? ORDER BY rowid", (day,)).fetchall()
    for row in rows:
        status = row["status"]
        from receipt_collector import package_manifest
        manifest = package_manifest(row, state)
        ids = {event['cupEventId'] for event in manifest['events']}
        # Any staged batch owns its event IDs. Retries must reuse that immutable
        # package rather than creating overlapping new packages.
        covered.update(ids)
        if status in ACTIVE:
            active.append({"batchId": row["id"], "status": status, "lastError": row["last_error"]})
    hold = db.execute("SELECT value FROM controls WHERE key='api_auth_hold'").fetchone()
    return covered, active, hold[0] if hold else None


def event_file_names(event):
    names = {event["image"], event["metadata"]}
    names.update(s["path"] for s in event.get("segments", []) if isinstance(s.get("path"), str))
    return names


def build_subset(manifest, files, selected):
    names = set()
    for event in selected:
        names.update(event_file_names(event))
    subset_files = {name: files[name] for name in sorted(names)}
    subset = dict(manifest)
    subset.update({
        "transport": "manus_official_api_realtime_visual",
        "events": selected,
        "countRecordIncluded": False,
        "countRecord": None,
        "cupsDetected": None,
        "incrementalVisualBatch": True,
        "selectedEventIds": [e["cupEventId"] for e in selected],
        "limitations": [
            "Incremental visual evidence only; not a unique physical-cup count.",
            "Dashboard receipt is required before this batch is final.",
            "Daily count remains post-close and deduplicated separately."
        ],
    })
    subset["files"] = [{"path": name, "sha256": b.digest(data), "bytes": len(data)}
                       for name, data in sorted(subset_files.items())]
    b.require(sum(len(v) for v in subset_files.values()) <= b.MAX_PACKAGE, "package_too_large")
    return subset, subset_files


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--date", default=datetime.now(TZ).date().isoformat())
    ap.add_argument("--base", type=Path, default=b.BASE)
    ap.add_argument("--max-events", type=int, default=5)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="Allow an explicit historical/non-operating date")
    args = ap.parse_args()
    b.require(1 <= args.max_events <= 10, "invalid_batch_size")
    parsed = datetime.strptime(args.date, "%Y-%m-%d").date()
    if not args.force and parsed.weekday() not in (4, 5, 6):
        result = {"status": "skipped_non_operating_day", "businessDate": args.date}
        print(json.dumps(result)); return

    state = args.base/"manus-bridge/state"
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    status_path = state/"realtime-visual-status.json"
    with (state/"worker.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            result = {"status": "already_running", "businessDate": args.date}
            atomic_json(status_path, result); print(json.dumps(result)); return
        db = b.queue_db(state)
        try:
            covered, active, api_hold = covered_and_active(db, state, args.date)
        finally:
            db.close()
        if api_hold:
            result = {"status": "api_auth_hold", "businessDate": args.date, "reason": api_hold}
            atomic_json(status_path, result); print(json.dumps(result)); return
        if active:
            result = {"status": "waiting_for_existing_batch", "businessDate": args.date,
                      "active": active, "coveredEventIds": len(covered)}
            atomic_json(status_path, result); print(json.dumps(result)); return
        try:
            manifest, files = b.assemble(args.date, args.base, include_count=False, exclude_event_ids=covered, max_events=args.max_events)
        except b.BridgeError as e:
            if str(e) == "no_verified_evidence_for_date":
                result = {"status": "no_new_evidence", "businessDate": args.date,
                          "coveredEventIds": len(covered)}
                atomic_json(status_path, result); print(json.dumps(result)); return
            raise
        unseen = [e for e in manifest["events"] if e["cupEventId"] not in covered]
        unseen.sort(key=lambda e: e["capturedAt"])
        selected = unseen[:args.max_events]
        if not selected:
            result = {"status": "no_new_evidence", "businessDate": args.date,
                      "availableEvents": len(manifest["events"]), "coveredEventIds": len(covered)}
            atomic_json(status_path, result); print(json.dumps(result)); return
        subset, subset_files = build_subset(manifest, files, selected)
        if args.dry_run:
            result = {"status": "dry_run_ready", "businessDate": args.date,
                      "newEvents": len(unseen), "selectedEvents": len(selected),
                      "eventIds": subset["selectedEventIds"],
                      "packageBytes": sum(len(v) for v in subset_files.values())}
        else:
            staged = b.stage(subset, subset_files, state)
            result = {"status": staged["status"], "businessDate": args.date,
                      "newEvents": len(unseen), "selectedEvents": len(selected),
                      "eventIds": subset["selectedEventIds"], **staged,
                      "directFrigateVerified": False,
                      "dashboardReceived": staged["status"] == "admin_receipt_verified"}
        result["checkedAt"] = datetime.now(TZ).isoformat()
        atomic_json(status_path, result)
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except b.BridgeError as e:
        print(json.dumps({"status": "blocked", "reason": str(e), "dashboardReceived": False}))
        raise SystemExit(2)
