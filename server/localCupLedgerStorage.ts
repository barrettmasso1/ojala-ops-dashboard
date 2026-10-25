import { ENV } from "./_core/env";
import { storageGetSignedUrl } from "./storage";
import { checkStored, compareRevision, ledgerStorageKey, localLedgerReceipt, parseLocalLedger, storedLedger, summarizeLocalLedger, MAX_LOCAL_LEDGER_BYTES, type ParsedLocalLedger } from "./localCupLedger";

export type BlobRead={text:string;etag:string};
export interface LocalLedgerBlobStore {
  read(key:string):Promise<BlobRead|null>;
  compareAndPut(key:string,text:string,expectedEtag:string|null):Promise<void>;
}
export class LedgerConflict extends Error {}
export type LedgerStorageStage="object_get"|"presign_put"|"object_put";
export class LedgerStorageError extends Error {
  constructor(message:string,readonly stage:LedgerStorageStage,readonly status?:number){super(message);this.name="LedgerStorageError";}
}
export const LOCAL_LEDGER_READ_HOST="d36hbw14aib5lz.cloudfront.net";
const safeKey=(key:string)=>/^local-cup-ledger\/v1\/store-[1-9]\d*\/[a-f0-9-]{36}\/\d{4}-\d{2}-\d{2}\.json$/.test(key);
const safeDirectionalKey=(key:string)=>/^directional-handoffs\/v1\/store-[1-9]\d*\/[a-f0-9-]{36}\/\d{4}-\d{2}-\d{2}\.json$/.test(key);
const safeCounterPickupKey=(key:string)=>/^counter-pickups\/v1\/store-[1-9]\d*\/[a-f0-9-]{36}\/\d{4}-\d{2}-\d{2}\.json$/.test(key);
const strongEtag=(value:string|null)=>Boolean(value&&/^"[\x21\x23-\x7e\x80-\xff]+"$/.test(value));
const validateUrl=(raw:string,allowLedgerReadHost:boolean)=>{
  const u=new URL(raw);
  const awsStorage=u.hostname.endsWith(".amazonaws.com");
  const projectReadStorage=allowLedgerReadHost&&u.hostname===LOCAL_LEDGER_READ_HOST;
  if(u.protocol!=="https:"||(!awsStorage&&!projectReadStorage)||u.username||u.password||(u.port&&u.port!=="443"))throw Error("untrusted_storage_url");
  return u;
};
const safeReadUrl=(raw:string)=>validateUrl(raw,true);
const safePutUrl=(raw:string)=>validateUrl(raw,false);
async function limitedText(response:Response,max:number) {
  if(Number(response.headers.get("content-length")||0)>max)throw Error("storage_object_too_large");
  if(!response.body)throw Error("storage_body_missing");
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let total=0;
  try{while(true){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;
    if(total>max)throw Error("storage_object_too_large");chunks.push(part.value);
  }}finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks).toString("utf8");
}
/** Private platform credentials stay on the application server. No browser or AI. */
export class PlatformLocalLedgerStore implements LocalLedgerBlobStore {
  async read(key:string) {
    if(!safeKey(key))throw Error("invalid_ledger_storage_key");
    const signed=await storageGetSignedUrl(key);
    const r=await fetch(safeReadUrl(signed),{method:"GET",headers:{"Accept-Encoding":"identity","Cache-Control":"no-cache, no-store, max-age=0"},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)});
    if(r.status===404)return null;
    if(!r.ok)throw new LedgerStorageError(`ledger_storage_read_failed_${r.status}`,"object_get",r.status);
    const etag=r.headers.get("etag");if(!etag)throw new LedgerStorageError("ledger_storage_etag_missing","object_get",r.status);
    if(!strongEtag(etag))throw new LedgerStorageError("ledger_storage_etag_not_strong","object_get",r.status);
    if(r.headers.get("content-encoding"))throw new LedgerStorageError("ledger_storage_content_encoding_present","object_get",r.status);
    return {text:await limitedText(r,MAX_LOCAL_LEDGER_BYTES*3),etag};
  }
  async compareAndPut(key:string,text:string,expectedEtag:string|null) {
    if(!safeKey(key)||Buffer.byteLength(text)>MAX_LOCAL_LEDGER_BYTES*3)throw Error("invalid_ledger_storage_write");
    if(!ENV.forgeApiUrl||!ENV.forgeApiKey)throw Error("ledger_storage_not_configured");
    const presign=new URL("v1/storage/presign/put",ENV.forgeApiUrl.replace(/\/+$/,"")+"/");presign.searchParams.set("path",key);
    const p=await fetch(presign,{headers:{Authorization:`Bearer ${ENV.forgeApiKey}`},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)});
    if(!p.ok)throw new LedgerStorageError(`ledger_storage_presign_failed_${p.status}`,"presign_put",p.status);
    const data=await p.json() as {url?:string};if(!data.url)throw Error("ledger_storage_presign_missing");
    const conditional:Record<string,string>={"Content-Type":"application/json"};
    conditional[expectedEtag?"If-Match":"If-None-Match"]=expectedEtag??"*";
    const r=await fetch(safePutUrl(data.url),{method:"PUT",headers:conditional,
      body:text,redirect:"error",signal:AbortSignal.timeout(20000)});
    if(r.status===412||r.status===409)throw new LedgerConflict("concurrent_ledger_update");
    if(!r.ok)throw new LedgerStorageError(`ledger_storage_write_failed_${r.status}`,"object_put",r.status);
  }
}

/** Same private platform adapter and conditional-write policy, in a separate namespace. */
export class PlatformDirectionalHandoffStore implements LocalLedgerBlobStore {
  async read(key:string) {
    if(safeKey(key))return new PlatformLocalLedgerStore().read(key);
    if(!safeDirectionalKey(key))throw Error("invalid_directional_storage_key");
    const signed=await storageGetSignedUrl(key);
    const r=await fetch(safeReadUrl(signed),{method:"GET",headers:{"Accept-Encoding":"identity","Cache-Control":"no-cache, no-store, max-age=0"},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)});
    if(r.status===404)return null;
    if(!r.ok)throw new LedgerStorageError(`directional_storage_read_failed_${r.status}`,"object_get",r.status);
    const etag=r.headers.get("etag");if(!etag)throw new LedgerStorageError("directional_storage_etag_missing","object_get",r.status);
    if(!strongEtag(etag))throw new LedgerStorageError("directional_storage_etag_not_strong","object_get",r.status);
    if(r.headers.get("content-encoding"))throw new LedgerStorageError("directional_storage_content_encoding_present","object_get",r.status);
    return {text:await limitedText(r,4*1024*1024*3),etag};
  }
  async compareAndPut(key:string,text:string,expectedEtag:string|null) {
    if(!safeDirectionalKey(key)||Buffer.byteLength(text)>4*1024*1024*3)throw Error("invalid_directional_storage_write");
    if(!ENV.forgeApiUrl||!ENV.forgeApiKey)throw Error("directional_storage_not_configured");
    const presign=new URL("v1/storage/presign/put",ENV.forgeApiUrl.replace(/\/+$/,"")+"/");presign.searchParams.set("path",key);
    const p=await fetch(presign,{headers:{Authorization:`Bearer ${ENV.forgeApiKey}`},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)});
    if(!p.ok)throw new LedgerStorageError(`directional_storage_presign_failed_${p.status}`,"presign_put",p.status);
    const data=await p.json() as {url?:string};if(!data.url)throw Error("directional_storage_presign_missing");
    const conditional:Record<string,string>={"Content-Type":"application/json"};
    conditional[expectedEtag?"If-Match":"If-None-Match"]=expectedEtag??"*";
    const r=await fetch(safePutUrl(data.url),{method:"PUT",headers:conditional,body:text,redirect:"error",signal:AbortSignal.timeout(20000)});
    if(r.status===412||r.status===409)throw new LedgerConflict("concurrent_directional_update");
    if(!r.ok)throw new LedgerStorageError(`directional_storage_write_failed_${r.status}`,"object_put",r.status);
  }
}

/** Counter-to-customer optical estimates share hardened read/CAS semantics, but may only read the native ledger as corroborating proof. */
export class PlatformCounterPickupStore implements LocalLedgerBlobStore {
  async read(key:string) {
    if (safeKey(key)) return new PlatformLocalLedgerStore().read(key);
    if (!safeCounterPickupKey(key)) throw Error("invalid_counter_pickup_storage_key");
    const signed=await storageGetSignedUrl(key);
    const r=await fetch(safeReadUrl(signed),{method:"GET",headers:{"Accept-Encoding":"identity","Cache-Control":"no-cache, no-store, max-age=0"},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)});
    if(r.status===404)return null;
    if(!r.ok)throw new LedgerStorageError(`counter_pickup_storage_read_failed_${r.status}`,"object_get",r.status);
    const etag=r.headers.get("etag");if(!etag)throw new LedgerStorageError("counter_pickup_storage_etag_missing","object_get",r.status);
    if(!strongEtag(etag))throw new LedgerStorageError("counter_pickup_storage_etag_not_strong","object_get",r.status);
    if(r.headers.get("content-encoding"))throw new LedgerStorageError("counter_pickup_storage_content_encoding_present","object_get",r.status);
    return {text:await limitedText(r,4*1024*1024*3),etag};
  }
  async compareAndPut(key:string,text:string,expectedEtag:string|null) {
    if(!safeCounterPickupKey(key)||Buffer.byteLength(text)>4*1024*1024*3)throw Error("invalid_counter_pickup_storage_write");
    if(!ENV.forgeApiUrl||!ENV.forgeApiKey)throw Error("counter_pickup_storage_not_configured");
    const presign=new URL("v1/storage/presign/put",ENV.forgeApiUrl.replace(/\/+$/,"")+"/");presign.searchParams.set("path",key);
    const p=await fetch(presign,{headers:{Authorization:`Bearer ${ENV.forgeApiKey}`},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)});
    if(!p.ok)throw new LedgerStorageError(`counter_pickup_storage_presign_failed_${p.status}`,"presign_put",p.status);
    const data=await p.json() as {url?:string};if(!data.url)throw Error("counter_pickup_storage_presign_missing");
    const conditional:Record<string,string>={"Content-Type":"application/json"};
    conditional[expectedEtag?"If-Match":"If-None-Match"]=expectedEtag??"*";
    const r=await fetch(safePutUrl(data.url),{method:"PUT",headers:conditional,body:text,redirect:"error",signal:AbortSignal.timeout(20000)});
    if(r.status===412||r.status===409)throw new LedgerConflict("concurrent_counter_pickup_update");
    if(!r.ok)throw new LedgerStorageError(`counter_pickup_storage_write_failed_${r.status}`,"object_put",r.status);
  }
}

export async function saveLocalLedger(store:LocalLedgerBlobStore,p:ParsedLocalLedger,storeId:number,timeZone:string) {
  const key=ledgerStorageKey(storeId,p.document.deviceId,p.document.businessDate);
  const next=storedLedger(p,storeId);
  let action:"create"|"update"|"already_persisted";
  try{
    // Creation is attempted first; an existing object must reject this write conditionally.
    await store.compareAndPut(key,JSON.stringify(next),null);
    action="create";
  }catch(e){
    if(!(e instanceof LedgerConflict))throw e;
    const before=await store.read(key);
    if(!before)throw Error("create_conflict_without_existing_ledger");
    const previous=checkStored(JSON.parse(before.text),storeId,p.document.deviceId,p.document.businessDate,timeZone).stored;
    action=compareRevision(previous,p);
    if(action==="update"){
      try{await store.compareAndPut(key,JSON.stringify(next),before.etag);}
      catch(error){if(!(error instanceof LedgerConflict))throw error;}
    }
  }
  // This fresh read is mandatory: accepted writes or queued operations are not receipts.
  const actual=await store.read(key);if(!actual)throw Error("persisted_ledger_missing");
  const verified=checkStored(JSON.parse(actual.text),storeId,p.document.deviceId,p.document.businessDate,timeZone);
  return {success:true,disposition:action,receipt:localLedgerReceipt(verified.stored,p)};
}
export async function readLocalLedger(store:LocalLedgerBlobStore,storeId:number,deviceId:string,day:string,timeZone:string) {
  const actual=await store.read(ledgerStorageKey(storeId,deviceId,day));if(!actual)return null;
  const checked=checkStored(JSON.parse(actual.text),storeId,deviceId,day,timeZone);
  return {sequence:checked.stored.sequence,documentSha256:checked.stored.documentSha256,
    ...summarizeLocalLedger(checked.parsed,checked.stored.receivedAt)};
}
export async function readLocalLedgerReceipt(store:LocalLedgerBlobStore,storeId:number,deviceId:string,day:string,timeZone:string) {
  const actual=await store.read(ledgerStorageKey(storeId,deviceId,day));if(!actual)return null;
  const checked=checkStored(JSON.parse(actual.text),storeId,deviceId,day,timeZone);
  return localLedgerReceipt(checked.stored,checked.parsed);
}

/** Store-scoped source for native photo proof. This does not expose storage URLs. */
export async function readLocalEvidenceObservation(store:LocalLedgerBlobStore,storeId:number,deviceId:string,day:string,observationId:string,timeZone:string){
 if(!/^[a-f0-9]{64}$/.test(observationId))throw Error("invalid_observation_id");
 const actual=await store.read(ledgerStorageKey(storeId,deviceId,day));if(!actual)return null;
 const checked=checkStored(JSON.parse(actual.text),storeId,deviceId,day,timeZone);
 return checked.parsed.observations.find(o=>o.observationId===observationId)??null;
}
