import { api } from "../api.js";
import { bindMealForm, mealForm } from "../meal-form.js";
import {
  MEAL_ICONS,
  MEAL_TYPES,
  addDays,
  button,
  cap,
  confirmDialog,
  dom,
  dow,
  errorBlock,
  fmt1,
  fmt2,
  fmtDate,
  fmtInt,
  html,
  icon,
  isISODate,
  menuLine,
  mount,
  openDialog,
  plural,
  setBusy,
  stateBlock,
  toast,
  todayISO,
  weightedAverage,
} from "../lib.js";

export const title = "Warden's desk";
const TABS = [
  { id: "complaints", label: "Complaints", ico: "flag" },
  { id: "publish", label: "Publish menu", ico: "plus" },
  { id: "manage", label: "Manage meals", ico: "calendar" },
];

export async function render(ctx) {
  const tab = TABS.some((t) => t.id === ctx.query.get("tab")) ? ctx.query.get("tab") : "complaints";
  const today = todayISO();

  mount(ctx.el, html`<section class="page"><div class="container">
    <div class="page-head">
      <span class="eyebrow"><span class="dot"></span>Warden's desk</span>
      <div class="page-head-row">
        <h1 class="h1">Run a better <em>mess.</em></h1>
        <nav class="segmented" aria-label="Warden sections" data-slot="tabs">${tabs(tab, null)}</nav>
      </div>
    </div>
    <div class="grid" data-slot="kpis">
      ${[0, 1, 2, 3].map(() => html`<div class="bezel span-3"><div class="core stack gap-2"><div class="skeleton sk-line"></div><div class="skeleton sk-title"></div></div></div>`)}
    </div>
    <div class="section-gap" data-slot="tab"></div>
  </div></section>`);

  ctx.el.addEventListener("click", (e) => {
    if (e.target.closest("[data-action='retry']")) ctx.refresh();
  });

  // KPIs and the complaint count load alongside the tab, and never block it.
  loadKpis(ctx, today);

  const slot = ctx.el.querySelector("[data-slot='tab']");
  if (tab === "complaints") await complaintsTab(ctx, slot);
  else if (tab === "publish") publishTab(ctx, slot);
  else await manageTab(ctx, slot);
}

function tabs(active, flaggedCount) {
  return html`${TABS.map((t) => html`<a href="#/warden?tab=${t.id}" ${t.id === active ? html`aria-current="page"` : ""}>${icon(t.ico)}${t.label}
    ${t.id === "complaints" && flaggedCount ? html`<span class="count">${flaggedCount}</span>` : ""}</a>`)}`;
}

async function loadKpis(ctx, today) {
  const slot = ctx.el.querySelector("[data-slot='kpis']");
  const [daily, flagged] = await Promise.all([
    api(`/stats/daily?date=${today}`).catch(() => null),
    api("/admin/flagged-meals").catch(() => null),
  ]);
  if (!ctx.alive()) return;
  const meals = daily?.meals ?? [];
  const ratings = meals.reduce((s, m) => s + m.rating_count, 0);
  const avg = weightedAverage(meals, "avg_score", "rating_count");
  const open = flagged?.length ?? null;
  mount(slot, html`
    ${kpi("Open complaints", open === null ? "–" : fmtInt(open), open ? "Meals averaging below 2.0" : "Nothing flagged right now", "flag", open ? "critical" : "good", 0)}
    ${kpi("Ratings today", fmtInt(ratings), meals.length ? `Across ${plural(meals.length, "meal")}` : "No meals published today", "star", "", 1)}
    ${kpi("Today's average", fmt2(avg), avg === null ? "Waiting for ratings" : "Weighted by ratings per meal", "trendUp", "", 2)}
    ${kpi("Menus today", `${meals.length}/4`, meals.length < 4 ? html`<a class="link" href="#/warden?tab=publish&date=${today}">Publish the rest ${icon("arrowUpRight")}</a>` : "All four meals are up", "utensils", "", 3)}`);
  if (open !== null) mount(ctx.el.querySelector("[data-slot='tabs']"), tabs(ctx.query.get("tab") || "complaints", open));
}

function kpi(label, value, sub, ico, tone, i) {
  return html`<div class="bezel span-3 reveal" data-i="${i}"><div class="core stat">
    <div class="row between"><span class="card-label">${label}</span>${icon(ico, `ico ${tone}`)}</div>
    <span class="big-num num">${value}</span>
    <span class="sub">${sub}</span>
  </div></div>`;
}

// ------------------------------------------------------------------ complaints

async function complaintsTab(ctx, slot) {
  mount(slot, html`<div class="bezel"><div class="core"><div class="skeleton sk-block"></div></div></div>`);
  let flagged;
  try {
    flagged = await api("/admin/flagged-meals");
  } catch (err) {
    if (!ctx.alive()) return;
    mount(slot, html`<div class="bezel"><div class="core">${errorBlock(err)}</div></div>`);
    return;
  }
  if (!ctx.alive()) return;
  mount(slot, html`<div class="bezel reveal"><div class="core">
    <div class="card-title"><div class="stack"><span class="card-label">Flagged meals</span>
      <span class="small muted">A meal is flagged when 3 or more ratings average below 2.0. The flag clears if later ratings lift it back up.</span></div></div>
    ${flagged.length
      ? html`<ol class="list">${flagged.map((m) => html`<li class="list-item">
          <div class="row gap-2"><span class="meal-type"><span class="ico-tile">${icon(MEAL_ICONS[m.meal_type])}</span></span>
            <div class="list-main"><a class="list-title" href="#/meal/${m.meal_id}">${menuLine(m.menu_items)}</a>
              <span class="list-meta"><span>${cap(m.meal_type)} · ${fmtDate(m.date, "long")}</span><span>${plural(m.rating_count, "rating")}</span>
                <span>Taste ${fmt1(m.avg_taste)} · Hygiene ${fmt1(m.avg_hygiene)} · Quantity ${fmt1(m.avg_quantity)}</span></span></div></div>
          <div class="stack gap-1">
            <span class="score-pill critical">${icon("flag")}${fmt2(m.avg_score)}</span>
            <a class="link small" href="#/meal/${m.meal_id}">Read reviews ${icon("arrowUpRight")}</a>
          </div>
        </li>`)}</ol>`
      : stateBlock({ ico: "checkCircle", title: "No complaints", text: "No meal is averaging below 2.0 right now. The kitchen is doing fine." })}
  </div></div>`);
}

// ------------------------------------------------------------------ publish

function publishTab(ctx, slot) {
  const date = isISODate(ctx.query.get("date")) ? ctx.query.get("date") : todayISO();
  const type = MEAL_TYPES.includes(ctx.query.get("type")) ? ctx.query.get("type") : "";
  mount(slot, html`<div class="grid">
    <div class="bezel span-7 reveal"><div class="core">
      <div class="card-title"><div class="stack"><span class="card-label">Publish a menu</span><span class="small muted">One menu per meal per day. Students can rate it once it's been served.</span></div></div>
      ${mealForm({ initial: { date, meal_type: type }, submitLabel: "Publish menu" })}
    </div></div>
    <div class="bezel span-5 reveal" data-i="1"><div class="core stack gap-3">
      <span class="card-label">Tips</span>
      <div class="callout">${icon("info")}<span>Paste a whole list like <strong>Dal, Rice, Roti</strong> and it splits into dishes.</span></div>
      <div class="callout">${icon("star")}<span>Dishes are scored by name across the week, so keep spellings consistent (for example, always "Jeera rice").</span></div>
      <div class="callout">${icon("edit")}<span>Made a mistake? Edit or delete the meal under <a class="link" href="#/warden?tab=manage&date=${date}">Manage meals</a>. Editing keeps its ratings.</span></div>
    </div></div>
  </div>`);
  const form = slot.querySelector("[data-meal-form]");
  const controls = bindMealForm(form, {
    initial: {},
    onSubmit: async (payload) => {
      const meal = await api("/meals", { method: "POST", body: payload });
      if (!ctx.alive()) return;
      toast(`${cap(meal.meal_type)} for ${fmtDate(meal.date)} is published.`, "good");
      controls.reset();
      const nextType = MEAL_TYPES[MEAL_TYPES.indexOf(meal.meal_type) + 1];
      if (nextType) {
        const radio = form.querySelector(`input[value="${nextType}"]`);
        if (radio) radio.checked = true;
      }
      loadKpis(ctx, todayISO());
    },
  });
}

// ------------------------------------------------------------------ manage

async function manageTab(ctx, slot) {
  const date = isISODate(ctx.query.get("date")) ? ctx.query.get("date") : todayISO();
  const today = todayISO();
  const days = Array.from({ length: 7 }, (_, i) => addDays(date, i - 3));
  mount(slot, html`<div class="bezel reveal"><div class="core">
    <div class="card-title wrap">
      <div class="stack"><span class="card-label">Meals on ${fmtDate(date, "long")}</span><span class="small muted">Edit keeps ratings. Delete removes the meal and its ratings.</span></div>
      <div class="toolbar">
        <a class="icon-btn" href="#/warden?tab=manage&date=${addDays(date, -1)}" aria-label="Previous day">${icon("chevronLeft")}</a>
        <nav class="date-strip" aria-label="Pick a day">${days.map((d) => html`<a class="day-pill ${d === today ? "is-today" : ""}" href="#/warden?tab=manage&date=${d}" ${d === date ? html`aria-current="date"` : ""} aria-label="${fmtDate(d, "long")}"><span class="dow">${dow(d)}</span><span class="dom">${dom(d)}</span></a>`)}</nav>
        <a class="icon-btn" href="#/warden?tab=manage&date=${addDays(date, 1)}" aria-label="Next day">${icon("chevronRight")}</a>
      </div>
    </div>
    <div data-slot="meals"><div class="skeleton sk-block"></div></div>
  </div></div>`);

  const list = slot.querySelector("[data-slot='meals']");
  let daily;
  try {
    daily = await api(`/stats/daily?date=${date}`);
  } catch (err) {
    if (!ctx.alive()) return;
    mount(list, errorBlock(err));
    return;
  }
  if (!ctx.alive()) return;
  const byType = Object.fromEntries(daily.meals.map((m) => [m.meal_type, m]));
  mount(list, html`<div class="list">${MEAL_TYPES.map((t) => {
    const m = byType[t];
    if (!m) {
      return html`<div class="list-item"><div class="row gap-2"><span class="meal-type"><span class="ico-tile">${icon(MEAL_ICONS[t])}</span></span>
        <div class="list-main"><span class="list-title muted">${cap(t)}: not published</span></div></div>
        ${button({ label: "Publish", href: `#/warden?tab=publish&date=${date}&type=${t}`, kind: "ghost", size: "xs", ico: "" })}</div>`;
    }
    return html`<div class="list-item"><div class="row gap-2"><span class="meal-type"><span class="ico-tile">${icon(MEAL_ICONS[t])}</span></span>
        <div class="list-main"><a class="list-title" href="#/meal/${m.meal_id}">${menuLine(m.menu_items)}</a>
          <span class="list-meta"><span>${cap(t)}</span><span>${plural(m.rating_count, "rating")}</span><span>Average ${fmt2(m.avg_score)}</span>
          ${m.flagged ? html`<span class="badge critical">${icon("flag")}Flagged</span>` : ""}</span></div></div>
      <div class="row gap-1">
        <button class="icon-btn" type="button" data-edit="${m.meal_id}" aria-label="Edit ${t}">${icon("edit")}</button>
        <button class="icon-btn danger" type="button" data-delete="${m.meal_id}" aria-label="Delete ${t}">${icon("trash")}</button>
      </div></div>`;
  })}</div>`);

  list.addEventListener("click", async (e) => {
    const edit = e.target.closest("[data-edit]");
    const del = e.target.closest("[data-delete]");
    const target = edit ?? del;
    const m = target && daily.meals.find((x) => x.meal_id === Number(target.dataset.edit ?? target.dataset.delete));
    if (!m) return;
    const meal = { id: m.meal_id, date: m.date, meal_type: m.meal_type, menu_items: m.menu_items };
    if (edit) {
      const { dialog, close } = openDialog(html`<div class="dialog-head"><h2 class="h3">Edit ${m.meal_type}</h2>
        <button class="icon-btn" data-action="dismiss" type="button" aria-label="Close">${icon("x")}</button></div>
        ${mealForm({ initial: meal, submitLabel: "Save changes", cancel: true })}`);
      bindMealForm(dialog.querySelector("form"), {
        initial: meal,
        onSubmit: async (payload) => {
          await api(`/meals/${meal.id}`, { method: "PUT", body: payload });
          close();
          toast("Menu updated.", "good");
          ctx.refresh();
        },
      });
      return;
    }
    const ok = await confirmDialog({
      title: `Delete this ${m.meal_type}?`,
      text: `${fmtDate(m.date, "long")}: ${m.menu_items.join(", ")}. ${m.rating_count ? `All ${plural(m.rating_count, "rating")} will be deleted too.` : "It has no ratings yet."}`,
      confirmLabel: "Delete meal",
      danger: true,
    });
    if (!ok || !ctx.alive()) return;
    setBusy(del, true);
    try {
      await api(`/meals/${meal.id}`, { method: "DELETE" });
      toast("Meal deleted.", "good");
    } catch (err) {
      toast(err.status === 404 ? "That meal was already deleted." : err.message, err.status === 404 ? "info" : "error");
    }
    ctx.refresh();
  });
}
