import { getSession } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  }

  const session = getSession(req);

  if (!session) {
    return res.status(401).json({ ok: false, authenticated: false });
  }

  if (session.version === 2) {
    return res.status(200).json({
      ok: true,
      authenticated: true,
      user: {
        userId: session.userId,
        email: session.email,
        name: session.name,
      },
    });
  }

  return res.status(200).json({
    ok: true,
    authenticated: true,
    user: { username: session.username },
  });
}
