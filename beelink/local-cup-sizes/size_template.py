"""Experimental local nominal-capacity template matcher, never a measured volume.
Only owner-labeled original images are reference data. No network or generative AI.
The original validated matcher remains primary; this model may abstain.
"""
from pathlib import Path
from datetime import datetime
from PIL import Image
import io,json,math,re
from size_classifier import descriptor,distance,scene_group,canonical,sha,CalibrationError,valid_feature,need
PROTOCOL='ojala_local_capacity_templates_v1'
VERSION='ojala_body_templates_v1'
CLASSES=('chico','mediano','pint','litro','not_cup')
MAX_DISTANCE=.28
MIN_MARGIN=.04
BODY_RATIO=.7

def body_descriptor(raw,box,image_sha):
    # Exact bottom-anchored region, never extend outside the original detector crop.
    with Image.open(io.BytesIO(raw)) as im:width,height=im.size
    need(isinstance(box,list) and len(box)==4,'template_box')
    x,y,w,h=box;body_h=min(h,w*width/height*BODY_RATIO)
    return descriptor(raw,[x,y+h-body_h,w,body_h],image_sha)

def ranked(feature,refs,exclude_scene=None):
    values=[]
    for ref in refs:
        if exclude_scene is not None and ref['sceneGroup']==exclude_scene:continue
        d=distance(feature,ref['feature'])
        if d is not None:values.append((d,ref))
    return sorted(values,key=lambda x:(x[0],x[1]['imageSha256']))

def choice(feature,refs,exclude_scene=None):
    ordered=ranked(feature,refs,exclude_scene)
    if not ordered:return None
    score,ref=ordered[0];rival=min((d for d,r in ordered if r['size']!=ref['size']),default=None)
    return {'reference':ref,'distance':score,'margin':None if rival is None else rival-score}

def fit(references,binding,annotation_sha):
    need(isinstance(annotation_sha,str) and re.fullmatch('[a-f0-9]{64}',annotation_sha),'annotation_hash')
    need(isinstance(binding,dict) and set(binding)=={'deviceId','cameraName','zoneSha256','detectorModelSha256'},'template_binding')
    need(binding['cameraName']=='handoff' and all(isinstance(binding[k],str) and binding[k] for k in binding),'template_binding')
    need(isinstance(references,list) and 1<=len(references)<=200,'template_reference_limit')
    refs=[];seen=set()
    for r in references:
        need(r.get('ownerConfirmed') is True and r.get('labelSource')=='owner_confirmed_capacity','template_label_source')
        need(r.get('size') in CLASSES,'template_label');valid_feature(r['feature'])
        h=r['imageSha256'];need(h==r['feature']['imageSha256'] and h not in seen,'template_duplicate_or_hash');seen.add(h)
        refs.append({'size':r['size'],'sourceEventId':r['sourceEventId'],'sceneGroup':scene_group(r['startedAt']),'imageSha256':h,'feature':r['feature']})
    diagnostics=[]
    for r in refs:
        pick=choice(r['feature'],refs,r['sceneGroup']);accepted=bool(pick and pick['margin'] is not None and pick['distance']<=MAX_DISTANCE and pick['margin']>=MIN_MARGIN)
        diagnostics.append({'expected':r['size'],'predicted':pick['reference']['size'] if accepted else None,'imageSha256':r['imageSha256'],'sceneGroup':r['sceneGroup'],'distance':None if not pick else pick['distance'],'margin':None if not pick else pick['margin']})
    policies={}
    for size in CLASSES:
        own=[r for r in refs if r['size']==size]
        if not own:continue
        scenes=len({r['sceneGroup'] for r in own});good=[r for r in diagnostics if r['expected']==size and r['predicted']==size];wrong=[r for r in diagnostics if r['expected']!=size and r['predicted']==size]
        if scenes>=3 and len({r['sceneGroup'] for r in good})>=3 and not wrong:
            radius=min(MAX_DISTANCE,max(r['distance'] for r in good)*1.15+.01)
            level='calibration_examples_only'
        else:
            # Low-data categories only permit near-reference matches; never certify them.
            negatives=[distance(r['feature'],other['feature']) for r in own for other in refs if other['size']!=size]
            negatives=[d for d in negatives if d is not None]
            radius=min(.12,min(negatives)*.5) if negatives else 0.0
            level='single_reference_only' if len(own)==1 else 'near_reference_only'
        if wrong:radius=min(radius,min(r['distance'] for r in wrong)*.8)
        policies[size]={'radius':max(0,round(radius,7)),'minimumMargin':MIN_MARGIN,'referenceImages':len(own),'referenceScenes':scenes,'validationLevel':level,'initialCalibrationCorrectAccepted':len(good),'initialCalibrationWrongAccepted':len(wrong)}
    model={'protocol':PROTOCOL,'classifierVersion':VERSION,'extractor':'bottom_body_hog_070','bodyRatio':BODY_RATIO,'binding':binding,'annotationSha256':annotation_sha,'references':refs,'classPolicies':policies,'calibrationDiagnostics':diagnostics,'labelSource':'owner_confirmed_capacity','generalizationValidated':False,'similarityIsProbability':False,'runtimeGenerativeAi':False}
    return {'model':model,'modelSha256':sha(canonical(model))}

def validate_model(model):
    need(isinstance(model,dict) and sha(canonical(model.get('model')))==model.get('modelSha256'),'template_model_checksum')
    m=model['model'];need(m.get('protocol')==PROTOCOL and m.get('classifierVersion')==VERSION and m.get('bodyRatio')==BODY_RATIO,'template_model_version')
    need(m.get('runtimeGenerativeAi') is False and m.get('generalizationValidated') is False and m.get('labelSource')=='owner_confirmed_capacity','template_model_scope')
    for label,policy in m['classPolicies'].items():
        need(label in CLASSES and 0<=policy['radius']<=MAX_DISTANCE and policy['minimumMargin']==MIN_MARGIN,'template_policy')
    return m

def predict(feature,model,binding):
    valid_feature(feature);m=validate_model(model)
    unknown=lambda reason:{'size':'unknown','status':'unclassified','reason':reason,'externalAiUsed':False}
    if m['binding']!=binding:return unknown('template_binding_changed')
    pick=choice(feature,m['references'])
    if not pick:return unknown('outside_reference_view')
    ref=pick['reference'];policy=m['classPolicies'].get(ref['size']);d=pick['distance'];margin=pick['margin']
    if not policy or margin is None or margin<MIN_MARGIN or d>policy['radius']:return unknown('template_ambiguous_or_outside_radius')
    if ref['size']=='not_cup':return unknown('matches_owner_non_serving_reference')
    return {'size':ref['size'],'status':'classified','reason':'matched_owner_labeled_local_references','basis':'local_reference_estimate','modelSha256':model['modelSha256'],'classifierVersion':VERSION,'imageSha256':feature['imageSha256'],'referenceImageHashes':[ref['imageSha256']],'distance':round(d,7),'margin':round(margin,7),'externalAiUsed':False,'notACertifiedVolume':True,'provisional':True,'generalizationValidated':False,'referenceImages':policy['referenceImages'],'referenceScenes':policy['referenceScenes'],'validationLevel':policy['validationLevel'],'annotationSha256':m['annotationSha256'],'extractor':'bottom_body_hog_070'}

class TemplateRuntime:
    def __init__(self,path):self.path=Path(path);self.model=None;self.stamp=None;self.status='not_configured'
    def reload(self,annotation_sha):
        if not self.path.exists():self.model=None;self.stamp=None;self.status='not_configured';return
        need(not self.path.is_symlink() and self.path.is_file() and self.path.stat().st_size<=2*1024*1024,'template_file')
        st=self.path.stat();stamp=(st.st_ino,st.st_mtime_ns,st.st_size,annotation_sha)
        if stamp!=self.stamp:
            model=json.loads(self.path.read_text());m=validate_model(model);need(m['annotationSha256']==annotation_sha,'template_owner_annotations_changed')
            self.model=model;self.stamp=stamp;self.status='provisional_templates_ready'
    def assess(self,raw,box,image_sha,binding,annotation_sha):
        self.reload(annotation_sha)
        if self.model is None:return None
        result=predict(body_descriptor(raw,box,image_sha),self.model,binding)
        return result if result['status']=='classified' else None


def build_from_manifest(annotations,annotation_sha,output_root,ledger_root):
    from calibration import safe_file
    need(annotations.get('ownerConfirmed') is True and annotations.get('labelSource')=='owner_confirmed_capacity','template_label_source')
    manifest_sha=annotations.get('manifestSha256');need(isinstance(manifest_sha,str) and re.fullmatch('[a-f0-9]{64}',manifest_sha),'manifest_hash')
    path=Path(output_root)/'manifests'/(manifest_sha+'.json');need(not path.is_symlink() and path.is_file() and path.stat().st_size<2*1024*1024,'template_manifest_file')
    manifest=json.loads(path.read_text());need(sha(canonical(manifest))==manifest_sha,'template_manifest_checksum')
    byid={x['sampleId']:x for x in manifest['samples']};seen=set();refs=[];binding=None
    labels=annotations.get('labels');need(isinstance(labels,list) and 1<=len(labels)<=100,'template_labels_limit')
    for label in labels:
        need(isinstance(label,dict) and set(label)=={'sampleId','size'} and label['size'] in CLASSES,'template_label')
        key=label['sampleId'];need(key in byid and key not in seen,'template_label_identity');seen.add(key);original=byid[key]
        if binding is None:binding=original['binding']
        need(binding==original['binding'],'template_mixed_bindings')
        raw=safe_file(Path(ledger_root),original['imageRelativePath'],original['imageSha256'])
        feature=body_descriptor(raw,original['targetBox'],original['imageSha256'])
        refs.append({'size':label['size'],'sourceEventId':original['sourceEventId'],'startedAt':original['startedAt'],'imageSha256':original['imageSha256'],'feature':feature,'ownerConfirmed':True,'labelSource':'owner_confirmed_capacity'})
    return fit(refs,binding,annotation_sha)
