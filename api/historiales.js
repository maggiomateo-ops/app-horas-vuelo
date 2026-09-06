import { requireAuth } from "./_auth.js";

function buildHistorialesUrl() {
  const appsScriptUrl = String(process.env.APPS_SCRIPT_URL || "").trim();

  if (!appsScriptUrl) {
    return null;
  }

  const url = new URL(appsScriptUrl);
  url.searchParams.set("action", "historiales");

  if (process.env.APPS_SCRIPT_SECRET) {
    url.searchParams.set("appSecret", String(process.env.APPS_SCRIPT_SECRET).trim());
  }

  return url.toString();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  }

  const session = requireAuth(req, res);

  if (!session) {
    return undefined;
  }

  const historialesUrl = buildHistorialesUrl();

  if (!historialesUrl) {
    return res
      .status(500)
      .json({ ok: false, error: "Falta APPS_SCRIPT_URL en variables de entorno." });
  }

  try {
    const response = await fetch(historialesUrl, {
      method: "GET",
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, error: "Respuesta invalida de Apps Script.", raw: text };
    }

    if (!response.ok || !data?.ok) {
      return res
        .status(response.ok ? 502 : response.status)
        .json({ ok: false, error: data?.error || "No se pudieron cargar los historiales." });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Error interno del servidor.",
    });
  }
}
