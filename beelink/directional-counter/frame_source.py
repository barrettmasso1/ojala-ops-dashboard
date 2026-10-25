"""Read-only subscriber run inside existing Frigate; emits metadata, never images.
No broker writes, camera changes, inference, credentials or frame-memory reads.
The socket is bounded; nothing is ever published into Frigate.
"""
import json,os,signal,sys,time
import zmq
from frigate.comms.detections_updater import DetectionSubscriber

stop=False

def finish(*_):
    global stop
    stop=True

signal.signal(signal.SIGTERM,finish)
signal.signal(signal.SIGINT,finish)
subscriber=DetectionSubscriber('video')
subscriber.socket.setsockopt(zmq.RCVHWM,100)
subscriber.socket.setsockopt(zmq.LINGER,0)
os.set_blocking(sys.stdout.fileno(),False)
started=time.monotonic()
dropped=0
try:
    while not stop and time.monotonic()-started<3600:
        message=subscriber.check_for_update(timeout=.3)
        if not message or message[1] is None:continue
        _,data=message
        if not isinstance(data,(list,tuple)) or len(data)!=6 or data[0]!='handoff':continue
        camera,frame_name,frame_at,objects,_,_=data
        selected=[]
        for obj in objects:
            if obj.get('label')!='cup':continue
            selected.append({k:obj.get(k) for k in ['id','label','frame_time','start_time','end_time','box','score','top_score','false_positive','current_zones','entered_zones','stationary','disappeared']})
        packet={'schema':'ojala_frigate_frame_metadata_v1','cameraName':camera,'frameAt':frame_at,'objects':selected,'droppedSincePrevious':dropped}
        encoded=(json.dumps(packet,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
        if len(encoded)>60000:
            dropped+=1;continue
        try:
            n=os.write(sys.stdout.fileno(),encoded)
            if n!=len(encoded):break
            dropped=0
        except BlockingIOError:dropped+=1
        except (BrokenPipeError,OSError):break
finally:
    subscriber.stop()
