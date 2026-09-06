import crypto from "node:crypto";

const SESSION_COOKIE_NAME = "app_horas_session";
const SESSION_DURATION_MS = 1000 * 60 * 60 * 12;

function parseCookies(cookieHeader = "") {
  return cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .filter(Boolean)
    .reduce((acc, cookie) => {
      const separatorIndex = cookie.indexOf("=");

      if (separatorIndex === -1) {
        return acc;
      }

      const key = cookie.slice(0, separatorIndex).trim();
      const value = cookie.slice(separatorIndex + 1).trim();

      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ""));
  const rightBuffer = Buffer.from(String(right ?? ""));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createSignature(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function serializeCookie(name, value, maxAgeSeconds) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function getSessionSecret() {
  return String(process.env.SESSION_SECRET || "").trim();
}

function buildSessionValue(username, expiresAt) {
  const secret = getSessionSecret();
  const payload = `${username}.${expiresAt}`;
  const signature = createSignature(payload, secret);

  return `${payload}.${signature}`;
}

export function createSessionCookie(username) {
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  const sessionValue = buildSessionValue(username, expiresAt);

  return serializeCookie(
    SESSION_COOKIE_NAME,
    sessionValue,
    Math.floor(SESSION_DURATION_MS / 1000)
  );
}

export function clearSessionCookie() {
  return serializeCookie(SESSION_COOKIE_NAME, "", 0);
}

export function getSession(req) {
  const secret = getSessionSecret();

  if (!secret) {
    return null;
  }

  const cookies = parseCookies(req.headers.cookie);
  const rawValue = cookies[SESSION_COOKIE_NAME];

  if (!rawValue) {
    return null;
  }

  const segments = rawValue.split(".");

  if (segments.length < 3) {
    return null;
  }

  const signature = segments.pop();
  const expiresAt = Number(segments.pop());
  const username = segments.join(".");

  if (!username || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return null;
  }

  const payload = `${username}.${expiresAt}`;
  const expectedSignature = createSignature(payload, secret);

  if (!safeCompare(signature, expectedSignature)) {
    return null;
  }

  return { username, expiresAt };
}

export function requireAuth(req, res) {
  const session = getSession(req);

  if (!session) {
    res.status(401).json({ ok: false, error: "No autenticado." });
    return null;
  }

  return session;
}

export function validateCredentials(username, password) {
  const expectedUsername = String(process.env.ADMIN_USERNAME || "").trim();
  const expectedPassword = String(process.env.ADMIN_PASSWORD || "").trim();

  if (!expectedUsername || !expectedPassword) {
    return false;
  }

  return safeCompare(username, expectedUsername) && safeCompare(password, expectedPassword);
}
