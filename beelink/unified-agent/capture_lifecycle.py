"""Bind a captured frame to the original event lifecycle, never a newer event."""
import math
from datetime import datetime

def verify_capture_lifecycle(original,latest,captured_at):
    if not isinstance(original,dict) or not isinstance(latest,dict):return False
    for key in ('id','camera','label','start_time'):
        if original.get(key)!=latest.get(key):return False
    if latest.get('camera')!='handoff' or latest.get('label')!='cup' or latest.get('false_positive'):return False
    start=latest.get('start_time');end=latest.get('end_time')
    valid=lambda x:type(x) in (int,float) and math.isfinite(x)
    if not valid(start) or (end is not None and (not valid(end) or end<start)):return False
    try:
        parsed=datetime.fromisoformat(captured_at.replace('Z','+00:00'))
        if parsed.tzinfo is None:return False
        at=parsed.timestamp()
    except (ValueError,TypeError,AttributeError):return False
    return start-2<=at<=start+600 and (end is None or at<=end+2)
