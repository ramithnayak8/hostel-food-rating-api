import { api, auth } from "../api.js";
import {
  MEAL_ICONS,
  MEAL_TYPES,
  addDays,
  button,
  cap,
  dishIndex,
  dishList,
  dom,
  dow,
  errorBlock,
  fmt1,
  fmt2,
  fmtDate,
  html,
  icon,
  isISODate,
  meters,
  mount,
  plural,
  relativeDay,
  skeletonCards,
  starsView,
  stateBlock,
  todayISO,
  weightedAverage,
} from "../lib.js";

export const title = "Menu";

// Bento rhythm: wide and narrow cards alternate row by row.
const SPANS = { breakfast: "span-5", lunch: "span-7", snacks: "span-7", dinner: "span-5" };

export async function render(ctx) {
  const requested = ctx.query.get("date");
  const date = isISODate(requested) ? requested : todayISO();

  mount(ctx.el, html`<section class="page"><div class="container">
    <div class="page-head">
      <span class="eyebrow"><span class="dot"></span>Menu${relativeDay(date) ? ` · ${relativeDay(date)}` : ""}</span>
      <div class="page-head-row">
        <h1 class="h1">${fmtDate(date, "long")}</h1>
        ${dateTools(date)}
      </div>
      <div class="day-summary" data-slot="summary"></div>
    </div>
    <div class="grid" data-slot="meals">${skeletonCards(4, ["span-5", "span-7", "span-7", "span-5"])}</div>
  </div></section>`);

  ctx.el.addEventListener("change", (e) => {
    if (e.target.matches("[data-action='jump']") && isISODate(e.target.value)) ctx.go(`#/menu?date=${e.target.value}`);
  });
  ctx.el.addEventListener("click", (e) => {
    if (e.target.closest("[data-action='retry']")) ctx.refresh();
  });

  let daily;
  let mine = new Map();
  let dishes = new Map();
  try {
    const [stats, my, dishStats] = await Promise.all([
      api(`/stats/daily?date=${date}`),
      auth.loggedIn ? api(`/auth/me/ratings?date=${date}&limit=10`).catch(() => null) : null,
      api("/stats/dishes").catch(() => null),
    ]);
    daily = stats;
    dishes = dishIndex(dishStats);
    if (my) mine = new Map(my.items.map((r) => [r.meal_id, r]));
  } catch (err) {
    if (!ctx.alive()) return;
    mount(ctx.el.querySelector("[data-slot='meals']"), html`<div class="bezel span-12"><div class="core">${errorBlock(err)}</div></div>`);
    return;
  }
  if (!ctx.alive()) return;

  const meals = daily.meals;
  const summary = ctx.el.querySelector("[data-slot='summary']");
  if (meals.length) {
    const ratings = meals.reduce((s, m) => s + m.rating_count, 0);
    const avg = weightedAverage(meals, "avg_score", "rating_count");
    const flagged = meals.filter((m) => m.flagged).length;
    mount(summary, html`<span><strong>${meals.length}</strong> ${meals.length === 1 ? "meal" : "meals"} published</span>
      <span><strong>${plural(ratings, "rating")}</strong></span>
      <span>Day average <strong>${fmt2(avg)}</strong></span>
      ${flagged ? html`<span class="badge critical">${icon("flag")}${plural(flagged, "meal")} flagged</span>` : ""}
      ${auth.loggedIn ? html`<span>You rated <strong>${mine.size}</strong> of ${meals.length}</span>` : ""}`);
  } else summary.replaceChildren();

  const grid = ctx.el.querySelector("[data-slot='meals']");
  if (!meals.length) {
    mount(grid, html`<div class="bezel span-12 reveal"><div class="core">${stateBlock({
      ico: "utensils",
      title: "No menu published for this day",
      text: date > todayISO() ? "The warden hasn't posted this day's menu yet. Check back closer to the date." : "Nothing was served or recorded on this day.",
      actions: html`${date !== todayISO() ? button({ label: "Go to today", href: "#/menu", kind: "ghost", size: "sm", ico: "calendar" }) : ""}
        ${auth.isAdmin ? button({ label: "Publish a menu", href: `#/warden?tab=publish&date=${date}`, size: "sm", ico: "plus" }) : ""}`,
    })}</div></div>`);
    return;
  }

  const byType = Object.fromEntries(meals.map((m) => [m.meal_type, m]));
  mount(grid, html`${MEAL_TYPES.map((type, i) =>
    byType[type] ? mealCard(byType[type], mine.get(byType[type].meal_id), i, dishes) : ghostCard(type, date, i),
  )}`);
}

function dateTools(date) {
  const today = todayISO();
  const days = Array.from({ length: 7 }, (_, i) => addDays(date, i - 3));
  return html`<div class="toolbar">
    <a class="icon-btn" href="#/menu?date=${addDays(date, -1)}" aria-label="Previous day">${icon("chevronLeft")}</a>
    <nav class="date-strip" aria-label="Pick a day">
      ${days.map((d) => html`<a class="day-pill ${d === today ? "is-today" : ""}" href="#/menu?date=${d}" ${d === date ? html`aria-current="date"` : ""} aria-label="${fmtDate(d, "long")}">
        <span class="dow">${dow(d)}</span><span class="dom">${dom(d)}</span></a>`)}
    </nav>
    <a class="icon-btn" href="#/menu?date=${addDays(date, 1)}" aria-label="Next day">${icon("chevronRight")}</a>
    <label class="sr-only" for="menu-jump">Jump to date</label>
    <input class="date-input" id="menu-jump" type="date" value="${date}" data-action="jump">
    ${date !== today ? html`<a class="btn btn-ghost btn-sm" href="#/menu">Today</a>` : ""}
  </div>`;
}

function mealCard(m, myRating, i, dishes) {
  const future = m.date > todayISO();
  let foot;
  if (myRating) {
    foot = html`<span class="your-rating">${icon("checkCircle")}You rated ${myRating.score}/5</span>
      <a class="link small" href="#/meal/${m.meal_id}">Details ${icon("arrowUpRight")}</a>`;
  } else if (future) {
    foot = html`<span class="small muted">Rating opens on ${fmtDate(m.date)}</span>
      <a class="link small" href="#/meal/${m.meal_id}">Details ${icon("arrowUpRight")}</a>`;
  } else if (!auth.loggedIn) {
    foot = html`<span class="small muted">Log in to rate and read reviews</span>
      ${button({ label: "Rate", href: `#/login?next=${encodeURIComponent(`#/meal/${m.meal_id}`)}`, size: "sm" })}`;
  } else {
    foot = html`<span class="small muted">${m.rating_count ? "How was it for you?" : "Be the first to rate"}</span>
      ${button({ label: "Rate this meal", href: `#/meal/${m.meal_id}`, size: "sm" })}`;
  }

  return html`<article class="bezel ${SPANS[m.meal_type]} lift reveal" data-i="${i}"><div class="core meal-card">
    <div class="meal-head">
      <a class="meal-type" href="#/meal/${m.meal_id}"><span class="ico-tile">${icon(MEAL_ICONS[m.meal_type])}</span><h2>${cap(m.meal_type)}</h2></a>
      ${m.flagged ? html`<span class="badge critical">${icon("flag")}Flagged</span>` : ""}
    </div>
    ${dishList(m.menu_items, dishes)}
    <div class="meal-score">
      <div class="stack gap-1">
        <span class="big-num num">${fmt1(m.avg_score)}<small>/ 5</small></span>
        <span class="row gap-1">${starsView(m.avg_score)}<span class="small muted">${plural(m.rating_count, "rating")}</span></span>
      </div>
    </div>
    ${m.rating_count ? meters({ avg_score: m.avg_score, avg_taste: m.avg_taste, avg_hygiene: m.avg_hygiene, avg_quantity: m.avg_quantity }, { compact: true }) : ""}
    <div class="meal-foot">${foot}</div>
  </div></article>`;
}

function ghostCard(type, date, i) {
  return html`<div class="bezel ${SPANS[type]} reveal" data-i="${i}"><div class="core meal-card ghost">
    <div class="meal-type"><span class="ico-tile">${icon(MEAL_ICONS[type])}</span><h2>${cap(type)}</h2></div>
    <p>Not on the menu for this day.</p>
    ${auth.isAdmin ? button({ label: `Publish ${type}`, href: `#/warden?tab=publish&date=${date}&type=${type}`, kind: "ghost", size: "sm", ico: "plus" }) : ""}
  </div></div>`;
}
