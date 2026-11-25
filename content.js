const PAGE_SOURCE = "quota-pilot-page";
const EXTENSION_SOURCE = "quota-pilot-oauth-extension";

window.addEventListener("message", async (event) => {
  const request = event.data;
  if (
    event.source !== window ||
    event.origin !== window.location.origin ||
    request?.source !== PAGE_SOURCE ||
    typeof request.nonce !== "string" ||
    !["extension-ping", "oauth-start", "oauth-stop"].includes(request.type)
  ) return;

  try {
    // Chrome host patterns cover all ports. Check the exact origin before waking the worker.
    const { settings } = await chrome.storage.local.get("settings");
    if (!settings?.enabled || !settings.origins.includes(event.origin)) return;

    const result = await chrome.runtime.sendMessage({ type: request.type, state: request.state });
    const response = request.type === "extension-ping"
      ? { type: "extension-pong", installed: result?.ok === true }
      : { type: `${request.type}-result`, ok: result?.ok === true, error: result?.error };
    window.postMessage({ source: EXTENSION_SOURCE, nonce: request.nonce, ...response }, event.origin);
  } catch {
    // Tabs opened before an extension reload can retain a stale bridge until reloaded.
  }
});
