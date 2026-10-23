import unittest,sys,json,zipfile,tempfile,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from recovered_candidates import groups,load_package
from automatic_sizes_worker import SCRIPT
class RecoveryTests(unittest.TestCase):
 def e(self,i,t,x=0.4):return {'id':i,'start_time':t,'end_time':t+5,'data':{'box':[x,0.5,0.03,0.06]}}
 def test_same_nearby_track_is_one_recovery_group(self):self.assertEqual(len(groups([self.e('a',0),self.e('b',10)])),1)
 def test_distant_objects_stay_separate(self):self.assertEqual(len(groups([self.e('a',0),self.e('b',10,0.8)])),2)
 def test_separate_scenes_stay_separate(self):self.assertEqual(len(groups([self.e('a',0),self.e('b',100)])),2)
 def test_no_fabricated_count(self):
  source=(Path(__file__).resolve().parents[1]/'recovered_candidates.py').read_text();self.assertIn("'physicalCount':None",source);self.assertIn("'verifiedSnapshot':False",source)
 def test_no_live_model_or_threshold_edit(self):
  source=(Path(__file__).resolve().parents[1]/'recovered_candidates.py').read_text();self.assertNotIn('config.yaml',source);self.assertNotIn('approved_counts',source)
 def test_recovery_origin_cannot_be_verified(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'bad.zip'
   with zipfile.ZipFile(p,'w') as z:
    for k,v in {'manifest.json':json.dumps({'origin':'verified_snapshot'}),'frame.jpg':'x','capture.json':json.dumps({'cup_event_id':'event-original'}),'provenance.json':'{}'}.items():z.writestr(k,v)
   with self.assertRaisesRegex(ValueError,'recovery_origin'):load_package(p)
 def test_auto_size_worker_preserves_identity_and_does_not_count(self):
  self.assertIn('classifyHandoffCupSizes',SCRIPT);self.assertNotIn('submitCounts',SCRIPT);self.assertIn("i.source==='manual'",SCRIPT)
 def test_size_worker_does_not_block_synchronous_photo_loop(self):self.assertIn("return {status:'started'",SCRIPT);self.assertIn('window[key]',SCRIPT)
if __name__=='__main__':unittest.main()
