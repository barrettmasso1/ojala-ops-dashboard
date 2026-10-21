#!/usr/bin/env python3
"""Offline high-recall scan of archived handoff video.

Read-only source audit. It never changes Frigate, production thresholds, approved
counts, bridge queues, or dashboard data. Output is review candidates only.
"""
import argparse, datetime as dt, hashlib, json, math, sqlite3
from pathlib import Path
from zoneinfo import ZoneInfo

import cv2
import numpy as np
import openvino as ov
import yaml

TZ=ZoneInfo("America/Mazatlan")

def sha(path):
    h=hashlib.sha256()
    with open(path,"rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""): h.update(chunk)
    return h.hexdigest()

def polygon_and_limits(config_path):
    cfg=yaml.safe_load(Path(config_path).read_text())
    cam=cfg["cameras"]["handoff"]
    coords=cam["zones"]["handoff_zone"]["coordinates"]
    if isinstance(coords,str):
        vals=[float(x) for x in coords.split(",")]
        poly=np.array(vals,dtype=np.float32).reshape(-1,2)
    else:
        poly=np.array(coords,dtype=np.float32)
    filt=cam["objects"]["filters"]["cup"]
    return poly,int(cam["detect"]["width"]),int(cam["detect"]["height"]),float(filt["min_area"]),float(filt["max_area"])

def in_zone(box,poly,refw,refh,min_area,max_area):
    x1,y1,x2,y2=box
    if x2<=x1 or y2<=y1: return False
    area=(x2-x1)*(y2-y1)*refw*refh
    return min_area<=area<=max_area and cv2.pointPolygonTest(poly,(float((x1+x2)/2),float(y2)),False)>=0

def letterbox(frame,size=640):
    h,w=frame.shape[:2]
    scale=min(size/w,size/h)
    nw,nh=int(round(w*scale)),int(round(h*scale))
    resized=cv2.resize(frame,(nw,nh),interpolation=cv2.INTER_LINEAR)
    canvas=np.full((size,size,3),114,dtype=np.uint8)
    dx=(size-nw)//2; dy=(size-nh)//2
    canvas[dy:dy+nh,dx:dx+nw]=resized
    return canvas,scale,dx,dy

def iou(a,b):
    x1=max(a[0],b[0]); y1=max(a[1],b[1]); x2=min(a[2],b[2]); y2=min(a[3],b[3])
    inter=max(0,x2-x1)*max(0,y2-y1)
    if inter<=0:return 0.0
    aa=max(1e-9,(a[2]-a[0])*(a[3]-a[1])); bb=max(1e-9,(b[2]-b[0])*(b[3]-b[1]))
    return inter/(aa+bb-inter)

def detect_cups(frame,compiled,threshold,poly,refw,refh,min_area,max_area):
    h,w=frame.shape[:2]
    img,scale,dx,dy=letterbox(frame)
    rgb=cv2.cvtColor(img,cv2.COLOR_BGR2RGB)
    tensor=rgb.transpose(2,0,1)[None].astype(np.float32)/255.0
    raw=compiled(tensor)[compiled.output(0)]
    pred=np.squeeze(raw)
    if pred.ndim!=2: return []
    if pred.shape[0] in (5,6) and pred.shape[1]>pred.shape[0]: pred=pred.T
    det=[]
    for row in pred:
        if len(row)<5: continue
        score=float(row[4])
        if not math.isfinite(score) or score<threshold: continue
        cx,cy,bw,bh=map(float,row[:4])
        x1=(cx-bw/2-dx)/scale/w; y1=(cy-bh/2-dy)/scale/h
        x2=(cx+bw/2-dx)/scale/w; y2=(cy+bh/2-dy)/scale/h
        box=[max(0,x1),max(0,y1),min(1,x2),min(1,y2)]
        if not in_zone(box,poly,refw,refh,min_area,max_area): continue
        det.append({"score":score,"box":box})
    det.sort(key=lambda d:d["score"],reverse=True)
    kept=[]
    for d in det:
        if all(iou(d["box"],k["box"])<0.45 for k in kept): kept.append(d)
    return kept

def detect_people(frame,compiled,threshold=0.45):
    tensor=cv2.resize(frame,(300,300),interpolation=cv2.INTER_AREA)[None]
    raw=compiled([tensor])[compiled.output(0)][0,0]
    out=[]
    for row in raw:
        if int(row[1])!=1 or float(row[2])<threshold: continue
        x1,y1,x2,y2=map(float,row[3:7])
        if (x2-x1)*(y2-y1)<0.015: continue
        out.append({"score":float(row[2]),"box":[x1,y1,x2,y2]})
    return out

def frame_at(archive_db,archive_root,timestamp,verified):
    row=archive_db.execute("SELECT archive_path,start_time,end_time,sha256 FROM segments WHERE start_time<=? AND end_time>? ORDER BY start_time DESC LIMIT 1",(timestamp,timestamp)).fetchone()
    if not row:return None,None
    rel,begin,end,expected=row
    src=(archive_root/rel).resolve()
    if not src.is_file(): return None,None
    if rel not in verified:
        actual=sha(src)
        if actual!=expected: raise ValueError("archive_hash_mismatch:"+rel)
        verified[rel]=actual
    cap=cv2.VideoCapture(str(src))
    cap.set(cv2.CAP_PROP_POS_MSEC,max(0,(timestamp-begin)*1000.0))
    ok,frame=cap.read(); cap.release()
    if not ok or frame is None:return None,None
    return frame,{"path":rel,"sha256":expected,"segmentStart":begin,"segmentEnd":end}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--audit",required=True)
    ap.add_argument("--archive",required=True)
    ap.add_argument("--config",required=True)
    ap.add_argument("--cup-model",required=True)
    ap.add_argument("--person-model",required=True)
    ap.add_argument("--output",required=True)
    ap.add_argument("--limit",type=int,default=20)
    ap.add_argument("--context-seconds",type=int,default=15)
    ap.add_argument("--sample-step-seconds",type=int,default=5)
    ap.add_argument("--cup-threshold",type=float,default=0.10)
    a=ap.parse_args()
    audit=json.loads(Path(a.audit).read_text())
    out=Path(a.output); out.mkdir(parents=True,exist_ok=True)
    poly,refw,refh,min_area,max_area=polygon_and_limits(a.config)
    core=ov.Core()
    cup=core.compile_model(a.cup_model,"CPU",{"INFERENCE_NUM_THREADS":1})
    person=core.compile_model(a.person_model,"CPU",{"INFERENCE_NUM_THREADS":1})
    archive=Path(a.archive)
    db=sqlite3.connect("file:"+str((archive/"index.sqlite3").resolve())+"?mode=ro",uri=True)
    db.execute("PRAGMA query_only=ON")
    verified={}
    candidates=[]; scanned=0; decode_errors=0
    for wi,w in enumerate(audit["topWindows"][:a.limit],1):
        start=float(w["start"]); end=float(w["end"])
        sample_start=start-max(0,a.context_seconds)
        sample_end=end+max(0,a.context_seconds)
        step=max(1,a.sample_step_seconds)
        times=[]
        t=sample_start
        while t<=sample_end:
            times.append(t)
            t+=step
        hits=[]
        for ti,ts in enumerate(times,1):
            frame,source=frame_at(db,archive,ts,verified)
            if frame is None:
                decode_errors+=1; continue
            scanned+=1
            cups=detect_cups(frame,cup,a.cup_threshold,poly,refw,refh,min_area,max_area)
            if not cups: continue
            people=detect_people(frame,person)
            if not people: continue
            stamp=dt.datetime.fromtimestamp(ts,TZ)
            name=f"w{wi:03d}-{stamp.strftime('%H%M%S')}-{ti}.jpg"
            path=out/name
            draw=frame.copy(); h,wpx=draw.shape[:2]
            for d in cups:
                x1,y1,x2,y2=d["box"]; p1=(int(x1*wpx),int(y1*h)); p2=(int(x2*wpx),int(y2*h))
                cv2.rectangle(draw,p1,p2,(255,255,255),2)
                cv2.putText(draw,f"cup {d['score']:.2f}",(p1[0],max(18,p1[1]-5)),cv2.FONT_HERSHEY_SIMPLEX,0.55,(255,255,255),2)
            cv2.imwrite(str(path),draw,[int(cv2.IMWRITE_JPEG_QUALITY),90])
            hits.append({"at":stamp.isoformat(),"image":name,"imageSha256":sha(path),"source":source,
                         "cups":[{"score":round(d["score"],4),"box":[round(x,5) for x in d["box"]]} for d in cups],
                         "people":[{"score":round(p["score"],4),"box":[round(x,5) for x in p["box"]]} for p in people]})
        if hits:
            candidates.append({"windowIndex":wi,"startLocal":w["startLocal"],"endLocal":w["endLocal"],
                               "motion":w["motion"],"nearestKnownSeconds":w["nearestKnownSeconds"],"hits":hits,
                               "reviewStatus":"pending_human_or_independent_visual_review","physicalCupCount":None})
    db.close()
    report={"schemaVersion":1,"businessDate":audit["businessDate"],"mode":"offline_recovery_review_only",
            "readOnlySources":True,"productionModified":False,"productionThresholdModified":False,
            "cupModelSha256":sha(Path(a.cup_model)),"cupThresholdOffline":a.cup_threshold,
            "contextSeconds":a.context_seconds,"sampleStepSeconds":a.sample_step_seconds,
            "windowsRequested":min(a.limit,len(audit["topWindows"])),"framesScanned":scanned,
            "decodeErrors":decode_errors,"sourceSegmentsHashVerified":len(verified),
            "candidateWindows":len(candidates),"candidates":candidates,
            "limitations":["Low-threshold detections are review candidates, not physical cups.",
                           "Person+cup+zone is a gate for review, not proof of delivery.",
                           "Deduplication across time is required before any count can be created."]}
    (out/"report.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps({"report":str(out/"report.json"),"framesScanned":scanned,"candidateWindows":len(candidates),
                      "decodeErrors":decode_errors,"sourceSegmentsHashVerified":len(verified)},indent=2))
if __name__=="__main__": main()
