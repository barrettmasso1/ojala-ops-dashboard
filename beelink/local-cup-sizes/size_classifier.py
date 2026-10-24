"""Local reference-based cup sizes; no network, language model, or volume guesses.

Capacity labels MUST originate in explicit owner confirmations. Similarity scores
are NOT probabilities. Independent scene checks gate each supported category.
"""
from __future__ import annotations
import hashlib,io,json,math,re
from datetime import datetime
from PIL import Image,ImageStat

SIZES=('chico','mediano','pint','litro')
CLASSES=SIZES+('not_cup',)
VERSION='ojala_reference_sizes_v1'
SHA=re.compile(r'^[a-f0-9]{64}$')
MAX_BYTES=8*1024*1024
MIN_SCENES=3
MAX_DISTANCE=.28
MIN_MARGIN=.04

class CalibrationError(ValueError):pass

def need(ok,reason):
    if not ok:raise CalibrationError(reason)

def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False)
def sha(value):return hashlib.sha256(value if isinstance(value,bytes) else value.encode()).hexdigest()
def number(x):return type(x) in (int,float) and math.isfinite(x)
def normalized(values):
    norm=math.sqrt(sum(v*v for v in values));return [round(v/max(norm,1e-12),7) for v in values]

def scene_group(started_at):
    t=datetime.fromisoformat(started_at.replace('Z','+00:00'));need(t.tzinfo is not None,'scene_timestamp_without_timezone')
    return str(int(t.timestamp())//120)

def descriptor(image_bytes,box,expected_sha):
    need(isinstance(expected_sha,str) and SHA.fullmatch(expected_sha),'missing_image_hash')
    need(0<len(image_bytes)<=MAX_BYTES and sha(image_bytes)==expected_sha,'image_hash_or_size')
    need(isinstance(box,list) and len(box)==4 and all(number(v) for v in box),'invalid_crop_box')
    x,y,w,h=box
    need(0<=x<1 and 0<=y<1 and w>0 and h>0 and x+w<=1.001 and y+h<=1.001,'crop_outside_frame')
    with Image.open(io.BytesIO(image_bytes)) as original:
        iw,ih=original.size;need(iw*ih<=20000000,'image_dimensions_excessive')
        need(w*iw>=28 and h*ih>=28,'crop_too_small')
        rect=(int(x*iw),int(y*ih),min(iw,int(math.ceil((x+w)*iw))),min(ih,int(math.ceil((y+h)*ih))))
        crop=original.convert('RGB').crop(rect);gray=crop.convert('L').resize((48,48),Image.Resampling.BILINEAR)
        need(ImageStat.Stat(gray).stddev[0]>=6,'crop_has_insufficient_detail')
        px=list(gray.get_flattened_data() if hasattr(gray,"get_flattened_data") else gray.getdata());hist=[0.0]*128
        for yy in range(1,47):
            for xx in range(1,47):
                dx=float(px[yy*48+xx+1])-px[yy*48+xx-1];dy=float(px[(yy+1)*48+xx])-px[(yy-1)*48+xx]
                angle=(math.atan2(dy,dx)%math.pi)/math.pi
                cell=min(3,yy//12)*4+min(3,xx//12);hist[cell*8+min(7,int(angle*8))]+=math.hypot(dx,dy)
        hog=normalized(hist)
        hsv=crop.resize((24,24),Image.Resampling.BILINEAR).convert('HSV');colors=[0.0]*24
        for hue,sat,val in (hsv.get_flattened_data() if hasattr(hsv,"get_flattened_data") else hsv.getdata()):
            colors[min(11,hue*12//256)]+=sat/255
            colors[12+min(5,sat*6//256)]+=1
            colors[18+min(5,val*6//256)]+=1
        total=sum(colors);colors=[round(v/total,7) for v in colors]
        return {'version':VERSION,'hog':hog,'colors':colors,'box':[round(v,7) for v in box],
                'width':iw,'height':ih,'imageSha256':expected_sha,'cropSha256':sha(crop.tobytes())}

def valid_feature(f):
    need(isinstance(f,dict) and f.get('version')==VERSION,'feature_version')
    need(isinstance(f.get('hog'),list) and len(f['hog'])==128 and all(number(v) and v>=0 for v in f['hog']),'feature_hog')
    need(isinstance(f.get('colors'),list) and len(f['colors'])==24 and all(number(v) and 0<=v<=1 for v in f['colors']),'feature_colors')
    b=f.get('box');need(isinstance(b,list) and len(b)==4 and all(number(v) for v in b) and b[2]>0 and b[3]>0,'feature_box')
    need(all(type(f.get(k)) is int and f[k]>0 for k in ['width','height']),'feature_dimensions')
    need(isinstance(f.get('imageSha256'),str) and SHA.fullmatch(f['imageSha256']),'feature_image_hash')

def distance(a,b):
    valid_feature(a);valid_feature(b)
    if (a['width'],a['height'])!=(b['width'],b['height']):return None
    ax,ay,aw,ah=a['box'];bx,by,bw,bh=b['box']
    # Do not infer physical scale from unmatched perspective or only pixel area.
    if abs(ax+aw/2-bx-bw/2)>.10 or abs(ay+ah-by-bh)>.10:return None
    if abs(math.log(aw/bw))>.38 or abs(math.log(ah/bh))>.38:return None
    cosine=max(0,min(1,sum(x*y for x,y in zip(a['hog'],b['hog']))))
    visual=1-cosine;color=sum(abs(x-y) for x,y in zip(a['colors'],b['colors']))/2
    shape=min(1,abs(math.log((aw/ah)/(bw/bh))))
    scale=min(1,(abs(math.log(aw/bw))+abs(math.log(ah/bh)))/2)
    return .55*visual+.20*color+.10*shape+.15*scale

def nearest(feature,refs,exclude_scene=None):
    by={}
    for ref in refs:
        if ref['sceneGroup']==exclude_scene:continue
        d=distance(feature,ref['feature'])
        if d is not None:by.setdefault(ref['size'],[]).append((d,ref))
    for entries in by.values():entries.sort(key=lambda item:(item[0],item[1]['imageSha256']))
    return by

def fit(references,binding):
    need(isinstance(binding,dict) and all(isinstance(binding.get(k),str) and binding[k] for k in ['deviceId','cameraName','zoneSha256','detectorModelSha256']),'calibration_binding')
    need(binding['cameraName']=='handoff' and SHA.fullmatch(binding['zoneSha256']) and SHA.fullmatch(binding['detectorModelSha256']),'calibration_binding')
    need(isinstance(references,list) and len(references)<=200,'reference_limit')
    seen={};refs=[]
    for r in references:
        need(r.get('ownerConfirmed') is True and r.get('labelSource')=='owner_confirmed_capacity','unconfirmed_capacity_label')
        need(r.get('size') in CLASSES,'invalid_capacity_label')
        valid_feature(r['feature']);h=r['feature']['imageSha256']
        need(r.get('imageSha256')==h,'reference_hash_mismatch')
        need(h not in seen,'duplicate_reference_image');seen[h]=r['size']
        need(isinstance(r.get('sourceEventId'),str) and bool(r['sourceEventId']),'reference_event_id')
        group=scene_group(r['startedAt'])
        refs.append({'size':r['size'],'sourceEventId':r['sourceEventId'],'sceneGroup':group,'imageSha256':h,'feature':r['feature']})
    groups={c:len({r['sceneGroup'] for r in refs if r['size']==c}) for c in CLASSES}
    candidates={c for c in CLASSES if groups[c]>=MIN_SCENES}
    supported={};validation={}
    for category in sorted(candidates):
        if len(candidates)<2:
            validation[category]={'status':'needs_contrasting_reference_class','independentScenes':groups[category]};continue
        own=[r for r in refs if r['size']==category];positives=[];failures=0
        for r in own:
            near=nearest(r['feature'],refs,r['sceneGroup']);same=near.get(category,[])
            rivals=[d for c,items in near.items() if c!=category for d,_ in items]
            # Two support images from independent scenes, never the held-out scene.
            by_scene={}
            for d,ref in same:by_scene.setdefault(ref['sceneGroup'],d)
            ds=sorted(by_scene.values())
            if len(ds)<2 or not rivals or ds[1]>MAX_DISTANCE or min(rivals)-ds[1]<MIN_MARGIN:
                failures+=1;continue
            positives.append(ds[1])
        validation[category]={'status':'validated' if not failures and positives else 'not_separable','heldOutSceneFailures':failures,'referenceImages':len(own),'independentScenes':groups[category]}
        if not failures and positives:supported[category]={'radius':round(min(MAX_DISTANCE,max(.035,max(positives)*1.15+.01)),7),'minimumMargin':MIN_MARGIN,'minimumSupportingScenes':2}
    status='ready' if any(c in SIZES for c in supported) else 'calibration_required'
    core={'protocol':VERSION,'binding':binding,'status':status,'supported':supported,'validation':validation,'references':refs,
          'labelProvenance':'owner_confirmed_capacity','runtimeGenerativeAi':False,'similarityIsProbability':False,
          'generalizationValidated':False,'missingCategories':[c for c in SIZES if c not in supported]}
    return {'model':core,'modelSha256':sha(canonical(core))}

def predict(feature,model,binding):
    unknown=lambda reason:{'size':'unknown','status':'unclassified','reason':reason,'externalAiUsed':False}
    valid_feature(feature)
    if not model:return unknown('calibration_required')
    need(isinstance(model,dict) and sha(canonical(model.get('model')))==model.get('modelSha256'),'model_checksum')
    m=model['model'];need(m.get('protocol')==VERSION,'model_version')
    if m.get('binding')!=binding:return unknown('camera_or_model_binding_changed')
    if m.get('status')!='ready':return unknown('calibration_required')
    near=nearest(feature,m['references']);winners=[]
    for c,policy in m['supported'].items():
        by_scene={}
        for d,ref in near.get(c,[]):by_scene.setdefault(ref['sceneGroup'],(d,ref))
        ds=sorted(by_scene.values(),key=lambda x:x[0])
        if len(ds)>=2:winners.append((ds[1][0],c,ds[:2],policy))
    if not winners:return unknown('outside_calibrated_view_or_shape')
    winners.sort(key=lambda item:item[0]);score,c,support,policy=winners[0]
    rivals=[d for other,entries in near.items() if other!=c for d,_ in entries]
    margin=min(rivals)-score if rivals else None
    if score>policy['radius'] or margin is None or margin<policy['minimumMargin']:return unknown('ambiguous_or_unfamiliar_appearance')
    if c=='not_cup':return unknown('matches_confirmed_non_serving_object')
    return {'size':c,'status':'classified','reason':'matched_owner_labeled_local_references','basis':'local_reference_estimate',
            'modelSha256':model['modelSha256'],'classifierVersion':VERSION,'imageSha256':feature['imageSha256'],
            'referenceImageHashes':[r['imageSha256'] for _,r in support],'distance':round(score,7),'margin':round(margin,7),
            'externalAiUsed':False,'notACertifiedVolume':True}
