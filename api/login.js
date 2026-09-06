import { createSessionCookie, validateCredentials } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  }

  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");

  if (!username || !password) {
    return res
      .status(400)
      .json({ ok: false, error: "Ingresa usuario y contrasena." });
  }

  if (!validateCredentials(username, password)) {
    return res.status(401).json({ ok: false, error: "Credenciales invalidas." });
  }

  res.setHeader("Set-Cookie", createSessionCookie(username));

  return res.status(200).json({
    ok: true,
    user: { username },
  });
}
