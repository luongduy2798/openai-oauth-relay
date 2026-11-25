import { hostPattern, LOOPBACK_CALLBACK, parseOrigin } from "./relay.mjs";

const byId = (id) => document.getElementById(id);
const enabled = byId("enabled");
const domain = byId("domain");
const add = byId("add");
const domains = byId("domains");
const errorBox = byId("error");
const time = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "medium" });
const statusLabels = {
  waiting: "Đang chờ callback",
  expired: "Phiên đã hết hạn",
  received: "Đã nhận callback",
  forwarded: "Đã gửi chuyển hướng",
  failed: "Chuyển hướng lỗi",
};
const errors = {
  invalid_domain: "Nhập một domain HTTPS hoặc địa chỉ HTTP localhost/127.0.0.1.",
  permission_required: "Chưa có quyền truy cập domain. Hãy cấp quyền trong Chrome.",
  relay_unavailable: "Không thể cập nhật relay. Hãy thử lại.",
};
let snapshot;
let busy = false;
let expiryTimer;
let refreshId = 0;

function show(id, text) {
  const element = byId(id);
  element.textContent = text;
  element.hidden = !text;
}

function renderFlow({ settings, pending, recent }) {
  const now = Date.now();
  const latest = pending.at(-1);
  const activity = latest && latest.startedAt >= (recent?.receivedAt ?? 0)
    ? { ...latest, status: latest.expiresAt > now ? "waiting" : "expired" }
    : recent;
  const flowStatus = byId("flow-status");
  flowStatus.dataset.status = activity?.status ?? "idle";
  flowStatus.textContent = statusLabels[activity?.status] ?? (settings.enabled ? "Sẵn sàng" : "Đang tắt");
  byId("start-step").toggleAttribute("data-active", !!activity);
  byId("receive-step").toggleAttribute("data-active", !!activity?.receivedAt);
  byId("forward-step").toggleAttribute("data-active", activity?.status === "forwarded");
  show("origin", activity?.origin ?? "Chưa có phiên");
  show("started-at", activity ? time.format(activity.startedAt) : "");
  show("source", activity?.source ?? LOOPBACK_CALLBACK);
  show("received-at", activity?.receivedAt ? time.format(activity.receivedAt) : "");
  show("destination", activity?.destination ?? "Chờ dashboard khởi tạo đăng nhập");
  show("callback-note", activity?.receivedAt ? "Chỉ hiển thị tên tham số." : "");
  show("forward-note", activity?.status === "failed" ? "Chrome không chuyển được tab. Bắt đầu lại phiên đăng nhập." : "");

  const fields = byId("fields");
  const labels = [...(activity?.fields ?? [])];
  if (activity?.otherFields) labels.push(`+${activity.otherFields} tham số khác`);
  fields.replaceChildren(...labels.map((name) => {
    const item = document.createElement("li");
    item.textContent = name;
    return item;
  }));
  fields.hidden = labels.length === 0;

  const active = pending.filter((login) => login.expiresAt > now);
  const others = active.length - Number(activity?.status === "waiting");
  show("pending", others > 0 ? `${others} phiên khác đang chờ callback.` : "");
  clearTimeout(expiryTimer);
  if (active.length) expiryTimer = setTimeout(() => renderFlow(snapshot), active[0].expiresAt - now + 20);
}

function renderDomains({ settings, granted }) {
  const existing = [...domains.children];
  if (existing.length === settings.origins.length && existing.every((item, index) =>
    item.dataset.origin === settings.origins[index] && item.dataset.granted === String(granted[index])
  )) return;

  domains.replaceChildren(...settings.origins.map((origin, index) => {
    const row = document.createElement("li");
    row.dataset.origin = origin;
    row.dataset.granted = String(granted[index]);
    const details = document.createElement("div");
    const address = document.createElement("code");
    address.textContent = origin;
    details.append(address);
    if (!granted[index]) {
      const hint = document.createElement("span");
      hint.className = "muted";
      hint.textContent = "Nhập lại domain để cấp quyền Chrome.";
      details.append(hint);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Xóa";
    remove.setAttribute("aria-label", `Xóa ${origin}`);
    remove.addEventListener("click", () => change(async () => {
      await send({ type: "remove-domain", origin });
      domain.focus();
    }));
    row.append(details, remove);
    return row;
  }));
  byId("empty").hidden = settings.origins.length > 0;
}

async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(errors[result?.error] ?? errors.relay_unavailable);
  return result;
}

async function refresh() {
  const id = ++refreshId;
  try {
    const result = await send({ type: "get-status" });
    if (id !== refreshId) return;
    snapshot = result;
    enabled.checked = result.settings.enabled;
    renderDomains(result);
    renderFlow(result);
    updateControls();
  } catch {
    show(errorBox.id, errors.relay_unavailable);
  }
}

function updateControls() {
  enabled.disabled = add.disabled = busy || !snapshot;
  for (const button of domains.querySelectorAll("button")) button.disabled = busy;
}

async function change(action) {
  if (busy) return;
  busy = true;
  updateControls();
  show(errorBox.id, "");
  try {
    await action();
  } catch (error) {
    show(errorBox.id, Object.values(errors).includes(error.message) ? error.message : errors.relay_unavailable);
  } finally {
    busy = false;
    updateControls();
    await refresh();
  }
}

enabled.addEventListener("change", () => {
  const value = enabled.checked;
  change(() => send({ type: "set-enabled", enabled: value }));
});

byId("add-domain").addEventListener("submit", (event) => {
  event.preventDefault();
  const origin = parseOrigin(domain.value);
  if (!origin) {
    show(errorBox.id, errors.invalid_domain);
    return;
  }
  change(async () => {
    // The permission request has to run directly from the form submit gesture.
    const granted = await chrome.permissions.request({ origins: [hostPattern(origin)] });
    if (!granted) throw new Error(errors.permission_required);
    await send({ type: "add-domain", origin });
    domain.value = "";
    domain.focus();
  });
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings || changes.relay) refresh();
});
chrome.permissions.onRemoved.addListener(refresh);
refresh();
