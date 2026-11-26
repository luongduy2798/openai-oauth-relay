import { CALLBACK_PATH, DEFAULT_SETTINGS, ambiguousCallbackRule, callbackRule, destinationFor, hostPattern, matchCallback, parseOrigin, validState } from "./relay.mjs";

const BRIDGE_ID = "dashboard-bridge";
const LOGIN_TTL = 10 * 60 * 1000;
const EXPIRY_ALARM = "expire-pending-logins";
const PANEL_URL = chrome.runtime.getURL("panel.html");
const LOOPBACK_HOSTS = ["http://localhost/*", "http://127.0.0.1/*"];
let queue = Promise.resolve();

function serialize(work) {
  const result = queue.then(work);
  queue = result.catch(() => {});
  return result;
}

async function readSettings() {
  return (await chrome.storage.local.get("settings")).settings ?? DEFAULT_SETTINGS;
}

async function readRelay() {
  return (await chrome.storage.session.get("relay")).relay ?? { pending: [], recent: null };
}

async function saveRelay(relay) {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const now = Date.now();
  relay.pending = relay.pending.filter((login) => login.expiresAt > now);
  const addRules = relay.pending.map((login, index) => callbackRule(login, index + 2));
  if (addRules.length) addRules.unshift(ambiguousCallbackRule());
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: rules.map(({ id }) => id),
    addRules,
  });
  try {
    await chrome.storage.session.set({ relay });
  } catch (error) {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: addRules.map(({ id }) => id),
      addRules: rules,
    });
    throw error;
  }

  if (relay.pending.length) {
    await chrome.alarms.create(EXPIRY_ALARM, { when: Math.min(...relay.pending.map((login) => login.expiresAt)) });
  } else {
    await chrome.alarms.clear(EXPIRY_ALARM);
  }
}

function hasHost(origin) {
  return chrome.permissions.contains({ origins: [hostPattern(origin)] });
}

async function syncAccess({ enabled, origins }) {
  const [current] = await chrome.scripting.getRegisteredContentScripts({ ids: [BRIDGE_ID] });
  const granted = enabled ? await Promise.all(origins.map(hasHost)) : [];
  const activeOrigins = origins.filter((_, index) => granted[index]);
  const matches = [...new Set(activeOrigins.map(hostPattern))];

  if (matches.length) {
    const bridge = { id: BRIDGE_ID, matches, js: ["content.js"], runAt: "document_start" };
    if (current) await chrome.scripting.updateContentScripts([bridge]);
    else await chrome.scripting.registerContentScripts([bridge]);
  } else if (current) {
    await chrome.scripting.unregisterContentScripts({ ids: [BRIDGE_ID] });
  }

  const relay = await readRelay();
  relay.pending = relay.pending.filter((login) => activeOrigins.includes(login.origin));
  await saveRelay(relay);
}

async function saveSettings(settings) {
  await syncAccess(settings);
  await chrome.storage.local.set({ settings });
}

async function status() {
  const [settings, relay] = await Promise.all([readSettings(), readRelay()]);
  const granted = await Promise.all(settings.origins.map(hasHost));
  const pending = relay.pending.map(({ origin, startedAt, expiresAt }) => ({
    origin, destination: destinationFor(origin), startedAt, expiresAt,
  }));
  return { ok: true, settings, granted, pending, recent: relay.recent };
}

async function manage(message) {
  const settings = await readSettings();
  if (message.type === "set-enabled" && typeof message.enabled === "boolean") {
    await saveSettings({ ...settings, enabled: message.enabled });
    return { ok: true };
  }

  const origin = typeof message.origin === "string" && parseOrigin(message.origin);
  if (!origin || origin !== message.origin) return { ok: false, error: "invalid_domain" };
  if (message.type === "add-domain") {
    if (!(await hasHost(origin))) return { ok: false, error: "permission_required" };
    await saveSettings({ ...settings, origins: [...new Set([...settings.origins, origin])] });
  } else if (message.type === "remove-domain") {
    const origins = settings.origins.filter((value) => value !== origin);
    await saveSettings({ ...settings, origins });
    const pattern = hostPattern(origin);
    if (new URL(origin).protocol === "https:" && !origins.some((value) => hostPattern(value) === pattern)) {
      await chrome.permissions.remove({ origins: [pattern] });
    }
  } else {
    return { ok: false, error: "invalid_message" };
  }
  return { ok: true };
}

async function dashboardMessage(message, sender) {
  if (sender.frameId !== 0 || sender.tab?.id == null || !sender.url) {
    return { ok: false, error: "invalid_sender" };
  }
  const origin = new URL(sender.url).origin;
  const { enabled, origins } = await readSettings();
  if (!enabled || !origins.includes(origin) || !(await chrome.permissions.contains({
    origins: [hostPattern(origin), ...LOOPBACK_HOSTS],
  }))) {
    return { ok: false, error: "relay_unavailable" };
  }
  if (message.type === "extension-ping") return { ok: true };
  if (!["oauth-start", "oauth-stop"].includes(message.type) || !validState(message.state)) {
    return { ok: false, error: "invalid_oauth_state" };
  }

  const relay = await readRelay();
  const now = Date.now();
  relay.pending = relay.pending.filter((login) => login.expiresAt > now);
  const existing = relay.pending.find((login) => login.state === message.state);
  if (existing && (existing.origin !== origin || existing.tabId !== sender.tab.id)) {
    return { ok: false, error: "state_in_use" };
  }

  if (message.type === "oauth-stop") {
    relay.pending = relay.pending.filter((login) => login !== existing);
  } else if (!existing) {
    relay.pending = relay.pending.filter((login) => login.tabId !== sender.tab.id);
    relay.pending.push({
      state: message.state,
      origin,
      tabId: sender.tab.id,
      startedAt: now,
      expiresAt: now + LOGIN_TTL,
    });
  }
  await saveRelay(relay);
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (typeof message?.type !== "string") return;
  serialize(() => {
    if (sender.url !== PANEL_URL) return dashboardMessage(message, sender);
    return message.type === "get-status" ? status() : manage(message);
  }).then(respond, () => respond({ ok: false, error: "relay_unavailable" }));
  return true;
});

async function recordCallback(details) {
  const relay = await readRelay();
  const match = matchCallback(details.url, relay.pending);
  if (!match) return;
  relay.pending = relay.pending.filter((login) => login !== match.login);
  relay.recent = match.activity;
  await saveRelay(relay);
}

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) serialize(() => recordCallback(details)).catch(() => console.error("OAuth relay activity update failed"));
}, { url: [{ pathEquals: CALLBACK_PATH }] });

chrome.alarms.onAlarm.addListener(({ name }) => {
  if (name === EXPIRY_ALARM) serialize(async () => saveRelay(await readRelay())).catch(() => console.error("OAuth relay expiry failed"));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  serialize(async () => {
    const relay = await readRelay();
    const pending = relay.pending.filter((login) => login.tabId !== tabId);
    if (pending.length !== relay.pending.length) await saveRelay({ ...relay, pending });
  }).catch(() => console.error("OAuth relay cleanup failed"));
});

function restoreBridge() {
  serialize(async () => syncAccess(await readSettings())).catch(() => console.error("OAuth bridge setup failed"));
}

chrome.runtime.onInstalled.addListener(restoreBridge);
chrome.permissions.onRemoved.addListener(restoreBridge);
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: PANEL_URL }));
