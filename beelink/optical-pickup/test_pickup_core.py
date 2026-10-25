import copy,unittest
from pickup_core import *

P={'schema':'ojala_optical_pickup_policy_v1','cameraName':'handoff','deviceId':'38395f07-90c9-4ab4-a47e-a8881a3498fb','timezone':'America/Mazatlan','detectorModelSha256':'a'*64,'sourceZoneSha256':'b'*64,'referenceImageSha256':'c'*64,'geometryCalibration':'provisional_visual_orientation','commercialAccuracyValidated':False,'width':2304,'height':1296,'recordingWidth':1280,'recordingHeight':720,'minimumFeatures':8,'minimumRetainedFraction':.2,'maxSampleGapSeconds':.45,'minimumStableSeconds':.4,'minimumOutsideSamples':2,'minimumMotionHeights':.5,'maximumDurationSeconds':24,'maximumForwardBackwardError':1.0,'maximumMotionResidual':3.0,'zones':{'handoff':[[.4,.55],[.65,.55],[.65,.75],[.4,.75]],'customer':[[.4,.4],[.65,.4],[.65,.55],[.4,.55]]}}
T=epoch('2026-10-24T19:00:00+00:00')
def fixture(size='unknown'):
 o={'deviceId':P['deviceId'],'cameraName':'handoff','sourceEventId':'1792868400.000-fixture','observationId':'d'*64,'businessDate':'2026-10-24','detectorModelSha256':'a'*64,'verification':'same_frame_local_cv','sourceFalsePositive':False,'size':size,'sameFrameEvidence':{'imageSha256':'e'*64,'sourceZoneSha256':'b'*64,'capturedAt':stamp(T),'targetBox':[.47,.55,.05,.08]}}
 samples=[]
 for i,y in enumerate([.55,.55,.55,.53,.49,.45,.44]):
  samples.append({'at':stamp(T+i*.2),'box':[.47,y,.05,.08],'features':20,'retainedFraction':.8,'forwardBackwardError':.1,'motionResidual':.1,'frameSha256':str(i+1)*64})
 r={'eventId':identify(o,P),'sourceEventId':o['sourceEventId'],'observationId':o['observationId'],'businessDate':o['businessDate'],'seedCapturedAt':stamp(T),'imageSha256':'e'*64,'samples':samples,'segments':[],'stopReason':'tracking_lost'}
 return r,o

class PickupTests(unittest.TestCase):
 def test_counter_to_customer_not_origin_required(self):
  r,o=fixture();result=assess(r,o,P);self.assertEqual(result['status'],'pickup_estimate');self.assertFalse(result['paidSaleConfirmed'])
 def test_no_size_invented(self):
  r,o=fixture();self.assertEqual(assess(r,o,P)['size'],'unknown')
 def test_existing_size_used_without_pos(self):
  r,o=fixture('mediano');self.assertEqual(assess(r,o,P)['size'],'mediano')
 def test_static_cup_not_a_delivery(self):
  r,o=fixture()
  for s in r['samples']:s['box']=o['sameFrameEvidence']['targetBox'][:]
  self.assertEqual(assess(r,o,P)['status'],'no_accepted_exit')
 def test_ending_track_or_image_alone_not_a_delivery(self):
  r,o=fixture();r['samples']=r['samples'][:1];self.assertEqual(assess(r,o,P)['status'],'no_accepted_exit')
 def test_missing_video_never_zero_sale(self):
  r,o=fixture();r['samples']=[];self.assertEqual(assess(r,o,P)['status'],'tracking_unavailable')
 def test_reverse_direction_rejected(self):
  r,o=fixture();r['samples'].reverse()
  with self.assertRaises(ValueError):assess(r,o,P)
 def test_insufficient_dwell(self):
  r,o=fixture();r['samples']=r['samples'][:2]+r['samples'][5:]
  with self.assertRaisesRegex(ValueError,'gap'):assess(r,o,P)
 def test_gap_must_not_be_interpolated(self):
  r,o=fixture();r['samples'][3]['at']=stamp(T+3)
  with self.assertRaises(ValueError):assess(r,o,P)
 def test_other_store_device_cannot_supply_proof(self):
  r,o=fixture();o['deviceId']='other'
  with self.assertRaises(ValueError):assess(r,o,P)
 def test_other_image_cannot_supply_proof(self):
  r,o=fixture();r['imageSha256']='f'*64
  with self.assertRaises(ValueError):assess(r,o,P)
 def test_source_detector_rejected_excluded(self):
  r,o=fixture();o['sourceFalsePositive']=True;self.assertEqual(assess(r,o,P)['status'],'source_rejected')
 def test_owner_non_cup_label_preserved(self):
  r,o=fixture();o['ownerSizeReview']={'label':'not_cup'};self.assertEqual(assess(r,o,P)['status'],'owner_excluded')
 def test_weak_feature_support_cannot_count(self):
  r,o=fixture();r['samples'][4]['features']=7
  with self.assertRaises(ValueError):assess(r,o,P)
 def test_unreliable_optical_forward_backward_rejected(self):
  r,o=fixture();r['samples'][4]['forwardBackwardError']=1.1
  with self.assertRaises(ValueError):assess(r,o,P)
 def test_motion_outlier_rejected(self):
  r,o=fixture();r['samples'][4]['motionResidual']=4
  with self.assertRaises(ValueError):assess(r,o,P)
 def test_fraction_of_original_features_required(self):
  r,o=fixture();r['samples'][4]['retainedFraction']=.1
  with self.assertRaises(ValueError):assess(r,o,P)
 def test_no_boundary_flicker_count(self):
  r,o=fixture();r['samples'][-1]['box']=[.47,.55,.05,.08];self.assertNotEqual(assess(r,o,P)['status'],'pickup_estimate')
 def test_same_photograph_wrong_region_not_count(self):
  r,o=fixture();r['samples'][0]['box'][0]=.1
  with self.assertRaises(ValueError):assess(r,o,P)
 def test_same_policy_cannot_claim_commercial_validation(self):
  p=copy.deepcopy(P);p['commercialAccuracyValidated']=True
  with self.assertRaises(ValueError):validate_policy(p)
 def test_unknown_physical_count_and_partial_scope(self):
  r,o=fixture();s=summarize([r],[o],P);self.assertEqual(s['estimatedPickups'],1);self.assertFalse(s['coversWholeBusinessDay']);self.assertFalse(s['physicalUniqueCountCertified'])
 def test_inter_id_near_duplicate_held_not_added(self):
  r,o=fixture();o2=copy.deepcopy(o);o2['sourceEventId']='1792868400.001-other';o2['observationId']='f'*64;r2=copy.deepcopy(r);r2.update(eventId=identify(o2,P),sourceEventId=o2['sourceEventId'],observationId=o2['observationId'])
  s=summarize([r,r2],[o,o2],P);self.assertEqual(s['estimatedPickups'],1);self.assertEqual(s['unresolved'],1)
 def test_missing_native_record_cannot_count(self):
  r,o=fixture()
  with self.assertRaises(ValueError):summarize([r],[],P)
 def test_nan_coordinates_rejected(self):
  r,o=fixture();r['samples'][1]['box'][0]=float('nan')
  with self.assertRaises(ValueError):assess(r,o,P)
 def test_original_inputs_unmodified(self):
  r,o=fixture();s=canonical([r,o,P]);assess(r,o,P);self.assertEqual(s,canonical([r,o,P]))

 def test_return_to_counter_after_crossing_is_not_an_exit(self):
  r,o=fixture();last=copy.deepcopy(r['samples'][-1]);last['at']=stamp(T+1.4);last['box']=o['sameFrameEvidence']['targetBox'][:];r['samples'].append(last)
  self.assertEqual(assess(r,o,P)['status'],'path_ambiguous')
 def test_invalid_late_sample_is_not_hidden_by_earlier_crossing(self):
  r,o=fixture();last=copy.deepcopy(r['samples'][-1]);last['at']=stamp(T+1.4);last['features']=1;r['samples'].append(last)
  with self.assertRaisesRegex(ValueError,'feature_support'):assess(r,o,P)

if __name__=='__main__':unittest.main()
