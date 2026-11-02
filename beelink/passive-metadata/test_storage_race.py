import os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import emergency_storage as s
class StorageScanTests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);(self.root/'ledger-state').mkdir();(self.root/'photo-state').mkdir()
 def tearDown(self):self.tmp.cleanup()
 def test_real_allocation(self):
  p=self.root/'ledger-state/ledger.sqlite3';p.write_bytes(b'a'*8192);self.assertGreaterEqual(s.allocated_bytes(self.root),p.stat().st_blocks*512)
 def test_empty_root(self):self.assertGreaterEqual(s.allocated_bytes(self.root),0)
 def test_missing_root_is_error(self):
  with self.assertRaises(s.StorageError):s.allocated_bytes(self.root/'absent')
 def test_atomic_renamed_health_is_reserved_not_failed(self):
  for rel in s.ATOMIC_STATUS_FILES:
   p=self.root/rel
   with self.subTest(rel=rel),patch.object(s.os,'walk',return_value=iter([(str(p.parent),[],[p.name])])):self.assertEqual(s.allocated_bytes(self.root),s.ATOMIC_STATUS_RESERVE)
 def test_arbitrary_missing_evidence_rejected(self):
  with patch.object(s.os,'walk',return_value=iter([(str(self.root/'ledger-state'),[],['proof.jpg'])])):
   with self.assertRaisesRegex(s.StorageError,'unexpected_file'):s.allocated_bytes(self.root)
 def test_missing_health_in_wrong_location_rejected(self):
  with patch.object(s.os,'walk',return_value=iter([(str(self.root),[],['health.json.tmp'])])):
   with self.assertRaises(s.StorageError):s.allocated_bytes(self.root)
 def test_regular_health_file_charged(self):
  p=self.root/'ledger-state/health.json.tmp';p.write_bytes(b'actual')
  with patch.object(s.os,'walk',return_value=iter([(str(p.parent),[],[p.name])])):self.assertEqual(s.allocated_bytes(self.root),p.stat().st_blocks*512)
 def test_health_symlink_not_ignored(self):
  p=self.root/'ledger-state/health.json.tmp';p.symlink_to(self.root/'not-there')
  with self.assertRaisesRegex(s.StorageError,'symlink'):s.allocated_bytes(self.root)
 def test_directory_symlink_rejected(self):
  (self.root/'escape').symlink_to('/tmp',target_is_directory=True)
  with self.assertRaisesRegex(s.StorageError,'symlink'):s.allocated_bytes(self.root)
 def test_permission_error_not_ignored(self):
  def denied(*a,**k):k['onerror'](PermissionError('fixture'));return []
  with patch.object(s.os,'walk',side_effect=denied):
   with self.assertRaises(s.StorageError):s.allocated_bytes(self.root)
 def test_disappeared_directory_not_tolerated(self):
  with patch.object(s.os,'walk',return_value=iter([(str(self.root/'ledger-state'),['health.json.tmp'],[])])):
   with self.assertRaises(s.StorageError):s.allocated_bytes(self.root)
 def test_reserve_unchanged(self):
  with self.assertRaises(s.StorageError):s.check_space(s.MIN_FREE-1,0,0)
  s.check_space(s.MIN_FREE,0,0)
 def test_quota_unchanged(self):
  with self.assertRaises(s.StorageError):s.check_space(s.MIN_FREE+32*1024**2,s.MAX_BYTES,1)
 def test_vanished_temporary_still_counts_toward_quota(self):
  with self.assertRaises(s.StorageError):s.check_space(s.MIN_FREE+32*1024**2,s.MAX_BYTES-1+s.ATOMIC_STATUS_RESERVE,0)
 def test_scan_500_simulated_atomic_replacements(self):
  with patch.object(s.os,'walk',side_effect=lambda *a,**k:iter([(str(self.root/'photo-state'),[],['health.json.tmp'])])):
   for _ in range(500):self.assertEqual(s.allocated_bytes(self.root),s.ATOMIC_STATUS_RESERVE)
class AtomicScopeTests(unittest.TestCase):
 def test_date_snapshot_allowed(self):self.assertTrue(s.known_atomic_output('ledger-state/2026-11-01.json.tmp'))
 def test_counter_snapshot_allowed(self):self.assertTrue(s.known_atomic_output('optical-state/2026-11-01.json.tmp'))
 def test_counter_heartbeat_allowed(self):self.assertTrue(s.known_atomic_output('optical-state/health.json.tmp'))
 def test_hashed_evidence_temp_allowed(self):self.assertTrue(s.known_atomic_output('ledger-state/evidence/'+'a'*64+'.jpg.tmp'))
 def test_permanent_evidence_never_ignored(self):self.assertFalse(s.known_atomic_output('ledger-state/evidence/'+'a'*64+'.jpg'))
 def test_arbitrary_paths_rejected(self):
  for name in ['../health.json.tmp','optical-state/../health.json.tmp','ledger-state/../photo-state/health.json.tmp','other/2026-11-01.json.tmp','ledger-state/evidence/random.jpg.tmp','ledger-state/ledger.sqlite3-wal']:
   self.assertFalse(s.known_atomic_output(name))
if __name__=='__main__':unittest.main()

