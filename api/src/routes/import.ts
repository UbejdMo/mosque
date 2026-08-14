import { Router } from 'express';
import { z } from 'zod';
import { ENTRY_REASONS, EXIT_REASONS } from '@mosque/shared';
import { requireRole, requireScope } from '../http/middleware/authenticate.js';
import { parseBody } from '../http/validate.js';
import { importHouseholds, listNeighbourhoods } from '../services/legacy-import.js';

export const importRouter: Router = Router();

const staff = requireRole('super_admin', 'imam', 'collector');

const personSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  fatherName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  joinedYear: z.number().int(),
  leftYear: z.number().int().nullish(),
  entryReason: z.enum(ENTRY_REASONS).nullish(),
  exitReason: z.enum(EXIT_REASONS).nullish(),
  isHead: z.boolean().optional(),
  livesAbroad: z.boolean().optional(),
});

const householdSchema = z.object({
  neighbourhood: z.string().trim().max(120).nullish(),
  phone: z.string().trim().max(32).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  needsReview: z.boolean().optional(),
  persons: z.array(personSchema).min(1),
  settledYears: z.array(z.number().int()),
});

const importSchema = z.object({
  // Capped so one accidental paste cannot lock the table for minutes; the CSV
  // path sends several batches rather than one enormous request.
  households: z.array(householdSchema).min(1).max(200),
});

/**
 * Transcribing the paper notebook (SPEC §15). One transaction per batch: the
 * whole batch lands or none of it does.
 */
importRouter.post('/import/households', staff, async (req, res) => {
  const scope = requireScope(req);
  const { households } = parseBody(importSchema, req);
  const result = await importHouseholds(scope, households);
  res.status(201).json(result);
});

/** Feeds the entry screen's neighbourhood suggestions, to keep spelling stable. */
importRouter.get('/import/neighbourhoods', staff, async (req, res) => {
  const scope = requireScope(req);
  res.json({ neighbourhoods: await listNeighbourhoods(scope) });
});
