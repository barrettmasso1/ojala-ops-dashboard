import { ENV } from "./_core/env";
import { storageGetSignedUrl } from "./storage";
import { checkStored, compareRevision, ledgerStorageKey, localLedgerReceipt, parseLocalLedger, storedLedger, summarizeLocalLedger, MAX_LOCAL_LEDGER_BYTES, type ParsedLocalLedger } from "./localCupLedger";

export type BlobRead={text:string;etag:string};
export interface LocalLedgerBlobStore {
  read(key:string):Promise<BlobRead|null>;
  compareAndPut(key:string,text:string,expectedEtag:string|null):Promise<void>;
}
export class LedgerConflict extends Error {}
const safeKey=(key:string)=>/^local-cup-ledger\/v1\/store-[1-9]\d*\/[a-f0-9-]{36}\/\d{4}-\d{2}-\d{2}\.json$/.test(key);
const safeUrl=(raw:string)=>{
  const u=new URL(raw);
  if(u.protocol!=="https:"||!u.hostname.endsWith(".amazonaws.com")||u.username||u.password||(u.port&&u.port!=="443"))throw Error("untrusted_storage_url");
  return u;
};
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
    const r=await fetch(safeUrl(signed),{method:"GET",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)});
    if(r.status===404)return null;
    if(!r.ok)throw Error("ledger_storage_read_failed");
    const etag=r.headers.get("etag");if(!etag)throw Error("ledger_storage_etag_missing");
    return {text:await limitedText(r,MAX_LOCAL_LEDGER_BYTES*3),etag};
  }
  async compareAndPut(key:string,text:string,expectedEtag:string|null) {
    if(!safeKey(key)||Buffer.byteLength(text)>MAX_LOCAL_LEDGER_BYTES*3)throw Error("invalid_ledger_storage_write");
    if(!ENV.forgeApiUrl||!ENV.forgeApiKey)throw Error("ledger_storage_not_configured");
    const presign=new URL("v1/storage/presign/put",ENV.forgeApiUrl.replace(/\/+$/,"")+"/");presign.searchParams.set("path",key);
    const p=await fetch(presign,{headers:{Authorization:`Bearer ${ENV.forgeApiKey}`},redirect:"error",signal:AbortSignal.timeout(15000)});
    if(!p.ok)throw Error("ledger_storage_presign_failed");
    const data=await p.json() as {url?:string};if(!data.url)throw Error("ledger_storage_presign_missing");
    const conditional:Record<string,string>={"Content-Type":"application/json"};
    conditional[expectedEtag?"If-Match":"If-None-Match"]=expectedEtag??"*";
    const r=await fetch(safeUrl(data.url),{method:"PUT",headers:conditional,
      body:text,redirect:"error",signal:AbortSignal.timeout(20000)});
    if(r.status===412||r.status===409)throw new LedgerConflict("concurrent_ledger_update");
    if(!r.ok)throw Error("ledger_storage_write_failed");
  }
}

export async function saveLocalLedger(store:LocalLedgerBlobStore,p:ParsedLocalLedger,storeId:number,timeZone:string) {
  const key=ledgerStorageKey(storeId,p.document.deviceId,p.document.businessDate);
  const before=await store.read(key);
  const previous=before?checkStored(JSON.parse(before.text),storeId,p.document.deviceId,p.document.businessDate,timeZone).stored:null;
  const action=compareRevision(previous,p);
  if(action!=="already_persisted"){
    const next=storedLedger(p,storeId);
    try{await store.compareAndPut(key,JSON.stringify(next),before?.etag??null);}
    catch(e){if(!(e instanceof LedgerConflict))throw e;}
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
