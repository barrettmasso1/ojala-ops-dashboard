"""Offline review search eligibility. No production configuration or counts."""
import math
SEARCH_AREAS={'handoff_zone','full_frame'}
def candidate_allowed(box,refw,refh,min_area,max_area,inside_zone,search_area='handoff_zone'):
    if search_area not in SEARCH_AREAS:raise ValueError('invalid_offline_search_area')
    if len(box)!=4 or any(not isinstance(v,(int,float)) or not math.isfinite(v) for v in box):return False
    if not all(isinstance(v,(int,float)) and math.isfinite(v) for v in (refw,refh,min_area,max_area)):return False
    if refw<=0 or refh<=0 or min_area<0 or max_area<min_area:return False
    x1,y1,x2,y2=box
    if not (0<=x1<x2<=1 and 0<=y1<y2<=1):return False
    area=(x2-x1)*(y2-y1)*refw*refh
    if not min_area<=area<=max_area:return False
    return search_area=='full_frame' or inside_zone is True
