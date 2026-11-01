// Entry point: hash router, navigation, footer, theme and last-resort error handling.

import { api, auth, refreshUser } from "./api.js";
import { button, errorBlock, firstName, html, icon, initials, logo, mount, stateBlock, toast } from "./lib.js";
import { loginView, registerView } from "./views/auth.js";
import * as insights from "./views/insights.js";
import * as landing from "./views/landing.js";
import * as meal from "./views/meal.js";
import * as menu from "./views/menu.js";
import * as profile from "./views/profile.js";
import * as warden from "./views/warden.js";

const REPO_URL = "https://github.com/ramithnayak8/hostel-food-rating-api";
const THEME_KEY = "thali.theme";

const ROUTES = [
  { pattern: /^$/, view: landing, nav: "home" },
  { pattern: /^menu$/, view: menu, nav: "menu" },
  { pattern: /^meal\/(?<id>[^/]+)$/, view: meal, nav: "menu" },
  { pattern: /^insights$/, view: insights, nav: "insights" },
  { pattern: /^login$/, view: loginView, nav: "login" },
  { pattern: /^register$/, view: registerView, nav: "register" },
  { pattern: /^me$/, view: profile, nav: "me", auth: true },
  { pattern: /^warden$/, view: warden, nav: "warden", admin: true },
];

const main = document.getElementById("main");
const navRoot = document.getElementById("nav-root");
const footerRoot = document.getElementById("footer-root");

let navToken = 0;
let lastPath = null;
let currentRoute = null;
let booted = false;

// ------------------------------------------------------------------ routing

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [rawPath, search = ""] = hash.split("?");
  let path = rawPath;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    /* malformed escape: match the raw text, which falls through to "not found" */
  }
  return { path: path.replace(/\/+$/, ""), query: new URLSearchParams(search) };
}

function setTitle(title) {
  document.title = title ? `${title} · Thali` : "Thali · Hostel Food Ratings";
}

function pageState(content) {
  return html`<section class="page"><div class="container"><div class="bezel"><div class="core">${content}</div></div></div></section>`;
}

async function route() {
  const token = (navToken += 1);
  closeMenu();
  const { path, query } = parseHash();
  let match = null;
  let params = {};
  for (const r of ROUTES) {
    const m = r.pattern.exec(path);
    if (m) {
      match = r;
      params = m.groups ?? {};
      break;
    }
  }
  currentRoute = match;
  renderNav(match?.nav ?? null);

  const el = document.createElement("div");
  el.className = "view";
  const ctx = {
    el,
    params,
    query,
    alive: () => token === navToken && el.isConnected,
    go: (hash) => (location.hash === hash ? route() : (location.hash = hash)),
    redirect: (hash) => (location.hash === hash ? route() : location.replace(hash)),
    refresh: () => route(),
    setTitle,
  };

  if (match && (match.auth || match.admin) && !auth.loggedIn) {
    ctx.redirect(`#/login?next=${encodeURIComponent(location.hash || "#/")}`);
    return;
  }

  const samePage = path === lastPath;
  lastPath = path;
  main.replaceChildren(el);
  if (!samePage) window.scrollTo({ top: 0, behavior: "instant" });
  if (booted && !samePage) main.focus({ preventScroll: true });
  booted = true;

  if (!match) {
    setTitle("Page not found");
    mount(el, pageState(stateBlock({
      ico: "utensils",
      title: "This page isn't on the menu",
      text: "The link may be old or mistyped.",
      actions: button({ label: "Go home", href: "#/", kind: "ghost", size: "sm", ico: "arrowLeft" }),
    })));
    return;
  }
  if (match.admin && !auth.isAdmin) {
    setTitle("Wardens only");
    mount(el, pageState(stateBlock({
      ico: "lock",
      title: "Wardens only",
      text: "This area is for hostel wardens. Your account is a student account.",
      actions: button({ label: "Back to the menu", href: "#/menu", kind: "ghost", size: "sm", ico: "arrowLeft" }),
    })));
    return;
  }

  setTitle(match.view.title);
  try {
    await match.view.render(ctx);
  } catch (err) {
    console.error(err);
    if (!ctx.alive()) return;
    mount(el, pageState(errorBlock(err)));
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-action='retry']")) route();
    });
  }
}

// ------------------------------------------------------------------ theme

function isDark() {
  const set = document.documentElement.dataset.theme;
  if (set) return set === "dark";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function toggleTheme() {
  const next = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* not saved; still applies to this page */
  }
  renderNav(currentRoute?.nav ?? null);
}

// ------------------------------------------------------------------ navigation

function renderNav(active) {
  const user = auth.user;
  const current = (id) => (active === id ? html`aria-current="page"` : "");
  const links = [
    { href: "#/menu", id: "menu", label: "Menu" },
    { href: "#/insights", id: "insights", label: "Insights" },
    ...(auth.isAdmin ? [{ href: "#/warden", id: "warden", label: "Warden" }] : []),
  ];
  const dark = isDark();

  mount(navRoot, html`<div class="nav-wrap">
    <nav class="nav" aria-label="Main">
      <a class="brand" href="#/" aria-label="Thali, home">${logo()}<span>Thali</span></a>
      <div class="nav-links">${links.map((l) => html`<a class="nav-link" href="${l.href}" ${current(l.id)}>${l.label}</a>`)}</div>
      <div class="nav-actions">
        <span class="nav-sep desk"></span>
        <button class="icon-btn" type="button" data-action="theme" aria-label="${dark ? "Use light theme" : "Use dark theme"}">${icon(dark ? "sun" : "moon")}</button>
        ${user
          ? html`<a class="avatar-pill desk" href="#/me" ${current("me")}><span class="avatar">${initials(user.name)}</span><span class="stack"><span>${firstName(user.name)}</span>${user.role === "admin" ? html`<span class="role-tag">Warden</span>` : ""}</span></a>`
          : html`<a class="nav-link desk" href="#/login" ${current("login")}>Log in</a><span class="desk">${button({ label: "Join", href: "#/register", size: "sm" })}</span>`}
        <button class="burger" type="button" data-action="menu" aria-label="Open menu" aria-expanded="false" aria-controls="mobile-menu"><span></span><span></span></button>
      </div>
    </nav>
  </div>
  <div class="mobile-menu" id="mobile-menu" aria-hidden="true" inert>
    <nav aria-label="Mobile">
      ${[{ href: "#/", id: "home", label: "Home" }, ...links].map((l, i) => html`<div class="stagger" data-i="${i}"><a class="big" href="${l.href}" ${current(l.id)}>${l.label}</a></div>`)}
      ${user ? html`<div class="stagger" data-i="${links.length + 1}"><a class="big" href="#/me" ${current("me")}>Profile</a></div>` : ""}
    </nav>
    <div class="menu-foot stagger" data-i="${links.length + 2}">
      ${user
        ? button({ label: "Log out", kind: "ghost", ico: "logout", action: "logout" })
        : html`${button({ label: "Create account", href: "#/register" })}${button({ label: "Log in", href: "#/login", kind: "ghost", ico: "arrowRight" })}`}
    </div>
  </div>`);
}

function openMenu() {
  navRoot.classList.add("menu-open");
  const menuEl = document.getElementById("mobile-menu");
  menuEl?.removeAttribute("inert");
  menuEl?.setAttribute("aria-hidden", "false");
  const burger = navRoot.querySelector(".burger");
  burger?.setAttribute("aria-expanded", "true");
  burger?.setAttribute("aria-label", "Close menu");
  document.body.style.overflow = "hidden";
}

function closeMenu() {
  if (!navRoot.classList.contains("menu-open")) return;
  navRoot.classList.remove("menu-open");
  const menuEl = document.getElementById("mobile-menu");
  menuEl?.setAttribute("inert", "");
  menuEl?.setAttribute("aria-hidden", "true");
  const burger = navRoot.querySelector(".burger");
  burger?.setAttribute("aria-expanded", "false");
  burger?.setAttribute("aria-label", "Open menu");
  document.body.style.overflow = "";
}

navRoot.addEventListener("click", (e) => {
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (action === "theme") toggleTheme();
  else if (action === "menu") navRoot.classList.contains("menu-open") ? closeMenu() : openMenu();
  else if (action === "logout") {
    closeMenu();
    auth.clear("logout");
    toast("You've been logged out.", "info");
    location.hash = "#/";
  } else if (e.target.closest(".mobile-menu a")) closeMenu();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu();
});

window.matchMedia?.("(min-width: 861px)").addEventListener?.("change", (e) => {
  if (e.matches) closeMenu();
});

// ------------------------------------------------------------------ footer

function renderFooter() {
  mount(footerRoot, html`<div class="footer"><div class="container footer-inner">
    <a class="brand" href="#/">${logo()}<span>Thali</span></a>
    <nav class="footer-links" aria-label="Footer">
      <a class="link" href="#/menu">Menu</a>
      <a class="link" href="#/insights">Insights</a>
      <a class="link" href="/docs">API docs</a>
      <a class="link" href="${REPO_URL}" target="_blank" rel="noopener noreferrer">Source code</a>
    </nav>
    <span class="status-pill" data-slot="status"><span class="dot"></span>Checking service…</span>
  </div></div>`);
  checkHealth();
}

async function checkHealth() {
  const pill = footerRoot.querySelector("[data-slot='status']");
  if (!pill) return;
  try {
    const [live] = await Promise.all([api("/health"), api("/health/ready")]);
    pill.className = "status-pill ok";
    mount(pill, html`<span class="dot"></span>All systems normal · v${live.version}`);
  } catch (err) {
    pill.className = "status-pill down";
    mount(pill, html`<span class="dot"></span>${err.status === 503 ? "Database unavailable" : err.status === 0 ? "Server unreachable" : "Service degraded"}`);
  }
}

// ------------------------------------------------------------------ errors & session

let lastUnexpected = 0;
function reportUnexpected(error) {
  console.error(error);
  if (Date.now() - lastUnexpected < 5000) return;
  lastUnexpected = Date.now();
  toast(error?.name === "ApiError" ? error.message : "Something unexpected happened. If it keeps happening, reload the page.", "error");
}
window.addEventListener("error", (e) => reportUnexpected(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => {
  e.preventDefault();
  reportUnexpected(e.reason);
});

auth.subscribe((reason) => {
  renderNav(currentRoute?.nav ?? null);
  if (reason === "expired") {
    toast("Your session has ended. Please log in again.", "info");
    if (currentRoute?.auth || currentRoute?.admin) location.replace(`#/login?next=${encodeURIComponent(location.hash)}`);
  }
});

// ------------------------------------------------------------------ boot

document.querySelector(".skip-link")?.addEventListener("click", (e) => {
  e.preventDefault();
  main.focus();
});

window.addEventListener("hashchange", () => {
  // Plain in-page anchors (not "#/...") are not routes.
  if (location.hash && !location.hash.startsWith("#/")) return;
  route();
});

async function boot() {
  renderNav(null);
  renderFooter();
  await refreshUser();
  route();
}

boot();
