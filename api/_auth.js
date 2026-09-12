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

function buildStructuredSessionValue(session) {
  const secret = getSessionSecret();
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = createSignature(payload, secret);

  return `${payload}.${signature}`;
}

export function createSessionCookie(user) {
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  const sessionValue = buildStructuredSessionValue({
    version: 2,
    userId: String(user?.userId || "").trim(),
    email: String(user?.email || "").trim().toLowerCase(),
    name: String(user?.name || "").trim(),
    isAdmin: user?.isAdmin === true,
    expiresAt,
  });

  return serializeCookie(
    SESSION_COOKIE_NAME,
    sessionValue,
    Math.floor(SESSION_DURATION_MS / 1000)
  );
}

export function clearSessionCookie() {
  return serializeCookie(SESSION_COOKIE_NAME, "", 0);
}

function parseStructuredSession(rawValue, secret) {
  const segments = rawValue.split(".");

  if (segments.length !== 2) {
    return null;
  }

  const [payload, signature] = segments;
  const expectedSignature = createSignature(payload, secret);

  if (!safeCompare(signature, expectedSignature)) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const expiresAt = Number(session?.expiresAt);
    const userId = String(session?.userId || "").trim();

    if (session?.version !== 2 || !userId || !Number.isFinite(expiresAt)) {
      return null;
    }

    if (expiresAt <= Date.now()) {
      return null;
    }

    return {
      version: 2,
      userId,
      email: String(session.email || "").trim().toLowerCase(),
      name: String(session.name || "").trim(),
      isAdmin: session?.isAdmin === true,
      expiresAt,
    };
  } catch {
    return null;
  }
}

function parseLegacySession(rawValue, secret) {
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

  return { version: 1, username, expiresAt };
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

  return parseStructuredSession(rawValue, secret) || parseLegacySession(rawValue, secret);
}

export function requireAuth(req, res) {
  const session = getSession(req);

  if (!session) {
    res.status(401).json({ ok: false, error: "No autenticado." });
    return null;
  }

  return session;
}

export function getSessionUserId(session) {
  if (session?.version === 2) {
    return String(session.userId || "").trim();
  }

  if (session?.version === 1) {
    return String(process.env.LEGACY_USER_ID || "").trim();
  }

  return "";
}

export function validateCredentials(username, password) {
  const expectedUsername = String(process.env.ADMIN_USERNAME || "").trim();
  const expectedPassword = String(process.env.ADMIN_PASSWORD || "").trim();

  if (!expectedUsername || !expectedPassword) {
    return false;
  }

  return safeCompare(username, expectedUsername) && safeCompare(password, expectedPassword);
}
