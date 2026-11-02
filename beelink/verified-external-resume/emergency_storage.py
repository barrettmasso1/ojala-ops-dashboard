"""UUID-bound resumed external agent; preserves pre-recovery evidence and receipts."""
from pathlib import Path
import json,os,shutil,stat,re,subprocess
ROOT=Path('/tmp/externo/home-ojala/ojala-active-evidence-20261017/recovery-debug-20261102/agent')
BASE=Path('/home/ojala/frigate')
UUID='f8073bcd-9193-489c-9546-892e70d66ed1'
MIN_FREE=8*1024**3
MAX_BYTES=256*1024**2
class StorageError(ValueError):pass
def need(ok,message):
    if not ok:raise StorageError(message)
def check_space(free,used,requested):
    need(type(requested) is int and 0<=requested<=32*1024**2,'restored_request_bounds')
    need(free-requested>=MIN_FREE,'external_reserve_8gib')
    need(used+requested<=MAX_BYTES,'agent_quota_256mib')
def check_mount(row):
    need(row.get('target')=='/tmp/externo' and row.get('uuid')==UUID and row.get('fstype')=='ext4','external_filesystem_identity_mismatch')
    opts=set(row.get('options','').split(','))
    need('rw' in opts and 'ro' not in opts and 'shutdown' not in opts,'external_not_writable_or_shutdown')
def source_writer_running(proc=Path('/proc')):
    old='/home/ojala/ojala-emergency-20261031/'
    historic='/tmp/externo/home-ojala/ojala-active-evidence-20261017/'
    components=('local-cup-engine/','native-photo-sender/','local-cup-sizes/','optical-pickup/','directional-counter/','unified-agent/')
    for p in proc.iterdir():
        if not p.name.isdigit():continue
        try:
            for arg in (p/'cmdline').read_bytes().split(b'\0')[1:5]:
                text=arg.decode(errors='replace')
                if text.endswith('.py') and (text.startswith(old) or (text.startswith(historic) and text[len(historic):].startswith(components))):return True
        except (OSError,ValueError):continue
    return False
ATOMIC_STATUS_FILES=frozenset(('ledger-state/health.json.tmp','ledger-state/sync-health.json.tmp','photo-state/health.json.tmp','optical-state/health.json.tmp','metadata-state/health.json.tmp'))
ATOMIC_STATUS_RESERVE=8*1024**2

def known_atomic_output(relative):
    if relative in ATOMIC_STATUS_FILES:return True
    if re.fullmatch(r'(?:ledger-state|optical-state)/[0-9]{4}-[0-9]{2}-[0-9]{2}\.json\.tmp',relative):return True
    return re.fullmatch(r'ledger-state/evidence/[a-f0-9]{64}\.(?:jpg|json)\.tmp',relative) is not None

def allocated_bytes(root):
    root=Path(root);used=0;visited=False
    def scan_error(exc):raise StorageError('emergency_scan_unavailable') from None
    for folder,dirs,files in os.walk(root,followlinks=False,onerror=scan_error):
        visited=True
        for name in dirs+files:
            p=Path(folder)/name
            try:st=p.lstat()
            except FileNotFoundError:
                need(name not in dirs and known_atomic_output(p.relative_to(root).as_posix()),'emergency_unexpected_file_disappeared')
                used+=ATOMIC_STATUS_RESERVE
                continue
            need(not stat.S_ISLNK(st.st_mode),'emergency_symlink_rejected')
            used+=st.st_blocks*512
    need(visited,'emergency_scan_unavailable')
    return used


def verify_emergency(base,target,*,writable=False,required_bytes=0):
    need(Path(base)==BASE,'source_scope')
    need(ROOT.is_dir() and ROOT.resolve()==ROOT and ROOT.stat().st_uid==os.getuid() and ROOT.stat().st_mode&0o077==0,'agent_root_permissions')
    target=Path(target)
    need(target.is_absolute() and target.is_relative_to(ROOT) and target!=ROOT and target.resolve()==target,'agent_target_scope')
    need(not source_writer_running(),'parallel_original_agent_active')
    try:
        r=subprocess.run(['findmnt','-J','-T','/tmp/externo','-o','TARGET,UUID,FSTYPE,OPTIONS,SOURCE'],capture_output=True,text=True,check=True,timeout=3)
        rows=json.loads(r.stdout).get('filesystems',[]);need(len(rows)==1,'external_mount_missing');row=rows[0];check_mount(row)
        device=Path(row['source']).resolve().name
        errors=Path('/sys/fs/ext4')/device/'errors_count'
        need(errors.is_file() and int(errors.read_text().strip())==0,'external_kernel_errors_or_unknown')
        if writable:check_space(shutil.disk_usage(ROOT).free,allocated_bytes(ROOT),required_bytes)
    except StorageError:raise
    except (OSError,ValueError,KeyError,subprocess.SubprocessError):raise StorageError('external_guard_unavailable') from None
    return ROOT
