import { describe, expect, it } from "vitest";
import { parseOAuthState } from "./_core/oauthState";

describe("parseOAuthState", () => {
  it("restores the published frontend origin and requested dashboard return path from structured state", () => {
    const state = btoa(
      JSON.stringify({
        origin: "https://ojaladarsh-m6piugsr.manus.space",
        returnPath: "/dashboard",
      }),
    );

    expect(parseOAuthState(state)).toEqual({
      redirectUri: "https://ojaladarsh-m6piugsr.manus.space/api/oauth/callback",
      redirectDestination: "https://ojaladarsh-m6piugsr.manus.space/dashboard",
    });
  });

  it("falls back to legacy redirect-uri state values", () => {
    const state = btoa("https://ojaladarsh-m6piugsr.manus.space/api/oauth/callback");

    expect(parseOAuthState(state)).toEqual({
      redirectUri: "https://ojaladarsh-m6piugsr.manus.space/api/oauth/callback",
      redirectDestination: "https://ojaladarsh-m6piugsr.manus.space",
    });
  });
});
