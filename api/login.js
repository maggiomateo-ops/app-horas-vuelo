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

  const userId = String(process.env.LEGACY_USER_ID || "").trim();

  if (!userId) {
    return res
      .status(500)
      .json({ ok: false, error: "Falta LEGACY_USER_ID en variables de entorno." });
  }

  const user = {
    userId,
    email: "",
    name: username,
  };

  res.setHeader("Set-Cookie", createSessionCookie(user));

  return res.status(200).json({
    ok: true,
    user,
  });
}
