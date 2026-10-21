"""Narrow, UUID-bound storage checks shared by Ojala readers and archivers."""
import json, os, re, shutil, subprocess
from pathlib import Path

MIN_FREE = 8 * 1024**3
MAX_OFFLINE_C = 85.0

class StorageError(ValueError):
    def __init__(self, code):
        self.code=code
        super().__init__(code)

def must(ok, code):
    if not ok: raise StorageError(code)

def external_root(base):
    try:
        data=json.loads((Path(base)/'pilot-tools/session-storage.json').read_text())
        mount=Path(data['mountPoint']); session=Path(data['sessionRootPath'])
        must(mount.is_absolute() and session.is_absolute() and session.is_relative_to(mount)
             and session.parent!=mount,'invalid_external_storage_config')
        must(isinstance(data.get('filesystemUuid'),str) and bool(data['filesystemUuid']),
             'missing_external_uuid')
        return mount,session.parent,data['filesystemUuid']
    except (KeyError, OSError, TypeError, json.JSONDecodeError):
        raise StorageError('external_storage_config_unavailable') from None

def verify_external(base, target, *, writable=False, required_bytes=0):
    mount,root,uuid=external_root(base)
    must(os.path.ismount(mount),'external_mount_missing')
    target=Path(target)
    must(target.is_absolute() and target.is_relative_to(root) and target!=root,
         'external_destination_outside_evidence_root')
    must(target.resolve()==target and root.resolve()==root,'external_path_symlink')
    try:
        result=subprocess.run(['findmnt','-J','-T',str(mount),'-o','TARGET,UUID'],
                check=True,capture_output=True,text=True,timeout=3)
        rows=json.loads(result.stdout).get('filesystems',[])
        must(len(rows)==1 and rows[0].get('target')==str(mount)
             and rows[0].get('uuid')==uuid,'external_filesystem_identity_mismatch')
        if writable:
            must(required_bytes>=0 and shutil.disk_usage(mount).free-required_bytes>=MIN_FREE,
                 'external_free_space_below_reserve')
    except (OSError,subprocess.SubprocessError,ValueError) as exc:
        if isinstance(exc,StorageError): raise
        raise StorageError('external_mount_check_failed') from None
    return root

def resolve_package_path(row,state):
    """Only immutable batch-name ZIPs under state or the UUID-bound archive."""
    state=Path(state).resolve(strict=True)
    bid=row['id']; candidate=Path(row['path'])
    must(isinstance(bid,str) and re.fullmatch('[a-f0-9]{64}',bid) is not None,'invalid_batch_id')
    must(candidate.name==bid+'.zip' and candidate.is_absolute(),'package_path_name_mismatch')
    must(not candidate.is_symlink(),'package_symlink_rejected')
    try: resolved=candidate.resolve(strict=True)
    except OSError: raise StorageError('package_missing') from None
    must(resolved.is_file(),'package_not_file')
    if resolved.parent==state and candidate.parent.resolve()==state:
        return resolved
    base=state.parent.parent
    _,root,_=external_root(base)
    expected=root/'manus-bridge-packages'/(bid+'.zip')
    must(candidate==expected and resolved==expected,'external_source_path')
    verify_external(base,expected)
    return resolved

def temperature_c():
    values=[]
    for p in Path('/sys/class/hwmon').glob('hwmon*/temp*_input'):
        try:
            v=float(p.read_text().strip())/1000
            if 0<v<150: values.append(v)
        except (ValueError,OSError): pass
    return max(values) if values else None

def offline_preflight(base):
    try:
        r=subprocess.run(['docker','inspect','frigate','--format','{{.State.Running}}'],
                          capture_output=True,text=True,timeout=3,check=True)
        must(r.stdout.strip()=='false','offline_scan_blocked_frigate_running')
    except (OSError,subprocess.SubprocessError):
        raise StorageError('frigate_state_unavailable') from None
    t=temperature_c()
    must(t is not None,'temperature_unavailable')
    must(t<MAX_OFFLINE_C,'offline_scan_paused_high_temperature')
    must(shutil.disk_usage(base).free>=MIN_FREE,'internal_free_space_below_reserve')
    return {'temperatureC':t,'frigateRunning':False}

def snapshot_atomic(source,destination):
    """Use SQLite backup; an interrupted destination is never reused as valid."""
    import sqlite3,tempfile
    from contextlib import closing
    source=Path(source);destination=Path(destination)
    if destination.exists():
        with closing(sqlite3.connect(destination.resolve().as_uri()+'?mode=ro',uri=True)) as check:
            must(check.execute('PRAGMA quick_check').fetchone()[0]=='ok','snapshot_integrity_failed')
        return
    src=sqlite3.connect(source.resolve().as_uri()+'?mode=ro',uri=True)
    destination.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd,name=tempfile.mkstemp(prefix=destination.name+'.',suffix='.part',dir=destination.parent);os.close(fd)
    temp=Path(name)
    try:
        out=sqlite3.connect(temp)
        try:
            src.backup(out)
            must(out.execute('PRAGMA integrity_check').fetchone()[0]=='ok','snapshot_integrity_failed')
            out.execute('PRAGMA journal_mode=DELETE');out.commit()
        finally:out.close()
        with temp.open('rb') as f:os.fsync(f.fileno())
        os.replace(temp,destination)
        d=os.open(destination.parent,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(d)
        finally:os.close(d)
    finally:
        src.close()
        if temp.exists():temp.unlink()
