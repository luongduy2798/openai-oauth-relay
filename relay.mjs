export const DEFAULT_SETTINGS = { enabled: false, origins: [] };
export const LOOPBACK_CALLBACK = "http://localhost:1455/auth/callback";
export const CALLBACK_FILTER = {
  urlMatches: "^http://(localhost|127\\.0\\.0\\.1):1455/auth/callback([?#]|$)",
};
const CALLBACK_URL = new RegExp(CALLBACK_FILTER.urlMatches);
const CALLBACK_PATH = "/api/oauth/codex/callback";
const DISPLAY_FIELDS = ["code", "state", "scope", "error", "error_description", "error_uri"];

export function parseOrigin(input) {
  const value = input.trim();
  if (!value || /[\s*\\]/.test(value)) return null;
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(value);
  try {
    const url = new URL(value.includes("://") ? value : `${local ? "http" : "https"}://${value}`);
    if (
      (url.protocol === "https:" ||
        (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) &&
      !url.hostname.includes("*") && !url.username && !url.password &&
      url.pathname === "/" && !url.search && !url.hash
    ) {
      return url.origin;
    }
  } catch {
    return null;
  }
  return null;
}

export function hostPattern(origin) {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

export function destinationFor(origin) {
  return new URL(CALLBACK_PATH, origin).href;
}

export function validState(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function matchCallback(value, pending, now = Date.now()) {
  if (!CALLBACK_URL.test(value)) return null;

  const callback = new URL(value);
  const states = callback.searchParams.getAll("state");
  if (states.length !== 1 || !validState(states[0])) return null;

  const login = pending.find((entry) => entry.state === states[0] && entry.expiresAt > now);
  if (!login) return null;

  const destination = destinationFor(login.origin);
  return {
    login,
    target: `${destination}${callback.search}`,
    activity: {
      status: "received",
      origin: login.origin,
      destination,
      source: `${callback.origin}${callback.pathname}`,
      fields: DISPLAY_FIELDS.filter((field) => callback.searchParams.has(field)),
      otherFields: [...callback.searchParams.keys()].filter((field) => !DISPLAY_FIELDS.includes(field)).length,
      startedAt: login.startedAt,
      receivedAt: now,
    },
  };
}
