import copy,unittest
from video_reader import SequentialReader,coherent_prefix
class Fake:
 def __init__(self,times):self.times=list(times);self.sets=[];self.released=False;self.actual=None;self.reads=0
 def set(self,key,val):self.sets.append((key,val))
 def read(self):
  self.reads+=1
  if not self.times:return False,None
  self.actual=self.times.pop(0);return True,('frame',self.actual)
 def get(self,key):return self.actual*1000
 def release(self):self.released=True
class ReaderTests(unittest.TestCase):
 def test_forward_sampling_seeks_only_once(self):
  c=Fake([0,.1,.2,.3,.4]);r=SequentialReader(lambda _:c,0)
  self.assertEqual(r.read('a',0)[1],0);self.assertEqual(r.read('a',.2)[1],.2);self.assertEqual(r.read('a',.4)[1],.4);self.assertEqual(len(c.sets),1)
 def test_repeated_request_does_not_decode(self):
  c=Fake([0,.1]);r=SequentialReader(lambda _:c,0);r.read('a',0);r.read('a',0);self.assertEqual(c.reads,1)
 def test_change_file_closes_original(self):
  a=Fake([0]);b=Fake([0]);r=SequentialReader(lambda p:a if p=='a' else b,0);r.read('a',0);r.read('b',0);self.assertTrue(a.released);self.assertEqual(len(b.sets),1)
 def test_requested_time_cannot_go_backwards(self):
  c=Fake([.3]);r=SequentialReader(lambda _:c,0);r.read('a',.2)
  with self.assertRaises(ValueError):r.read('a',.1)
 def test_bad_offsets_rejected(self):
  for v in [-1,float('nan'),float('inf'),True,'0']:
   with self.assertRaises(ValueError):SequentialReader(lambda _:None,0).read('a',v)
 def test_no_frame_remains_missing(self):self.assertEqual(SequentialReader(lambda _:Fake([]),0).read('a',0),(None,None))
 def test_decoding_budget_bounded(self):
  c=Fake([0]*20);r=SequentialReader(lambda _:c,0,max_reads=5)
  with self.assertRaisesRegex(ValueError,'budget'):r.read('a',1)
  self.assertEqual(c.reads,5)
 def test_backward_pts_rejected_not_invented(self):
  c=Fake([.2,.1]);r=SequentialReader(lambda _:c,0);r.read('a',.2)
  with self.assertRaisesRegex(ValueError,'backwards'):r.read('a',.3)
 def test_nonfinite_pts_rejected(self):
  for v in [float('nan'),float('inf'),-1]:
   with self.assertRaises(ValueError):SequentialReader(lambda _:Fake([v]),0).read('a',0)
 def test_close_releases(self):
  c=Fake([0]);r=SequentialReader(lambda _:c,0);r.read('a',0);r.close();self.assertTrue(c.released)
class PrefixTests(unittest.TestCase):
 def rows(self):return [{'path':'a','start':100.,'end':109.9,'sha256':'a'*64},{'path':'b','start':109.,'end':119.,'sha256':'b'*64},{'path':'c','start':119.,'end':129.,'sha256':'c'*64}]
 def test_large_overlap_keeps_valid_prefix_not_total_failure(self):self.assertEqual(coherent_prefix(self.rows(),101),self.rows()[:1])
 def test_small_overlap_preserves_exact_original_ranges(self):
  r=self.rows();r[1]['start']=109.5;self.assertEqual(coherent_prefix(r,101),r)
 def test_gap_stops_not_interpolates(self):
  r=self.rows();r[1]['start']=111;self.assertEqual(coherent_prefix(r,101),r[:1])
 def test_seed_in_missing_window_remains_empty(self):self.assertEqual(coherent_prefix(self.rows(),99),[])
 def test_expired_segments_skipped(self):self.assertEqual(coherent_prefix(self.rows(),120),self.rows()[2:])
 def test_duplicate_path_not_double_counted(self):
  r=self.rows();r[1].update(path='a',start=110);self.assertEqual(coherent_prefix(r,101),r[:1])
 def test_original_metadata_not_mutated(self):
  r=self.rows();before=copy.deepcopy(r);coherent_prefix(r,101);self.assertEqual(r,before)
 def test_empty_input_remains_empty(self):self.assertEqual(coherent_prefix([],1),[])
if __name__=='__main__':unittest.main()
