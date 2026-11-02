import unittest,tempfile,json,os
from pathlib import Path
from unittest.mock import patch
import emergency_storage as s
class GuardTests(unittest.TestCase):
 def row(self,**kw):return {'target':'/tmp/externo','uuid':s.UUID,'fstype':'ext4','options':'rw,relatime',**kw}
 def test_expected_mount(self):s.check_mount(self.row())
 def test_wrong_uuid(self):
  with self.assertRaises(s.StorageError):s.check_mount(self.row(uuid='other'))
 def test_readonly(self):
  with self.assertRaises(s.StorageError):s.check_mount(self.row(options='ro,relatime'))
 def test_shutdown(self):
  with self.assertRaises(s.StorageError):s.check_mount(self.row(options='rw,shutdown'))
 def test_wrong_mount(self):
  with self.assertRaises(s.StorageError):s.check_mount(self.row(target='/'))
 def test_wrong_filesystem(self):
  with self.assertRaises(s.StorageError):s.check_mount(self.row(fstype='tmpfs'))
 def test_free_reserve(self):
  with self.assertRaises(s.StorageError):s.check_space(s.MIN_FREE-1,0,0)
 def test_quota(self):
  with self.assertRaises(s.StorageError):s.check_space(s.MIN_FREE+1024,s.MAX_BYTES,1)
 def test_request_limit(self):
  with self.assertRaises(s.StorageError):s.check_space(s.MIN_FREE+1024**3,0,33*1024**2)
 def test_expected_temporary_scope(self):
  self.assertTrue(s.known_atomic_output('ledger-state/health.json.tmp'));self.assertFalse(s.known_atomic_output('ledger-state/ledger.sqlite3-wal'))
 def test_current_allocation(self):
  with tempfile.TemporaryDirectory() as temp:
   p=Path(temp)/'proof';p.write_bytes(b'a'*8192);self.assertGreaterEqual(s.allocated_bytes(Path(temp)),p.stat().st_blocks*512)
 def test_scan_symlink_rejected(self):
  with tempfile.TemporaryDirectory() as temp:
   (Path(temp)/'escape').symlink_to('/tmp')
   with self.assertRaises(s.StorageError):s.allocated_bytes(Path(temp))
 def test_old_writer_detected(self):
  with tempfile.TemporaryDirectory() as temp:
   p=Path(temp)/'123';p.mkdir();(p/'cmdline').write_bytes(b'python3\0/home/ojala/ojala-emergency-20261031/ledger-code/collector.py\0');self.assertTrue(s.source_writer_running(Path(temp)))
 def test_restored_writer_allowed(self):
  with tempfile.TemporaryDirectory() as temp:
   p=Path(temp)/'123';p.mkdir();(p/'cmdline').write_bytes(('python3\0'+str(s.ROOT)+'/ledger-code/collector.py\0').encode());self.assertFalse(s.source_writer_running(Path(temp)))
if __name__=='__main__':unittest.main()
