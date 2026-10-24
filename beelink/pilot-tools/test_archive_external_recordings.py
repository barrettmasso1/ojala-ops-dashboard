import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import archive_external_recordings as a
class ExternalCapacityTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);(self.root/'pilot-tools').mkdir();self.policy={'maxArchiveGiB':32,'minimumFreeGiB':8,'filesystemUuid':'fixture-uuid'};self.write();(self.root/'pilot-tools/archive-storage.json').write_text(json.dumps({'filesystemUuid':'fixture-uuid'}))
 def write(self):(self.root/'pilot-tools/archive-capacity.json').write_text(json.dumps(self.policy))
 def tearDown(self):self.temp.cleanup()
 def test_valid_policy_keeps_guard_and_reserve(self):
  with patch.object(a,'verify_storage') as guard,patch.object(a,'archive_once',return_value={'status':'ok'}) as run:
   self.assertEqual(a.apply_capacity(self.root)['status'],'ok');guard.assert_called_once();run.assert_called_once_with(self.root,max_bytes=32*a.GiB,min_free=8*a.GiB)
 def test_no_reserve_reduction(self):
  self.policy['minimumFreeGiB']=7;self.write()
  with self.assertRaises(ValueError):a.apply_capacity(self.root)
 def test_unbounded_capacity_not_allowed(self):
  self.policy['maxArchiveGiB']=10000;self.write()
  with self.assertRaises(ValueError):a.apply_capacity(self.root)
 def test_bool_not_integer_capacity(self):
  self.policy['maxArchiveGiB']=True;self.write()
  with self.assertRaises(ValueError):a.apply_capacity(self.root)
 def test_wrong_uuid_not_writable(self):
  self.policy['filesystemUuid']='other';self.write()
  with self.assertRaises(ValueError),patch.object(a,'archive_once',side_effect=AssertionError('write')):a.apply_capacity(self.root)
 def test_no_external_config_no_override(self):
  (self.root/'pilot-tools/archive-storage.json').unlink()
  with self.assertRaises(ValueError):a.apply_capacity(self.root)
 def test_missing_mount_never_writes(self):
  with patch.object(a,'verify_storage',side_effect=ValueError('missing')),patch.object(a,'archive_once',side_effect=AssertionError('write')),self.assertRaises(ValueError):a.apply_capacity(self.root)
 def test_underlying_guard_reserve_cannot_be_lowered(self):
  with patch.object(a,'MIN_FREE',1),self.assertRaises(ValueError):a.apply_capacity(self.root)
if __name__=='__main__':unittest.main()
