"""Start bounded server-side size classification; photo uploads never wait on vision."""
SCRIPT=r"""
const day=arguments[0],key='__ojalaAutoSizeJobV1',old=window[key];
if(location.origin!=='https://ojaladarsh-m6piugsr.manus.space')return {status:'origin_mismatch'};
if(old?.status==='running'&&Date.now()-old.startedAt<150000)return {status:'running',eventId:old.eventId||null};
if(old&&Date.now()-(old.finishedAt||old.startedAt)<15000)return old;
const job=window[key]={status:'running',startedAt:Date.now(),eventId:null};
const unpack=x=>x?.result?.data?.json??x?.result?.data;
const read=async()=>{const q=encodeURIComponent(JSON.stringify({json:{businessDate:day,status:'all',limit:200}}));const r=await fetch('/api/trpc/dashboard.handoffVisualEvents?input='+q,{credentials:'same-origin',cache:'no-store',redirect:'error'});if(!r.ok)throw Error('size_readback_http_'+r.status);const data=unpack(await r.json());if(!Array.isArray(data)||data.length>=200)throw Error('size_readback_limit');return data;};
(async()=>{
 const ar=await fetch('/api/trpc/auth.me',{credentials:'same-origin',cache:'no-store',redirect:'error'});if(!ar.ok)throw Error('size_session_unavailable');const user=unpack(await ar.json());if(user?.role!=='admin'||user?.storeId!==1)throw Error('size_owner_session_required');
 const rows=await read();const selected=rows.filter(r=>{
  if(r.storeId!==1||r.businessDate!==day||r.cameraName!=='handoff'||!r.imageKey)return false;
  if(!(r.analysisStatus==='approved_by_ai'||r.analysisStatus==='approved_by_manager'||r.analysisStatus==='pending_review'&&r.aiSuggestedStatus==='approved_by_ai'))return false;
  if(r.cupDescriptions?.some(i=>i.source==='manual')||r.cupDescriptionsMalformed||r.cupDescriptionsUpdatedAt)return false;
  const a=r.autoCupSizeAssessment;if(!a||a.imageSha256!==r.imageSha256)return true;
  if(a.status==='completed'||a.attempts>=3)return false;
  if(a.status==='running'&&Date.parse(a.leaseUntil)>Date.now())return false;
  return !a.retryAfter||Date.parse(a.retryAfter)<=Date.now();
 }).sort((a,b)=>b.id-a.id)[0];
 if(!selected){Object.assign(job,{status:'idle',finishedAt:Date.now()});return;}
 job.eventId=selected.id;
 const r=await fetch('/api/trpc/dashboard.classifyHandoffCupSizes',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({json:{id:selected.id}}),redirect:'error'});
 if(!r.ok)throw Error('size_classification_http_'+r.status);
 const value=unpack(await r.json());const after=(await read()).find(x=>x.id===selected.id);
 const a=after?.autoCupSizeAssessment;
 Object.assign(job,{status:a?.status||value?.status||'awaiting_readback',eventId:selected.id,items:a?.items||[],imageSha256:after?.imageSha256,finishedAt:Date.now(),physicalCountChanged:false});
})().catch(e=>Object.assign(job,{status:'held',error:String(e.message).slice(0,120),finishedAt:Date.now()}));
return {status:'started',physicalCountChanged:false};
"""
def tick(browser,day):
 browser.select_window()
 return browser.call('POST','/execute/sync',{'script':SCRIPT,'args':[day]},timeout=8)
