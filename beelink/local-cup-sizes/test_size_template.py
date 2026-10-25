import copy,io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image,ImageDraw
from size_template import fit,predict,body_descriptor,TemplateRuntime,PROTOCOL,VERSION,validate_model
from size_classifier import sha,canonical,CalibrationError
from test_size_classifier import feature,BIND,references

class CapacityTemplateTests(unittest.TestCase):
 def training(self):return references(('chico','mediano','pint','litro','not_cup'),3)
 def model(self):return fit(self.training(),BIND,'e'*64)
 def test_all_nominal_classes_present_without_changing_labels(self):
  m=self.model();self.assertEqual(set(m['model']['classPolicies']),{'chico','mediano','pint','litro','not_cup'})
 def test_each_capacity_can_match_a_new_image_of_its_reference(self):
  m=self.model()
  for index,label in enumerate(('chico','mediano','pint','litro')):
   f=feature(index,999);r=predict(f,m,BIND);self.assertEqual(r['size'],label);self.assertTrue(r['provisional']);self.assertFalse(r['generalizationValidated']);self.assertFalse(r['externalAiUsed'])
 def test_no_probability_or_certified_volume(self):
  r=predict(feature(0,999),self.model(),BIND);self.assertNotIn('probability',r);self.assertTrue(r['notACertifiedVolume'])
 def test_single_pint_is_explicitly_unvalidated_and_tight(self):
  rows=[r for r in self.training() if r['size']!='pint'];rows+=references(('pint',),1);rows[-1]['feature']=feature(6,21);rows[-1]['imageSha256']=rows[-1]['feature']['imageSha256'];rows[-1]['sourceEventId']='pint-independent-fixture'
  m=fit(rows,BIND,'e'*64);p=m['model']['classPolicies']['pint'];self.assertEqual(p['validationLevel'],'single_reference_only');self.assertLessEqual(p['radius'],.12);self.assertEqual(p['referenceScenes'],1)
 def test_unknown_shape_abstains(self):self.assertEqual(predict(feature(8,999),self.model(),BIND)['size'],'unknown')
 def test_negative_reference_never_a_size(self):self.assertEqual(predict(feature(4,999),self.model(),BIND)['size'],'unknown')
 def test_source_binding_change_abstains(self):self.assertEqual(predict(feature(),self.model(),{**BIND,'zoneSha256':'f'*64})['size'],'unknown')
 def test_ambiguous_equal_classes_abstain(self):
  rows=self.training()
  for r in rows:
   if r['size']=='mediano':r['feature']['hog']=feature(0)['hog']
  m=fit(rows,BIND,'e'*64);self.assertEqual(predict(feature(0,999),m,BIND)['size'],'unknown')
 def test_no_ai_guessed_training_labels(self):
  rows=self.training();rows[0]['labelSource']='ai_estimate'
  with self.assertRaises(CalibrationError):fit(rows,BIND,'e'*64)
 def test_owner_confirmation_required(self):
  rows=self.training();rows[0]['ownerConfirmed']=False
  with self.assertRaises(CalibrationError):fit(rows,BIND,'e'*64)
 def test_duplicate_image_not_extra_evidence(self):
  rows=self.training();rows.append(copy.deepcopy(rows[0]))
  with self.assertRaises(CalibrationError):fit(rows,BIND,'e'*64)
 def test_model_tamper_rejected(self):
  m=self.model();m['model']['classPolicies']['chico']['radius']=1
  with self.assertRaises(CalibrationError):predict(feature(),m,BIND)
 def test_score_limits_cannot_be_bypassed_with_rehash(self):
  m=self.model();m['model']['classPolicies']['chico']['radius']=1;m['modelSha256']=sha(canonical(m['model']))
  with self.assertRaises(CalibrationError):validate_model(m)
 def test_calibration_does_not_mutate_references(self):
  rows=self.training();original=canonical(rows);fit(rows,BIND,'e'*64);self.assertEqual(canonical(rows),original)
 def test_real_reference_hash_returned_not_query_hash(self):
  m=self.model();f=feature(0,999);r=predict(f,m,BIND);self.assertEqual(r['imageSha256'],f['imageSha256']);self.assertNotIn(f['imageSha256'],r['referenceImageHashes'])
 def test_position_far_outside_calibration_abstains(self):
  f=feature();f['box'][0]=.8;self.assertEqual(predict(f,self.model(),BIND)['size'],'unknown')
 def test_changed_image_resolution_abstains(self):
  f=feature();f['width']=640;self.assertEqual(predict(f,self.model(),BIND)['size'],'unknown')
 def test_missing_template_does_not_assign(self):
  with tempfile.TemporaryDirectory() as d:
   r=TemplateRuntime(Path(d)/'none');r.reload('e'*64);self.assertIsNone(r.model)
 def test_changed_owner_annotations_stop_old_model(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'model.json';p.write_text(canonical(self.model()));r=TemplateRuntime(p)
   with self.assertRaisesRegex(CalibrationError,'annotations_changed'):r.reload('f'*64)
 def test_symlink_model_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'model.json';q=Path(d)/'real';q.write_text(canonical(self.model()));p.symlink_to(q)
   with self.assertRaises(CalibrationError):TemplateRuntime(p).reload('e'*64)
 def test_original_image_hash_checked_for_body_crop(self):
  im=Image.new('RGB',(128,128),'white');ImageDraw.Draw(im).rectangle((25,30,95,115),fill='brown');b=io.BytesIO();im.save(b,format='JPEG');raw=b.getvalue()
  with self.assertRaises(CalibrationError):body_descriptor(raw,[.1,.1,.8,.8],'0'*64)
 def test_body_crop_stays_inside_original_proof(self):
  im=Image.new('RGB',(128,128),'white');ImageDraw.Draw(im).rectangle((25,30,95,115),fill='brown');b=io.BytesIO();im.save(b,format='JPEG');raw=b.getvalue();f=body_descriptor(raw,[.1,.1,.8,.8],sha(raw));x,y,w,h=f['box'];self.assertGreaterEqual(y,.1);self.assertLessEqual(y+h,.900001);self.assertEqual(x,.1);self.assertEqual(w,.8)
if __name__=='__main__':unittest.main()
