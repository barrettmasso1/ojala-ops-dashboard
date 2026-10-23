import { describe,expect,it,vi } from "vitest";
import {isPrivateLocalLedgerKey,registerStorageProxy} from "./_core/storageProxy";
describe("private detection ledger namespace",()=>{
 it.each(["local-cup-ledger/v1/store-1/a/day.json","/local-cup-ledger/v1/x","%6cocal-cup-ledger/v1/x","%256cocal-cup-ledger/v1/x","x/../local-cup-ledger/v1/x","local-cup-ledger\\v1\\x"])("blocks ledger media access for %s",key=>{expect(isPrivateLocalLedgerKey(key)).toBe(true);});
 it("preserves ordinary original photo URLs",()=>{expect(isPrivateLocalLedgerKey("frigate-handoff-verified/store-1/handoff/image.jpg")).toBe(false);});
 it("never asks for a signed URL for a private ledger",async()=>{let handler:any;const app={get:vi.fn((_path:string,fn:any)=>{handler=fn;})};registerStorageProxy(app as any);const res:any={status:vi.fn(()=>res),send:vi.fn(()=>res)};const fetch=vi.fn();vi.stubGlobal("fetch",fetch);try{await handler({params:{0:"local-cup-ledger/v1/store-1/a/day.json"}},res);expect(res.status).toHaveBeenCalledWith(404);expect(fetch).not.toHaveBeenCalled();}finally{vi.unstubAllGlobals();}});
});
