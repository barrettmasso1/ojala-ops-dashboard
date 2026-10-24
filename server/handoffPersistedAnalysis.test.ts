import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  claimHandoffVisualAnalysis: vi.fn(),
  finalizeHandoffVisualAnalysis: vi.fn(),
  deferHandoffVisualAnalysis: vi.fn(),
  getHandoffVisualEventById: vi.fn(),
}));
const storageMocks = vi.hoisted(() => ({ storageGetSignedUrl: vi.fn() }));
const visualMocks = vi.hoisted(() => ({
  analyzeHandoffVisualImage: vi.fn(),
  getHandoffVisualRetryDelayMs: vi.fn(),
}));

vi.mock("./db", () => dbMocks);
vi.mock("./storage", () => storageMocks);
vi.mock("./handoffVisualAnalysis", () => visualMocks);

const { analyzePersistedHandoffVisual } = await import("./handoffPersistedAnalysis");

const nativeEvent = {
  id: 701,
  storeId: 1,
  cameraName: "handoff",
  sourceDetail: "native_local_cv_only_v1:fixture",
  analysisStatus: "pending_review",
  imageKey: "private/native.jpg",
  imageSha256: "a".repeat(64),
  evidenceOrigin: "verified_snapshot",
  analysisAttempts: 0,
  nextRetryAt: null,
  zoneGeometryJson: JSON.stringify([{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }]),
  zoneGeometryVersion: 1,
};

describe("persisted visual analysis native exclusion", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns before lease, storage URL, or generative model for native-local evidence", async () => {
    await expect(analyzePersistedHandoffVisual(nativeEvent as never, { storeId: 1, cameraName: "handoff" }))
      .resolves.toEqual({ eventId: 701, status: "pending_review", disposition: "native_local_only", retryable: false });
    expect(dbMocks.claimHandoffVisualAnalysis).not.toHaveBeenCalled();
    expect(storageMocks.storageGetSignedUrl).not.toHaveBeenCalled();
    expect(visualMocks.analyzeHandoffVisualImage).not.toHaveBeenCalled();
    expect(dbMocks.finalizeHandoffVisualAnalysis).not.toHaveBeenCalled();
    expect(dbMocks.deferHandoffVisualAnalysis).not.toHaveBeenCalled();
  });
});
