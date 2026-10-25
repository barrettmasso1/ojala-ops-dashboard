import copy,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from size_runtime import SizeRuntime
from size_classifier import canonical,sha,fit
from size_template import TemplateRuntime
from test_size_classifier import BIND,references,feature
class RuntimeIntegration(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.path=self.root/'model.json';self.path.write_text(canonical(fit(references(),BIND)))
  self.r=SizeRuntime(self.path,self.root,self.root/'template.json','2026-10-25');self.r.annotation_sha='a'*64
  self.o={'observationId':'x','deviceId':BIND['deviceId'],'cameraName':'handoff','detectorModelSha256':BIND['detectorModelSha256'],'sourceEventId':'fixture-event','businessDate':'2026-10-25','sourceFalsePositive':False}
  self.e={'sourceZoneSha256':BIND['zoneSha256'],'imageSha256':'b'*64,'targetBox':[.4,.5,.1,.1],'storedImageRelativePath':'photo.jpg'};(self.root/'photo.jpg').write_bytes(b'image-fixture')
 def tearDown(self):self.tmp.cleanup()
 def test_owner_review_always_wins(self):
  review={'size':'litro','status':'owner_confirmed','basis':'owner_confirmed_reference'}
  with patch.object(self.r,'owner_review',return_value=review),patch.object(self.r.template,'assess',side_effect=AssertionError('never')):self.assertEqual(self.r.assess(self.o,self.e),review)
 def test_detector_rejected_never_inferred(self):
  self.o['sourceFalsePositive']=True
  with patch.object(self.r.template,'assess',side_effect=AssertionError('never')):self.assertIsNone(self.r.assess(self.o,self.e))
 def test_missing_evidence_never_inferred(self):
  with patch.object(self.r.template,'assess',side_effect=AssertionError('never')):self.assertIsNone(self.r.assess(self.o,None))
 def test_historical_record_not_reclassified_by_fallback(self):
  self.o['businessDate']='2026-10-24'
  with patch('size_runtime.descriptor',return_value=feature()),patch('size_runtime.predict',return_value={'status':'unclassified','reason':'ambiguous'}),patch.object(self.r.template,'assess',side_effect=AssertionError('never')):self.assertIsNone(self.r.assess(self.o,self.e))
 def test_existing_primary_prediction_remains_primary(self):
  primary={'size':'mediano','status':'classified'}
  with patch('size_runtime.descriptor',return_value=feature()),patch('size_runtime.predict',return_value=primary),patch.object(self.r.template,'assess',side_effect=AssertionError('never')):self.assertEqual(self.r.assess(self.o,self.e),primary)
 def test_primary_non_serving_veto_preserved(self):
  with patch('size_runtime.descriptor',return_value=feature()),patch('size_runtime.predict',return_value={'status':'unclassified','reason':'matches_confirmed_non_serving_object'}),patch.object(self.r.template,'assess',side_effect=AssertionError('never')):self.assertIsNone(self.r.assess(self.o,self.e))
 def test_unknown_can_gain_explicit_provisional_estimate(self):
  value={'size':'chico','status':'classified','provisional':True}
  with patch('size_runtime.descriptor',return_value=feature()),patch('size_runtime.predict',return_value={'status':'unclassified','reason':'ambiguous'}),patch.object(self.r.template,'assess',return_value=value):self.assertEqual(self.r.assess(self.o,self.e),value)
 def test_optional_template_error_does_not_break_primary(self):
  primary={'size':'mediano','status':'classified'}
  with patch.object(self.r.template,'reload',side_effect=ValueError('template-invalid')),patch('size_runtime.descriptor',return_value=feature()),patch('size_runtime.predict',return_value=primary):
   self.assertEqual(self.r.assess(self.o,self.e),primary);self.assertEqual(self.r.template.status,'template_unavailable')

if __name__=='__main__':unittest.main()
