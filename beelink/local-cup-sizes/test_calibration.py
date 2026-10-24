import copy,io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image,ImageDraw
from calibration import build_form,train_from_annotations,safe_file
from size_classifier import sha,canonical,CalibrationError,fit
from size_runtime import SizeRuntime
from test_size_classifier import BIND,feature,references

class CalibrationInputTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.ledger=self.root/'ledger';self.ledger.mkdir();self.output=self.root/'calibration';self.output.mkdir()
  im=Image.new('RGB',(128,128),'gray');d=ImageDraw.Draw(im);d.rectangle((20,20,100,110),fill='brown');d.ellipse((20,15,100,40),fill='white');buf=io.BytesIO();im.save(buf,format='JPEG');self.raw=buf.getvalue();self.h=sha(self.raw);(self.ledger/'example.jpg').write_bytes(self.raw)
  self.sample={'sampleId':'sample1','sourceEventId':'fixture-event-1','observationId':'1'*64,'startedAt':'2026-10-23T20:00:00+00:00','imageSha256':self.h,'imageRelativePath':'example.jpg','targetBox':[.1,.1,.8,.8],'binding':BIND,'feature':feature(),'cropPath':'crops/example.jpg','size':None,'labelSource':None}
  self.mh=build_form(self.output,[self.sample]);self.labels={'schemaVersion':1,'manifestSha256':self.mh,'ownerConfirmed':True,'labelSource':'owner_confirmed_capacity','labels':[{'sampleId':'sample1','size':'chico'}]}
 def tearDown(self):self.tmp.cleanup()
 def test_real_label_not_enough_examples_stays_calibration_required(self):self.assertEqual(train_from_annotations(self.labels,self.output,self.ledger)['model']['status'],'calibration_required')
 def test_false_attestation_rejected(self):
  self.labels['ownerConfirmed']=False
  with self.assertRaises(CalibrationError):train_from_annotations(self.labels,self.output,self.ledger)
 def test_ai_source_cannot_be_used_as_human_truth(self):
  self.labels['labelSource']='ai_estimate'
  with self.assertRaises(CalibrationError):train_from_annotations(self.labels,self.output,self.ledger)
 def test_absent_manifest_rejected(self):
  self.labels['manifestSha256']='f'*64
  with self.assertRaises(CalibrationError):train_from_annotations(self.labels,self.output,self.ledger)
 def test_unknown_sample_rejected(self):
  self.labels['labels'][0]['sampleId']='other'
  with self.assertRaises(CalibrationError):train_from_annotations(self.labels,self.output,self.ledger)
 def test_arbitrary_input_paths_rejected(self):
  self.labels['labels'][0]['imageRelativePath']='../../private'
  with self.assertRaises(CalibrationError):train_from_annotations(self.labels,self.output,self.ledger)
 def test_annotation_manifest_traversal_rejected(self):
  self.labels['manifestSha256']='../outside'
  with self.assertRaises(CalibrationError):train_from_annotations(self.labels,self.output,self.ledger)
 def test_source_image_tampering_rejected(self):
  (self.ledger/'example.jpg').write_bytes(self.raw+b'changed')
  with self.assertRaises(CalibrationError):train_from_annotations(self.labels,self.output,self.ledger)
 def test_source_image_symlink_rejected(self):
  (self.ledger/'linked.jpg').symlink_to(self.ledger/'example.jpg')
  with self.assertRaises(CalibrationError):safe_file(self.ledger,'linked.jpg',self.h)
 def test_manifest_tampering_rejected(self):
  p=self.output/'manifests'/(self.mh+'.json');m=json.loads(p.read_text());m['samples'][0]['binding']['cameraName']='other';p.write_text(json.dumps(m))
  with self.assertRaises(CalibrationError):train_from_annotations(self.labels,self.output,self.ledger)
 def test_no_training_images_silently_relabelled(self):
  before=(self.ledger/'example.jpg').read_bytes();train_from_annotations(self.labels,self.output,self.ledger);self.assertEqual((self.ledger/'example.jpg').read_bytes(),before)
 def test_html_requires_owner_confirmation_and_makes_no_network_requests(self):
  text=(self.output/'Calibrar_tamanos.html').read_text();self.assertIn('ownerConfirmed',text);self.assertIn('confirm',text);self.assertNotIn('fetch(',text);self.assertNotIn('window.open',text)
 def test_same_source_manifest_is_stable(self):self.assertEqual(build_form(self.output,[self.sample]),self.mh)

class RuntimeTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.p=self.root/'model.json';self.runtime=SizeRuntime(self.p,self.root)
  self.track={'deviceId':BIND['deviceId'],'cameraName':'handoff','detectorModelSha256':BIND['detectorModelSha256'],'sourceFalsePositive':False}
  self.evidence={'sourceZoneSha256':BIND['zoneSha256'],'imageSha256':'a'*64,'targetBox':[.4,.5,.1,.1],'storedImageRelativePath':'evidence.jpg'}
 def tearDown(self):self.tmp.cleanup()
 def test_missing_model_no_assignment(self):self.assertIsNone(self.runtime.assess(self.track,self.evidence))
 def test_no_proof_no_size(self):self.assertIsNone(self.runtime.assess(self.track,None))
 def test_symlink_model_rejected(self):
  target=self.root/'other';target.write_text('{}');self.p.symlink_to(target)
  with self.assertRaises(CalibrationError):self.runtime.reload()
 def test_model_checksum_must_match(self):
  self.p.write_text(json.dumps({'model':{},'modelSha256':'a'*64}))
  with self.assertRaises(CalibrationError):self.runtime.reload()
 def test_rejected_source_never_classified(self):
  self.p.write_text(canonical(fit(references(),BIND)));self.track['sourceFalsePositive']=True
  self.assertIsNone(self.runtime.assess(self.track,self.evidence))
 def test_no_references_no_decode_or_classifier_call(self):
  self.p.write_text(canonical(fit([],BIND)))
  with patch('size_runtime.descriptor',side_effect=AssertionError('decode')):self.assertIsNone(self.runtime.assess(self.track,self.evidence))
 def test_external_path_never_read(self):
  self.p.write_text(canonical(fit(references(),BIND)));self.evidence['storedImageRelativePath']='../../etc/passwd'
  with self.assertRaises(CalibrationError):self.runtime.assess(self.track,self.evidence)
 def test_removed_model_disables_new_assignments(self):
  self.p.write_text(canonical(fit(references(),BIND)));self.runtime.reload();self.p.unlink()
  self.assertIsNone(self.runtime.assess(self.track,self.evidence));self.assertEqual(self.runtime.status,'calibration_required')

if __name__=='__main__':unittest.main()
