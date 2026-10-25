"""Auditable counter-to-customer PICKUP ESTIMATES, not sales or certified totals.
The source is actual video motion linked to an already persisted cup photograph.
A track ending, a photo, or an unknown size alone never creates a pickup.
"""
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
import hashlib,json,math,re
PROTOCOL='ojala_counter_pickups_v1'
SIZES=('chico','mediano','pint','litro','unknown')
SHA=re.compile(r'^[a-f0-9]{64}$')

def canonical(x):return json.dumps(x,sort_keys=True,separators=(',',':'),allow_nan=False)
def digest(x):return hashlib.sha256(x.encode() if isinstance(x,str) else x).hexdigest()
def require(x,reason):
 if not x:raise ValueError(reason)
def finite(x):return type(x) in (int,float) and math.isfinite(x)
def epoch(s):
 d=datetime.fromisoformat(s.replace('Z','+00:00'));require(d.tzinfo is not None,'timezone_required');return d.timestamp()
def stamp(t):return datetime.fromtimestamp(t,timezone.utc).isoformat()
def inside(point,poly):
 x,y=point;answer=False
 for i,(ax,ay) in enumerate(poly):
  bx,by=poly[(i+1)%len(poly)]
  if abs((x-ax)*(by-ay)-(y-ay)*(bx-ax))<1e-10 and min(ax,bx)<=x<=max(ax,bx) and min(ay,by)<=y<=max(ay,by):return True
  if (ay>y)!=(by>y) and x<(bx-ax)*(y-ay)/(by-ay)+ax:answer=not answer
 return answer

def box(b):
 require(isinstance(b,list) and len(b)==4 and all(finite(v) for v in b),'invalid_box')
 x,y,w,h=b;require(0<=x<1 and 0<=y<1 and w>0 and h>0 and x+w<=1.001 and y+h<=1.001,'box_bounds');return b

def validate_policy(p):
 require(p.get('schema')=='ojala_optical_pickup_policy_v1','policy_schema')
 require(p.get('geometryCalibration')=='provisional_visual_orientation' and p.get('commercialAccuracyValidated') is False,'policy_not_certified')
 require(p.get('cameraName')=='handoff' and isinstance(p.get('deviceId'),str),'policy_scope')
 for k in ['detectorModelSha256','sourceZoneSha256','referenceImageSha256']:require(isinstance(p.get(k),str) and SHA.fullmatch(p[k]),'policy_hash')
 expected={'minimumFeatures':8,'minimumRetainedFraction':.2,'maxSampleGapSeconds':.45,'minimumStableSeconds':.4,'minimumOutsideSamples':2,'minimumMotionHeights':.5,'maximumDurationSeconds':24,'maximumForwardBackwardError':1.0,'maximumMotionResidual':3.0}
 require(all(p.get(k)==v for k,v in expected.items()),'policy_thresholds')
 require(p.get('width')==2304 and p.get('height')==1296 and p.get('recordingWidth')==1280 and p.get('recordingHeight')==720,'policy_dimensions');ZoneInfo(p['timezone'])
 require(set(p['zones'])=={'handoff','customer'},'policy_zones')
 for poly in p['zones'].values():
  require(isinstance(poly,list) and 3<=len(poly)<=16,'polygon_size')
  require(all(isinstance(pt,list) and len(pt)==2 and all(finite(v) and 0<=v<=1 for v in pt) for pt in poly),'polygon_bounds')
 return p

def identify(o,policy):return digest(policy['deviceId']+'/optical-pickup/'+o['sourceEventId']+'/'+digest(canonical(policy)))

def assess(record,observation,policy):
 """Recompute result from samples and authoritative native observation."""
 validate_policy(policy);o=observation
 require(record.get('eventId')==identify(o,policy),'event_identity')
 require(o.get('deviceId')==policy['deviceId'] and o.get('cameraName')=='handoff','observation_scope')
 require(o.get('detectorModelSha256')==policy['detectorModelSha256'],'detector_changed')
 require(record.get('sourceEventId')==o['sourceEventId'] and record.get('observationId')==o['observationId'],'source_identity')
 require(record.get('businessDate')==o['businessDate'],'business_date')
 if o.get('sourceFalsePositive') or o.get('verification')=='detector_rejected':return {'status':'source_rejected','size':'unknown','completedAt':None}
 if o.get('ownerSizeReview',{}).get('label')=='not_cup':return {'status':'owner_excluded','size':'unknown','completedAt':None}
 proof=o.get('sameFrameEvidence');require(o.get('verification')=='same_frame_local_cv' and proof,'same_frame_evidence_required')
 require(proof['imageSha256']==record.get('imageSha256') and proof['capturedAt']==record.get('seedCapturedAt'),'seed_binding')
 require(proof['sourceZoneSha256']==policy['sourceZoneSha256'],'geometry_changed')
 require(o.get('size') in SIZES,'invalid_size')
 samples=record.get('samples');require(isinstance(samples,list) and len(samples)<=121,'sample_limit')
 if not samples:return {'status':'tracking_unavailable','size':'unknown','completedAt':None}
 seed=epoch(proof['capturedAt']);previous=None;stable_start=None;armed=False;outside=[];start_point=None;accepted=None
 for index,s in enumerate(samples):
  require(isinstance(s,dict),'sample_type');at=epoch(s['at']);b=box(s['box'])
  require(seed-.4<=at<=seed+24.5,'sample_time_window')
  require(datetime.fromtimestamp(at,ZoneInfo(policy['timezone'])).date().isoformat()==o['businessDate'],'sample_day')
  require(previous is None or 0<at-previous<=.45,'sample_gap')
  require(isinstance(s.get('frameSha256'),str) and SHA.fullmatch(s['frameSha256']),'frame_hash')
  require(type(s.get('features')) is int and s['features']>=8 and s['features']<=50,'feature_support')
  require(finite(s.get('retainedFraction')) and .2<=s['retainedFraction']<=1,'feature_fraction')
  require(finite(s.get('forwardBackwardError')) and 0<=s['forwardBackwardError']<=1.0,'flow_roundtrip')
  require(finite(s.get('motionResidual')) and 0<=s['motionResidual']<=3.0,'flow_consensus')
  if index==0:
   require(all(abs(v-w)<1e-6 for v,w in zip(b,proof['targetBox'])),'seed_box')
   start_point=(b[0]+b[2]/2,b[1]+b[3]);require(inside(start_point,policy['zones']['handoff']),'seed_not_on_counter')
  point=(b[0]+b[2]/2,b[1]+b[3]);on_counter=inside(point,policy['zones']['handoff']);on_customer=inside(point,policy['zones']['customer'])
  if on_counter and not on_customer:
   if accepted is not None:return {'status':'path_ambiguous','size':'unknown','completedAt':None}
   if not armed:
    if stable_start is None:stable_start=at
    if at-stable_start>=.4-1e-6:armed=True
   outside=[]
  elif on_customer and not on_counter and armed:
   displacement=math.hypot(point[0]-start_point[0],point[1]-start_point[1])
   if displacement>=proof['targetBox'][3]*.5:outside.append(s)
   else:outside=[]
   if len(outside)>=2 and accepted is None:accepted=(index+1,s['at'])
  else:
   return {'status':'path_ambiguous','size':'unknown','completedAt':None}
  previous=at
 if accepted is not None:return {'status':'pickup_estimate','size':o['size'],'completedAt':accepted[1],'acceptedThrough':accepted[0],'method':'local_video_optical_flow','paidSaleConfirmed':False,'physicalUniqueCountCertified':False}
 return {'status':'no_accepted_exit','size':'unknown','completedAt':None}

def summarize(records,observations,policy):
 by_id={o['observationId']:o for o in observations};results=[];counted=[];sizes={s:0 for s in SIZES}
 for r in sorted(records,key=lambda x:(x['seedCapturedAt'],x['eventId'])):
  o=by_id.get(r['observationId']);require(o is not None,'persisted_observation_missing')
  result=assess(r,o,policy);item={'eventId':r['eventId'],'sourceEventId':r['sourceEventId'],'imageSha256':r['imageSha256'],**result}
  if result['status']=='pickup_estimate':
   last=r['samples'][result['acceptedThrough']-1]['box'];point=(last[0]+last[2]/2,last[1]+last[3]);done=epoch(result['completedAt'])
   for old,oldrec in counted:
    oldlast=oldrec['samples'][old['acceptedThrough']-1]['box'];oldpoint=(oldlast[0]+oldlast[2]/2,oldlast[1]+oldlast[3])
    if abs(done-epoch(old['completedAt']))<=2 and math.hypot(point[0]-oldpoint[0],point[1]-oldpoint[1])<.025:
     item.update(status='identity_uncertain',possibleDuplicateOf=old['eventId']);break
   if item['status']=='pickup_estimate':sizes[o['size']]+=1;counted.append((item,r))
  results.append(item)
 return {'estimatedPickups':sum(sizes.values()),'sizeBreakdown':sizes,'records':results,'unresolved':sum(x['status'] not in ('pickup_estimate','source_rejected','owner_excluded') for x in results),'countsAreSales':False,'coversWholeBusinessDay':False,'physicalUniqueCountCertified':False,'externalAiInvoked':False,'requiredHumanAction':False}
