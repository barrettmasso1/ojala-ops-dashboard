#!/usr/bin/env python3
"""Extract timestamped review frames from hash-checked, archived handoff video.

Creates evidence only. Never infers cups, approves a count, or contacts production.
"""
import argparse
import bisect
import concurrent.futures
import datetime as dt
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
from zoneinfo import ZoneInfo

TZ = ZoneInfo('America/Mazatlan')


def build(archive, output, day, scene, start, end, step):
    archive = archive.resolve()
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    first = dt.datetime.fromisoformat(day + 'T' + start).replace(tzinfo=TZ)
    last = dt.datetime.fromisoformat(day + 'T' + end).replace(tzinfo=TZ)
    if last <= first or not 1 <= step <= 60:
        raise ValueError('Invalid review interval')
    db = sqlite3.connect('file:' + str(archive/'index.sqlite3') + '?mode=ro', uri=True)
    db.execute('PRAGMA query_only=ON')
    rows = db.execute('SELECT archive_path,start_time,end_time,sha256 FROM segments '
                      'WHERE end_time>? AND start_time<? ORDER BY start_time',
                      (first.timestamp(), last.timestamp())).fetchall()
    db.close()
    starts = [r[1] for r in rows]
    selected, gaps = [], []
    now = first.timestamp()
    while now < last.timestamp():
        idx = bisect.bisect_right(starts, now)-1
        if idx < 0 or now >= rows[idx][2]:
            gaps.append(dt.datetime.fromtimestamp(now, TZ).isoformat())
        else:
            selected.append((now, rows[idx]))
        now += step
    verified = {}
    for _, row in selected:
        rel, _, _, expected = row
        source = (archive/rel).resolve()
        if not source.is_relative_to(archive) or not source.is_file():
            raise ValueError('Missing or invalid archive source')
        if rel not in verified:
            actual = hashlib.sha256(source.read_bytes()).hexdigest()
            if actual != expected:
                raise ValueError('Archive hash mismatch: ' + rel)
            verified[rel] = actual

    def extract(item):
        timestamp, row = item
        rel, begin, finish, sha = row
        stamp = dt.datetime.fromtimestamp(timestamp, TZ)
        target = output/(stamp.strftime('%H%M%S')+'.jpg')
        args = ['ffmpeg','-nostdin','-hide_banner','-loglevel','error',
                '-threads','1','-ss',str(timestamp-begin),'-i',str(archive/rel),
                '-frames:v','1','-threads','1','-q:v','3','-y',str(target)]
        result = subprocess.run(args, capture_output=True, timeout=30)
        if result.returncode or not target.is_file() or not target.stat().st_size:
            return {'at':stamp.isoformat(),'error':'frame_decode_failed'}
        return {'at':stamp.isoformat(),'source':rel,'segmentStart':begin,
                'segmentEnd':finish,'sourceSha256':sha,
                'framePath':str(target),'frameSha256':hashlib.sha256(target.read_bytes()).hexdigest()}

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        frames = list(pool.map(extract, selected))
    report = {'businessDate':day,'scene':scene,'start':first.isoformat(),
              'end':last.isoformat(),'sampleEverySeconds':step,'frames':frames,
              'unavailableSampleTimes':gaps,'sourceSegmentsHashVerified':len(verified),
              'reviewStatus':'pending','physicalCupCount':None,
              'limitations':'Sampled frames, not a complete video review or a cup count.'}
    (output/'frames.json').write_text(json.dumps(report,indent=2)+'\n')
    from PIL import Image, ImageDraw
    valid = [f for f in frames if 'framePath' in f]
    sheets=[]
    for offset in range(0,len(valid),12):
        group=valid[offset:offset+12]
        w,h=550,460
        canvas=Image.new('RGB',(w*3,h*((len(group)+2)//3)),(245,245,245))
        draw=ImageDraw.Draw(canvas)
        for j,f in enumerate(group):
            with Image.open(f['framePath']) as original:
                iw,ih=original.size
                crop=original.crop((int(iw*.35),int(ih*.26),int(iw*.81),int(ih*.84)))
                crop.thumbnail((w-8,h-32))
                x=(j%3)*w+4;y=(j//3)*h+28
                canvas.paste(crop,(x,y))
                draw.text((x,y-22),scene+' '+f['at'][11:19],fill='black')
        path=output/('sheet-'+str(offset//12+1)+'.jpg')
        canvas.save(path,quality=90);sheets.append(str(path))
    print(json.dumps({'scene':scene,'frames':len(valid),'gaps':len(gaps),
                      'decodeErrors':len(frames)-len(valid),'sheets':sheets}),flush=True)
    return report


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--archive',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--date',required=True)
    p.add_argument('--scene',required=True)
    p.add_argument('--start',required=True)
    p.add_argument('--end',required=True)
    p.add_argument('--step',type=int,default=5)
    a=p.parse_args()
    build(a.archive,a.output,a.date,a.scene,a.start,a.end,a.step)
