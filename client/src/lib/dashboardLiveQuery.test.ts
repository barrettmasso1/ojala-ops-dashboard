import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

type ReactQueryModule = typeof import("@tanstack/react-query");
let QueryClient: ReactQueryModule["QueryClient"];
let QueryObserver: ReactQueryModule["QueryObserver"];
let onlineManager: ReactQueryModule["onlineManager"];

beforeAll(async () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { addEventListener: () => undefined, removeEventListener: () => undefined },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { visibilityState: "visible", addEventListener: () => undefined, removeEventListener: () => undefined },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true, addEventListener: () => undefined, removeEventListener: () => undefined },
  });
  const module = await import("@tanstack/react-query");
  QueryClient = module.QueryClient;
  QueryObserver = module.QueryObserver;
  onlineManager = module.onlineManager;
});

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  onlineManager.setOnline(true);
  vi.useRealTimers();
});

describe("live dashboard QueryObserver behavior", () => {
  it("uses private no-store caching for tRPC without changing static asset caching", () => {
    const clientSource = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
    const serverSource = readFileSync(new URL("../../../server/_core/index.ts", import.meta.url), "utf8");
    expect(clientSource).toContain('cache: "no-store"');
    expect(serverSource).toContain('Cache-Control", "private, no-store, no-cache, must-revalidate"');
  });

  it("refetches new fixture data after five seconds without a click", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.mount();
    const observer = new QueryObserver(client, {
      queryKey: ["native-live", "2026-10-25"],
      queryFn: async () => ({ businessDate: "2026-10-25", sequence: ++calls }),
      refetchInterval: 5000,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
    });
    const unsubscribe = observer.subscribe(() => undefined);

    await observer.refetch();
    await flush();
    expect(observer.getCurrentResult().data).toEqual({ businessDate: "2026-10-25", sequence: 1 });
    await vi.advanceTimersByTimeAsync(5000);
    await flush();

    expect(calls).toBe(2);
    expect(observer.getCurrentResult().data).toEqual({ businessDate: "2026-10-25", sequence: 2 });
    expect(observer.getCurrentResult().dataUpdatedAt).toBeGreaterThan(0);
    unsubscribe();
    client.unmount();
    client.clear();
  });

  it("keeps same-day data visible as stale on error and refetches after reconnect", async () => {
    vi.useFakeTimers();
    let calls = 0;
    let fail = false;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.mount();
    const observer = new QueryObserver(client, {
      queryKey: ["native-live", "2026-10-25"],
      queryFn: async () => {
        calls += 1;
        if (fail) throw new Error("offline");
        return { businessDate: "2026-10-25", sequence: calls };
      },
      refetchInterval: 5000,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
    });
    const unsubscribe = observer.subscribe(() => undefined);

    await observer.refetch();
    await flush();
    fail = true;
    await vi.advanceTimersByTimeAsync(5000);
    await flush();
    expect(observer.getCurrentResult().data).toEqual({ businessDate: "2026-10-25", sequence: 1 });
    expect(observer.getCurrentResult().status).toBe("error");
    expect(observer.getCurrentResult().dataUpdatedAt).toBeGreaterThan(0);

    fail = false;
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(observer.getCurrentResult().data?.businessDate).toBe("2026-10-25");
    expect(observer.getCurrentResult().dataUpdatedAt).toBeGreaterThan(0);
    unsubscribe();
    client.unmount();
    client.clear();
  });

  it("does not let a late response from the prior business date replace the new query key", async () => {
    let resolveOld!: (value: { businessDate: string; sequence: number }) => void;
    let resolveNew!: (value: { businessDate: string; sequence: number }) => void;
    const oldResponse = new Promise<{ businessDate: string; sequence: number }>(resolve => { resolveOld = resolve; });
    const newResponse = new Promise<{ businessDate: string; sequence: number }>(resolve => { resolveNew = resolve; });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.mount();
    const observer = new QueryObserver(client, {
      queryKey: ["native-live", "2026-10-24"],
      queryFn: () => oldResponse,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    void observer.refetch();
    observer.setOptions({ queryKey: ["native-live", "2026-10-25"], queryFn: () => newResponse, retry: false });

    resolveOld({ businessDate: "2026-10-24", sequence: 1 });
    await flush();
    expect(observer.getCurrentResult().data).toBeUndefined();
    resolveNew({ businessDate: "2026-10-25", sequence: 2 });
    await flush();

    expect(observer.getCurrentResult().data).toEqual({ businessDate: "2026-10-25", sequence: 2 });
    unsubscribe();
    client.unmount();
    client.clear();
  });
});
