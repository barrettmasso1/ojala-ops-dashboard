import copy,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from size_classifier import sha,canonical,CalibrationError,fit,predict,MAX_DISTANCE,MIN_MARGIN
from size_runtime import SizeRuntime
from calibration import owner_review_index
import test_calibration as calibration_tests
from test_size_classifier import BIND,feature,references

class OwnerInputTests(unittest.TestCase):
 setUp=calibration_tests.CalibrationInputTests.setUp
 tearDown=calibration_tests.CalibrationInputTests.tearDown
 def index(self):return owner_review_index(self.labels,'a'*64,'2026-10-24T02:08:40+00:00',self.output,self.ledger)
 def test_owner_labels_retained_without_predictive_model(self):
  x=self.index();r=x['index']['records'][self.sample['observationId']]
  self.assertEqual(r['label'],'chico');self.assertEqual(r['sourceEventId'],self.sample['sourceEventId'])
  self.assertEqual(r['labelSource'],'owner_confirmed_capacity');self.assertEqual(r['imageSha256'],self.h)
 def test_noncup_is_an_exclusion_not_a_cup_size(self):
  self.labels['labels'][0]['size']='not_cup';x=self.index();self.assertEqual(x['index']['records'][self.sample['observationId']]['label'],'not_cup')
 def test_index_checksum_covers_actual_labels(self):
  x=self.index();self.assertEqual(sha(canonical(x['index'])),x['indexSha256'])
 def test_no_annotation_edits(self):
  before=canonical(self.labels);self.index();self.assertEqual(canonical(self.labels),before)

class OwnerRuntimeTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.runtime=SizeRuntime(self.root/'model.json',self.root)
  self.track={'observationId':'1'*64,'sourceEventId':'fixture-event-1','deviceId':BIND['deviceId'],'cameraName':'handoff','detectorModelSha256':BIND['detectorModelSha256'],'sourceFalsePositive':False}
  self.proof={'sourceZoneSha256':BIND['zoneSha256'],'imageSha256':'2'*64,'targetBox':[.4,.5,.1,.1]}
  self.review={'protocol':'ojala_owner_size_review_v1','sourceEventId':'fixture-event-1','imageSha256':'2'*64,'targetBox':[.4,.5,.1,.1],
   'binding':BIND,'label':'pint','labelSource':'owner_confirmed_capacity','annotationSha256':'a'*64,'manifestSha256':'b'*64,'sampleId':'c'*64,'confirmedAt':'2026-10-24T02:00:00Z'}
 def tearDown(self):self.tmp.cleanup()
 def write(self):
  index={'records':{self.track['observationId']:self.review}};p=self.root/'owner-reviews.json';p.write_text(canonical({'index':index,'indexSha256':sha(canonical(index))}))
 def test_reference_confirmation_does_not_need_model_ready(self):
  self.write();r=self.runtime.assess(self.track,self.proof);self.assertEqual(r['size'],'pint');self.assertEqual(r['status'],'owner_confirmed');self.assertNotIn('modelSha256',r)
 def test_owner_reference_takes_priority_over_inference(self):
  self.write();(self.root/'model.json').write_text(canonical(fit(references(),BIND)))
  with patch('size_runtime.predict',side_effect=AssertionError('prediction_for_owner_review')):r=self.runtime.assess(self.track,self.proof)
  self.assertEqual(r['size'],'pint')
 def test_noncup_preserves_unknown_size_and_explicit_review(self):
  self.review['label']='not_cup';self.write();r=self.runtime.assess(self.track,self.proof);self.assertEqual(r['size'],'unknown');self.assertEqual(r['ownerReview']['label'],'not_cup')
 def test_foreign_event_rejected(self):
  self.review['sourceEventId']='another-event';self.write()
  with self.assertRaises(CalibrationError):self.runtime.assess(self.track,self.proof)
 def test_foreign_image_rejected(self):
  self.review['imageSha256']='f'*64;self.write()
  with self.assertRaises(CalibrationError):self.runtime.assess(self.track,self.proof)
 def test_other_crop_same_image_is_not_relabelled(self):
  self.review['targetBox']=[.3,.5,.1,.1];self.write()
  with self.assertRaises(CalibrationError):self.runtime.assess(self.track,self.proof)
 def test_changed_zone_rejected(self):
  self.review['binding']={**BIND,'zoneSha256':'f'*64};self.write()
  with self.assertRaises(CalibrationError):self.runtime.assess(self.track,self.proof)
 def test_corrupt_review_checksum_rejected(self):
  self.write();p=self.root/'owner-reviews.json';v=json.loads(p.read_text());v['indexSha256']='f'*64;p.write_text(json.dumps(v))
  with self.assertRaises(CalibrationError):self.runtime.assess(self.track,self.proof)
 def test_ai_label_source_cannot_masquerade_as_owner(self):
  self.review['labelSource']='ai_estimate';self.write()
  with self.assertRaises(CalibrationError):self.runtime.assess(self.track,self.proof)
 def test_unrelated_event_has_no_owner_label(self):
  self.write();self.track['observationId']='3'*64;self.assertIsNone(self.runtime.assess(self.track,self.proof))
 def test_missing_proof_not_classified(self):self.write();self.assertIsNone(self.runtime.assess(self.track,None))

class SelectiveValidationTests(unittest.TestCase):
 def test_ambiguous_example_can_abstain_without_disabling_safe_region(self):
  r=references(n=4);bad=copy.deepcopy(r[0]);bad['feature']=feature(5,60);bad['imageSha256']=bad['feature']['imageSha256'];bad['sourceEventId']='ambiguous-extra';bad['startedAt']='2026-10-23T20:20:00Z';r.append(bad)
  m=fit(r,BIND);self.assertEqual(m['model']['status'],'ready');self.assertIn('chico',m['model']['supported']);self.assertGreater(m['model']['validation']['chico']['heldOutSceneFailures'],0)
  self.assertEqual(predict(feature(5,90),m,BIND)['size'],'unknown')
 def test_known_wrong_confident_prediction_disables_that_class(self):
  r=references(n=4);bad=copy.deepcopy(r[-1]);bad['feature']=feature(0,99);bad['imageSha256']=bad['feature']['imageSha256'];bad['startedAt']='2026-10-23T20:30:00Z';bad['sourceEventId']='bad-contrast';r.append(bad)
  m=fit(r,BIND);self.assertNotIn('chico',m['model']['supported'])
 def test_distance_and_margin_not_relaxed(self):self.assertEqual(MAX_DISTANCE,.28);self.assertEqual(MIN_MARGIN,.04)
 def test_same_scene_never_used_for_heldout_support(self):
  m=fit(references(n=3),BIND);self.assertEqual(len(m['model']['heldOutSceneResults']),6)
  self.assertTrue(all(x['expected']==x['predicted'] for x in m['model']['heldOutSceneResults']))
 def test_minimum_three_accepted_scenes(self):
  r=references(n=3);r[0]['feature']=feature(5,90);r[0]['imageSha256']=r[0]['feature']['imageSha256'];m=fit(r,BIND);self.assertNotIn('chico',m['model']['supported'])

if __name__=='__main__':unittest.main()
