import {describe,it,expect} from "vitest";
import {nativeCaptureTimeMatchesStorage as match} from "./nativeLocalEvidence";
describe("native original timestamp vs SQL precision",()=>{
 it("accepts the real observed SQL second precision",()=>expect(match(new Date("2026-10-24T20:49:06Z"),new Date("2026-10-24T20:49:06.108218Z"))).toBe(true));
 it("accepts exact milliseconds if storage preserves them",()=>expect(match(new Date("2026-10-24T20:49:06.108Z"),new Date("2026-10-24T20:49:06.108Z"))).toBe(true));
 it("rejects a different earlier second",()=>expect(match(new Date("2026-10-24T20:49:05Z"),new Date("2026-10-24T20:49:06.108Z"))).toBe(false));
 it("rejects rounding to a later second",()=>expect(match(new Date("2026-10-24T20:49:07Z"),new Date("2026-10-24T20:49:06.999Z"))).toBe(false));
 it("does not permit arbitrary millisecond mismatch",()=>expect(match(new Date("2026-10-24T20:49:06.100Z"),new Date("2026-10-24T20:49:06.108Z"))).toBe(false));
 it("rejects invalid dates",()=>expect(match(new Date("bad"),new Date())).toBe(false));
 it("accepts exact whole seconds",()=>expect(match(new Date("2026-10-24T20:49:06Z"),new Date("2026-10-24T20:49:06Z"))).toBe(true));
});
