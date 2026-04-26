import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLoginUrl } from "./const";

describe("getLoginUrl", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_OAUTH_PORTAL_URL", "https://manus.im");
    vi.stubEnv("VITE_APP_ID", "test-app-id");
    window.history.replaceState({}, "", "/staff-login");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    window.history.replaceState({}, "", "/");
  });

  it("preserves an explicit manager dashboard return path", () => {
    const url = new URL(getLoginUrl("/dashboard"));
    const encodedState = url.searchParams.get("state");

    expect(url.searchParams.get("redirectUri")).toBe(
      `${window.location.origin}/api/oauth/callback`
    );
    expect(encodedState).not.toBeNull();
    expect(JSON.parse(atob(encodedState!))).toEqual({
      origin: window.location.origin,
      returnPath: "/dashboard",
    });
  });

  it("falls back to the current page when no return path is provided", () => {
    const url = new URL(getLoginUrl());
    const encodedState = url.searchParams.get("state");

    expect(encodedState).not.toBeNull();
    expect(JSON.parse(atob(encodedState!))).toEqual({
      origin: window.location.origin,
      returnPath: "/staff-login",
    });
  });
});
