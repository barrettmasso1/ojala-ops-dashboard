#!/usr/bin/env python3
import argparse, datetime as dt, json, math, sqlite3
from pathlib import Path
from zoneinfo import ZoneInfo

TZ=ZoneInfo("America/Mazatlan")

def union_seconds(intervals, start, end):
    rows=[]
    for a,b in sorted(intervals):
        a=max(a,start); b=min(b,end)
        if b<=a: continue
        if rows and a<=rows[-1][1]:
            rows[-1][1]=max(rows[-1][1],b)
        else:
            rows.append([a,b])
    return sum(b-a for a,b in rows)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--date",required=True)
    ap.add_argument("--base",default="/home/ojala/frigate")
    ap.add_argument("--db",default=None,help="Optional read-only Frigate DB or preserved session snapshot")
    ap.add_argument("--window-seconds",type=int,default=30)
    ap.add_argument("--event-radius",type=int,default=45)
    ap.add_argument("--top",type=int,default=20)
    a=ap.parse_args()
    base=Path(a.base)
    day=a.date
    start=dt.datetime.fromisoformat(day+"T12:00:00").replace(tzinfo=TZ).timestamp()
    end=dt.datetime.fromisoformat(day+"T21:00:00").replace(tzinfo=TZ).timestamp()
    db_path=Path(a.db) if a.db else base/"config/frigate.db"
    db=sqlite3.connect("file:"+str(db_path.resolve())+"?mode=ro",uri=True)
    db.execute("PRAGMA query_only=ON")
    rec=db.execute("SELECT start_time,end_time,motion,objects,path FROM recordings WHERE camera=? AND end_time>? AND start_time<? ORDER BY start_time",("handoff",start,end)).fetchall()
    events=db.execute("SELECT id,start_time,zones FROM event WHERE camera=? AND label=? AND start_time>=? AND start_time<? ORDER BY start_time",("handoff","cup",start,end)).fetchall()
    db.close()
    event_times=[]
    for eid,ts,zones in events:
        try: z=json.loads(zones) if isinstance(zones,str) else zones
        except Exception: z=[]
        if "handoff_zone" in (z or []):
            event_times.append((ts,eid))
    cand=[]
    manifest=base/f"pilot-reports/{day}/candidate_manifest.json"
    if manifest.exists():
        raw=json.loads(manifest.read_text())
        rows=raw if isinstance(raw,list) else raw.get("candidates",raw.get("events",[]))
        for item in rows:
            stamp=item.get("captured_at_local")
            if stamp:
                cand.append((dt.datetime.fromisoformat(stamp).timestamp(),item.get("cup_event_id")))
    known=[x[0] for x in event_times]+[x[0] for x in cand]
    metadata_covered=union_seconds([(r[0],r[1]) for r in rec],start,end)
    metadata_pct=round(100*metadata_covered/(end-start),3)
    full_shift_ranking_valid=metadata_pct>=80.0
    wins=[]
    t=start
    while t<end:
        u=min(end,t+a.window_seconds)
        overlapping=[r for r in rec if r[1]>t and r[0]<u]
        intervals=[(r[0],r[1]) for r in overlapping]
        covered=union_seconds(intervals,t,u)
        motion=sum(float(r[2] or 0) for r in overlapping)
        nearest=min([abs(k-(t+u)/2) for k in known] or [10**9])
        has_known=nearest<=a.event_radius
        wins.append({"start":t,"end":u,"motion":round(motion,3),"coveredSeconds":round(covered,3),"coveragePct":round(100*covered/(u-t),3),"nearestKnownSeconds":round(nearest,3),"hasKnownNearby":has_known})
        t=u
    silent=[w for w in wins if not w["hasKnownNearby"] and w["coveragePct"]>=80 and w["motion"]>0]
    silent.sort(key=lambda w:(w["motion"],w["coveragePct"]),reverse=True)
    chosen=[]
    for w in silent:
        center=(w["start"]+w["end"])/2
        if any(abs(center-(x["start"]+x["end"])/2)<120 for x in chosen):
            continue
        chosen.append(w)
        if len(chosen)>=a.top: break
    for w in chosen:
        w["startLocal"]=dt.datetime.fromtimestamp(w["start"],TZ).isoformat()
        w["endLocal"]=dt.datetime.fromtimestamp(w["end"],TZ).isoformat()
    outdir=base/f"pilot-reports/{day}/full-shift-gap-audit"
    outdir.mkdir(parents=True,exist_ok=True)
    report={
      "schemaVersion":1,"businessDate":day,"camera":"handoff","purpose":"find_high_motion_windows_without_nearby_cup_event_or_verified_candidate",
      "readOnly":True,"productionModified":False,"windowSeconds":a.window_seconds,"knownEventRadiusSeconds":a.event_radius,
      "shiftStart":dt.datetime.fromtimestamp(start,TZ).isoformat(),"shiftEnd":dt.datetime.fromtimestamp(end,TZ).isoformat(),
      "sourceDb":str(db_path.resolve()),"recordingRows":len(rec),"recordingMetadataCoveragePct":metadata_pct,
      "fullShiftRankingValid":full_shift_ranking_valid,"cupEventsInZone":len(event_times),"verifiedCandidateTimestamps":len(cand),
      "windowsEvaluated":len(wins),"silentMotionWindows":len(silent),"topWindows":chosen,
      "limitations":([
        "Recording metadata covers less than 80% of the shift; ranking is incomplete and must not be described as a full-shift audit."
      ] if not full_shift_ranking_valid else [])+[
        "Motion is a prioritization signal, not a cup count.",
        "No window is counted as a delivery without subsequent video review and deduplication.",
        "Known cup events and verified snapshots are excluded only within the configured time radius; missed cups may still occur near known events."
      ]
    }
    (outdir/"audit.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps({"output":str(outdir/"audit.json"),"recordingRows":len(rec),"cupEventsInZone":len(event_times),"verifiedCandidates":len(cand),"silentMotionWindows":len(silent),"top":[{"start":x["startLocal"],"motion":x["motion"],"coveragePct":x["coveragePct"],"nearestKnownSeconds":x["nearestKnownSeconds"]} for x in chosen[:10]]},indent=2))
if __name__=="__main__": main()
