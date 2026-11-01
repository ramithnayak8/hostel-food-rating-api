import { api } from "../api.js";
import { bindCharts, countChart, scoreChart, weekTable } from "../charts.js";
import {
  MEAL_ICONS,
  MEAL_TYPES,
  addDays,
  cap,
  errorBlock,
  fmt1,
  fmt2,
  fmtDate,
  fmtInt,
  html,
  icon,
  isISODate,
  menuLine,
  meters,
  mount,
  plural,
  stateBlock,
  todayISO,
  weightedAverage,
} from "../lib.js";

export const title = "Insights";

export async function render(ctx) {
  const requested = ctx.query.get("end");
  const today = todayISO();
  const end = isISODate(requested) ? requested : today;
  const start = addDays(end, -6);

  mount(ctx.el, html`<section class="page"><div class="container">
    <div class="page-head">
      <span class="eyebrow"><span class="dot"></span>Insights</span>
      <div class="page-head-row">
        <h1 class="h1">${fmtDate(start, "short")} <em>to</em> ${fmtDate(end, "short")}</h1>
        <div class="toolbar">
          <a class="icon-btn" href="#/insights?end=${addDays(end, -7)}" aria-label="Previous week">${icon("chevronLeft")}</a>
          <label class="sr-only" for="week-end">Week ending</label>
          <input class="date-input" id="week-end" type="date" value="${end}" data-action="jump">
          <a class="icon-btn" href="#/insights?end=${addDays(end, 7)}" aria-label="Next week">${icon("chevronRight")}</a>
          ${end !== today ? html`<a class="btn btn-ghost btn-sm" href="#/insights">This week</a>` : ""}
        </div>
      </div>
      <p class="lede">Seven days of ratings: how each day went, which dishes students loved, and which ones need work.</p>
    </div>
    <div data-slot="body"><div class="grid">
      ${["span-3", "span-3", "span-3", "span-3"].map((s) => html`<div class="bezel ${s}"><div class="core stack gap-2"><div class="skeleton sk-line"></div><div class="skeleton sk-title"></div></div></div>`)}
      <div class="bezel span-12"><div class="core"><div class="skeleton sk-block"></div></div></div>
    </div></div>
  </div></section>`);

  ctx.el.addEventListener("change", (e) => {
    if (e.target.matches("[data-action='jump']") && isISODate(e.target.value)) ctx.go(`#/insights?end=${e.target.value}`);
  });
  ctx.el.addEventListener("click", (e) => {
    if (e.target.closest("[data-action='retry']")) ctx.refresh();
    const toggle = e.target.closest("[data-action='toggle-table']");
    if (toggle) {
      const table = ctx.el.querySelector("[data-slot='table']");
      table.hidden = !table.hidden;
      toggle.setAttribute("aria-expanded", String(!table.hidden));
      toggle.querySelector("span").textContent = table.hidden ? "View as table" : "Hide table";
    }
  });

  const body = ctx.el.querySelector("[data-slot='body']");
  let weekly;
  try {
    weekly = await api(`/stats/weekly?end_date=${end}`);
  } catch (err) {
    if (!ctx.alive()) return;
    mount(body, html`<div class="bezel"><div class="core">${errorBlock(err)}</div></div>`);
    return;
  }
  if (!ctx.alive()) return;

  const days = weekly.days;
  const total = days.reduce((s, d) => s + d.rating_count, 0);
  const avg = weightedAverage(days, "avg_score", "rating_count");
  const busiest = days.reduce((a, d) => (d.rating_count > (a?.rating_count ?? 0) ? d : a), null);
  let selected = days.length - 1;
  for (let i = days.length - 1; i >= 0; i -= 1) {
    if (days[i].rating_count > 0) {
      selected = i;
      break;
    }
  }

  mount(body, html`
    <div class="grid">
      ${kpi("Ratings", html`<span class="big-num num">${fmtInt(total)}</span>`, busiest ? `Busiest: ${fmtDate(busiest.date)} (${fmtInt(busiest.rating_count)})` : "No ratings this week", "chart", 0)}
      ${kpi("Week average", html`<span class="big-num num">${fmt2(avg)}<small>/ 5</small></span>`, avg === null ? "Nothing rated yet" : "Weighted by ratings per day", "star", 1)}
      ${kpi("Best dish", html`<span class="stat-name">${weekly.best_dish?.name ?? "–"}</span>`, weekly.best_dish ? `${fmt2(weekly.best_dish.avg_score)} from ${plural(weekly.best_dish.rating_count, "rating")}` : "Needs ratings", "trendUp", 2, "good")}
      ${kpi("Needs work", html`<span class="stat-name">${weekly.worst_dish?.name ?? "–"}</span>`, weekly.worst_dish ? `${fmt2(weekly.worst_dish.avg_score)} from ${plural(weekly.worst_dish.rating_count, "rating")}` : "Needs ratings", "trendDown", 3, "critical")}

      <div class="bezel span-8 reveal"><div class="core">
        <div class="card-title">
          <div class="stack"><span class="card-label">Average score per day</span><span class="small muted">Scale 1 to 5. Click a day for its meals.</span></div>
          <button class="btn btn-ghost btn-xs" type="button" data-action="toggle-table" aria-expanded="false" aria-controls="week-table"><span>View as table</span></button>
        </div>
        <div data-slot="score-chart">${scoreChart(days, selected)}</div>
        <div id="week-table" data-slot="table" hidden>${weekTable(days)}</div>
      </div></div>
      <div class="bezel span-4 self-start reveal" data-i="1"><div class="core">
        <div class="card-title"><div class="stack"><span class="card-label">Ratings per day</span><span class="small muted">How many students rated</span></div></div>
        <div data-slot="count-chart">${countChart(days, selected)}</div>
      </div></div>

      ${rankList("Top meals", "The week's highest average scores", weekly.top_meals, false)}
      ${rankList("Bottom meals", "Where the kitchen should look first", weekly.bottom_meals, true)}

      <div class="bezel span-12 reveal"><div class="core" data-slot="day"></div></div>
    </div>`);

  const select = (i) => {
    selected = i;
    mount(ctx.el.querySelector("[data-slot='score-chart']"), scoreChart(days, selected));
    mount(ctx.el.querySelector("[data-slot='count-chart']"), countChart(days, selected));
    bindCharts(ctx.el, days, select);
    loadDay(ctx, days[i].date);
  };
  bindCharts(ctx.el, days, select);
  loadDay(ctx, days[selected].date);
}

function kpi(label, value, sub, ico, i, tone = "") {
  return html`<div class="bezel span-3 reveal" data-i="${i}"><div class="core stat">
    <div class="row between"><span class="card-label">${label}</span>${icon(ico, `ico ${tone}`)}</div>
    ${value}
    <span class="sub">${sub}</span>
  </div></div>`;
}

function rankList(label, sub, meals, bottom) {
  return html`<div class="bezel span-6 reveal" data-i="${bottom ? 1 : 0}"><div class="core">
    <div class="card-title"><div class="stack"><span class="card-label">${label}</span><span class="small muted">${sub}</span></div></div>
    ${meals.length
      ? html`<ol class="list">${meals.map((m, i) => html`<li class="list-item">
          <div class="row gap-2"><span class="rank">${i + 1}</span>
            <div class="list-main"><a class="list-title" href="#/meal/${m.meal_id}">${menuLine(m.menu_items)}</a>
              <span class="list-meta"><span>${cap(m.meal_type)} · ${fmtDate(m.date)}</span><span>${plural(m.rating_count, "rating")}</span>
              ${m.flagged ? html`<span class="badge critical">${icon("flag")}Flagged</span>` : ""}</span></div></div>
          <span class="score-pill ${m.flagged ? "critical" : ""}">${icon(m.flagged ? "flag" : "starFill")}${fmt2(m.avg_score)}</span>
        </li>`)}</ol>`
      : stateBlock({ ico: "chart", title: "Nothing to rank yet", text: "Meals appear here once they have ratings." })}
  </div></div>`;
}

async function loadDay(ctx, date) {
  const slot = ctx.el.querySelector("[data-slot='day']");
  if (!slot) return;
  const token = (slot.dataset.token = String(Number(slot.dataset.token || 0) + 1));
  mount(slot, html`<div class="card-title"><span class="card-label">${fmtDate(date, "long")}, meal by meal</span></div><div class="skeleton sk-block"></div>`);
  let daily;
  try {
    daily = await api(`/stats/daily?date=${date}`);
  } catch (err) {
    if (!ctx.alive() || slot.dataset.token !== token) return;
    mount(slot, errorBlock(err));
    return;
  }
  if (!ctx.alive() || slot.dataset.token !== token) return;
  const byType = Object.fromEntries(daily.meals.map((m) => [m.meal_type, m]));
  mount(slot, html`<div class="card-title">
      <span class="card-label">${fmtDate(date, "long")}, meal by meal</span>
      <a class="link small" href="#/menu?date=${date}">Open menu ${icon("arrowUpRight")}</a>
    </div>
    ${daily.meals.length
      ? html`<div class="grid keep-2">${MEAL_TYPES.filter((t) => byType[t]).map((t) => {
          const m = byType[t];
          return html`<div class="bezel sm span-3"><div class="core tight stack gap-2">
            <div class="row between"><span class="meal-type"><span class="ico-tile">${icon(MEAL_ICONS[t])}</span></span>
              ${m.flagged ? html`<span class="badge critical">${icon("flag")}Flagged</span>` : html`<span class="score-pill">${icon("starFill")}${fmt1(m.avg_score)}</span>`}</div>
            <div class="stack"><span class="card-label">${cap(t)}</span><a class="list-title" href="#/meal/${m.meal_id}">${menuLine(m.menu_items)}</a></div>
            ${m.rating_count ? meters(m, { compact: true }) : html`<span class="small muted">No ratings yet</span>`}
            <span class="small muted">${plural(m.rating_count, "rating")}</span>
          </div></div>`;
        })}</div>`
      : stateBlock({ ico: "utensils", title: "No meals on this day", text: "Pick another day on the chart." })}`);
}
