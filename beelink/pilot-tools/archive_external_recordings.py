#!/usr/bin/env python3
"""Apply a bounded external-only video retention quota without deleting evidence."""
import argparse,json
from pathlib import Path
from archive_recordings import archive_once,verify_storage,BASE,MIN_FREE
GiB=1024**3

def apply_capacity(root=BASE):
    policy=json.loads((root/'pilot-tools/archive-capacity.json').read_text())
    cap=policy.get('maxArchiveGiB');reserve=policy.get('minimumFreeGiB')
    if type(cap) is not int or not 16<=cap<=128 or type(reserve) is not int or reserve!=8 or MIN_FREE!=8*GiB:raise ValueError('invalid_bounded_archive_policy')
    storage=root/'pilot-tools/archive-storage.json'
    if not storage.is_file() or storage.is_symlink():raise ValueError('external_archive_config_required')
    cfg=json.loads(storage.read_text())
    if not policy.get('filesystemUuid') or cfg.get('filesystemUuid')!=policy['filesystemUuid']:raise ValueError('archive_policy_uuid_mismatch')
    archive=root/'pilot-archive/forward-20260929'
    verify_storage(root,archive)
    return archive_once(root,max_bytes=cap*GiB,min_free=reserve*GiB)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,default=BASE);a=p.parse_args()
    try:result=apply_capacity(a.root)
    except (OSError,ValueError,KeyError) as exc:result={'status':'paused_storage_policy','errorType':type(exc).__name__,'automatic_deletion':False}
    print(json.dumps(result),flush=True)
    return 0 if result['status'] in ('ok','already_running','catching_up') else 2
if __name__=='__main__':raise SystemExit(main())
