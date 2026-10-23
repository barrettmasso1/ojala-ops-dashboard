import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {hasClosingRecord,closingValue,sizeCategoryValue} from "./localLedgerPresentation";
describe("camera data remains visible without inventing closed counts",()=>{
 it("same-day closing required",()=>{expect(hasClosingRecord("2026-10-23","2026-10-23",1)).toBe(true);});
 it("no closing is not zero",()=>{expect(hasClosingRecord("2026-10-23","2026-10-23",0)).toBe(false);expect(closingValue("$0",false)).toBe("Pendiente");});
 it("keeps a real reported zero",()=>expect(closingValue("0",true)).toBe("0"));
 it("never reuses another date",()=>expect(hasClosingRecord("2026-10-22","2026-10-23",2)).toBe(false));
 it.each([undefined,NaN,-1,1.5])("rejects invalid report count %s",n=>expect(hasClosingRecord("2026-10-23","2026-10-23",n)).toBe(false));
 it("unassigned sizes remain pending",()=>expect(sizeCategoryValue(0,10,false)).toBe("Pendiente"));
 it("unknown observations stay visible",()=>expect(sizeCategoryValue(10,10,true)).toBe("10"));
 it("known assigned sizes retain numbers",()=>expect(sizeCategoryValue(2,10,false)).toBe("2"));
 it("real classified zeros remain zeros",()=>expect(sizeCategoryValue(0,0,false)).toBe("0"));
 it("invalid size counts do not become zero",()=>expect(sizeCategoryValue(NaN,0,false)).toBe("No verificable"));
 it("mounts local data once before empty daily summary",()=>{const s=readFileSync(new URL("../pages/ManagerDashboard.tsx",import.meta.url),"utf8");expect(s.match(/<LocalCupLedgerPanel /g)).toHaveLength(1);expect(s.indexOf("<LocalCupLedgerPanel ")).toBeLessThan(s.indexOf("Daily snapshot for"));});
 it("keeps five explicit size categories",()=>{const s=readFileSync(new URL("../components/LocalCupLedgerPanel.tsx",import.meta.url),"utf8");for(const k of ["chico:","mediano:","pint:","litro:","unknown:"])expect(s).toContain(k);expect(s).not.toContain("useMutation");});
});
