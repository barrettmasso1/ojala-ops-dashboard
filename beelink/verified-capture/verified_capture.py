#!/usr/bin/env python3
"""Ojala: candidate screenshots, requiring cup and person in the same frame."""
import datetime as dt
import fcntl
import hashlib
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import re
import shutil
import signal
import sys
import time
from urllib.parse import urlencode
from urllib.request import urlopen

from capture_lifecycle import verify_capture_lifecycle

import cv2
import numpy as np
import openvino as ov

VERSION = "2026-10-24.1"
API = "http://127.0.0.1:5000/api"
BASE = Path("/config")
OUT = BASE / "verified_snapshots/handoff"
HEALTH = BASE / "verified_capture_health.json"
MODEL = "/openvino-model/ssdlite_mobilenet_v2.xml"
CUP_MODEL = "/config/model_cache/ojala_cups_v4_640.onnx"
ZONE = "handoff_zone"
RETENTION_DAYS = 30
MAX_BYTES = 1024**3
MIN_FREE = 1024**3
STOP = False
LOG = logging.getLogger("verified_capture")

def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def atomic_write(path, data):
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)

def json_write(path, value):
    atomic_write(path, (json.dumps(value, indent=2) + "\n").encode())

def fetch(path):
    with urlopen(API + path, timeout=4) as response:
        return response.read()

def decode(jpeg):
    frame = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("invalid JPEG")
    return frame

def geometry(config):
    cam = config["cameras"]["handoff"]
    coords = cam["zones"][ZONE]["coordinates"]
    if isinstance(coords, str):
        points = np.array([float(x) for x in coords.split(",")], np.float32).reshape(-1, 2)
    else:
        raise ValueError("unsupported zone coordinates")
    if points.min() < 0 or points.max() > 1:
        raise ValueError("zone must use normalized coordinates")
    return {"polygon": points, "width": int(cam["detect"]["width"]),
            "height": int(cam["detect"]["height"]),
            "min_area": float(cam["objects"]["filters"]["cup"]["min_area"]),
            "max_area": float(cam["objects"]["filters"]["cup"]["max_area"])}

def in_zone(box, geom):
    x, y, w, h = map(float, box)
    if not all(np.isfinite([x,y,w,h])) or min(w,h) <= 0:
        return False
    area = w * h * geom["width"] * geom["height"]
    return (geom["min_area"] <= area <= geom["max_area"] and
            cv2.pointPolygonTest(geom["polygon"], (x+w/2, y+h), False) >= 0)

def event_eligible(event, geom):
    box = event.get("data", {}).get("box")
    return (event.get("camera") == "handoff" and event.get("label") == "cup"
            and event.get("end_time") is None and ZONE in event.get("zones", [])
            and isinstance(box, list) and len(box) == 4 and in_zone(box, geom))

def person_detection(jpeg, compiled):
    frame = decode(jpeg)
    tensor = cv2.resize(frame, (300,300), interpolation=cv2.INTER_AREA)[None]
    detections = compiled([tensor])[compiled.output(0)][0,0]
    people = []
    for row in detections:
        if int(row[1]) != 1 or float(row[2]) < 0.45:
            continue
        x1,y1,x2,y2 = [float(v) for v in row[3:7]]
        if (x2-x1)*(y2-y1) < 0.015:
            continue
        people.append({"score": round(float(row[2]),3),
                       "box": [round(v,4) for v in (x1,y1,x2,y2)]})
    return people

def cup_detection(jpeg, event, compiled, geom):
    frame = decode(jpeg)
    height,width = frame.shape[:2]
    region = event.get("data", {}).get("region")
    if not region or len(region) != 4 or not all(np.isfinite(region)):
        return None
    x,y,rw,rh = map(float,region)
    left,top = int(round(x*width)),int(round(y*height))
    cw,ch = int(round(rw*width)),int(round(rh*height))
    if min(cw,ch) < 32 or max(cw,ch) > 4*max(width,height):
        return None
    # Frigate regions may extend outside the image. Preserve shape with black padding.
    crop = np.zeros((ch,cw,3),dtype=np.uint8)
    sx0,sy0 = max(0,left),max(0,top)
    sx1,sy1 = min(width,left+cw),min(height,top+ch)
    if sx1 <= sx0 or sy1 <= sy0:
        return None
    crop[sy0-top:sy1-top,sx0-left:sx1-left] = frame[sy0:sy1,sx0:sx1]
    rgb = cv2.cvtColor(cv2.resize(crop,(640,640)),cv2.COLOR_BGR2RGB)
    # Identical pixel scale to Frigate InputDTypeEnum.float.
    tensor = rgb.transpose(2,0,1)[None].astype(np.float32) / 255.0
    predictions = compiled(tensor)[compiled.output(0)].squeeze().T
    bx,by,bw,bh = map(float,event["data"]["box"])
    event_center = (bx+bw/2,by+bh/2)
    best = None
    for row in predictions:
        score = float(row[4])
        if not np.isfinite(score) or score < 0.45:
            continue
        cx = (left+float(row[0])*cw/640)/width
        cy = (top+float(row[1])*ch/640)/height
        w = float(row[2])*cw/(640*width)
        h = float(row[3])*ch/(640*height)
        box = [cx-w/2,cy-h/2,w,h]
        if not in_zone(box,geom):
            continue
        if ((cx-event_center[0])**2+(cy-event_center[1])**2)**0.5 > 0.035:
            continue
        if best is None or score > best["score"]:
            best = {"score": round(score,4),"box":[round(v,5) for v in box]}
    return best

def stored_ids():
    ids = set()
    for p in OUT.glob("*.json"):
        try:
            data=json.loads(p.read_text())
            if p.with_suffix(".jpg").is_file():
                ids.add(data["cup_event_id"])
        except (ValueError,KeyError,OSError):
            continue
    return ids

def save_verified(event,jpeg,people,cup,geom,captured_at):
    if not people or not cup:
        raise ValueError("both detections required")
    eid = event["id"]
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}",eid):
        raise ValueError("invalid event id")
    OUT.mkdir(parents=True,exist_ok=True)
    if shutil.disk_usage(OUT).free < MIN_FREE:
        raise OSError("low_disk_space")
    stem = dt.datetime.fromtimestamp(event["start_time"],dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")+"_"+eid
    image_path,meta_path = OUT/(stem+".jpg"),OUT/(stem+".json")
    if image_path.exists() and meta_path.exists():
        return False
    frame=decode(jpeg)
    if not isinstance(captured_at,str) or dt.datetime.fromisoformat(captured_at).tzinfo is None:
        raise ValueError("capture timestamp must include timezone")
    zone_geometry={"name":ZONE,"coordinate_system":"normalized",
        "polygon":[[round(float(x),6),round(float(y),6)] for x,y in geom["polygon"]],
        "reference_width":geom["width"],"reference_height":geom["height"],
        "membership_rule":"box_bottom_center"}
    zone_digest=hashlib.sha256(json.dumps(zone_geometry,sort_keys=True,separators=(",",":")).encode()).hexdigest()
    metadata = {"schema_version":3,"gate_version":VERSION,"camera":"handoff",
        "cup_event_id":eid,"cup_zone":ZONE,"cup_event_start":event["start_time"],
        "captured_at_utc":captured_at,"timestamp_source":"beelink_received_at",
        "cup":cup,"people":people,
        "image_dimensions":{"width":int(frame.shape[1]),"height":int(frame.shape[0])},
        "zone_geometry":zone_geometry,"zone_config_sha256":zone_digest,
        "image_sha256":hashlib.sha256(jpeg).hexdigest(),
        "interpretation":"cup and person detected in the same image; delivery not confirmed"}
    atomic_write(image_path,jpeg)
    # JSON is the completion marker; readers must require both files.
    json_write(meta_path,metadata)
    return True

def cleanup():
    OUT.mkdir(parents=True,exist_ok=True)
    files=sorted(OUT.glob("*.jpg"),key=lambda p:p.stat().st_mtime)
    total=sum(p.stat().st_size for p in files)
    cutoff=time.time()-RETENTION_DAYS*86400
    for p in files:
        if p.stat().st_mtime < cutoff or total > MAX_BYTES:
            total -= p.stat().st_size
            p.unlink(missing_ok=True)
            p.with_suffix(".json").unlink(missing_ok=True)

def stop_handler(*_):
    global STOP
    STOP=True

def run():
    lock=open(BASE/"verified_capture.runtime.lock","w")
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:
        return
    handler=RotatingFileHandler(BASE/"verified_capture.log",maxBytes=2*1024**2,backupCount=2)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    LOG.addHandler(handler);LOG.setLevel(logging.INFO)
    signal.signal(signal.SIGTERM,stop_handler)
    signal.signal(signal.SIGINT,stop_handler)
    state={"version":VERSION,"pid":os.getpid(),"source_sha256":hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
           "started_at_utc":utc(),"status":"starting","saved_this_run":0,
           "candidates_checked":0,"rejected_cup":0,"rejected_person":0,"rejected_lifecycle":0,"errors":0}
    def heartbeat():
        state["heartbeat_utc"]=utc();state["heartbeat_epoch"]=time.time()
        json_write(HEALTH,state)
    heartbeat()
    core=ov.Core()
    settings={"INFERENCE_NUM_THREADS":1}
    person=core.compile_model(MODEL,"CPU",settings)
    cup_model=core.compile_model(CUP_MODEL,"CPU",settings)
    cleanup();completed=stored_ids();attempted={}
    last_config=last_health=last_cleanup=0
    LOG.info("started version=%s restored_ids=%d",VERSION,len(completed))
    while not STOP:
        now=time.time()
        try:
            if now-last_config>60:
                geom=geometry(json.loads(fetch("/config")));last_config=now
            stats=json.loads(fetch("/stats"))["cameras"]["handoff"]
            state.update({k:stats.get(k) for k in ("camera_fps","process_fps","skipped_fps")})
            if float(stats["camera_fps"]) < 1:
                state["status"]="camera_unavailable"
                heartbeat();time.sleep(2);continue
            state["status"]="running"
            query=urlencode({"camera":"handoff","label":"cup","in_progress":1,"limit":100})
            events=json.loads(fetch("/events?"+query))
            for event in events:
                eid=event["id"]
                if eid in completed or not event_eligible(event,geom):
                    continue
                if now-attempted.get(eid,0)<1.5:
                    continue
                attempted[eid]=now
                jpeg=fetch("/handoff/latest.jpg")
                captured_at=utc()
                state["candidates_checked"]+=1
                cup=cup_detection(jpeg,event,cup_model,geom)
                if not cup:
                    state["rejected_cup"]+=1;continue
                people=person_detection(jpeg,person)
                if not people:
                    state["rejected_person"]+=1;continue
                # Recheck the same event after inference: a delayed live frame must
                # not be attached to a track that already ended or was rejected.
                latest_event=json.loads(fetch("/events/"+eid))
                if not verify_capture_lifecycle(event,latest_event,captured_at):
                    state["rejected_lifecycle"]+=1
                    LOG.info("rejected_lifecycle event=%s",eid)
                    continue
                if save_verified(event,jpeg,people,cup,geom,captured_at):
                    state["saved_this_run"]+=1;state["last_saved_utc"]=utc()
                    LOG.info("saved event=%s cup_score=%.3f people=%d",eid,cup["score"],len(people))
                completed.add(eid)
            attempted={k:v for k,v in attempted.items() if now-v<300}
            if now-last_cleanup>3600:
                cleanup();completed=stored_ids();last_cleanup=now
            if now-last_health>5:
                heartbeat();last_health=now
        except Exception as exc:
            state["errors"]+=1;state["status"]="degraded";state["last_error_type"]=type(exc).__name__
            LOG.error("poll_error type=%s",type(exc).__name__)
            heartbeat();time.sleep(3)
        time.sleep(0.8)
    state["status"]="stopped";heartbeat();LOG.info("stopped")

if __name__=="__main__":
    run()
