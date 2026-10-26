"""Bounded sequential video reads. Original timestamps are never synthesized."""
import math

class SequentialReader:
    def __init__(self,factory,pos_msec,max_reads=64):
        self.factory=factory;self.pos_msec=pos_msec;self.max_reads=max_reads;self.cap=None;self.path=None;self.last_request=None;self.frame=None;self.offset=None
    def close(self):
        if self.cap is not None:self.cap.release()
        self.cap=None
    def read(self,path,offset):
        if type(offset) not in (int,float) or not math.isfinite(offset) or offset<0:raise ValueError('invalid_video_offset')
        if path!=self.path:
            self.close();self.cap=self.factory(path);self.path=path;self.last_request=None;self.frame=None;self.offset=None
            self.cap.set(self.pos_msec,offset*1000)
        if self.last_request is not None and offset<self.last_request:raise ValueError('video_time_went_backwards')
        self.last_request=offset
        if self.offset is not None and self.offset>=offset-1e-6:return self.frame,self.offset
        for _ in range(self.max_reads):
            ok,frame=self.cap.read()
            if not ok:return None,None
            actual=self.cap.get(self.pos_msec)/1000
            if not math.isfinite(actual) or actual<0:raise ValueError('video_timestamp_unavailable')
            if self.offset is not None and actual<self.offset-1e-6:raise ValueError('decoded_time_went_backwards')
            self.frame=frame;self.offset=actual
            if actual>=offset-1e-6:return frame,actual
        raise ValueError('video_decode_budget_exhausted')

def coherent_prefix(segments,seed,max_overlap=.5,max_gap=.45):
    """Keep exact source ranges; stop before a discontinuity, never hide it."""
    if not segments:return []
    result=[];paths=set()
    for s in segments:
        if s['end']<=seed:continue
        if not result:
            if s['start']>seed+max_gap:return []
        else:
            prev=result[-1]
            if s['path'] in paths or s['start']<=prev['start'] or s['start']<prev['end']-max_overlap or s['start']>prev['end']+max_gap:break
        result.append(dict(s));paths.add(s['path'])
    return result
