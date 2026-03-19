export default async function handler(req, res) {
    // Permitir requests desde tu frontend
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }
  
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Método no permitido" });
    }
  
    try {
      const appsScriptUrl = process.env.APPS_SCRIPT_URL;
  
      if (!appsScriptUrl) {
        return res
          .status(500)
          .json({ ok: false, error: "Falta APPS_SCRIPT_URL en variables de entorno" });
      }
  
      const response = await fetch(appsScriptUrl, {
        method: "POST",
        body: JSON.stringify(req.body),
      });
  
      const text = await response.text();
  
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { ok: false, error: "Respuesta inválida de Apps Script", raw: text };
      }
  
      return res.status(200).json(data);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error.message || "Error interno del servidor",
      });
    }
  }