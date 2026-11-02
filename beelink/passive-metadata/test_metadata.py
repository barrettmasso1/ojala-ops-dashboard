import unittest,copy,time,math
from record_frames import validate
from emergency_storage import known_atomic_output,check_space,MIN_FREE,MAX_BYTES,StorageError
class Protocol(unittest.TestCase):
 def setUp(self):
  self.now=time.time();self.p={'schema':'ojala_frigate_frame_metadata_v1','cameraName':'handoff','frameAt':self.now,'objects':[{'id':'valid-event-01','label':'cup','box':[1000,650,1100,780],'frame_time':self.now}],'droppedSincePrevious':0}
 def test_valid_original(self):self.assertEqual(validate(self.p,self.now),self.now)
 def test_no_mutation(self):
  orig=copy.deepcopy(self.p);validate(self.p,self.now);self.assertEqual(self.p,orig)
 def test_empty_source_heartbeat_allowed(self):self.p['objects']=[];self.assertEqual(validate(self.p,self.now),self.now)
 def test_explicit_dropped_marker_preserved(self):self.p['droppedSincePrevious']=5;validate(self.p,self.now);self.assertEqual(self.p['droppedSincePrevious'],5)
 def test_wrong_camera(self):
  self.p['cameraName']='other'
  with self.assertRaises(ValueError):validate(self.p,self.now)
 def test_stale_frame(self):
  with self.assertRaises(ValueError):validate(self.p,self.now+6)
 def test_future_frame(self):
  with self.assertRaises(ValueError):validate(self.p,self.now-6)
 def test_nan_timestamp(self):
  self.p['frameAt']=float('nan')
  with self.assertRaises(ValueError):validate(self.p,self.now)
 def test_bad_identity(self):
  self.p['objects'][0]['id']=None
  with self.assertRaises(ValueError):validate(self.p,self.now)
 def test_duplicate_identity(self):
  self.p['objects']*=2
  with self.assertRaises(ValueError):validate(self.p,self.now)
 def test_wrong_class(self):
  self.p['objects'][0]['label']='person'
  with self.assertRaises(ValueError):validate(self.p,self.now)
 def test_bad_box(self):
  self.p['objects'][0]['box']=[1000,500,900,700]
  with self.assertRaises(ValueError):validate(self.p,self.now)
 def test_box_out_of_frame(self):
  self.p['objects'][0]['box']=[1000,500,2500,700]
  with self.assertRaises(ValueError):validate(self.p,self.now)
 def test_box_nan(self):
  self.p['objects'][0]['box']=[1000,500,float('nan'),700]
  with self.assertRaises(ValueError):validate(self.p,self.now)
 def test_missing_object_time(self):
  self.p['objects'][0]['frame_time']=None
  with self.assertRaises(ValueError):validate(self.p,self.now)
 def test_limit(self):
  self.p['objects']*=201
  with self.assertRaises(ValueError):validate(self.p,self.now)
 def test_invalid_dropped_count(self):
  self.p['droppedSincePrevious']=-1
  with self.assertRaises(ValueError):validate(self.p,self.now)
class Storage(unittest.TestCase):
 def test_only_own_temp_allowed(self):self.assertTrue(known_atomic_output('metadata-state/health.json.tmp'));self.assertFalse(known_atomic_output('metadata-state/frames.sqlite3'))
 def test_no_scope_escape(self):self.assertFalse(known_atomic_output('metadata-state/../health.json.tmp'))
 def test_reserve_preserved(self):
  with self.assertRaises(StorageError):check_space(MIN_FREE-1,0,0)
 def test_quota_preserved(self):
  with self.assertRaises(StorageError):check_space(MIN_FREE+1024**3,MAX_BYTES,1)
if __name__=='__main__':unittest.main()
