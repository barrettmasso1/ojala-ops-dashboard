import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearPortalDraft, getPortalDraftKey, loadPortalDraft, savePortalDraft } from "./portalDrafts";

function createStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
  };
}

describe("portal draft storage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T15:30:00Z"));
  });

  it("saves and restores a same-day draft", () => {
    const storage = createStorage();
    const record = savePortalDraft("opening", "2026-04-26", { staffName: "Ava" }, storage);

    expect(record).toEqual({
      savedAt: new Date("2026-04-26T15:30:00Z").getTime(),
      businessDate: "2026-04-26",
      data: { staffName: "Ava" },
    });
    expect(storage.setItem).toHaveBeenCalledWith(
      getPortalDraftKey("opening"),
      JSON.stringify(record),
    );
    expect(loadPortalDraft<{ staffName: string }>("opening", "2026-04-26", storage)).toEqual(record);
  });

  it("drops stale drafts from a previous business date", () => {
    const storage = createStorage();
    storage.setItem(getPortalDraftKey("closing"), JSON.stringify({
      savedAt: 123,
      businessDate: "2026-04-25",
      data: { staffName: "Marco" },
    }));

    expect(loadPortalDraft<{ staffName: string }>("closing", "2026-04-26", storage)).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(getPortalDraftKey("closing"));
  });

  it("drops invalid draft payloads and allows explicit clearing", () => {
    const storage = createStorage();
    storage.setItem(getPortalDraftKey("inventory"), "not-json");

    expect(loadPortalDraft("inventory", "2026-04-26", storage)).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(getPortalDraftKey("inventory"));

    clearPortalDraft("inventory", storage);
    expect(storage.removeItem).toHaveBeenCalledWith(getPortalDraftKey("inventory"));
  });
});
