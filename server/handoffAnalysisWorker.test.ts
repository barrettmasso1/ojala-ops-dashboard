import { beforeEach, describe, it, expect, vi } from "vitest";
import { deferredHandoffSource } from "./handoffDurableReceipt";
const mocks = vi.hoisted(() => ({
  getHandoffVisualEventById: vi.fn(), listDueDeferredHandoffVisualEvents: vi.fn(),
  getActiveStoreById: vi.fn(), queueHandoffVisualForZoneMismatch: vi.fn(),
  analyzePersistedHandoffVisual: vi.fn(),
}));
vi.mock("./db", () => mocks);
vi.mock("./handoffPersistedAnalysis", () => mocks);
const { runHandoffAnalysisCycle } = await import("./handoffAnalysisWorker");
const base = () => ({ id: 1, storeId: 7, cameraName: "handoff", cupEventId: "fixture-1234",
  sourceDetail: deferredHandoffSource("fixture source"), evidenceOrigin: "verified_snapshot",
  analysisStatus: "pending_review", imageKey: "private/key", imageSha256: "a".repeat(64),
  zoneId: 1, zoneGeometryVersion: 1, zoneGeometryJson: JSON.stringify([{ x:0.1,y:0.1 },{ x:0.9,y:0.1 },{ x:0.9,y:0.9 }]),
  analysisAttempts: 0, analysisLeaseUntil: null, nextRetryAt: null,
  captureMetadataJson: JSON.stringify({ camera:"handoff",cup_zone:"handoff_zone",cup_event_id:"fixture-1234",
    image_sha256:"a".repeat(64),captured_at_utc:"2026-10-18T20:00:00Z",schema_version:2 }),
});
beforeEach(() => {
  vi.resetAllMocks();mocks.listDueDeferredHandoffVisualEvents.mockResolvedValue([base()]);
  mocks.getHandoffVisualEventById.mockResolvedValue(base());mocks.getActiveStoreById.mockResolvedValue({id:7});
  mocks.analyzePersistedHandoffVisual.mockResolvedValue({status:"approved_by_ai"});
});
describe("persistent analysis worker", () => {
  it("uses the exact tenant and a bounded analysis budget", async () => {
    expect(await runHandoffAnalysisCycle()).toMatchObject({processed:1,errors:0});
    expect(mocks.getHandoffVisualEventById).toHaveBeenCalledWith({id:1,storeId:7});
    expect(mocks.analyzePersistedHandoffVisual).toHaveBeenCalledWith(expect.anything(),{storeId:7,cameraName:"handoff"},3);
  });
  it("does not process inactive stores",async()=>{
    mocks.getActiveStoreById.mockResolvedValue(null);expect(await runHandoffAnalysisCycle()).toMatchObject({held:1});
    expect(mocks.analyzePersistedHandoffVisual).not.toHaveBeenCalled();
  });
  it("rechecks a manager decision made since selection",async()=>{
    mocks.getHandoffVisualEventById.mockResolvedValue({...base(),analysisStatus:"discarded_by_manager"});
    await runHandoffAnalysisCycle();expect(mocks.analyzePersistedHandoffVisual).not.toHaveBeenCalled();
  });
  it("leaves legacy historical evidence alone",async()=>{
    mocks.getHandoffVisualEventById.mockResolvedValue({...base(),sourceDetail:"verified_snapshot"});
    await runHandoffAnalysisCycle();expect(mocks.analyzePersistedHandoffVisual).not.toHaveBeenCalled();
  });
  it("holds inconsistent stored identity rather than analyzing it",async()=>{
    mocks.getHandoffVisualEventById.mockResolvedValue({...base(),imageSha256:"b".repeat(64)});
    expect(await runHandoffAnalysisCycle()).toMatchObject({held:1});
    expect(mocks.queueHandoffVisualForZoneMismatch).toHaveBeenCalledWith({id:1,storeId:7});
    expect(mocks.analyzePersistedHandoffVisual).not.toHaveBeenCalled();
  });
  it("sanitizes worker failures and releases its local lock",async()=>{
    mocks.analyzePersistedHandoffVisual.mockRejectedValue(new Error("SECRET_FIXTURE_NOT_FOR_LOGGING"));
    const result=await runHandoffAnalysisCycle();expect(result).toMatchObject({errors:1});
    expect(JSON.stringify(result)).not.toContain("SECRET_FIXTURE");
    mocks.analyzePersistedHandoffVisual.mockResolvedValue({status:"pending_review"});
    expect(await runHandoffAnalysisCycle()).toMatchObject({processed:1});
  });
  it("does not overlap cycles while an analysis is pending",async()=>{
    let release!:()=>void;
    mocks.listDueDeferredHandoffVisualEvents.mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve([])}));
    const first=runHandoffAnalysisCycle();expect(await runHandoffAnalysisCycle()).toEqual({status:"already_running"});
    release();await first;
  });
});
