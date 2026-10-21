#!/usr/bin/env python3
"""Validate a local scene-review ledger. Never publishes or approves a daily count."""
import argparse,hashlib,json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
TZ=ZoneInfo('America/Mazatlan')
ALLOWED={'repeat_existing','non_cup_observation','non_service_object','ambiguous_no_addition','return_or_identity_unresolved','new_serving_evidence'}
def must(ok,reason):
 if not ok:raise ValueError(reason)
def validate(doc,bases):
 must(doc.get('productionCountWrites')==0 and doc.get('approvedCountsWritten') is False,'production_write_claim_rejected')
 known={};counts={};seen_scenes=set();new={};proofs=set()
 for day,base in bases.items():
  ids=[u['id'] for u in base['units']];must(len(ids)==len(set(ids)),'duplicate_baseline_id');known[day]=set(ids);counts[day]=len(ids)
 for unit in doc['newServingEpisodes']:
  day=unit['date'];ident=unit['id'];must(day in known,'unexpected_day');must(ident not in known[day] and ident not in new,'duplicate_new_unit')
  must(unit.get('humanApproved') is False and unit.get('productionEligible') is False,'approval_not_permitted')
  evidence=unit['evidence'];must(len(evidence)>=4,'temporal_context_missing')
  times=[datetime.fromisoformat(f['at']) for f in evidence]
  must(all(t.tzinfo and t.astimezone(TZ).date().isoformat()==day for t in times),'evidence_date_mismatch')
  must(times==sorted(times) and len(set(times))==len(times),'non_chronological_evidence')
  first=datetime.fromisoformat(day+'T'+unit['firstPlacement']).replace(tzinfo=TZ);last=datetime.fromisoformat(day+'T'+unit['collectionBy']).replace(tzinfo=TZ)
  must(times[0]<first<=last<=times[-1],'before_after_context_missing')
  must(len({f['source'] for f in evidence})>=2,'multiple_source_segments_required')
  fingerprint=tuple(sorted((f['at'],f['sha256']) for f in evidence));must(fingerprint not in proofs,'same_evidence_claimed_as_new_unit');proofs.add(fingerprint)
  must(bool(unit.get('reason')),'missing_identity_reason');new[ident]=day;known[day].add(ident);counts[day]+=1
 linked=set();dispositions={}
 for scene in doc['sceneDispositions']:
  day=scene['date'];key=(day,scene['sceneId']);must(key not in seen_scenes,'duplicate_scene');seen_scenes.add(key)
  kind=scene['decision'];must(kind in ALLOWED,'unknown_disposition');dispositions[kind]=dispositions.get(kind,0)+1
  ids=scene['linkedUnitIds'];must(len(ids)==len(set(ids)),'duplicate_unit_within_scene')
  must(all(i in known.get(day,set()) for i in ids),'unknown_unit_reference')
  if kind in {'non_cup_observation','non_service_object','ambiguous_no_addition','return_or_identity_unresolved'}:must(not ids,'non_countable_case_has_units')
  if kind=='repeat_existing':must(bool(ids),'repeat_without_identity')
  if kind=='new_serving_evidence':must(ids and all(new.get(i)==day for i in ids),'new_scene_not_linked_to_new_units');linked.update(ids)
 must(linked==set(new),'unlinked_new_unit')
 for day,p in doc['proposedLocalLowerBounds'].items():
  must(p.get('proposedLocalUnits')==counts[day],'proposal_count_mismatch');must(p.get('dailyTotal') is None and p.get('coverage')=='partial','partial_not_daily_total');must(p.get('productionImported') is False and p.get('humanApproved') is False,'proposal_cannot_be_approval')
 return {'status':'local_ledger_consistent','reviewedScenes':len(seen_scenes),'newEpisodes':len(new),'proposedLocalUnits':counts,'dispositions':dispositions,'dailyTotalsCertified':False,'productionEligible':False}
def main():
 p=argparse.ArgumentParser();p.add_argument('ledger',type=Path);a=p.parse_args();doc=json.loads(a.ledger.read_text());bases={}
 for d,v in doc['inheritedLocalReconstructions'].items():
  raw=Path(v['path']).read_bytes();must(hashlib.sha256(raw).hexdigest()==v['sha256'],'baseline_changed');bases[d]=json.loads(raw)
 print(json.dumps(validate(doc,bases)))
if __name__=='__main__':main()
