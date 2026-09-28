"""Small, dependency-free temporal gate. Tracks are never delivery counts."""
import math

def iou(a, b):
    ax,ay,aw,ah=a; bx,by,bw,bh=b
    overlap=max(0,min(ax+aw,bx+bw)-max(ax,bx))*max(0,min(ay+ah,by+bh)-max(ay,by))
    return overlap/max(aw*ah+bw*bh-overlap,1e-12)

def in_polygon(x, y, polygon):
    inside=False
    for i,(ax,ay) in enumerate(polygon):
        bx,by=polygon[(i+1)%len(polygon)]
        cross=(x-ax)*(by-ay)-(y-ay)*(bx-ax)
        if abs(cross)<1e-10 and min(ax,bx)<=x<=max(ax,bx) and min(ay,by)<=y<=max(ay,by):
            return True
        if (ay>y)!=(by>y) and x<(bx-ax)*(y-ay)/(by-ay)+ax:
            inside=not inside
    return inside

def valid_box(box, polygon, width, height, min_area, max_area):
    if len(box)!=4 or not all(math.isfinite(v) for v in box):return False
    x,y,w,h=box
    return (0<=x<1 and 0<=y<1 and w>0 and h>0 and x+w<=1 and y+h<=1
            and min_area<=w*h*width*height<=max_area
            and in_polygon(x+w/2,y+h,polygon))

def nms(detections, threshold=.45):
    keep=[]
    for d in sorted(detections,key=lambda d:d['score'],reverse=True):
        if all(iou(d['box'],k['box'])<=threshold for k in keep):keep.append(d)
    return keep

def associate(previous, detections, now, max_gap=7.0, max_distance=.035):
    """Greedy global pairing: a detection and a track are each used once."""
    edges=[]
    for track in previous:
        if now-track['last_seen']>max_gap or now<track['last_seen']:continue
        a=track['box'];ax,ay=a[0]+a[2]/2,a[1]+a[3]/2
        for index,d in enumerate(detections):
            b=d['box'];distance=math.hypot(ax-b[0]-b[2]/2,ay-b[1]-b[3]/2)
            overlap=iou(a,b)
            if distance<=max_distance and (overlap>=.1 or distance<.012):
                edges.append((overlap-distance,index,track['id']))
    matches={};used=set()
    for _,index,track_id in sorted(edges,reverse=True):
        if index not in matches and track_id not in used:
            matches[index]=track_id;used.add(track_id)
    return matches

def healthy_for_shadow(camera):
    return (camera.get('detection_enabled',False) and float(camera.get('camera_fps',0))>=4.5
            and float(camera.get('process_fps',0))>=4.5 and float(camera.get('skipped_fps',99))<=.7)
