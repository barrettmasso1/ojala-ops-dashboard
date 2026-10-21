#!/usr/bin/env python3
"""Archive acknowledged packages only, with a UUID guard and durable audit trail."""
import fcntl, hashlib, json, os, shutil, sqlite3, sys, tempfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
BASE=Path('/home/ojala/frigate')
sys.path.insert(0,str(BASE/'manus-bridge'))


def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()

def sync_dir(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)

def run(base=BASE):
    import manus_bridge as b
    from package_storage import external_root,verify_external,StorageError
    state=base/'manus-bridge/state'
    _,root,_=external_root(base)
    dest=root/'manus-bridge-packages'
    # Crucially before mkdir, opening any DB, or deleting a source.
    verify_external(base,dest,writable=True)
    with (state/'worker.lock').open('a') as lock:
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: return {'status':'already_running'}
        db=sqlite3.connect(state/'queue.sqlite3'); db.row_factory=sqlite3.Row
        items=[]; released=0
        try:
            rows=db.execute("SELECT * FROM batches WHERE status IN ('admin_receipt_verified','covered_by_verified_batch') ORDER BY rowid").fetchall()
            for row in rows:
                src=b.package_path(row,state); target=dest/(row['id']+'.zip')
                if sha(src)!=row['sha256']: raise StorageError('source_package_hash_mismatch')
                if src==target:
                    items.append({'batchId':row['id'],'status':'already_external_verified'})
                    continue
                size=src.stat().st_size
                verify_external(base,target,writable=True,required_bytes=size)
                dest.mkdir(parents=True,exist_ok=True,mode=0o700)
                if target.exists():
                    if sha(target)!=row['sha256']: raise StorageError('external_package_conflict')
                else:
                    fd,tempname=tempfile.mkstemp(prefix=row['id']+'.',suffix='.part',dir=dest)
                    part=Path(tempname)
                    try:
                        with src.open('rb') as inp,os.fdopen(fd,'wb') as out:
                            shutil.copyfileobj(inp,out,1024*1024); out.flush(); os.fsync(out.fileno())
                        if sha(part)!=row['sha256']: raise StorageError('external_copy_hash_mismatch')
                        os.replace(part,target);sync_dir(dest)
                    finally:
                        if part.exists(): part.unlink()
                # Persist the new location before removing the redundant local copy.
                db.execute('UPDATE batches SET path=? WHERE id=? AND path=?',
                           (str(target),row['id'],str(src)));db.commit()
                verify_external(base,target)
                if sha(src)!=row['sha256'] or sha(target)!=row['sha256']:
                    raise StorageError('copy_changed_before_cleanup')
                src.unlink();sync_dir(src.parent);released+=size
                items.append({'batchId':row['id'],'status':'archived_verified','bytes':size})
        finally: db.close()
    now=datetime.now(ZoneInfo('America/Mazatlan'))
    result={'schemaVersion':2,'checkedAt':now.isoformat(),'status':'ok',
            'packagesMoved':sum(x['status']=='archived_verified' for x in items),
            'bytesFreedInternal':released,'packages':items,'receiptsPreserved':True,
            'mountIdentityVerified':True,'minimumFreeGiB':8}
    folder=base/'pilot-reports'/now.date().isoformat()/'package-archive-runs'
    folder.mkdir(parents=True,exist_ok=True,mode=0o700)
    report=folder/(now.strftime('%H%M%S%f')+'.json')
    b.private_json(report,result)
    result['report']=str(report)
    return result

if __name__=='__main__':
    os.umask(0o077)
    try: print(json.dumps(run()))
    except Exception as exc:
        # Do not print keys, private file content, URLs, or raw exception strings.
        print(json.dumps({'status':'blocked','reason':getattr(exc,'code','archive_validation_failed'),'errorType':type(exc).__name__}))
        raise SystemExit(2)
