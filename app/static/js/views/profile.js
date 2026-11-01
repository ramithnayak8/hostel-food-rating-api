import { api, auth, refreshUser } from "../api.js";
import {
  MEAL_ICONS,
  button,
  cap,
  errorBlock,
  fmtDate,
  fmtMonthYear,
  html,
  icon,
  initials,
  menuLine,
  mount,
  plural,
  setBusy,
  starsView,
  stateBlock,
  timeAgo,
  toast,
} from "../lib.js";

export const title = "My profile";
const PAGE = 10;

export async function render(ctx) {
  const user = (await refreshUser()) ?? auth.user;
  if (!ctx.alive()) return;
  if (!user) {
    ctx.redirect(`#/login?next=${encodeURIComponent("#/me")}`);
    return;
  }

  mount(ctx.el, html`<section class="page"><div class="container">
    <div class="page-head">
      <span class="eyebrow"><span class="dot"></span>${user.role === "admin" ? "Warden account" : "Student account"}</span>
      <h1 class="h1">Hello, <em>${user.name.split(" ")[0]}.</em></h1>
    </div>
    <div class="grid">
      <div class="bezel span-5 reveal"><div class="core">
        <div class="profile-head">
          <span class="avatar lg">${initials(user.name)}</span>
          <div class="stack gap-1"><h2 class="h3">${user.name}</h2><span class="badge accent">${icon(user.role === "admin" ? "shield" : "user")}${cap(user.role === "admin" ? "warden" : user.role)}</span></div>
        </div>
        <dl class="profile-facts">
          <div><dt>Room</dt><dd>${user.room_no}</dd></div>
          <div><dt>Member since</dt><dd>${fmtMonthYear(user.created_at)}</dd></div>
          <div><dt>Email</dt><dd>${user.email}</dd></div>
          <div><dt>Ratings given</dt><dd data-slot="count">…</dd></div>
        </dl>
        <div class="form-actions">${button({ label: "Log out", kind: "ghost", size: "sm", ico: "logout", action: "logout" })}
          ${user.role === "admin" ? button({ label: "Warden's desk", href: "#/warden", size: "sm" }) : button({ label: "Rate today's meals", href: "#/menu", size: "sm" })}</div>
      </div></div>
      <div class="bezel span-7 reveal" data-i="1"><div class="core">
        <div class="card-title"><div class="stack"><span class="card-label">Your ratings</span><span class="small muted">Newest first. Only you and the warden can link these to you.</span></div></div>
        <div class="list" data-slot="history"><div class="skeleton sk-block"></div></div>
        <div class="row" data-slot="more"></div>
      </div></div>
    </div>
  </div></section>`);

  ctx.el.addEventListener("click", (e) => {
    if (e.target.closest("[data-action='logout']")) {
      auth.clear("logout");
      toast("You've been logged out.", "info");
      ctx.go("#/");
    }
    if (e.target.closest("[data-action='retry']")) ctx.refresh();
  });
  loadHistory(ctx, 0);
}

async function loadHistory(ctx, offset) {
  const list = ctx.el.querySelector("[data-slot='history']");
  const more = ctx.el.querySelector("[data-slot='more']");
  let page;
  try {
    page = await api(`/auth/me/ratings?limit=${PAGE}&offset=${offset}`);
  } catch (err) {
    if (!ctx.alive()) return;
    if (offset === 0) mount(list, errorBlock(err));
    else toast(err.message, "error");
    return;
  }
  if (!ctx.alive()) return;
  const count = ctx.el.querySelector("[data-slot='count']");
  if (count) count.textContent = String(page.total);

  if (offset === 0 && !page.items.length) {
    mount(list, stateBlock({
      ico: "star",
      title: "No ratings yet",
      text: "Your ratings will show up here after you rate your first meal.",
      actions: button({ label: "See today's menu", href: "#/menu", size: "sm" }),
    }));
  } else {
    const items = html`${page.items.map(historyItem)}`;
    if (offset === 0) mount(list, items);
    else list.insertAdjacentHTML("beforeend", String(items));
  }
  const next = offset + page.items.length;
  mount(more, next < page.total ? button({ label: `Show more (${page.total - next} left)`, kind: "ghost", size: "sm", ico: "chevronRight", attrs: `data-more="${next}"` }) : "");
  more.querySelector("[data-more]")?.addEventListener("click", (e) => {
    setBusy(e.currentTarget, true, "Loading…");
    loadHistory(ctx, next);
  }, { once: true });
}

function historyItem(r) {
  const m = r.meal;
  return html`<article class="list-item">
    <div class="row gap-2">
      <span class="meal-type"><span class="ico-tile">${icon(MEAL_ICONS[m.meal_type])}</span></span>
      <div class="list-main">
        <a class="list-title" href="#/meal/${m.id}">${menuLine(m.menu_items)}</a>
        <span class="list-meta"><span>${cap(m.meal_type)} · ${fmtDate(m.date)}</span><span>Rated ${timeAgo(r.created_at)}</span>
          ${m.flagged ? html`<span class="badge critical">${icon("flag")}Flagged</span>` : ""}</span>
        <span class="list-meta"><span>Taste ${r.taste}</span><span>Hygiene ${r.hygiene}</span><span>Quantity ${r.quantity}</span></span>
        ${r.comment ? html`<p class="review-text small">“${r.comment}”</p>` : ""}
      </div>
    </div>
    <span class="stack gap-1">${starsView(r.score)}<span class="small muted num">${r.score}/5 overall</span></span>
  </article>`;
}
