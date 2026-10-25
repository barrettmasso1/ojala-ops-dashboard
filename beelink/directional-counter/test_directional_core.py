import copy,json,tempfile,unittest
from pathlib import Path
from directional_core import Counter,canonical,digest,iso,region,validate_policy
from record_frames import validate

BASE=1792891800.0
DEVICE='38395f07-90c9-4ab4-a47e-a8881a3498fb'
def policy():
 return {'schema':'ojala_directional_policy_v1','storeId':1,'deviceId':DEVICE,'cameraName':'handoff','timezone':'America/Mazatlan','detectorModelSha256':'a'*64,'sourceZoneSha256':'b'*64,'referenceImageSha256':'c'*64,'geometryCalibration':'provisional_visual_orientation','commercialAccuracyValidated':False,'minimumSamplesPerZone':2,'maxSampleGapSeconds':1.5,'minimumScore':.45,'width':2304,'height':1296,'zones':{'origin':[[.3,.7],[.7,.7],[.7,.9],[.3,.9]],'handoff':[[.3,.45],[.7,.45],[.7,.65],[.3,.65]],'destination':[[.3,.1],[.7,.1],[.7,.4],[.3,.4]]}}
def packet(i,where='origin',sid='test-object-0001',offset=0):
 at=BASE+i*.2+offset;y={'origin':.8,'handoff':.55,'destination':.3,'outside':.95}[where]
 box=[.47*2304,(y-.05)*1296,.53*2304,y*1296]
 return {'schema':'ojala_frigate_frame_metadata_v1','cameraName':'handoff','frameAt':at,'droppedSincePrevious':0,'objects':[{'id':sid,'label':'cup','frame_time':at,'start_time':BASE,'end_time':None,'box':box,'score':.8,'false_positive':False,'disappeared':0}]}
def evidence(sid='test-object-0001',size='unknown',captured=BASE+.5):
 return {'sourceEventId':sid,'deviceId':DEVICE,'cameraName':'handoff','businessDate':'2026-10-24','detectorModelSha256':'a'*64,'verification':'same_frame_local_cv','sourceFalsePositive':False,'observationId':digest(DEVICE+'/handoff/'+sid),'size':size,'sizeBasis':'local_model_has_no_size_classes' if size=='unknown' else 'local_reference_estimate','sameFrameEvidence':{'sourceZoneSha256':'b'*64,'imageSha256':'d'*64,'capturedAt':iso(captured)}}
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'count.sqlite3';self.counter=Counter(self.path,policy())
 def tearDown(self):self.counter.close();self.tmp.cleanup()
 def feed(self,p):return self.counter.ingest_frame(p,p['frameAt'])
 def route(self,sid='test-object-0001',offset=0):
  return sum(self.feed(packet(i,w,sid,offset)) for i,w in enumerate(['origin']*2+['handoff']*2+['destination']*2))
 def doc(self):return self.counter.document('2026-10-24')
 def test_no_frames_not_zero_whole_day(self):self.assertEqual(self.doc()['windows'],[]);self.assertFalse(self.doc()['coversWholeBusinessDay'])
 def test_received_empty_frame_observes_partial_interval(self):
  p=packet(0);p['objects']=[];self.feed(p);d=self.doc();self.assertEqual(d['records'],[]);self.assertEqual(d['windows'][0]['frames'],1)
 def test_static_target_never_counted(self):
  for i in range(50):self.feed(packet(i,'handoff'))
  self.assertEqual(self.doc()['records'],[])
 def test_end_of_track_not_delivery(self):
  p=packet(0,'handoff');p['objects'][0]['end_time']=p['frameAt'];self.feed(p);self.assertEqual(self.doc()['records'],[])
 def test_same_id_single_route_candidate(self):self.assertEqual(self.route(),1);self.assertEqual(self.doc()['records'][0]['status'],'awaiting_local_evidence')
 def test_reverse_route_not_delivery(self):
  for i,w in enumerate(['destination']*2+['handoff']*2+['origin']*2):self.feed(packet(i,w))
  self.assertEqual(self.doc()['records'],[])
 def test_incomplete_route_not_delivery(self):
  for i,w in enumerate(['handoff']*2+['destination']*2):self.feed(packet(i,w))
  self.assertEqual(self.doc()['records'],[])
 def test_one_sample_per_region_not_delivery(self):
  for i,w in enumerate(['origin','handoff','destination']):self.feed(packet(i,w))
  self.assertEqual(self.doc()['records'],[])
 def test_duplicates_not_add_frames_or_count(self):
  self.route();before=canonical(self.doc())
  for i,w in enumerate(['origin']*2+['handoff']*2+['destination']*2):self.feed(packet(i,w))
  self.assertEqual(canonical(self.doc()),before)
 def test_restarted_process_preserves_candidate(self):
  self.route();self.counter.close();self.counter=Counter(self.path,policy());self.assertEqual(self.route(),0);self.assertEqual(len(self.doc()['records']),1)
 def test_route_repeated_same_id_not_second_delivery(self):
  self.route();self.route(offset=10);self.assertEqual(len(self.doc()['records']),1)
 def test_gap_resets_route(self):
  for i,w in enumerate(['origin']*2+['handoff']*2):self.feed(packet(i,w))
  self.feed(packet(4,'destination',offset=10));self.feed(packet(5,'destination',offset=10));self.assertEqual(self.doc()['records'],[]);self.assertEqual(len(self.doc()['windows']),2)
 def test_dropped_frames_reset_route(self):
  for i,w in enumerate(['origin']*2+['handoff']*2):self.feed(packet(i,w))
  p=packet(4,'destination');p['droppedSincePrevious']=1;self.feed(p);self.feed(packet(5,'destination'));self.assertEqual(self.doc()['records'],[])
 def test_per_object_gap_even_with_other_frames(self):
  self.feed(packet(0));self.feed(packet(1))
  for i in range(2,20):p=packet(i);p['objects']=[];self.feed(p)
  for i,w in enumerate(['handoff']*2+['destination']*2,20):self.feed(packet(i,w))
  self.assertEqual(self.doc()['records'],[])
 def test_continuous_counter_dwell_keeps_every_sample(self):
  for i,w in enumerate(['origin']*2+['handoff']*20+['destination']*2):self.feed(packet(i,w))
  self.assertEqual(len(self.doc()['records']),1);self.assertEqual(len(self.doc()['records'][0]['samples']),24)
 def test_old_object_frame_not_current(self):
  for i,w in enumerate(['origin']*2+['handoff']*2+['destination']*2):
   p=packet(i,w);p['objects'][0]['frame_time']-=3;self.feed(p)
  self.assertEqual(self.doc()['records'],[])
 def test_predicted_missing_object_not_sample(self):
  for i,w in enumerate(['origin']*2+['handoff']*2+['destination']*2):
   p=packet(i,w);p['objects'][0]['disappeared']=2;self.feed(p)
  self.assertEqual(self.doc()['records'],[])
 def test_low_confidence_not_delivery(self):
  for i,w in enumerate(['origin']*2+['handoff']*2+['destination']*2):
   p=packet(i,w);p['objects'][0]['score']=.1;self.feed(p)
  self.assertEqual(self.doc()['records'],[])
 def test_source_rejection_drops_estimate_but_preserves_event(self):
  self.route();self.counter.reconcile([evidence()]);p=packet(7,'destination');p['objects'][0]['false_positive']=True;self.feed(p);self.assertEqual(self.doc()['records'][0]['status'],'source_rejected')
 def test_photo_proof_needed_not_just_route(self):
  self.route();o=evidence();o['verification']='detector_track_only';o['sameFrameEvidence']=None;self.counter.reconcile([o]);self.assertEqual(self.doc()['records'][0]['status'],'awaiting_local_evidence')
 def test_bound_local_evidence_makes_only_estimate(self):
  self.route();self.counter.reconcile([evidence()]);d=self.doc();self.assertEqual(d['records'][0]['status'],'estimated');self.assertEqual(d['records'][0]['size'],'unknown');self.assertFalse(d['physicalUniqueCountCertified'])
 def test_assigned_size_reused_not_guessed(self):
  self.route();self.counter.reconcile([evidence(size='mediano')]);self.assertEqual(self.doc()['records'][0]['size'],'mediano')
 def test_wrong_geometry_proof_rejected(self):
  self.route();o=evidence();o['sameFrameEvidence']['sourceZoneSha256']='e'*64;self.counter.reconcile([o]);self.assertEqual(self.doc()['records'][0]['status'],'evidence_conflict')
 def test_image_outside_crossing_not_accepted(self):
  self.route();self.counter.reconcile([evidence(captured=BASE-30)]);self.assertEqual(self.doc()['records'][0]['status'],'evidence_not_at_crossing')
 def test_notcup_label_preserved(self):
  self.route();o=evidence();o['ownerSizeReview']={'label':'not_cup'};self.counter.reconcile([o]);self.assertEqual(self.doc()['records'][0]['status'],'owner_excluded')
 def test_other_device_not_accepted(self):
  self.route();o=evidence();o['deviceId']='other'
  with self.assertRaisesRegex(ValueError,'scope'):self.counter.reconcile([o])
 def test_model_change_blocks_not_relabels(self):
  self.route();o=evidence();o['detectorModelSha256']='e'*64
  with self.assertRaisesRegex(ValueError,'detector_changed'):self.counter.reconcile([o])
 def test_ambiguous_reidentification_withheld_not_double_counted(self):
  self.route();self.counter.reconcile([evidence()]);self.route('test-object-0002',offset=5);self.counter.reconcile([evidence(),evidence('test-object-0002',captured=BASE+5.5)]);self.assertEqual([x['status'] for x in self.doc()['records']],['estimated','identity_ambiguous'])
 def test_distinct_route_after_longer_interval_retained(self):
  self.route();self.route('test-object-0002',offset=25);self.counter.reconcile([evidence(),evidence('test-object-0002',captured=BASE+25.5)]);self.assertEqual([x['status'] for x in self.doc()['records']],['estimated','estimated'])
 def test_geometry_change_does_not_reuse_state(self):
  p=policy();p['zones']['origin'][0][0]=.2
  with self.assertRaisesRegex(ValueError,'policy_changed'):Counter(self.path,p)
 def test_policy_requires_explicit_provisional_status(self):
  p=policy();p['commercialAccuracyValidated']=True
  with self.assertRaises(ValueError):validate_policy(p)
 def test_hashes_are_metadata_not_fictional_photo_hashes(self):
  self.route()
  for proof in self.doc()['records'][0]['samples']:self.assertEqual(digest(proof['metadataJson']),proof['metadataSha256']);self.assertNotIn('imageSha256',json.loads(proof['metadataJson']))
 def test_future_or_replayed_frame_rejected_by_recorder(self):
  p=packet(0)
  with self.assertRaisesRegex(ValueError,'not_live'):validate(p,p['frameAt']+30)
 def test_wrong_camera_rejected(self):
  p=packet(0);p['cameraName']='other'
  with self.assertRaises(ValueError):self.feed(p)
 def test_ambiguous_overlapping_geometry_not_inferred(self):
  p=policy();p['zones']['destination']=p['zones']['origin'];self.assertEqual(region([.4,.75,.1,.05],p),'ambiguous')
 def test_separate_day_does_not_invent_zero(self):
  self.route();self.assertEqual(self.counter.document('2026-10-23')['windows'],[])
 def test_late_false_positive_not_reapproved_from_stale_native_metadata(self):
  self.route();self.counter.reconcile([evidence()]);p=packet(7,'destination');p['objects'][0]['false_positive']=True;self.feed(p);self.counter.reconcile([evidence()]);self.assertEqual(self.doc()['records'][0]['status'],'source_rejected')
if __name__=='__main__':unittest.main()
