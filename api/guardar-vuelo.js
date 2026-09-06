import { requireAuth } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  }

  const session = requireAuth(req, res);

  if (!session) {
    return undefined;
  }

  try {
    const appsScriptUrl = String(process.env.APPS_SCRIPT_URL || "").trim();

    if (!appsScriptUrl) {
      return res
        .status(500)
        .json({ ok: false, error: "Falta APPS_SCRIPT_URL en variables de entorno." });
    }

    const response = await fetch(appsScriptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...req.body,
        appSecret: process.env.APPS_SCRIPT_SECRET
          ? String(process.env.APPS_SCRIPT_SECRET).trim()
          : undefined,
      }),
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, error: "Respuesta invalida de Apps Script.", raw: text };
    }

    return res.status(response.ok ? 200 : response.status).json(data);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Error interno del servidor.",
    });
  }
}
