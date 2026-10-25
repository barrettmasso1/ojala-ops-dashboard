import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {hasClosingRecord,closingValue,sizeCategoryValue,nativeEvidenceDate} from "./localLedgerPresentation";
describe("camera data remains visible without inventing closed counts",()=>{
 it("same-day closing required",()=>{expect(hasClosingRecord("2026-10-23","2026-10-23",1)).toBe(true);});
 it("no closing is not zero",()=>{expect(hasClosingRecord("2026-10-23","2026-10-23",0)).toBe(false);expect(closingValue("$0",false)).toBe("Sin cierre registrado");});
 it("keeps a real reported zero",()=>expect(closingValue("0",true)).toBe("0"));
 it("never reuses another date",()=>expect(hasClosingRecord("2026-10-22","2026-10-23",2)).toBe(false));
 it.each([undefined,NaN,-1,1.5])("rejects invalid report count %s",n=>expect(hasClosingRecord("2026-10-23","2026-10-23",n)).toBe(false));
 it("unassigned capacities are not presented as pending transmission",()=>expect(sizeCategoryValue(0,10,false)).toBe("Sin asignación confirmada"));
 it("unknown observations stay visible",()=>expect(sizeCategoryValue(10,10,true)).toBe("10"));
 it("known assigned sizes retain numbers",()=>expect(sizeCategoryValue(2,10,false)).toBe("2"));
 it("real classified zeros remain zeros",()=>expect(sizeCategoryValue(0,0,false)).toBe("0"));
 it("invalid size counts do not become zero",()=>expect(sizeCategoryValue(NaN,0,false)).toBe("No verificable"));
 it("mounts local data once before empty daily summary",()=>{const s=readFileSync(new URL("../pages/ManagerDashboard.tsx",import.meta.url),"utf8");expect(s.match(/<LocalCupLedgerPanel /g)).toHaveLength(1);expect(s.indexOf("<LocalCupLedgerPanel ")).toBeLessThan(s.indexOf("Daily snapshot for"));});
 it("keeps five explicit size categories",()=>{const s=readFileSync(new URL("../components/LocalCupLedgerPanel.tsx",import.meta.url),"utf8");for(const k of ["chico:","mediano:","pint:","litro:","unknown:"])expect(s).toContain(k);expect(s).not.toContain("useMutation");});
});

describe("native evidence controls initial date without overriding explicit selection",()=>{
 it("uses today's received native detections before an old sales date",()=>expect(nativeEvidenceDate({businessDate:"2026-10-23",detectedTracks:13},"2026-10-23")).toBe("2026-10-23"));
 it("does not reuse yesterday's native rows",()=>expect(nativeEvidenceDate({businessDate:"2026-10-22",detectedTracks:35},"2026-10-23")).toBeNull());
 it("missing native data is not invented",()=>expect(nativeEvidenceDate(undefined,"2026-10-23")).toBeNull());
 it("invalid data cannot claim current evidence",()=>expect(nativeEvidenceDate({businessDate:"2026-10-23",detectedTracks:NaN},"2026-10-23")).toBeNull());
 it("keeps a received empty ledger distinct from missing",()=>expect(nativeEvidenceDate({businessDate:"2026-10-23",detectedTracks:0},"2026-10-23")).toBe("2026-10-23"));
 it("does not auto-fallback from Today to an older sales date",()=>{const s=readFileSync(new URL("../pages/ManagerDashboard.tsx",import.meta.url),"utf8");expect(s).not.toContain("todayNativeLedgerQuery");expect(s).not.toContain("shouldAutoFallbackToLatestOperationalDate");expect(s).toContain("resolveDashboardDate");});
});
