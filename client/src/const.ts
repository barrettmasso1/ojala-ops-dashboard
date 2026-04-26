export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

type OAuthStatePayload = {
  origin: string;
  returnPath: string;
};

function normalizeReturnPath(returnPath?: string) {
  if (!returnPath) {
    if (typeof window === "undefined") return "/";
    return `${window.location.pathname}${window.location.search}${window.location.hash}` || "/";
  }

  if (/^https?:\/\//.test(returnPath)) {
    try {
      const url = new URL(returnPath);
      return `${url.pathname}${url.search}${url.hash}` || "/";
    } catch {
      return "/";
    }
  }

  return returnPath.startsWith("/") ? returnPath : `/${returnPath}`;
}

function encodeOAuthState(payload: OAuthStatePayload) {
  return btoa(JSON.stringify(payload));
}

// Generate login URL at runtime so redirect URI reflects the current frontend origin.
export const getLoginUrl = (returnPath?: string) => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  const origin = window.location.origin;
  const normalizedReturnPath = normalizeReturnPath(returnPath);
  const redirectUri = `${origin}/api/oauth/callback`;
  const state = encodeOAuthState({ origin, returnPath: normalizedReturnPath });

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};
