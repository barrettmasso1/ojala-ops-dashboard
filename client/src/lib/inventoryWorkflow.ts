export type InventoryDraftState = Record<number, { currentQuantity: string }>;

export type InventoryWorkflowItem = {
  id: number;
  currentQuantity: number | string | null;
};

export type PendingInventorySave = {
  id: number;
  currentQuantity: number;
};

function normalizeQuantity(value: number | string | null | undefined) {
  return Number(value ?? 0).toFixed(2);
}

export function getPendingInventorySaves(items: InventoryWorkflowItem[], drafts: InventoryDraftState): PendingInventorySave[] {
  return items.flatMap(item => {
    const draft = drafts[item.id];
    if (!draft) return [];

    const draftValue = Number(draft.currentQuantity || 0);
    if (Number.isNaN(draftValue)) return [];

    if (normalizeQuantity(item.currentQuantity) === normalizeQuantity(draftValue)) {
      return [];
    }

    return [{
      id: item.id,
      currentQuantity: draftValue,
    }];
  });
}
