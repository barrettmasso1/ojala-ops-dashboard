"""Explicit bounded internal emergency store. Never changes the original SSD guard."""
from pathlib import Path
import json,os,shutil,stat,re
ROOT=Path('/home/ojala/ojala-emergency-20261031')
UUID='49ced009-937f-4a83-bdb7-4365e1925775'
EXTERNAL='f8073bcd-9193-489c-9546-892e70d66ed1'
MIN_FREE=8*1024**3
MAX_BYTES=256*1024**2
class StorageError(ValueError):pass
def need(ok,message):
    if not ok:raise StorageError(message)
def parse_mounts(text):
    result=[]
    for line in text.splitlines():
        left,right=line.split(' - ',1);a,b=left.split(),right.split()
        result.append({'device':a[2],'target':a[4],'type':b[0],'options':set((a[5]+','+b[2]).split(','))})
    return result
def check_space(free,used,requested):
    need(type(requested) is int and 0<=requested<=32*1024**2,'emergency_request_bounds')
    need(free-requested>=MIN_FREE,'emergency_internal_reserve_8gib')
    need(used+requested<=MAX_BYTES,'emergency_quota_256mib')
def check_mounts(rows,internal_device,external_device):
    own=[r for r in rows if r['target']=='/']
    need(len(own)==1 and own[0]['device']==internal_device and own[0]['type']=='ext4' and 'rw' in own[0]['options'] and 'shutdown' not in own[0]['options'],'emergency_internal_identity')
    normal=[r for r in rows if r['target']=='/tmp/externo']
    need(not any(r['device']==external_device and 'rw' in r['options'] and 'shutdown' not in r['options'] for r in normal),'external_restored_reconciliation_required')
def original_process_running(proc=Path('/proc')):
    prefix='/tmp/externo/home-ojala/ojala-active-evidence-20261017/'
    components=('local-cup-engine/','native-photo-sender/','local-cup-sizes/','optical-pickup/','directional-counter/','unified-agent/')
    for p in proc.iterdir():
        if not p.name.isdigit():continue
        try:
            args=(p/'cmdline').read_bytes().split(b'\0')
            for a in args[1:4]:
                t=a.decode(errors='replace')
                if t.startswith(prefix) and t.endswith('.py') and t[len(prefix):].startswith(components):return True
        except (OSError,ValueError):continue
    return False
# Only these atomic status writers may disappear during a quota scan.
# Charge reserved space even when the temporary name was already renamed.
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
    need(Path(base)==Path('/home/ojala/frigate'),'emergency_source_scope')
    need(ROOT.resolve()==ROOT and ROOT.is_dir() and ROOT.stat().st_uid==os.getuid() and ROOT.stat().st_mode&0o077==0,'emergency_root_permissions')
    target=Path(target)
    need(target.is_absolute() and target.is_relative_to(ROOT) and target!=ROOT and target.resolve()==target,'emergency_target_scope')
    need(not original_process_running(),'original_agent_active_no_dual_writer')
    dev=(Path('/dev/disk/by-uuid')/UUID).stat();need(stat.S_ISBLK(dev.st_mode),'emergency_internal_uuid')
    key=f'{os.major(dev.st_rdev)}:{os.minor(dev.st_rdev)}'
    try:
        ext=(Path('/dev/disk/by-uuid')/EXTERNAL).stat();extkey=f'{os.major(ext.st_rdev)}:{os.minor(ext.st_rdev)}'
    except OSError:extkey='absent'
    rows=parse_mounts(Path('/proc/self/mountinfo').read_text());check_mounts(rows,key,extkey)
    if writable:
        used=allocated_bytes(ROOT)
        check_space(shutil.disk_usage(ROOT).free,used,required_bytes)
    return ROOT
