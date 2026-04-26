type ParsedOAuthState = {
  redirectUri: string;
  redirectDestination: string;
};

type OAuthStatePayload = {
  origin?: string;
  returnPath?: string;
};

function normalizeReturnPath(returnPath?: string) {
  if (!returnPath) return "/";
  return returnPath.startsWith("/") ? returnPath : `/${returnPath}`;
}

function parseJsonState(decodedState: string): ParsedOAuthState | null {
  try {
    const payload = JSON.parse(decodedState) as OAuthStatePayload;
    if (!payload.origin || typeof payload.origin !== "string") return null;

    const origin = new URL(payload.origin).origin;
    const returnPath = normalizeReturnPath(payload.returnPath);

    return {
      redirectUri: `${origin}/api/oauth/callback`,
      redirectDestination: `${origin}${returnPath}`,
    };
  } catch {
    return null;
  }
}

function parseLegacyState(decodedState: string): ParsedOAuthState {
  const redirectUrl = new URL(decodedState);
  return {
    redirectUri: redirectUrl.toString(),
    redirectDestination: redirectUrl.origin,
  };
}

export function parseOAuthState(state: string): ParsedOAuthState {
  const decodedState = atob(state);
  return parseJsonState(decodedState) ?? parseLegacyState(decodedState);
}
