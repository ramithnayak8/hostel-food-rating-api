import { api, auth } from "../api.js";
import { bindMealForm, mealForm } from "../meal-form.js";
import {
  DIMENSIONS,
  SCORE_WORDS,
  button,
  cap,
  confirmDialog,
  errorBlock,
  fmt1,
  fmtDate,
  html,
  icon,
  initials,
  dishIndex,
  dishList,
  menuLine,
  meters,
  mount,
  openDialog,
  plural,
  relativeDay,
  setBusy,
  showFormError,
  clearErrors,
  starsView,
  stateBlock,
  timeAgo,
  toast,
  todayISO,
} from "../lib.js";

export const title = "Meal";
const PAGE = 10;
const MAX_COMMENT = 500;

export async function render(ctx) {
  const id = Number(ctx.params.id);
  mount(ctx.el, html`<section class="page"><div class="container" data-slot="page">
    <div class="page-head"><div class="skeleton sk-line" ></div><div class="skeleton sk-title"></div></div>
    <div class="grid">${["span-7", "span-5"].map((s) => html`<div class="bezel ${s}"><div class="core stack gap-2"><div class="skeleton sk-title"></div><div class="skeleton sk-block"></div></div></div>`)}</div>
  </div></section>`);
  ctx.el.addEventListener("click", (e) => {
    if (e.target.closest("[data-action='retry']")) ctx.refresh();
  });
  const slot = ctx.el.querySelector("[data-slot='page']");

  if (!Number.isInteger(id) || id < 1) {
    mount(slot, notFound());
    return;
  }

  let meal;
  let stats;
  let mine = null;
  let dishes = new Map();
  try {
    meal = await api(`/meals/${id}`);
    const [daily, my, dishStats] = await Promise.all([
      api(`/stats/daily?date=${meal.date}`),
      auth.loggedIn ? api(`/auth/me/ratings?date=${meal.date}&limit=10`).catch(() => null) : null,
      api("/stats/dishes").catch(() => null),
    ]);
    dishes = dishIndex(dishStats);
    stats = daily.meals.find((m) => m.meal_id === id) ?? null;
    mine = my?.items.find((r) => r.meal_id === id) ?? null;
  } catch (err) {
    if (!ctx.alive()) return;
    mount(slot, err.status === 404 ? notFound() : html`<div class="bezel"><div class="core">${errorBlock(err)}</div></div>`);
    return;
  }
  if (!ctx.alive()) return;
  ctx.setTitle(`${cap(meal.meal_type)} · ${fmtDate(meal.date, "short")}`);

  const flagged = stats?.flagged ?? meal.flagged;
  mount(slot, html`
    <div class="page-head">
      <a class="link back small reveal" href="#/menu?date=${meal.date}">${icon("arrowLeft")}Menu for ${relativeDay(meal.date) ?? fmtDate(meal.date)}</a>
      <div class="row gap-1 wrap reveal" data-i="1">
        <span class="eyebrow"><span class="dot"></span>${cap(meal.meal_type)} · ${fmtDate(meal.date, "long")}</span>
        ${flagged ? html`<span class="badge critical">${icon("flag")}Flagged: average below 2.0</span>` : ""}
      </div>
      <div class="page-head-row">
        <h1 class="h1 reveal" data-i="2">${menuLine(meal.menu_items)}</h1>
        ${auth.isAdmin ? html`<div class="row gap-1 reveal" data-i="3">
          ${button({ label: "Edit", kind: "ghost", size: "sm", ico: "edit", action: "edit" })}
          ${button({ label: "Delete", kind: "ghost", size: "sm", ico: "trash", action: "delete" })}
        </div>` : ""}
      </div>
      <div class="meal-dishes reveal" data-i="3"><span class="card-label">Dish ratings · every serving so far</span>${dishList(meal.menu_items, dishes, { compact: true })}</div>
    </div>
    <div class="grid">
      <div class="bezel span-7 reveal"><div class="core">${scorePanel(stats)}</div></div>
      <div class="bezel span-5 reveal" data-i="1"><div class="core" data-slot="rate">${ratePanel(meal, mine)}</div></div>
      <div class="bezel span-12 reveal"><div class="core" data-slot="reviews">${reviewsShell(stats)}</div></div>
    </div>`);

  bindRateForm(ctx, meal);
  bindAdmin(ctx, meal, stats);
  if (auth.loggedIn) loadReviews(ctx, meal.id, 0);
}

function notFound() {
  return html`<div class="bezel"><div class="core">${stateBlock({
    ico: "utensils",
    title: "We couldn't find that meal",
    text: "It may have been removed by the warden, or the link is wrong.",
    actions: button({ label: "Back to the menu", href: "#/menu", kind: "ghost", size: "sm", ico: "arrowLeft" }),
  })}</div></div>`;
}

function scorePanel(stats) {
  if (!stats || !stats.rating_count) {
    return html`<div class="card-title"><span class="card-label">Scores</span></div>
      ${stateBlock({ ico: "star", title: "No ratings yet", text: "Once students rate this meal, the averages show up here." })}`;
  }
  return html`<div class="card-title"><span class="card-label">Scores</span><span class="small muted">${plural(stats.rating_count, "rating")}</span></div>
    <div class="row gap-3 wrap" >
      <span class="big-num num">${fmt1(stats.avg_score)}<small>/ 5 overall</small></span>
      ${starsView(stats.avg_score, "lg")}
    </div>
    <div class="divider"></div>
    ${meters(stats)}`;
}

function ratePanel(meal, mine) {
  if (mine) {
    return html`<div class="card-title"><span class="card-label">Your rating</span><span class="small muted">${timeAgo(mine.created_at)}</span></div>
      <div class="stack gap-3">
        <div class="callout good">${icon("checkCircle")}<span><strong>Thanks for rating.</strong> Each student can rate a meal once, so this is final.</span></div>
        <div class="meters">${DIMENSIONS.map((d) => html`<div class="meter-row"><span class="label">${d.label}</span>${starsView(mine[d.key])}<span class="val">${mine[d.key]}/5</span></div>`)}</div>
        ${mine.comment ? html`<p class="review-text">“${mine.comment}”</p>` : ""}
      </div>`;
  }
  if (!auth.loggedIn) {
    const next = encodeURIComponent(`#/meal/${meal.id}`);
    return html`<div class="card-title"><span class="card-label">Rate this meal</span></div>
      ${stateBlock({
        ico: "lock",
        title: "Log in to rate",
        text: "Ratings are tied to your student account, so each person rates each meal once.",
        actions: html`${button({ label: "Log in", href: `#/login?next=${next}`, size: "sm" })}${button({ label: "Create account", href: `#/register?next=${next}`, kind: "ghost", size: "sm", ico: "" })}`,
      })}`;
  }
  if (meal.date > todayISO()) {
    return html`<div class="card-title"><span class="card-label">Rate this meal</span></div>
      ${stateBlock({ ico: "calendar", title: "Not served yet", text: `Rating opens on ${fmtDate(meal.date, "long")}, once the meal has been served.` })}`;
  }
  return html`<form class="form" novalidate data-rate-form>
    <div class="card-title"><span class="card-label">Rate this meal</span><span class="small muted">1 = poor · 5 = excellent</span></div>
    <div class="form-error" role="alert" hidden>${icon("alert")}<span></span></div>
    <div>${DIMENSIONS.map((d) => starInput(d))}</div>
    <div class="field" data-field="comment">
      <label for="rate-comment">Comment <span class="muted">(optional)</span></label>
      <textarea class="input" id="rate-comment" name="comment" maxlength="${MAX_COMMENT}" placeholder="What stood out? Too salty, cold, great portion…"></textarea>
      <span class="counter" data-counter>0 / ${MAX_COMMENT}</span>
      <span class="field-error"></span>
    </div>
    <div class="form-actions">${button({ label: "Submit rating", type: "submit", ico: "check" })}</div>
  </form>`;
}

function starInput(d) {
  const stars = [5, 4, 3, 2, 1].map(
    (v) => html`<input type="radio" id="r-${d.key}-${v}" name="${d.key}" value="${v}">
      <label for="r-${d.key}-${v}" title="${SCORE_WORDS[v]}"><span class="sr-only">${v} out of 5, ${SCORE_WORDS[v]}</span>${icon("starFill")}</label>`,
  );
  return html`<fieldset class="rate-row" data-field="${d.key}">
    <legend>${d.label}<span class="rate-help">${d.help}</span></legend>
    <div class="rate-right"><span class="rate-word" data-word>Not rated</span><div class="star-input">${stars}</div></div>
  </fieldset>`;
}

function bindRateForm(ctx, meal) {
  const form = ctx.el.querySelector("[data-rate-form]");
  if (!form) return;
  const counter = form.querySelector("[data-counter]");
  const textarea = form.elements.namedItem("comment");

  form.addEventListener("change", (e) => {
    if (e.target.type !== "radio") return;
    const row = e.target.closest(".rate-row");
    row.classList.remove("has-error");
    row.querySelector("[data-word]").textContent = SCORE_WORDS[Number(e.target.value)];
  });
  textarea.addEventListener("input", () => {
    const n = textarea.value.length;
    counter.textContent = `${n} / ${MAX_COMMENT}`;
    counter.classList.toggle("over", n > MAX_COMMENT);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submit = form.querySelector("button[type='submit']");
    if (submit.disabled) return;
    clearErrors(form);
    const data = new FormData(form);
    const body = {};
    const missing = [];
    for (const d of DIMENSIONS) {
      const v = Number(data.get(d.key));
      if (v >= 1 && v <= 5) body[d.key] = v;
      else missing.push(d);
    }
    if (missing.length) {
      for (const d of missing) {
        const row = form.querySelector(`[data-field="${d.key}"]`);
        row.classList.add("has-error");
        row.querySelector("[data-word]").textContent = "Required";
      }
      showFormError(form, `Please give a score for ${missing.map((d) => d.label.toLowerCase()).join(", ")}.`);
      return;
    }
    const comment = String(data.get("comment") || "").trim();
    if (comment.length > MAX_COMMENT) {
      showFormError(form, `Comments can be at most ${MAX_COMMENT} characters.`);
      return;
    }
    if (comment) body.comment = comment;

    setBusy(submit, true, "Submitting…");
    try {
      await api(`/meals/${meal.id}/ratings`, { method: "POST", body });
      toast("Thanks! Your rating is in.", "good");
      ctx.refresh();
    } catch (err) {
      if (!form.isConnected) return;
      setBusy(submit, false);
      if (err.status === 409) {
        toast("You've already rated this meal.", "info");
        ctx.refresh();
      } else if (err.status === 404) {
        toast("This meal was just removed.", "error");
        ctx.go(`#/menu?date=${meal.date}`);
      } else if (err.status === 401) {
        ctx.go(`#/login?next=${encodeURIComponent(`#/meal/${meal.id}`)}`);
      } else {
        showFormError(form, err.message);
      }
    }
  });
}

function reviewsShell(stats) {
  const count = stats?.rating_count ?? 0;
  if (!auth.loggedIn) {
    return html`<div class="card-title"><span class="card-label">Reviews</span><span class="small muted">${plural(count, "rating")}</span></div>
      <div class="callout">${icon("lock")}<span><a class="link" href="#/login?next=${encodeURIComponent(location.hash)}">Log in</a> to read what other students wrote. Reviews are anonymous.</span></div>`;
  }
  return html`<div class="card-title"><span class="card-label">Reviews</span>
      <span class="small muted">${auth.isAdmin ? "Rater names are visible to wardens only" : "Anonymous: names are never shown"}</span></div>
    <div class="list" data-slot="review-list"><div class="skeleton sk-block"></div></div>
    <div class="row" data-slot="more"></div>`;
}

async function loadReviews(ctx, mealId, offset) {
  const list = ctx.el.querySelector("[data-slot='review-list']");
  const more = ctx.el.querySelector("[data-slot='more']");
  if (!list) return;
  let page;
  try {
    page = await api(`/meals/${mealId}/ratings?limit=${PAGE}&offset=${offset}`);
  } catch (err) {
    if (!ctx.alive()) return;
    if (offset === 0) mount(list, errorBlock(err));
    else toast(err.message, "error");
    if (more) mount(more, button({ label: "Try again", kind: "ghost", size: "sm", ico: "refresh", attrs: `data-more="${offset}"` }));
    bindMore(ctx, mealId, more);
    return;
  }
  if (!ctx.alive()) return;
  const items = page.items.map(review);
  if (offset === 0) {
    mount(list, page.items.length ? html`${items}` : stateBlock({ ico: "message", title: "No reviews yet", text: "Be the first to tell the kitchen how it went." }));
  } else {
    list.insertAdjacentHTML("beforeend", String(html`${items}`));
  }
  const next = offset + page.items.length;
  mount(more, next < page.total ? button({ label: `Show more (${page.total - next} left)`, kind: "ghost", size: "sm", ico: "chevronRight", attrs: `data-more="${next}"` }) : "");
  bindMore(ctx, mealId, more);
}

function bindMore(ctx, mealId, more) {
  const btn = more?.querySelector("[data-more]");
  if (!btn) return;
  btn.addEventListener("click", () => {
    setBusy(btn, true, "Loading…");
    loadReviews(ctx, mealId, Number(btn.dataset.more));
  }, { once: true });
}

function review(r) {
  const who = r.rated_by
    ? html`<span class="review-who"><span class="avatar">${initials(r.rated_by.name)}</span>${r.rated_by.name} <span class="muted">· Room ${r.rated_by.room_no}</span></span>`
    : html`<span class="review-who"><span class="avatar">${icon("user")}</span>Student</span>`;
  return html`<article class="review">
    <div class="review-head">${who}<span class="row gap-1">${starsView(r.score)}<span class="small muted">${timeAgo(r.created_at)}</span></span></div>
    <div class="review-dims"><span>Taste <b>${r.taste}</b></span><span>Hygiene <b>${r.hygiene}</b></span><span>Quantity <b>${r.quantity}</b></span><span>Overall <b>${r.score}</b></span></div>
    ${r.comment ? html`<p class="review-text">${r.comment}</p>` : html`<p class="review-text none">No comment</p>`}
  </article>`;
}

function bindAdmin(ctx, meal, stats) {
  if (!auth.isAdmin) return;
  ctx.el.querySelector("[data-action='edit']")?.addEventListener("click", () => {
    const { dialog, close } = openDialog(html`<div class="dialog-head"><h2 class="h3">Edit ${meal.meal_type}</h2>
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
  });
  ctx.el.querySelector("[data-action='delete']")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const n = stats?.rating_count ?? 0;
    const ok = await confirmDialog({
      title: `Delete this ${meal.meal_type}?`,
      text: `The ${fmtDate(meal.date, "long")} ${meal.meal_type} and ${n ? `all ${plural(n, "rating")}` : "its ratings"} will be removed for good.`,
      confirmLabel: "Delete meal",
      danger: true,
    });
    if (!ok || !ctx.alive()) return;
    setBusy(btn, true, "Deleting…");
    try {
      await api(`/meals/${meal.id}`, { method: "DELETE" });
      toast("Meal deleted.", "good");
      ctx.go(`#/menu?date=${meal.date}`);
    } catch (err) {
      setBusy(btn, false);
      toast(err.status === 404 ? "That meal was already deleted." : err.message, "error");
      if (err.status === 404) ctx.go(`#/menu?date=${meal.date}`);
    }
  });
}
