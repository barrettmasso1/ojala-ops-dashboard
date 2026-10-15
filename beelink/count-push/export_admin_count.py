#!/usr/bin/env python3
"""Package an existing reviewed count for authenticated admin import.

No network, API key, new approval, inferred count, or modification of outbox.
The exact canonical bytes match frigate_push_counts.py's record fingerprint.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
from frigate_push_counts import validate_record, approval_timestamp


def export(source, destination):
    record = json.loads(source.read_text())
    day = source.stem
    if not isinstance(record, dict):
        raise ValueError('invalid_reviewed_record')
    error = validate_record(record, day)
    if error:
        raise ValueError(error)
    approval_timestamp(record)
    if any(name in record for name in ('apiKey', 'password', 'secret')):
        raise ValueError('secret_in_record')
    canonical = json.dumps(record, sort_keys=True)
    envelope = {'schemaVersion': 1,
                'intendedProcedure': 'dashboard.importReviewedCameraCount',
                'recordJson': canonical}
    content = json.dumps(envelope, ensure_ascii=False, indent=2) + '\n'
    if len(content.encode()) > 256 * 1024:
        raise ValueError('import_too_large')
    with destination.open('x', encoding='utf-8') as output:
        os.chmod(destination, 0o600)
        output.write(content)
        output.flush()
        os.fsync(output.fileno())
    return {'businessDate': day, 'cupsDetected': record['cupsDetected'],
            'coverage': record['coverage'], 'recordSha256': hashlib.sha256(canonical.encode()).hexdigest(),
            'path': str(destination), 'posted': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    print(json.dumps(export(args.source, args.destination)))
