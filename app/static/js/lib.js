// Small UI toolkit: an auto-escaping html`` template, DOM mounting, dates, formatting,
// icons, toasts and dialogs. Every interpolated value is escaped unless it is already Safe,
// so user content (names, comments, menu items) can never become markup.

export class Safe {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
export const raw = (value) => new Safe(String(value));

function render(value) {
  if (value === null || value === undefined || value === false || value === true) return "";
  if (value instanceof Safe) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  return escape(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) out += render(values[i]) + strings[i + 1];
  return new Safe(out);
}

// ------------------------------------------------------------------ mounting

let revealObserver = null;

function observeReveals(root) {
  const targets = root.querySelectorAll(".reveal:not(.is-in)");
  if (!targets.length) return;
  if (!("IntersectionObserver" in window)) {
    targets.forEach((el) => el.classList.add("is-in"));
    return;
  }
  revealObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          revealObserver.unobserve(entry.target);
        }
      }
    },
    { rootMargin: "0px 0px -4% 0px", threshold: 0.01 },
  );
  targets.forEach((el) => revealObserver.observe(el));
}

// Style attributes are blocked by the page's CSP, so sizes travel as data-* attributes and
// are applied through the CSSOM, which CSP allows.
export function hydrate(root) {
  root.querySelectorAll("[data-frac]").forEach((el) => {
    const frac = clamp(Number(el.dataset.frac) || 0, 0, 1);
    el.style.setProperty("--frac", String(frac));
    el.style.setProperty("--pct", `${(frac * 100).toFixed(2)}%`);
  });
  root.querySelectorAll("[data-i]").forEach((el) => el.style.setProperty("--i", el.dataset.i));
  observeReveals(root);
}

export function mount(el, content) {
  if (!el) return;
  el.innerHTML = String(content);
  hydrate(el);
}

export const qs = (root, selector) => root.querySelector(selector);

// ------------------------------------------------------------------ numbers & text

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export const fmt1 = (v) => (v === null || v === undefined ? "–" : Number(v).toFixed(1));
export const fmt2 = (v) => (v === null || v === undefined ? "–" : Number(v).toFixed(2));
export const fmtInt = (v) => new Intl.NumberFormat("en-IN").format(v ?? 0);
export const plural = (n, word, many = `${word}s`) => `${fmtInt(n)} ${n === 1 ? word : many}`;
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");

export function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0]?.slice(0, 2) || "?";
  return letters.toUpperCase();
}

export const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "there";

/** Average weighted by count, over entries that have one. */
export function weightedAverage(entries, valueKey, countKey) {
  let sum = 0;
  let n = 0;
  for (const e of entries) {
    if (e[valueKey] !== null && e[valueKey] !== undefined && e[countKey] > 0) {
      sum += e[valueKey] * e[countKey];
      n += e[countKey];
    }
  }
  return n ? sum / n : null;
}

// ------------------------------------------------------------------ dates (local, ISO yyyy-mm-dd)

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function parseISODate(value) {
  const m = ISO_DATE.exec(String(value || ""));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return toISO(d) === value ? d : null;
}

export const isISODate = (value) => parseISODate(value) !== null;
export const todayISO = () => toISO(new Date());

export function addDays(iso, days) {
  const d = parseISODate(iso) ?? new Date();
  d.setDate(d.getDate() + days);
  return toISO(d);
}

const dateFormats = {
  long: new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }),
  medium: new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short" }),
  short: new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }),
  year: new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }),
  monthYear: new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }),
  dow: new Intl.DateTimeFormat("en-IN", { weekday: "short" }),
};

export function fmtDate(iso, style = "medium") {
  const d = parseISODate(iso);
  return d ? dateFormats[style].format(d) : String(iso ?? "");
}

export const dow = (iso) => fmtDate(iso, "dow");
export const dom = (iso) => parseISODate(iso)?.getDate() ?? "";

export function relativeDay(iso) {
  const today = todayISO();
  if (iso === today) return "Today";
  if (iso === addDays(today, -1)) return "Yesterday";
  if (iso === addDays(today, 1)) return "Tomorrow";
  return null;
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function timeAgo(isoDateTime) {
  const then = new Date(isoDateTime).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(seconds / 86400), "day");
  return dateFormats.year.format(new Date(then));
}

export function fmtMonthYear(isoDateTime) {
  const d = new Date(isoDateTime);
  return Number.isNaN(d.getTime()) ? "" : dateFormats.monthYear.format(d);
}

// ------------------------------------------------------------------ icons (thin line set)

const PATHS = {
  arrowUpRight: '<path d="M7 17 17 7M8.5 7H17v8.5"/>',
  arrowRight: '<path d="M4.5 12h15M13.5 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19.5 12h-15M10.5 6l-6 6 6 6"/>',
  chevronLeft: '<path d="m14.5 6-6 6 6 6"/>',
  chevronRight: '<path d="m9.5 6 6 6-6 6"/>',
  star: '<path d="m12 3.6 2.55 5.17 5.7.83-4.13 4.02.98 5.68L12 16.62 6.9 19.3l.98-5.68L3.75 9.6l5.7-.83L12 3.6Z"/>',
  starFill: '<path fill="currentColor" stroke="none" d="m12 3.6 2.55 5.17 5.7.83-4.13 4.02.98 5.68L12 16.62 6.9 19.3l.98-5.68L3.75 9.6l5.7-.83L12 3.6Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1Z"/>',
  sunrise: '<path d="M12 3v3.5M4.9 8.4l1.6 1.6M19.1 8.4 17.5 10M2.5 17.5h19M7 17.5a5 5 0 0 1 10 0M6 21h12"/>',
  bowl: '<path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0ZM8.5 8c0-1.4 1-1.6 1-3M12 8c0-1.4 1-1.6 1-3M15.5 8c0-1.4 1-1.6 1-3"/>',
  cup: '<path d="M4.5 9.5h12v4.5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V9.5ZM16.5 11h1.25a2.5 2.5 0 0 1 0 5H16.3M8.5 6c0-1 .9-1.2.9-2.5M12.5 6c0-1 .9-1.2.9-2.5"/>',
  moonStar: '<path d="M17.5 15.4A7 7 0 0 1 8.6 6.5a7 7 0 1 0 8.9 8.9Z"/><path d="M18 3.5v3M16.5 5h3"/>',
  flag: '<path d="M5.5 21V4M5.5 4.5h11l-2 4 2 4h-11"/>',
  user: '<circle cx="12" cy="8" r="3.75"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  logout: '<path d="M14.5 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M10 16.5 14.5 12 10 7.5M14.5 12H3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4.5 19.5h3.8L19 8.8 15.2 5 4.5 15.7v3.8ZM13.4 6.8l3.8 3.8"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.9 12.5h9.2L17.5 7M9.5 7V4.5h5V7"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8.3 12.3 2.6 2.6 4.9-5.2"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  chart: '<path d="M4 20.5V10M10 20.5V4M16 20.5v-7M2.5 20.5h19"/>',
  trendUp: '<path d="m3.5 16.5 5.5-5.5 4 4 7.5-7.5M15 7.5h5.5V13"/>',
  trendDown: '<path d="m3.5 7.5 5.5 5.5 4-4 7.5 7.5M15 16.5h5.5V11"/>',
  shield: '<path d="M12 3.2 19.5 6v5.7c0 4.4-3.1 8-7.5 9.1-4.4-1.1-7.5-4.7-7.5-9.1V6L12 3.2Z"/><path d="m9 12 2.2 2.2L15.3 10"/>',
  message: '<path d="M4.5 5.5h15v10.5H9l-4.5 3.5V5.5Z"/>',
  code: '<path d="m8.5 7.5-5 4.5 5 4.5M15.5 7.5l5 4.5-5 4.5"/>',
  book: '<path d="M5 4.5h12.5v15H6.5A1.5 1.5 0 0 1 5 18V4.5ZM5 18a1.5 1.5 0 0 1 1.5-1.5h11"/>',
  alert: '<path d="M12 4.2 20.8 19.5H3.2L12 4.2ZM12 10v4.2M12 16.8v.2"/>',
  refresh: '<path d="M19.5 11.5A7.5 7.5 0 1 0 17.3 17M19.5 5v6.5H13"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3.5 3.5l17 17M10.6 6c.5-.1.9-.1 1.4-.1C18 5.9 21.5 12 21.5 12s-.9 1.6-2.6 3.3M6.6 6.9C4 8.6 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  server: '<rect x="3.5" y="4" width="17" height="7" rx="2"/><rect x="3.5" y="13" width="17" height="7" rx="2"/><path d="M7.5 7.5h.01M7.5 16.5h.01"/>',
  layers: '<path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8 12 3.5Z"/><path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5"/>',
  pulse: '<path d="M2.5 12h4l2.5-6 4 12 2.5-6h6"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  sparkle: '<path d="M12 3.5c.6 4.3 2.2 5.9 6.5 6.5-4.3.6-5.9 2.2-6.5 6.5-.6-4.3-2.2-5.9-6.5-6.5 4.3-.6 5.9-2.2 6.5-6.5ZM18.5 15.5c.3 1.7.8 2.2 2.5 2.5-1.7.3-2.2.8-2.5 2.5-.3-1.7-.8-2.2-2.5-2.5 1.7-.3 2.2-.8 2.5-2.5Z"/>',
  utensils: '<path d="M7 3.5V11M4.5 3.5v5a2.5 2.5 0 0 0 5 0v-5M7 11v9.5M17 20.5V3.5c-2.2 1.2-3.5 3.6-3.5 6.5v3.5H17"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.2"/>',
};

export function icon(name, cls = "") {
  const body = PATHS[name] ?? PATHS.info;
  return raw(
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`,
  );
}

export const logo = () =>
  raw(
    '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle cx="16" cy="16" r="13.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle class="logo-core" cx="16" cy="16" r="4.6"/><circle cx="16" cy="7.4" r="2.3" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="23.5" cy="20.4" r="2.3" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8.5" cy="20.4" r="2.3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  );

export const MEAL_TYPES = ["breakfast", "lunch", "snacks", "dinner"];
export const MEAL_ICONS = { breakfast: "sunrise", lunch: "bowl", snacks: "cup", dinner: "moonStar" };
export const SCORE_WORDS = ["", "Poor", "Fair", "Good", "Great", "Excellent"];
export const DIMENSIONS = [
  { key: "score", label: "Overall", help: "How was the meal overall?" },
  { key: "taste", label: "Taste", help: "Flavour, seasoning, freshness" },
  { key: "hygiene", label: "Hygiene", help: "Clean plates, counter and food" },
  { key: "quantity", label: "Quantity", help: "Was the portion enough?" },
];

// ------------------------------------------------------------------ shared fragments

export function button({ label, href, kind = "primary", size = "", ico = "arrowUpRight", action, type, attrs = "" }) {
  const cls = `btn btn-${kind} ${size ? `btn-${size}` : ""} ${ico ? "has-ico" : ""}`;
  const inner = html`<span>${label}</span>${ico ? html`<span class="btn-ico">${icon(ico)}</span>` : ""}`;
  if (href) return html`<a class="${cls}" href="${href}" ${raw(attrs)}>${inner}</a>`;
  return html`<button class="${cls}" type="${type || "button"}" data-ico="${ico || ""}" ${action ? html`data-action="${action}"` : ""} ${raw(attrs)}>${inner}</button>`;
}

export function starsView(value, size = "") {
  const frac = value ? clamp(value / 5, 0, 1) : 0;
  const five = Array.from({ length: 5 }, () => icon("starFill"));
  return html`<span class="stars-view ${size}" role="img" aria-label="${value ? `${fmt1(value)} out of 5` : "No ratings yet"}">${five}<span class="on" data-frac="${frac}">${five}</span></span>`;
}

export function meters(stats, { compact = false } = {}) {
  return html`<div class="meters ${compact ? "compact" : ""}">
    ${DIMENSIONS.map((d) => {
      const v = stats?.[`avg_${d.key}`];
      return html`<div class="meter-row">
        <span class="label">${d.label}</span>
        <span class="meter" aria-hidden="true"><span class="meter-fill" data-frac="${v ? v / 5 : 0}"></span></span>
        <span class="val">${fmt1(v)}</span>
      </div>`;
    })}
  </div>`;
}

export function menuLine(items) {
  const list = Array.isArray(items) ? items : [];
  return html`${list.map((item, i) => html`${i ? html` <span class="sep">&amp;</span> ` : ""}${item}`)}`;
}

/** Map of lower-cased dish name -> {name, avg_score, rating_count} from GET /stats/dishes. */
export function dishIndex(list) {
  return new Map((Array.isArray(list) ? list : []).map((d) => [String(d.name).toLowerCase(), d]));
}

/** Each dish of a menu with its own average rating next to it (or "New" when never rated). */
export function dishList(items, dishes, { compact = false } = {}) {
  const list = Array.isArray(items) ? items : [];
  return html`<ul class="dish-list ${compact ? "compact" : ""}">${list.map((item) => {
    const d = dishes?.get(String(item).toLowerCase());
    const low = d && d.avg_score < 2.5;
    return html`<li class="dish">
      <span class="dish-name">${item}</span>
      ${d
        ? html`<span class="dish-score ${low ? "critical" : ""}" title="${fmt1(d.avg_score)} out of 5 from ${plural(d.rating_count, "rating")}">${icon("starFill")}${fmt1(d.avg_score)}<small>${d.rating_count}</small></span>`
        : html`<span class="dish-score new" title="Not rated yet">New</span>`}
    </li>`;
  })}</ul>`;
}

export function skeletonCards(count = 4, spans = ["span-6"]) {
  return html`${Array.from({ length: count }, (_, i) => html`<div class="bezel ${spans[i % spans.length]}"><div class="core stack gap-2">
    <div class="skeleton sk-line" data-frac="0"></div><div class="skeleton sk-title"></div><div class="skeleton sk-block"></div>
  </div></div>`)}`;
}

export function stateBlock({ ico = "info", title, text, actions = "", error = false }) {
  return html`<div class="state ${error ? "error" : ""}">
    <div class="ico-ring">${icon(ico)}</div>
    <h3 class="h3">${title}</h3>
    ${text ? html`<p>${text}</p>` : ""}
    ${actions ? html`<div class="actions">${actions}</div>` : ""}
  </div>`;
}

export function errorBlock(err, { retry = true } = {}) {
  const network = err?.status === 0;
  return stateBlock({
    ico: network ? "server" : "alert",
    error: true,
    title: network ? "Can't reach the kitchen" : "That didn't work",
    text: err?.message || "Something unexpected happened.",
    actions: retry ? button({ label: "Try again", kind: "ghost", ico: "refresh", action: "retry", size: "sm" }) : "",
  });
}

// ------------------------------------------------------------------ toasts

const TOAST_ICONS = { good: "checkCircle", error: "alert", info: "info" };

export function toast(message, kind = "info") {
  const host = document.getElementById("toasts");
  if (!host) return;
  while (host.children.length >= 3) host.firstElementChild.remove();
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  el.innerHTML = String(html`${icon(TOAST_ICONS[kind] ?? "info")}<span>${message}</span>`);
  host.append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("is-in")));
  const remove = () => {
    el.classList.remove("is-in");
    setTimeout(() => el.remove(), 600);
  };
  setTimeout(remove, kind === "error" ? 6500 : 4200);
  el.addEventListener("click", remove, { once: true });
}

// ------------------------------------------------------------------ dialogs

/** Open a modal <dialog>. Returns { dialog, close }; `onClose` runs once when it closes. */
export function openDialog(content, { onClose } = {}) {
  const dialog = document.createElement("dialog");
  dialog.className = "dialog";
  dialog.innerHTML = String(html`<div class="bezel"><div class="core">${content}</div></div>`);
  hydrate(dialog);
  document.body.append(dialog);
  let closed = false;
  const close = (value) => {
    if (closed) return;
    closed = true;
    if (dialog.open && typeof dialog.close === "function") dialog.close();
    dialog.remove();
    onClose?.(value);
  };
  dialog.addEventListener("close", () => close(undefined));
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close(undefined);
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close(undefined);
    if (e.target.closest("[data-action='dismiss']")) close(undefined);
  });
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  return { dialog, close };
}

export function confirmDialog({ title, text, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const { dialog, close } = openDialog(
      html`<div class="dialog-head"><h2 class="h3">${title}</h2>
        <button class="icon-btn" data-action="dismiss" aria-label="Close">${icon("x")}</button></div>
        <p class="dialog-body">${text}</p>
        <div class="dialog-actions">
          <button class="btn btn-ghost btn-sm" data-action="dismiss" type="button">Cancel</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"} btn-sm" data-action="confirm" type="button">${confirmLabel}</button>
        </div>`,
      { onClose: (value) => resolve(value === true) },
    );
    dialog.querySelector("[data-action='confirm']").addEventListener("click", () => close(true));
    dialog.querySelector("[data-action='dismiss']")?.focus();
  });
}

// ------------------------------------------------------------------ forms

export function setBusy(buttonEl, busy, busyLabel) {
  if (!buttonEl) return;
  if (busy) {
    buttonEl.dataset.label ??= buttonEl.querySelector("span")?.textContent ?? "";
    buttonEl.disabled = true;
    const span = buttonEl.querySelector("span");
    if (span && busyLabel) span.textContent = busyLabel;
    const ico = buttonEl.querySelector(".btn-ico");
    if (ico) ico.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
  } else {
    buttonEl.disabled = false;
    const span = buttonEl.querySelector("span");
    if (span && buttonEl.dataset.label !== undefined) span.textContent = buttonEl.dataset.label;
    const ico = buttonEl.querySelector(".btn-ico");
    if (ico) ico.innerHTML = String(icon(buttonEl.dataset.ico || "arrowUpRight"));
  }
}

export function setFieldError(form, name, message) {
  const field = form.querySelector(`[data-field="${name}"]`);
  if (!field) return false;
  field.classList.toggle("has-error", Boolean(message));
  const slot = field.querySelector(".field-error");
  if (slot) slot.textContent = message || "";
  const input = field.querySelector("input, textarea");
  if (input && input.type !== "radio") input.setAttribute("aria-invalid", message ? "true" : "false");
  return true;
}

export function clearErrors(form) {
  form.querySelectorAll(".has-error").forEach((el) => el.classList.remove("has-error"));
  form.querySelectorAll("[aria-invalid='true']").forEach((el) => el.setAttribute("aria-invalid", "false"));
  const banner = form.querySelector(".form-error");
  if (banner) banner.hidden = true;
}

export function showFormError(form, message) {
  const banner = form.querySelector(".form-error");
  if (!banner) return;
  banner.hidden = false;
  const text = banner.querySelector("span");
  if (text) text.textContent = message;
}

/** Map a 422's details onto fields; returns true if at least one field took a message. */
export function applyFieldErrors(form, err, messages = {}) {
  let any = false;
  for (const detail of err?.details ?? []) {
    const loc = Array.isArray(detail.loc) ? detail.loc : [];
    const name = loc[0] === "body" ? loc[1] : loc[loc.length - 1];
    if (name && setFieldError(form, name, messages[name] ?? cleanMessage(detail.msg))) any = true;
  }
  return any;
}

function cleanMessage(msg) {
  const text = String(msg || "Invalid value").replace(/^Value error, /, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
