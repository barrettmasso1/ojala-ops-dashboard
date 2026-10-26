"""Bounded read-only OpenCV worker run in existing Frigate, one CPU thread.
Reads only recorded MP4s; emits actual optical observations, never a sale/count.
No network, model inference, frame approvals, camera mutation, or filesystem writes.
"""
import hashlib,json,math,re,sys
from pathlib import PurePosixPath,Path
from datetime import datetime,timezone
from video_reader import SequentialReader
import cv2
import numpy as np

cv2.setNumThreads(1)
ROOT=Path(sys.argv[1]) if len(sys.argv)>1 else Path('/media/frigate/recordings')
if str(ROOT) not in ('/media/frigate/recordings','/home/ojala/frigate/storage/recordings'):raise ValueError('unapproved_recording_root')
def real_path(name):
 p=ROOT/PurePosixPath(name).relative_to('/media/frigate/recordings')
 if p.is_symlink() or not p.resolve().is_relative_to(ROOT.resolve()):raise ValueError('recording_symlink')
 return str(p)
def require(ok,reason):
 if not ok:raise ValueError(reason)
def iso(at):return datetime.fromtimestamp(at,timezone.utc).isoformat()
def main(data):
 seed=datetime.fromisoformat(data['capturedAt'].replace('Z','+00:00')).timestamp();box=data['box'];segments=data['segments']
 require(isinstance(segments,list) and 1<=len(segments)<=8,'segment_limit')
 for item in segments:
  path=PurePosixPath(item['path']);require(str(path).startswith('/media/frigate/recordings/') and '..' not in path.parts and path.suffix=='.mp4' and len(path.parts)==8 and path.parts[-2]=='handoff','segment_path')
  require(isinstance(item['sha256'],str) and re.fullmatch('[a-f0-9]{64}',item['sha256']),'segment_hash')
  with open(real_path(str(path)),'rb') as f:actual=hashlib.file_digest(f,'sha256').hexdigest()
  require(actual==item['sha256'],'segment_integrity')
 previous=None;points=None;initial=None;rect=None;trace=[];reason='window_completed';cap=None;current_path=None;previous_at=None;reader=SequentialReader(cv2.VideoCapture,cv2.CAP_PROP_POS_MSEC)
 try:
  for n in range(121):
   desired=seed+n*.2;matches=[x for x in segments if x['start']<=desired<x['end']]
   if not matches:reason='recording_gap';break
   segment=matches[0];path=segment['path'];begin=segment['start']
   frame,offset=reader.read(real_path(path),max(0,desired-begin))
   if frame is None:
    following=[x for x in segments if x['start']>desired and x['start']-desired<=.35]
    if not following:reason='frame_decode_failed';break
    segment=following[0];begin=segment['start'];frame,offset=reader.read(real_path(segment['path']),0)
    if frame is None:reason='frame_decode_failed';break
   at=begin+offset
   if previous_at is not None and at<=previous_at:continue
   if previous_at is not None and at-previous_at>.45:reason='decoded_frame_gap';break
   if previous_at is None and abs(at-seed)>.4:reason='seed_frame_not_near_capture';break
   require(frame.shape[1]==1280 and frame.shape[0]==720,'recording_resolution_changed')
   reduced=cv2.resize(frame,(1152,648),interpolation=cv2.INTER_AREA);gray=cv2.cvtColor(reduced,cv2.COLOR_BGR2GRAY)
   fb_error=0.0;residual=0.0
   if previous is None:
    x,y,w,h=box;rect=[x*1152,y*648,w*1152,h*648];mask=np.zeros_like(gray);x,y,w,h=rect
    mask[int(y+h*.05):int(y+h*.95),int(x+w*.1):int(x+w*.9)]=255
    points=cv2.goodFeaturesToTrack(gray,mask=mask,maxCorners=50,qualityLevel=.015,minDistance=2,blockSize=3)
    if points is None or len(points)<12:reason='insufficient_initial_features';break
    initial=len(points)
   else:
    nxt,st,err=cv2.calcOpticalFlowPyrLK(previous,gray,points,None,winSize=(15,15),maxLevel=3,criteria=(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,20,.02))
    if nxt is None:reason='tracking_lost';break
    back,bs,_=cv2.calcOpticalFlowPyrLK(gray,previous,nxt,None,winSize=(15,15),maxLevel=3,criteria=(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,20,.02))
    if back is None:reason='tracking_lost';break
    delta=nxt.reshape(-1,2)-points.reshape(-1,2);errors=np.linalg.norm(back.reshape(-1,2)-points.reshape(-1,2),axis=1)
    keep=(st.ravel()==1)&(bs.ravel()==1)&(errors<1.0)&(err.ravel()<25)
    if int(sum(keep))<8 or sum(keep)/initial<.2:reason='insufficient_feature_support';break
    median=np.median(delta[keep],axis=0);res=np.linalg.norm(delta-median,axis=1);keep=keep&(res<3)
    if int(sum(keep))<8 or sum(keep)/initial<.2:reason='motion_not_coherent';break
    move=np.median(delta[keep],axis=0)
    if np.linalg.norm(move)>70:reason='motion_jump';break
    rect[0]+=float(move[0]);rect[1]+=float(move[1]);points=nxt[keep].reshape(-1,1,2);fb_error=float(max(errors[keep]));residual=float(max(res[keep]))
   x,y,w,h=rect
   if x<0 or y<0 or x+w>1152 or y+h>648:reason='target_left_frame';break
   trace.append({'at':iso(at),'box':[round(x/1152,7),round(y/648,7),round(w/1152,7),round(h/648,7)],'features':len(points),'retainedFraction':round(len(points)/initial,7),'forwardBackwardError':round(fb_error,7),'motionResidual':round(residual,7),'frameSha256':hashlib.sha256(gray.tobytes()).hexdigest()})
   previous=gray;previous_at=at
  return {'source':'recorded_video_optical_flow','algorithm':'sparse_lk_forward_backward_v1','samples':trace,'stopReason':reason,'newInference':False,'generativeAiUsed':False}
 finally:
  reader.close()
if __name__=='__main__':
 raw=sys.stdin.read(65537);require(len(raw)<=65536,'input_limit');print(json.dumps(main(json.loads(raw)),separators=(',',':'),allow_nan=False))
