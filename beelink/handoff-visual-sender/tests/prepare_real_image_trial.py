#!/usr/bin/env python3
"""Stage a local-only real-image validation sample without sending anything.

This is intentionally not the sender. It copies valid image+JSON pairs into a
new isolated directory, verifies the same metadata contract as the sender, and
writes a checksum manifest. It never opens a listener, calls HTTPS, or reads a
queue/database outside the supplied workspace.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import handoff_visual_sender as sender


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare a no-network real-image handoff validation sample")
    parser.add_argument("--snapshot-dir", type=Path, default=sender.VERIFIED_SNAPSHOT_DIR)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=8)
    args = parser.parse_args()

    if args.limit < 1 or args.limit > 25:
        raise SystemExit("--limit must be from 1 to 25")
    if args.workspace.exists():
        raise SystemExit("workspace must not already exist")

    source_root = args.snapshot_dir.resolve(strict=True)
    args.workspace.mkdir(mode=0o700, parents=True)
    staging = args.workspace / "verified_snapshots" / "handoff"
    staging.mkdir(mode=0o700, parents=True)
    selected: list[dict[str, str]] = []
    rejected = 0

    original_root = sender.VERIFIED_SNAPSHOT_DIR
    try:
        sender.VERIFIED_SNAPSHOT_DIR = source_root
        for image in sorted(source_root.iterdir()):
            if len(selected) >= args.limit:
                break
            if not image.is_file() or image.suffix.lower() not in sender.ALLOWED_SUFFIXES:
                continue
            try:
                metadata, digest = sender.event_metadata(image)
                sidecar = sender.sidecar_path(image)
            except sender.SenderError:
                rejected += 1
                continue
            target_image = staging / image.name
            target_sidecar = staging / sidecar.name
            shutil.copy2(image, target_image)
            shutil.copy2(sidecar, target_sidecar)
            target_image.chmod(0o600)
            target_sidecar.chmod(0o600)
            selected.append({
                "cup_event_id": metadata["cup_event_id"],
                "captured_at_utc": metadata["captured_at_utc"],
                "image_sha256": digest,
            })
    finally:
        sender.VERIFIED_SNAPSHOT_DIR = original_root

    manifest = {
        "mode": "isolated_local_validation_only",
        "network_calls": 0,
        "database_connections": 0,
        "prepared_pairs": len(selected),
        "rejected_pairs": rejected,
        "events": selected,
    }
    (args.workspace / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"prepared_pairs": len(selected), "rejected_pairs": rejected}, separators=(",", ":")))
    return 0 if selected else 2


if __name__ == "__main__":
    raise SystemExit(main())
