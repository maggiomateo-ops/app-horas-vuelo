import { costsRepository } from './_postgresCostsRepository.js';

export function createCostsHttpHandler(repository = costsRepository) {
  return async function handleCosts(req, res, { userId }) {
    res.setHeader?.('Cache-Control', 'private, no-store');
    try {
      if (req.method === 'GET') {
        const first = v => Array.isArray(v) ? v[0] : v;
        const action = first(req.query?.action);
        const costs = action === 'archives' ? { archives: await repository.listArchives({ userId }) }
          : await repository.read({ userId, aircraftId: first(req.query?.aircraft_id), scopeId: first(req.query?.financial_scope_id) });
        return res.status(200).json({ ok: true, costs });
      }
      if (!['POST', 'PATCH'].includes(req.method)) return res.status(405).json({ ok: false, error: 'Método no permitido.' });
      const body = req.body || {};
      const result = await repository.command({ userId, aircraftId: body.aircraft_id, scopeId: body.financial_scope_id,
        action: body.action, requestId: body.request_id, data: body.data, reason: body.reason });
      return res.status(200).json({ ok: true, result });
    } catch (error) {
      const status = error.statusCode || 500;
      const expose = [400, 403, 404, 409, 422, 503].includes(status);
      return res.status(status).json({ ok: false, error: expose ? error.message : 'No se pudo procesar Costs. Intentá nuevamente.',
        code: expose ? error.code : 'COST_INTERNAL_ERROR' });
    }
  };
}
export const handleCostsResource = createCostsHttpHandler();
