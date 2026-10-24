import copy,io,json,math,unittest
from PIL import Image,ImageDraw
from size_classifier import descriptor,fit,predict,sha,canonical,CalibrationError,VERSION,distance,scene_group

BIND={'deviceId':'device-test','cameraName':'handoff','zoneSha256':'a'*64,'detectorModelSha256':'b'*64}

def feature(index=0,sample=0):
    v=[0.0]*128;v[index]=1.0
    return {'version':VERSION,'hog':v,'colors':[1/24]*24,'box':[.45,.5,.05,.08],
            'width':2304,'height':1296,'imageSha256':sha(f'fixture-{index}-{sample}'),'cropSha256':sha(f'crop-{index}-{sample}')}

def references(categories=('chico','mediano'),n=3):
    rows=[]
    for index,category in enumerate(categories):
        for j in range(n):
            f=feature(index,j)
            rows.append({'feature':f,'imageSha256':f['imageSha256'],'size':category,'ownerConfirmed':True,
                         'labelSource':'owner_confirmed_capacity','sourceEventId':f'fixture-{index}-{j}',
                         'startedAt':f'2026-10-23T20:{j*3:02}:00+00:00'})
    return rows

class ClassifierTests(unittest.TestCase):
    def test_no_model_never_guesses_capacity(self):self.assertEqual(predict(feature(),None,BIND)['size'],'unknown')
    def test_empty_labels_require_calibration(self):self.assertEqual(fit([],BIND)['model']['status'],'calibration_required')
    def test_missing_owner_attestation_rejected(self):
        r=references();r[0]['ownerConfirmed']=False
        with self.assertRaisesRegex(CalibrationError,'unconfirmed_capacity'):fit(r,BIND)
    def test_ai_labels_rejected(self):
        r=references();r[0]['labelSource']='ai_estimate'
        with self.assertRaises(CalibrationError):fit(r,BIND)
    def test_unknown_not_a_training_label(self):
        r=references();r[0]['size']='unknown'
        with self.assertRaises(CalibrationError):fit(r,BIND)
    def test_same_image_cannot_inflate_training(self):
        r=references();r.append(copy.deepcopy(r[0]))
        with self.assertRaisesRegex(CalibrationError,'duplicate_reference'):fit(r,BIND)
    def test_same_scene_does_not_count_as_independent(self):
        r=references()
        for x in r:x['startedAt']='2026-10-23T20:00:00+00:00'
        self.assertEqual(fit(r,BIND)['model']['status'],'calibration_required')
    def test_one_reference_per_class_not_automatic(self):self.assertEqual(fit(references(n=1),BIND)['model']['status'],'calibration_required')
    def test_single_class_needs_contrast(self):self.assertEqual(fit(references(categories=('chico',)),BIND)['model']['status'],'calibration_required')
    def test_scene_held_out_validation_accepts_separable_fixtures(self):
        model=fit(references(),BIND);self.assertEqual(set(model['model']['supported']),{'chico','mediano'})
        self.assertEqual(model['model']['validation']['chico']['heldOutSceneFailures'],0)
    def test_new_matching_fixture_classified_locally(self):
        result=predict(feature(0,20),fit(references(),BIND),BIND)
        self.assertEqual(result['size'],'chico');self.assertFalse(result['externalAiUsed']);self.assertEqual(len(result['referenceImageHashes']),2)
    def test_two_distinct_calibrated_classes(self):self.assertEqual(predict(feature(1,20),fit(references(),BIND),BIND)['size'],'mediano')
    def test_unseen_shape_stays_unknown(self):self.assertEqual(predict(feature(6,20),fit(references(),BIND),BIND)['size'],'unknown')
    def test_noncup_reference_prevents_size_assignment(self):self.assertEqual(predict(feature(1,20),fit(references(('chico','not_cup')),BIND),BIND)['reason'],'matches_confirmed_non_serving_object')
    def test_unrepresented_sizes_never_invented(self):
        model=fit(references(),BIND);self.assertEqual(model['model']['missingCategories'],['pint','litro'])
    def test_binding_change_rejects_model(self):
        b={**BIND,'zoneSha256':'c'*64};self.assertEqual(predict(feature(),fit(references(),BIND),b)['size'],'unknown')
    def test_tampered_model_rejected(self):
        m=fit(references(),BIND);m['model']['supported']['chico']['radius']=1
        with self.assertRaisesRegex(CalibrationError,'model_checksum'):predict(feature(),m,BIND)
    def test_identical_appearance_different_capacity_not_separable(self):
        r=references()
        for x in r:x['feature']['hog']=feature()['hog']
        self.assertEqual(fit(r,BIND)['model']['status'],'calibration_required')
    def test_camera_resolution_change_rejected(self):
        f=feature();f['width']=640
        self.assertEqual(predict(f,fit(references(),BIND),BIND)['size'],'unknown')
    def test_perspective_outside_references_rejected(self):
        f=feature();f['box'][1]=.8
        self.assertEqual(predict(f,fit(references(),BIND),BIND)['size'],'unknown')
    def test_large_relative_scale_change_rejected(self):
        f=feature();f['box'][2]=.20
        self.assertEqual(predict(f,fit(references(),BIND),BIND)['size'],'unknown')
    def test_nonfinite_features_rejected(self):
        f=feature();f['hog'][0]=math.nan
        with self.assertRaises(CalibrationError):predict(f,None,BIND)
    def test_scene_timestamp_requires_timezone(self):
        with self.assertRaises(CalibrationError):scene_group('2026-10-23T00:00:00')
    def test_ref_hash_matches_feature(self):
        r=references();r[0]['imageSha256']='c'*64
        with self.assertRaises(CalibrationError):fit(r,BIND)
    def test_results_are_estimates_not_probability(self):
        m=fit(references(),BIND);r=predict(feature(),m,BIND)
        self.assertFalse(m['model']['similarityIsProbability']);self.assertTrue(r['notACertifiedVolume']);self.assertNotIn('probability',r)
    def test_model_training_does_not_mutate_reference(self):
        r=references();before=canonical(r);fit(r,BIND);self.assertEqual(canonical(r),before)

class ImageTests(unittest.TestCase):
    def image(self,uniform=False):
        im=Image.new('RGB',(128,128),'gray');d=ImageDraw.Draw(im)
        if not uniform:d.rectangle((32,24,80,110),fill='brown');d.ellipse((32,20,80,40),fill='white')
        b=io.BytesIO();im.save(b,format='JPEG');return b.getvalue()
    def test_pillow_descriptor_is_deterministic(self):
        raw=self.image();self.assertEqual(descriptor(raw,[.2,.1,.5,.8],sha(raw)),descriptor(raw,[.2,.1,.5,.8],sha(raw)))
    def test_wrong_hash_rejected(self):
        with self.assertRaises(CalibrationError):descriptor(self.image(),[.2,.1,.5,.8],'0'*64)
    def test_tiny_crop_rejected(self):
        b=self.image()
        with self.assertRaisesRegex(CalibrationError,'too_small'):descriptor(b,[.2,.1,.05,.05],sha(b))
    def test_blank_crop_rejected(self):
        b=self.image(True)
        with self.assertRaisesRegex(CalibrationError,'insufficient_detail'):descriptor(b,[.2,.1,.5,.8],sha(b))
    def test_bbox_outside_rejected(self):
        b=self.image()
        with self.assertRaises(CalibrationError):descriptor(b,[.8,.8,.5,.5],sha(b))
    def test_model_empty_stays_unclassified_real_descriptor(self):
        b=self.image();f=descriptor(b,[.2,.1,.5,.8],sha(b));self.assertEqual(predict(f,fit([],BIND),BIND)['size'],'unknown')

if __name__=='__main__':unittest.main()
