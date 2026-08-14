import { Router } from 'express';
import { z } from 'zod';
import { HOUSEHOLD_STATUSES } from '@mosque/shared';
import { requireRole, requireScope } from '../http/middleware/authenticate.js';
import { parseBody, parseParams, parseQuery } from '../http/validate.js';
import * as householdsRepo from '../repositories/households.js';
import { getHouseholdDetail, listHouseholds } from '../services/household-view.js';
import { dissolveHousehold, splitHousehold } from '../services/household-split.js';

export const householdsRouter: Router = Router();


const idParam = z.object({ id: z.uuid() });

const listQuery = z.object({
  search: z.string().trim().max(120).optional(),
  neighbourhood: z.string().trim().max(120).optional(),
  status: z.enum(HOUSEHOLD_STATUSES).optional(),
  minYearsUnpaid: z.coerce.number().int().min(0).optional(),
  includeDeleted: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * The screen the collector lives in (SPEC §10). Sorted by amount owed, which
 * is the order he walks the village in.
 */
householdsRouter.get('/households', async (req, res) => {
  const scope = requireScope(req);
  const options = parseQuery(listQuery, req);
  res.json({ households: await listHouseholds(scope, options) });
});

householdsRouter.get('/households/:id', async (req, res) => {
  const scope = requireScope(req);
  const { id } = parseParams(idParam, req);
  res.json(await getHouseholdDetail(scope, id));
});

const createBody = z.object({
  neighbourhood: z.string().trim().max(120).nullish(),
  phone: z.string().trim().max(32).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  needsReview: z.boolean().optional(),
});

householdsRouter.post(
  '/households',
  requireRole('super_admin', 'imam', 'collector'),
  async (req, res) => {
    const scope = requireScope(req);
    const input = parseBody(createBody, req);
    const household = await householdsRepo.create(scope, input);
    res.status(201).json({ household });
  },
);

const updateBody = createBody.extend({
  status: z.enum(HOUSEHOLD_STATUSES).optional(),
});

householdsRouter.patch(
  '/households/:id',
  requireRole('super_admin', 'imam', 'collector'),
  async (req, res) => {
    const scope = requireScope(req);
    const { id } = parseParams(idParam, req);
    const input = parseBody(updateBody, req);
    res.json({ household: await householdsRepo.update(scope, id, input) });
  },
);

householdsRouter.delete(
  '/households/:id',
  requireRole('super_admin', 'imam', 'collector'),
  async (req, res) => {
    const scope = requireScope(req);
    const { id } = parseParams(idParam, req);
    await householdsRepo.softDelete(scope, id);
    res.status(204).end();
  },
);

/**
 * Dissolving keeps the outstanding balance — it is retained and reportable,
 * never written off (SPEC §5.6).
 */
householdsRouter.post(
  '/households/:id/dissolve',
  requireRole('super_admin', 'imam', 'collector'),
  async (req, res) => {
    const scope = requireScope(req);
    const { id } = parseParams(idParam, req);
    const { note } = parseBody(z.object({ note: z.string().trim().max(2000).optional() }), req);
    await dissolveHousehold(scope, id, note);
    res.status(204).end();
  },
);

const splitBody = z.object({
  personIds: z.array(z.uuid()).min(1),
  newHeadPersonId: z.uuid(),
  splitYear: z.number().int(),
  neighbourhood: z.string().trim().max(120).nullish(),
  phone: z.string().trim().max(32).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

/** A son forming his own household — first-class, not manual re-entry (SPEC §5.6). */
householdsRouter.post(
  '/households/:id/split',
  requireRole('super_admin', 'imam', 'collector'),
  async (req, res) => {
    const scope = requireScope(req);
    const { id } = parseParams(idParam, req);
    const input = parseBody(splitBody, req);
    const result = await splitHousehold(scope, { sourceHouseholdId: id, ...input });
    res.status(201).json(result);
  },
);
