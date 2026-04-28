export type PortalDraftView = "opening" | "closing" | "inventory" | "pilot-opening" | "pilot-closing";

export type PortalDraftRecord<T> = {
  savedAt: number;
  businessDate: string;
  data: T;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const PORTAL_DRAFT_PREFIX = "ojala-staff-draft";

function getStorage(storage?: StorageLike) {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function getPortalDraftKey(view: PortalDraftView) {
  return `${PORTAL_DRAFT_PREFIX}:${view}`;
}

export function savePortalDraft<T>(view: PortalDraftView, businessDate: string, data: T, storage?: StorageLike) {
  const target = getStorage(storage);
  if (!target) return null;

  const record: PortalDraftRecord<T> = {
    savedAt: Date.now(),
    businessDate,
    data,
  };

  target.setItem(getPortalDraftKey(view), JSON.stringify(record));
  return record;
}

export function loadPortalDraft<T>(view: PortalDraftView, businessDate: string, storage?: StorageLike) {
  const target = getStorage(storage);
  if (!target) return null;

  const raw = target.getItem(getPortalDraftKey(view));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<PortalDraftRecord<T>>;
    if (
      typeof parsed.savedAt !== "number" ||
      typeof parsed.businessDate !== "string" ||
      !("data" in parsed)
    ) {
      target.removeItem(getPortalDraftKey(view));
      return null;
    }

    if (parsed.businessDate !== businessDate) {
      target.removeItem(getPortalDraftKey(view));
      return null;
    }

    return parsed as PortalDraftRecord<T>;
  } catch {
    target.removeItem(getPortalDraftKey(view));
    return null;
  }
}

export function clearPortalDraft(view: PortalDraftView, storage?: StorageLike) {
  const target = getStorage(storage);
  if (!target) return;
  target.removeItem(getPortalDraftKey(view));
}
