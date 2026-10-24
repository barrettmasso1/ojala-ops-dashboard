export type RetroactiveClosingDraft<T> = {
  savedAt: number;
  storeId: number;
  businessDate: string;
  data: T;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storageOrNull(storage?: StorageLike) {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function getRetroactiveClosingDraftKey(storeId: number, businessDate: string) {
  if (!Number.isSafeInteger(storeId) || storeId < 1) throw new Error("Store ID is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) throw new Error("Business date is required");
  return `ojala-admin-retroactive-closing:store-${storeId}:date-${businessDate}`;
}

export function saveRetroactiveClosingDraft<T>(storeId: number, businessDate: string, data: T, storage?: StorageLike) {
  const target = storageOrNull(storage);
  if (!target) return null;
  const record: RetroactiveClosingDraft<T> = { savedAt: Date.now(), storeId, businessDate, data };
  target.setItem(getRetroactiveClosingDraftKey(storeId, businessDate), JSON.stringify(record));
  return record;
}

export function loadRetroactiveClosingDraft<T>(storeId: number, businessDate: string, storage?: StorageLike) {
  const target = storageOrNull(storage);
  if (!target) return null;
  const key = getRetroactiveClosingDraftKey(storeId, businessDate);
  const raw = target.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RetroactiveClosingDraft<T>>;
    if (parsed.storeId !== storeId || parsed.businessDate !== businessDate || typeof parsed.savedAt !== "number" || !("data" in parsed)) {
      target.removeItem(key);
      return null;
    }
    return parsed as RetroactiveClosingDraft<T>;
  } catch {
    target.removeItem(key);
    return null;
  }
}

export function clearRetroactiveClosingDraft(storeId: number, businessDate: string, storage?: StorageLike) {
  const target = storageOrNull(storage);
  if (!target) return;
  target.removeItem(getRetroactiveClosingDraftKey(storeId, businessDate));
}
