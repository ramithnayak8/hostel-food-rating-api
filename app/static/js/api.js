// JSON API client and the login session. Every failure becomes an ApiError with a message
// that can be shown to a person as-is: network down, timeout, rate limit, expired session.

const SESSION_KEY = "thali.session";
const TIMEOUT_MS = 15000;
const listeners = new Set();

function readSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (s && typeof s.token === "string" && Number(s.expiresAt) > Date.now()) return s;
  } catch {
    /* unreadable or blocked storage: start logged out */
  }
  return null;
}

let session = readSession();

function persist() {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage blocked: the session lives for this tab only */
  }
}

function emit(reason) {
  for (const fn of listeners) {
    try {
      fn(reason);
    } catch (err) {
      console.error(err);
    }
  }
}

export const auth = {
  get user() {
    return this.loggedIn ? session.user : null;
  },
  get token() {
    return this.loggedIn ? session.token : null;
  },
  get loggedIn() {
    return Boolean(session && session.user && session.expiresAt > Date.now());
  },
  get isAdmin() {
    return this.loggedIn && session.user.role === "admin";
  },
  /** Keep a fresh token; the user is attached once /auth/me answers. */
  begin(token, expiresIn) {
    const seconds = Math.max(60, Number(expiresIn) || 3600);
    session = { token, expiresAt: Date.now() + (seconds - 30) * 1000, user: null };
  },
  setUser(user) {
    if (!session) return;
    session.user = user;
    persist();
    emit("login");
  },
  clear(reason = "logout") {
    const had = Boolean(session);
    session = null;
    persist();
    if (had) emit(reason);
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = extra.details ?? null;
    this.requestId = extra.requestId ?? null;
  }
}

function friendlyMessage(status, serverMessage, requestId) {
  if (status === 429) return "Too many requests in a short time. Please wait a minute and try again.";
  if (status >= 500) {
    const ref = requestId ? ` (ref ${String(requestId).slice(0, 8)})` : "";
    return `The server hit a problem${ref}. Please try again in a moment.`;
  }
  if (status === 413) return "That was too much text to send at once.";
  return serverMessage || `Request failed (${status}).`;
}

/**
 * Call the API. `body` is sent as JSON. Resolves with the parsed JSON (or null for 204).
 * Rejects with ApiError. A 401 on an authenticated call ends the session.
 */
export async function api(path, { method = "GET", body } = {}) {
  const pendingSession = session && !session.user ? session : null;
  const token = auth.token ?? pendingSession?.token ?? null;
  if (!token && session && session.expiresAt <= Date.now()) auth.clear("expired");

  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      0,
      controller.signal.aborted ? "timeout" : "network",
      controller.signal.aborted
        ? "The server took too long to answer. Please try again."
        : "Can't reach the server. Check your connection and try again.",
    );
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  if (response.status !== 204) {
    const text = await response.text().catch(() => "");
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
  }

  if (!response.ok) {
    const error = data && typeof data === "object" ? (data.error ?? {}) : {};
    const requestId = error.request_id ?? response.headers.get("X-Request-ID");
    if (response.status === 401 && token) {
      auth.clear("expired");
      throw new ApiError(401, "unauthorized", "Your session has ended. Please log in again.", { requestId });
    }
    throw new ApiError(
      response.status,
      error.code ?? `http_${response.status}`,
      friendlyMessage(response.status, error.message, requestId),
      { details: Array.isArray(error.details) ? error.details : null, requestId },
    );
  }
  return data;
}

/** Log in, then load the account. Leaves no half-made session behind if either step fails. */
export async function login(email, password) {
  const token = await api("/auth/login", { method: "POST", body: { email, password } });
  auth.begin(token.access_token, token.expires_in);
  try {
    const user = await api("/auth/me");
    auth.setUser(user);
    return user;
  } catch (err) {
    auth.clear("logout");
    throw err;
  }
}

/** Re-check the saved session against the server; keeps it if the server is unreachable. */
export async function refreshUser() {
  if (!auth.loggedIn) return null;
  try {
    const user = await api("/auth/me");
    auth.setUser(user);
    return user;
  } catch (err) {
    if (err.status === 0) return auth.user;
    return null;
  }
}
