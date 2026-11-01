import { api, auth, login } from "../api.js";
import {
  applyFieldErrors,
  button,
  clearErrors,
  firstName,
  html,
  icon,
  mount,
  setBusy,
  setFieldError,
  showFormError,
  toast,
} from "../lib.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Only follow in-app hash routes after login, never an arbitrary URL. */
function safeNext(next, fallback) {
  return typeof next === "string" && /^#\/[\w\-/?=&%.]*$/.test(next) && !next.startsWith("#/login") && !next.startsWith("#/register")
    ? next
    : fallback;
}

const homeFor = (user) => (user?.role === "admin" ? "#/warden" : "#/menu");

function passwordField(id, autocomplete) {
  return html`<div class="field" data-field="password">
    <label for="${id}">Password</label>
    <div class="input-wrap">
      <input class="input" id="${id}" name="password" type="password" autocomplete="${autocomplete}" required minlength="${autocomplete === "new-password" ? 8 : 1}" maxlength="128">
      <button class="icon-btn" type="button" data-action="toggle-password" aria-label="Show password" aria-pressed="false">${icon("eye")}</button>
    </div>
    ${autocomplete === "new-password" ? html`<span class="field-hint">At least 8 characters.</span>` : ""}
    <span class="field-error"></span>
  </div>`;
}

function bindPasswordToggle(root) {
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action='toggle-password']");
    if (!btn) return;
    const input = btn.parentElement.querySelector("input");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.setAttribute("aria-pressed", String(show));
    btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    btn.innerHTML = String(icon(show ? "eyeOff" : "eye"));
  });
}

function shell(copy, form) {
  return html`<section class="page"><div class="container auth-grid">
    <div class="auth-copy">${copy}</div>
    <div class="bezel reveal" data-i="2"><div class="core">${form}</div></div>
  </div></section>`;
}

// ------------------------------------------------------------------ login

export const loginView = {
  title: "Log in",
  async render(ctx) {
    const next = safeNext(ctx.query.get("next"), null);
    if (auth.loggedIn) {
      ctx.redirect(next ?? homeFor(auth.user));
      return;
    }
    mount(
      ctx.el,
      shell(
        html`<span class="eyebrow reveal"><span class="dot"></span>Welcome back</span>
          <h1 class="h1 reveal" data-i="1">Good to see you <em>again.</em></h1>
          <p class="lede reveal" data-i="2">Log in to rate today's meals, read what others thought, and see your rating history.</p>
          <ul class="auth-points reveal" data-i="3">
            <li>${icon("star")}<span>Rate overall, taste, hygiene and quantity in seconds.</span></li>
            <li>${icon("lock")}<span>Your name is never shown to other students.</span></li>
          </ul>`,
        html`<form class="form" novalidate>
          <div class="stack gap-1"><h2 class="h3">Log in</h2><p class="small muted">Students and wardens use the same login.</p></div>
          <div class="form-error" role="alert" hidden>${icon("alert")}<span></span></div>
          <div class="field" data-field="email">
            <label for="login-email">Email</label>
            <input class="input" id="login-email" name="email" type="email" autocomplete="email" required maxlength="255" placeholder="you@hostel.example.com">
            <span class="field-error"></span>
          </div>
          ${passwordField("login-password", "current-password")}
          <div class="form-actions">${button({ label: "Log in", type: "submit", ico: "arrowRight" })}</div>
          <p class="auth-switch">New here? <a href="#/register${next ? `?next=${encodeURIComponent(next)}` : ""}">Create a student account</a></p>
        </form>`,
      ),
    );
    const form = ctx.el.querySelector("form");
    bindPasswordToggle(form);
    form.querySelector("input").focus({ preventScroll: true });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submit = form.querySelector("button[type='submit']");
      if (submit.disabled) return;
      clearErrors(form);
      const email = form.elements.namedItem("email").value.trim();
      const password = form.elements.namedItem("password").value;
      let bad = false;
      if (!EMAIL.test(email)) bad = setFieldError(form, "email", "Enter a valid email address.");
      if (!password) bad = setFieldError(form, "password", "Enter your password.");
      if (bad) return;

      setBusy(submit, true, "Logging in…");
      try {
        const user = await login(email, password);
        toast(`Welcome back, ${firstName(user.name)}.`, "good");
        ctx.redirect(next ?? homeFor(user));
      } catch (err) {
        if (!form.isConnected) return;
        if (err.status === 401) showFormError(form, "That email and password don't match an account.");
        else if (err.status === 422 && applyFieldErrors(form, err)) showFormError(form, "Please check the highlighted fields.");
        else showFormError(form, err.message);
        setBusy(submit, false);
      }
    });
  },
};

// ------------------------------------------------------------------ register

export const registerView = {
  title: "Create an account",
  async render(ctx) {
    const next = safeNext(ctx.query.get("next"), null);
    if (auth.loggedIn) {
      ctx.redirect(next ?? homeFor(auth.user));
      return;
    }
    mount(
      ctx.el,
      shell(
        html`<span class="eyebrow reveal"><span class="dot"></span>Student account</span>
          <h1 class="h1 reveal" data-i="1">Pull up a chair at <em>the table.</em></h1>
          <p class="lede reveal" data-i="2">Your ratings shape what the mess serves next week. Sign up with your room number to get started.</p>
          <ul class="auth-points reveal" data-i="3">
            <li>${icon("checkCircle")}<span>One rating per meal, so every voice counts the same.</span></li>
            <li>${icon("flag")}<span>Meals that average below 2.0 are flagged for the warden automatically.</span></li>
            <li>${icon("lock")}<span>Passwords are stored as argon2id hashes, never in plain text.</span></li>
          </ul>`,
        html`<form class="form" novalidate>
          <div class="stack gap-1"><h2 class="h3">Create your account</h2><p class="small muted">Warden accounts are set up by the hostel office.</p></div>
          <div class="form-error" role="alert" hidden>${icon("alert")}<span></span></div>
          <div class="field" data-field="name">
            <label for="reg-name">Full name</label>
            <input class="input" id="reg-name" name="name" autocomplete="name" required maxlength="100" placeholder="Asha Rao">
            <span class="field-error"></span>
          </div>
          <div class="grid keep-2">
            <div class="field span-6" data-field="room_no">
              <label for="reg-room">Room</label>
              <input class="input" id="reg-room" name="room_no" required maxlength="20" placeholder="B-204" autocomplete="off">
              <span class="field-error"></span>
            </div>
            <div class="field span-6" data-field="email">
              <label for="reg-email">Email</label>
              <input class="input" id="reg-email" name="email" type="email" autocomplete="email" required maxlength="255" placeholder="you@hostel.example.com">
              <span class="field-error"></span>
            </div>
          </div>
          ${passwordField("reg-password", "new-password")}
          <div class="form-actions">${button({ label: "Create account", type: "submit", ico: "arrowRight" })}</div>
          <p class="auth-switch">Already registered? <a href="#/login${next ? `?next=${encodeURIComponent(next)}` : ""}">Log in</a></p>
        </form>`,
      ),
    );
    const form = ctx.el.querySelector("form");
    bindPasswordToggle(form);
    form.querySelector("input").focus({ preventScroll: true });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submit = form.querySelector("button[type='submit']");
      if (submit.disabled) return;
      clearErrors(form);
      const field = (name) => form.elements.namedItem(name).value;
      const body = {
        name: field("name").trim(),
        room_no: field("room_no").trim(),
        email: field("email").trim(),
        password: field("password"),
      };
      const problems = {};
      if (!body.name) problems.name = "Enter your name.";
      if (!body.room_no) problems.room_no = "Enter your room number.";
      if (!EMAIL.test(body.email)) problems.email = "Enter a valid email address.";
      if (body.password.length < 8) problems.password = "Use at least 8 characters.";
      for (const [name, message] of Object.entries(problems)) setFieldError(form, name, message);
      if (Object.keys(problems).length) return;

      setBusy(submit, true, "Creating account…");
      let registered = false;
      try {
        await api("/auth/register", { method: "POST", body });
        registered = true;
        const user = await login(body.email, body.password);
        toast(`Welcome to Thali, ${firstName(user.name)}!`, "good");
        ctx.redirect(next ?? homeFor(user));
      } catch (err) {
        if (registered) {
          toast("Your account is ready. Please log in.", "good");
          ctx.redirect(`#/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
          return;
        }
        if (!form.isConnected) return;
        if (err.status === 409) setFieldError(form, "email", "An account with this email already exists. Try logging in.");
        else if (err.status === 422 && applyFieldErrors(form, err)) showFormError(form, "Please check the highlighted fields.");
        else showFormError(form, err.message);
        setBusy(submit, false);
      }
    });
  },
};
