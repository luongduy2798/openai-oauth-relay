export const DEFAULT_SETTINGS = { enabled: false, origins: [] };
export const LOOPBACK_CALLBACK = "http://localhost:1455/auth/callback";
export const CALLBACK_PATH = "/api/oauth/codex/callback";
const RELAY_MARKER = "#openai-oauth-relay-";
const DISPLAY_FIELDS = ["code", "state", "scope", "error", "error_description", "error_uri"];
const keyChar = "[^&=#?%]";
// Match literal parameter names other than state without lookahead, which RE2 does not support.
const differentStateKey = Array.from("state", (letter, index) =>
  `${"state".slice(0, index)}[^${letter}&=#?%]${keyChar.repeat(4 - index)}`,
).join("|");
const otherParam = `(?:${keyChar}{1,4}|${keyChar}{6,}|${differentStateKey})(?:=[^&#]*)?`;

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

export function callbackRule(login, id) {
  return {
    id,
    action: {
      type: "redirect",
      redirect: { regexSubstitution: `${destinationFor(login.origin)}?\\2${RELAY_MARKER}\\1` },
    },
    condition: {
      regexFilter: `^http://(localhost|127\\.0\\.0\\.1):1455/auth/callback\\?((?:${otherParam}&)*state=${login.state}(?:&${otherParam})*)(?:#.*)?$`,
      isUrlFilterCaseSensitive: true,
      resourceTypes: ["main_frame"],
      requestMethods: ["get"],
    },
  };
}

export function matchCallback(value, pending, now = Date.now()) {
  const callback = new URL(value);
  if (callback.pathname !== CALLBACK_PATH) return null;
  const sourceHost = callback.hash.slice(RELAY_MARKER.length);
  if (!callback.hash.startsWith(RELAY_MARKER) || !["localhost", "127.0.0.1"].includes(sourceHost)) return null;
  const states = callback.searchParams.getAll("state");
  if (states.length !== 1 || !validState(states[0])) return null;

  const login = pending.find((entry) =>
    entry.state === states[0] && entry.origin === callback.origin && entry.expiresAt > now,
  );
  if (!login) return null;

  return {
    login,
    activity: {
      status: "forwarded",
      origin: login.origin,
      destination: destinationFor(login.origin),
      source: `http://${sourceHost}:1455/auth/callback`,
      fields: DISPLAY_FIELDS.filter((field) => callback.searchParams.has(field)),
      otherFields: [...callback.searchParams.keys()].filter((field) => !DISPLAY_FIELDS.includes(field)).length,
      startedAt: login.startedAt,
      receivedAt: now,
    },
  };
}
