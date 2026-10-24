"""Independent reconciliation audit: quantities are never borrowed across sources.
A day's detector observations are not a validated physical cup count.
"""
from __future__ import annotations
from datetime import datetime
SIZES=('chico','mediano','pint','litro')
MAP={'chico':'4oz','mediano':'8oz','pint':'Pint','litro':'Liter'}
CATEGORIES=(('chico','here'),('chico','to_go'),('mediano','here'),('mediano','to_go'),('pint','to_go'),('litro','to_go'))

def number(n):return n if type(n) is int and n>=0 else None

def period(p):
    if not isinstance(p,dict) or set(p)!={'start','end'}:return None
    try:
        a=datetime.fromisoformat(p['start'].replace('Z','+00:00'));b=datetime.fromisoformat(p['end'].replace('Z','+00:00'))
        return (a.timestamp(),b.timestamp()) if a.tzinfo and b.tzinfo and a<b else None
    except (TypeError,ValueError,AttributeError):return None

def reconcile(day,store,manual,native,physical=None,pos=None):
    for src in [manual,native,physical,pos]:
        if src is not None and (src.get('businessDate')!=day or src.get('storeId')!=store):raise ValueError('source_date_or_tenant_mismatch')
    m=manual if manual and type(manual.get('reportCount')) is int and manual['reportCount']>0 else None
    n=native if native and number(native.get('detectedTracks')) is not None else None
    rows=[]
    for size in SIZES:
        mv=number((m.get('cups') or {}).get(MAP[size])) if m else None
        cv=number((n.get('sizeBreakdown') or {}).get(size)) if n else None
        pv=number((pos.get('bySize') or {}).get(size)) if pos and pos.get('source')=='actual_pos_export' else None
        rows.append({'size':size,'manualClosing':mv,'cameraObservations':cv,'posUnits':pv})
    manualTotal=sum(r['manualClosing'] for r in rows) if all(r['manualClosing'] is not None for r in rows) else None
    unknown=number((n.get('sizeBreakdown') or {}).get('unknown')) if n else None
    cameraTotal=number(n.get('locallyVerifiedTargets')) if n else None
    if n and (unknown is None or any(r['cameraObservations'] is None for r in rows) or sum(r['cameraObservations'] for r in rows)+unknown!=cameraTotal):raise ValueError('native_breakdown_inconsistent')
    cats=[]
    for size,mode in CATEGORIES:
        field='cupsHere' if mode=='here' else 'cupsToGo'
        mv=number((m.get(field) or {}).get(MAP[size])) if m else None
        pv=number((pos.get('byCategory') or {}).get(size+'_'+mode)) if pos and pos.get('source')=='actual_pos_export' else None
        cv=number((physical.get('byCategory') or {}).get(size+'_'+mode)) if physical and physical.get('kind')=='validated_unique_cups' else None
        cats.append({'category':size+'_'+mode,'manualClosing':mv,'shopify':pv,'uniqueCameraCups':cv})
    reasons=[]
    if m is None:reasons.append('manual_closing_missing')
    if physical is None or physical.get('kind')!='validated_unique_cups':reasons.append('unique_camera_count_not_validated')
    if physical and physical.get('coverage')!='complete':reasons.append('camera_coverage_not_complete')
    mp=period(m.get('period')) if m else None;cp=period(physical.get('period')) if physical else None
    if mp is None or cp is None or mp!=cp:reasons.append('common_interval_not_verified')
    pt=number(physical.get('count')) if physical else None
    if manualTotal is None:reasons.append('manual_quantities_incomplete')
    if pt is None:reasons.append('unique_camera_quantity_unavailable')
    comparable=not reasons
    diff=pt-manualTotal if comparable else None
    pct=round(100*diff/manualTotal,4) if comparable and manualTotal>0 else None
    return {'protocol':'ojala_reconciliation_audit_v1','storeId':store,'businessDate':day,'rows':rows,'sixCategories':cats,
        'manualClosingTotal':manualTotal,'cameraUsableObservations':cameraTotal,'cameraUnclassifiedObservations':unknown,
        'validatedUniqueCameraTotal':pt,'comparable':comparable,'blockingReasons':reasons,'cameraMinusManual':diff,'relativeDifferencePct':pct,
        'agreementOrRecallClaimed':False,'manualClosingIsIndependentTally':bool(m and m.get('source')=='independent_manual_tally'),
        'sourcesAddedTogether':False,'productionWrites':False,'note':'Equal totals are not proof of accuracy. Observations and submitted sales are different measurement units.'}
