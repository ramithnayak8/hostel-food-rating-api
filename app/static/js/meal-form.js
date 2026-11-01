// The warden's menu form (publish and edit): date, meal type and a chip input for dishes.

import {
  MEAL_ICONS,
  MEAL_TYPES,
  applyFieldErrors,
  cap,
  clearErrors,
  html,
  icon,
  isISODate,
  raw,
  setBusy,
  setFieldError,
  showFormError,
  button,
} from "./lib.js";

const MAX_ITEMS = 30;
const MAX_ITEM_LENGTH = 100;
let formCounter = 0;

export function mealForm({ initial = {}, submitLabel = "Publish menu", cancel = false } = {}) {
  const id = `mf${(formCounter += 1)}`;
  return html`<form class="form" novalidate data-meal-form>
    <div class="form-error" role="alert" hidden>${icon("alert")}<span></span></div>
    <div class="field" data-field="date">
      <label for="${id}-date">Date</label>
      <input class="input" id="${id}-date" name="date" type="date" required value="${initial.date || ""}">
      <span class="field-error"></span>
    </div>
    <fieldset class="field" data-field="meal_type">
      <legend>Meal</legend>
      <div class="segmented">
        ${MEAL_TYPES.map(
          (t) => html`<input class="sr-only" type="radio" id="${id}-${t}" name="meal_type" value="${t}" ${raw(initial.meal_type === t ? "checked" : "")}>
            <label for="${id}-${t}">${icon(MEAL_ICONS[t])}${cap(t)}</label>`,
        )}
      </div>
      <span class="field-error"></span>
    </fieldset>
    <div class="field" data-field="menu_items">
      <label for="${id}-items">Dishes</label>
      <div class="chip-input" data-chip-input>
        <span class="chips" data-chips></span>
        <input id="${id}-items" type="text" maxlength="${MAX_ITEM_LENGTH}" autocomplete="off" placeholder="Type a dish, press Enter">
      </div>
      <span class="field-hint">Press Enter or comma after each dish. Up to ${MAX_ITEMS}.</span>
      <span class="field-error"></span>
    </div>
    <div class="form-actions">
      ${button({ label: submitLabel, type: "submit", ico: "check" })}
      ${cancel ? html`<button class="btn btn-ghost" type="button" data-action="dismiss">Cancel</button>` : ""}
    </div>
  </form>`;
}

/**
 * Wire a rendered mealForm. `onSubmit(payload)` must return a promise; errors it throws
 * (ApiError) are shown on the form. Returns `{ reset }`.
 */
export function bindMealForm(form, { initial = {}, onSubmit }) {
  let items = Array.isArray(initial.menu_items) ? [...initial.menu_items] : [];
  const chipsEl = form.querySelector("[data-chips]");
  const box = form.querySelector("[data-chip-input]");
  const input = box.querySelector("input");
  const submit = form.querySelector("button[type='submit']");

  const renderChips = () => {
    chipsEl.innerHTML = String(
      html`${items.map(
        (item, i) => html`<span class="chip">${item}<button type="button" data-remove="${i}" aria-label="Remove ${item}">${icon("x")}</button></span>`,
      )}`,
    );
  };

  const add = (text) => {
    let added = false;
    for (const part of String(text).split(/[,\n]/)) {
      const value = part.trim().replace(/\s+/g, " ");
      if (!value) continue;
      if (value.length > MAX_ITEM_LENGTH) {
        setFieldError(form, "menu_items", `Each dish can be at most ${MAX_ITEM_LENGTH} characters.`);
        continue;
      }
      if (items.length >= MAX_ITEMS) {
        setFieldError(form, "menu_items", `A menu can have at most ${MAX_ITEMS} dishes.`);
        break;
      }
      if (!items.some((existing) => existing.toLowerCase() === value.toLowerCase())) {
        items.push(value);
        added = true;
      }
    }
    if (added) {
      setFieldError(form, "menu_items", "");
      renderChips();
    }
  };

  box.addEventListener("click", (e) => {
    const remove = e.target.closest("[data-remove]");
    if (remove) {
      items.splice(Number(remove.dataset.remove), 1);
      renderChips();
      input.focus();
      return;
    }
    if (e.target === box || e.target === chipsEl) input.focus();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(input.value);
      input.value = "";
    } else if (e.key === "Backspace" && !input.value && items.length) {
      items.pop();
      renderChips();
    }
  });
  input.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text") ?? "";
    if (/[,\n]/.test(text)) {
      e.preventDefault();
      add(text);
    }
  });
  input.addEventListener("blur", () => {
    if (input.value.trim()) {
      add(input.value);
      input.value = "";
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    clearErrors(form);
    if (input.value.trim()) {
      add(input.value);
      input.value = "";
    }
    const data = new FormData(form);
    const payload = { date: String(data.get("date") || ""), meal_type: String(data.get("meal_type") || ""), menu_items: [...items] };
    const problems = {};
    if (!isISODate(payload.date)) problems.date = "Pick a date.";
    if (!MEAL_TYPES.includes(payload.meal_type)) problems.meal_type = "Choose breakfast, lunch, snacks or dinner.";
    if (!payload.menu_items.length) problems.menu_items = "Add at least one dish.";
    for (const [name, message] of Object.entries(problems)) setFieldError(form, name, message);
    if (Object.keys(problems).length) return;

    setBusy(submit, true, "Saving…");
    try {
      await onSubmit(payload);
    } catch (err) {
      if (err?.status === 409) {
        setFieldError(form, "meal_type", err.message);
      } else if (err?.status === 422 && applyFieldErrors(form, err)) {
        showFormError(form, "Please fix the highlighted fields.");
      } else {
        showFormError(form, err?.message || "Couldn't save the menu.");
      }
    } finally {
      if (form.isConnected) setBusy(submit, false);
    }
  });

  renderChips();
  return {
    reset(next = {}) {
      items = Array.isArray(next.menu_items) ? [...next.menu_items] : [];
      renderChips();
      clearErrors(form);
    },
  };
}
