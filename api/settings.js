import { requireAuth } from "./_auth.js";
import { DATA_SOURCE, resolveDataSource } from "./_dataSource.js";
import {
  getLegacySettingsShapeFromPostgres,
  saveLegacySettingsShapeToPostgres,
} from "./_postgresSettingsParityAdapter.js";
import {
  archiveTrackingItemInPostgres,
  completeTrackingItemInPostgres,
  createTrackingItemInPostgres,
  getTrackingItemsFromPostgres,
  updateTrackingItemInPostgres,
} from "./_postgresTrackingRepository.js";
import {
  resolvePostgresTrackingWriteCapability,
  resolveSettingsWriteCapability,
} from "./_settingsWriteCapability.js";
import {
  getSettingsFromSheets,
  saveSettingsToSheets,
} from "./_settingsRepository.js";

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function trackingErrorResponse(res, error) {
  const statusCode = error?.statusCode || 502;
  const exposeMessage = [400, 403, 404, 409, 422].includes(statusCode);
  return res.status(statusCode).json({
    ok: false,
    error: exposeMessage
      ? error.message
      : "No se pudieron procesar los recordatorios.",
    code: exposeMessage ? error.code : undefined,
  });
}

async function handleTrackingResource(req, res, { userId, aircraftId, source }) {
  try {
    if (req.method === "GET") {
      const tracking = await getTrackingItemsFromPostgres({
        userId,
        aircraftId,
        status: firstQueryValue(req.query?.status) || "ACTIVE",
      });
      return res.status(200).json({ ok: true, tracking });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const action = String(body.action || "").trim().toLowerCase();

    if (req.method === "POST" && action === "create") {
      const result = await createTrackingItemInPostgres({
        userId,
        aircraftId,
        item: body.item,
      });
      return res.status(201).json({ ok: true, result });
    }

    if (req.method === "POST" && action === "complete") {
      const result = await completeTrackingItemInPostgres({
        userId,
        aircraftId,
        trackingItemId: body.tracking_item_id,
        note: body.note,
        nextDueDate: body.next_due_date,
      });
      return res.status(200).json({ ok: true, result });
    }

    if (req.method === "PATCH" && action === "update") {
      const result = await updateTrackingItemInPostgres({
        userId,
        aircraftId,
        trackingItemId: body.tracking_item_id,
        item: body.item,
      });
      return res.status(200).json({ ok: true, result });
    }

    if (req.method === "PATCH" && action === "archive") {
      const result = await archiveTrackingItemInPostgres({
        userId,
        aircraftId,
        trackingItemId: body.tracking_item_id,
      });
      return res.status(200).json({ ok: true, result });
    }

    return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  } catch (error) {
    return trackingErrorResponse(res, error);
  }
}

export default async function handler(req, res) {
  const session = requireAuth(req, res);

  if (!session) {
    return undefined;
  }

  const userId = String(session.userId || "").trim();
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const resource = String(
    (req.method === "GET" ? firstQueryValue(req.query?.resource) : body.resource) || ""
  ).trim().toLowerCase();
  const requestedAircraftId = req.method === "GET"
    ? firstQueryValue(req.query?.aircraft_id)
    : body.aircraft_id;
  const aircraftId = String(
    requestedAircraftId || process.env.LEGACY_AIRCRAFT_ID || ""
  ).trim();

  if (!userId) {
    return res
      .status(401)
      .json({ ok: false, error: "La sesion no contiene un userId valido." });
  }

  if (!aircraftId) {
    return res
      .status(500)
      .json({ ok: false, error: "Falta aircraft_id o LEGACY_AIRCRAFT_ID." });
  }

  let source;
  try {
    source = resolveDataSource("SETTINGS_DATA_SOURCE");
  } catch {
    return res.status(500).json({
      ok: false,
      error: "La fuente o capacidad de escritura de Settings no esta configurada correctamente.",
    });
  }

  if (resource === "tracking") {
    if (source !== DATA_SOURCE.POSTGRES) {
      return res.status(404).json({ ok: false, error: "Recurso no disponible." });
    }
    return handleTrackingResource(req, res, { userId, aircraftId, source });
  }

  let settingsWriteCapability;
  try {
    settingsWriteCapability = resolveSettingsWriteCapability(source);
  } catch {
    return res.status(500).json({
      ok: false,
      error: "La fuente o capacidad de escritura de Settings no esta configurada correctamente.",
    });
  }

  if (req.method === "GET") {
    try {
      const settings = source === DATA_SOURCE.POSTGRES
        ? await getLegacySettingsShapeFromPostgres({ userId, aircraftId })
        : await getSettingsFromSheets({ userId, aircraftId });

      return res.status(200).json({ ok: true, settings });
    } catch (error) {
      return res.status(error.statusCode || 502).json({
        ok: false,
        error: error.code === "INVALID_SETTINGS_JSON"
          ? error.message
          : "No se pudieron cargar los settings.",
      });
    }
  }

  if (req.method === "POST") {
    if (source === DATA_SOURCE.POSTGRES && !settingsWriteCapability.enabled) {
      return res.status(503).json({
        ok: false,
        error: "La escritura de Settings en Postgres esta deshabilitada en este Preview.",
      });
    }

    try {
      if (source === DATA_SOURCE.POSTGRES) {
        const result = await saveLegacySettingsShapeToPostgres({
          userId,
          aircraftId,
          settings: body.settings,
        });

        return res.status(200).json({
          ok: true,
          settings: result.settings,
          changed: result.changed,
          changedPaths: result.changedPaths,
        });
      }

      const settings = await saveSettingsToSheets({
        userId,
        aircraftId,
        settings: body.settings,
      });
      return res.status(200).json({ ok: true, settings });
    } catch (error) {
      const exposeMessage = [400, 403, 409, 422].includes(error.statusCode);

      return res.status(error.statusCode || 502).json({
        ok: false,
        error: exposeMessage
          ? error.message
          : "No se pudieron guardar los settings.",
        code: exposeMessage ? error.code : undefined,
      });
    }
  }

  return res.status(405).json({ ok: false, error: "Metodo no permitido." });
}
