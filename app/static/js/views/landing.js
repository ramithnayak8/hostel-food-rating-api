import { api, auth } from "../api.js";
import {
  DIMENSIONS,
  MEAL_TYPES,
  button,
  cap,
  dishIndex,
  dishList,
  fmt1,
  fmt2,
  fmtDate,
  fmtInt,
  html,
  icon,
  mount,
  plural,
  relativeDay,
  starsView,
  todayISO,
  weightedAverage,
} from "../lib.js";

export const title = "Hostel food, rated honestly";

const REPO_URL = "https://github.com/ramithnayak8/hostel-food-rating-api";

export async function render(ctx) {
  mount(ctx.el, page());
  const slot = ctx.el.querySelector("[data-slot='live']");
  try {
    const [weekly, dishStats] = await Promise.all([
      api(`/stats/weekly?end_date=${todayISO()}`),
      api("/stats/dishes").catch(() => null),
    ]);
    const lastDay = [...weekly.days].reverse().find((d) => d.rating_count > 0);
    const daily = lastDay ? await api(`/stats/daily?date=${lastDay.date}`) : null;
    if (!ctx.alive()) return;
    mount(slot, liveCards(weekly, daily, dishIndex(dishStats)));
  } catch {
    if (!ctx.alive()) return;
    mount(slot, liveCards(null, null));
  }
}

function page() {
  const primary = auth.isAdmin
    ? button({ label: "Open the warden's desk", href: "#/warden" })
    : button({ label: "Rate today's meals", href: "#/menu" });
  return html`
  <section class="hero">
    <div class="container hero-grid">
      <div class="hero-copy">
        <span class="eyebrow reveal"><span class="dot live"></span>Hostel food ratings · live</span>
        <h1 class="display reveal" data-i="1">Every meal,<br><em>rated honestly.</em></h1>
        <p class="lede reveal" data-i="2">Students score each breakfast, lunch, snack and dinner for taste, hygiene and quantity. Wardens see the trends, and any meal averaging below 2.0 is flagged for them automatically.</p>
        <div class="hero-ctas reveal" data-i="3">
          ${primary}
          ${button({ label: "This week's insights", href: "#/insights", kind: "ghost", ico: "chart" })}
        </div>
        <div class="hero-facts reveal" data-i="4">
          <span>${icon("star")}4 things rated per meal</span>
          <span>${icon("lock")}Anonymous to other students</span>
          <span>${icon("flag")}Auto-flags bad meals</span>
        </div>
      </div>
      <div class="cascade" data-slot="live" aria-live="polite">${liveSkeleton()}</div>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="page-head">
        <span class="eyebrow reveal"><span class="dot"></span>How it works</span>
        <h2 class="h2 reveal" data-i="1">Feedback the kitchen can <em>act on.</em></h2>
      </div>
      <div class="grid">
        <div class="bezel span-7 reveal"><div class="core feature">
          <div class="ico-tile">${icon("star")}</div>
          <h3 class="h3">Rate in ten seconds</h3>
          <p>Tap a score for overall, taste, hygiene and quantity, and add a comment if you want. One rating per meal per student keeps the numbers fair.</p>
          <div class="demo-stars" aria-hidden="true">
            ${DIMENSIONS.map((d, i) => html`<div class="row"><span>${d.label}</span>${starsView([4, 5, 4, 3][i])}</div>`)}
          </div>
        </div></div>
        <div class="bezel span-5 reveal" data-i="1"><div class="core feature">
          <div class="ico-tile">${icon("lock")}</div>
          <h3 class="h3">Anonymous by design</h3>
          <p>Other students see the scores and comments, but never who wrote them. Only the warden can see a rater's name and room, and nobody sees email addresses.</p>
        </div></div>
        <div class="bezel span-5 reveal"><div class="core feature">
          <div class="ico-tile">${icon("flag")}</div>
          <h3 class="h3">Complaints raise themselves</h3>
          <p>When a meal averages below 2.0 across three or more ratings, it lands on the warden's complaint list right away. Nobody has to file anything.</p>
        </div></div>
        <div class="bezel span-7 reveal" data-i="1"><div class="core feature">
          <div class="ico-tile">${icon("trendUp")}</div>
          <h3 class="h3">Trends, not anecdotes</h3>
          <p>Daily averages for every meal, a seven-day trend, and the best and worst dishes of the week, worked out from every rating each dish received.</p>
          <div class="row gap-2 wrap">${button({ label: "Explore insights", href: "#/insights", kind: "ghost", size: "sm" })}</div>
        </div></div>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="page-head">
        <span class="eyebrow reveal"><span class="dot"></span>Engineering</span>
        <div class="page-head-row">
          <h2 class="h2 reveal" data-i="1">Built like a <em>production service.</em></h2>
          <div class="row gap-1 wrap reveal" data-i="2">
            ${button({ label: "API docs", href: "/docs", kind: "ghost", size: "sm", ico: "book" })}
            ${button({ label: "Source code", href: REPO_URL, kind: "ghost", size: "sm", ico: "code", attrs: 'target="_blank" rel="noopener noreferrer"' })}
          </div>
        </div>
      </div>
      <div class="bezel reveal"><div class="core flush">
        <div class="tech-list">
          <div>${icon("server")}<h3>FastAPI and PostgreSQL 16</h3><p>Typed request validation, SQLAlchemy 2.0 models and Alembic migrations, with constraints enforced in the database too.</p></div>
          <div>${icon("shield")}<h3>Secure by default</h3><p>JWT sessions, argon2id password hashing, rate-limited logins, a strict Content-Security-Policy and request IDs on every response.</p></div>
          <div>${icon("layers")}<h3>Kubernetes, autoscaled</h3><p>Runs on kind with an ingress, a Postgres StatefulSet and an HPA that scales the API from 2 to 6 pods under load.</p></div>
          <div>${icon("pulse")}<h3>Observable</h3><p>Prometheus metrics for requests, latency, ratings and flagged meals, plus a ready-made Grafana dashboard and alert rules.</p></div>
          <div>${icon("checkCircle")}<h3>Tested on every push</h3><p>GitHub Actions runs lint, tests against real Postgres, dependency and image scans, then publishes the image to GHCR.</p></div>
          <div>${icon("utensils")}<h3>One small image</h3><p>A multi-stage, non-root Docker image of about 134 MB that serves this website and the JSON API from the same origin.</p></div>
        </div>
      </div></div>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="bezel reveal"><div class="core cta-band">
        <span class="eyebrow"><span class="dot"></span>${auth.loggedIn ? "Welcome back" : "Join your hostel"}</span>
        <h2 class="h2">${auth.loggedIn ? html`What did you think of <em>today's food?</em>` : html`Your feedback, <em>on every plate.</em>`}</h2>
        <p class="lede">${auth.loggedIn ? "Rating a meal takes about ten seconds." : "Create a student account with your room number. It takes less than a minute."}</p>
        ${auth.loggedIn ? button({ label: "Go to the menu", href: "#/menu" }) : button({ label: "Create a student account", href: "#/register" })}
      </div></div>
    </div>
  </section>`;
}

function liveSkeleton() {
  const card = (extra) => html`<div class="bezel"><div class="core stack gap-2"><div class="skeleton sk-line"></div><div class="skeleton sk-title"></div>${extra}</div></div>`;
  return html`
    <div class="tilt t1">${card(html`<div class="skeleton sk-block"></div>`)}</div>
    <div class="cascade-row"><div class="tilt t2">${card("")}</div><div class="tilt t3">${card("")}</div></div>`;
}

function liveCards(weekly, daily, dishes) {
  const meals = daily?.meals ?? [];
  const byType = Object.fromEntries(meals.map((m) => [m.meal_type, m]));
  const day = daily?.date;
  const when = day ? (relativeDay(day) ?? fmtDate(day)) : null;
  const total = weekly ? weekly.days.reduce((s, d) => s + d.rating_count, 0) : null;
  const weekAvg = weekly ? weightedAverage(weekly.days, "avg_score", "rating_count") : null;
  const best = weekly?.best_dish;

  const menuCard = html`<div class="tilt t1"><div class="bezel reveal"><div class="core">
    <div class="card-title"><span class="card-label">${when ? `Menu · ${when}` : "Latest menu"}</span>
      ${day ? html`<a class="link small" href="#/menu?date=${day}">Open ${icon("arrowUpRight")}</a>` : ""}</div>
    ${meals.length
      ? MEAL_TYPES.filter((t) => byType[t]).map((t) => {
          const m = byType[t];
          return html`<div class="live-meal">
            <div class="stack"><span class="type">${cap(t)}</span><span class="items">${dishList(m.menu_items, dishes, { compact: true })}</span></div>
            <div class="stack num" ><span class="score-pill ${m.flagged ? "critical" : ""}">${icon(m.flagged ? "flag" : "starFill")}${fmt1(m.avg_score)}</span></div>
          </div>`;
        })
      : html`<p class="muted">${weekly ? "No meals have been rated in the last seven days yet." : "Live numbers are unavailable right now."}</p>`}
  </div></div></div>`;

  const bestCard = html`<div class="tilt t2"><div class="bezel reveal" data-i="1"><div class="core stack gap-1">
    <span class="card-label">Best dish this week</span>
    <span class="stat-name">${best ? best.name : "–"}</span>
    <span class="small muted">${best ? `${fmt2(best.avg_score)} average from ${plural(best.rating_count, "rating")}` : "Waiting for ratings"}</span>
  </div></div></div>`;

  const countCard = html`<div class="tilt t3"><div class="bezel reveal" data-i="2"><div class="core stack gap-1">
    <span class="card-label">Ratings · 7 days</span>
    <span class="big-num num">${total === null ? "–" : fmtInt(total)}</span>
    <span class="small muted">${weekAvg === null ? "No average yet" : `Average score ${fmt2(weekAvg)}`}</span>
  </div></div></div>`;

  return html`${menuCard}<div class="cascade-row">${bestCard}${countCard}</div>`;
}
