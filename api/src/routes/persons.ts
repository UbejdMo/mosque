import { Router } from 'express';
import { z } from 'zod';
import { requireRole, requireScope } from '../http/middleware/authenticate.js';
import { parseBody, parseParams } from '../http/validate.js';
import * as personsRepo from '../repositories/persons.js';
import { toPersonDto } from '../services/household-view.js';
import {
  recordBirth,
  recordEmigration,
  recordExit,
  recordMarriedIn,
  setHeadOfHousehold,
} from '../services/life-events.js';

export const personsRouter: Router = Router();


// Both the imam and the collector maintain households and persons (SPEC §4.2).
const staff = requireRole('super_admin', 'imam', 'collector');

const householdParam = z.object({ id: z.uuid() });
const personParam = z.object({ personId: z.uuid() });

const nameBody = z.object({
  firstName: z.string().trim().min(1).max(80),
  /** Required, never optional — the village's only reliable disambiguator. */
  fatherName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
});

personsRouter.get('/households/:id/persons', async (req, res) => {
  const scope = requireScope(req);
  const { id } = parseParams(householdParam, req);
  const people = await personsRepo.listByHousehold(scope, id);
  res.json({ persons: people.map(toPersonDto) });
});

/** Generic create, for importing the notebook where the event is unknown. */
personsRouter.post('/households/:id/persons', staff, async (req, res) => {
  const scope = requireScope(req);
  const { id } = parseParams(householdParam, req);
  const body = parseBody(
    nameBody.extend({
      joinedYear: z.number().int(),
      leftYear: z.number().int().nullish(),
      isHead: z.boolean().optional(),
      livesAbroad: z.boolean().optional(),
    }),
    req,
  );
  const person = await personsRepo.create(scope, { householdId: id, ...body });
  res.status(201).json({ person: toPersonDto(person) });
});

personsRouter.post('/households/:id/persons/birth', staff, async (req, res) => {
  const scope = requireScope(req);
  const { id } = parseParams(householdParam, req);
  const body = parseBody(nameBody.extend({ birthYear: z.number().int() }), req);
  const person = await recordBirth(scope, { householdId: id, ...body });
  res.status(201).json({ person: toPersonDto(person) });
});

personsRouter.post('/households/:id/persons/married-in', staff, async (req, res) => {
  const scope = requireScope(req);
  const { id } = parseParams(householdParam, req);
  const body = parseBody(nameBody.extend({ year: z.number().int() }), req);
  const person = await recordMarriedIn(scope, { householdId: id, ...body });
  res.status(201).json({ person: toPersonDto(person) });
});

personsRouter.patch('/persons/:personId', staff, async (req, res) => {
  const scope = requireScope(req);
  const { personId } = parseParams(personParam, req);
  const body = parseBody(
    nameBody.partial().extend({
      joinedYear: z.number().int().optional(),
      leftYear: z.number().int().nullish(),
      livesAbroad: z.boolean().optional(),
    }),
    req,
  );
  const person = await personsRepo.update(scope, personId, body);
  res.json({ person: toPersonDto(person) });
});

/**
 * Someone stops being liable. The leaving year is inclusive — a person who
 * dies in March still owes that whole year (SPEC §5.1).
 */
personsRouter.post('/persons/:personId/exit', staff, async (req, res) => {
  const scope = requireScope(req);
  const { personId } = parseParams(personParam, req);
  const body = parseBody(
    z.object({
      event: z.enum(['death', 'married_out', 'moved_out']),
      year: z.number().int(),
    }),
    req,
  );
  const person = await recordExit(scope, personId, body);
  res.json({ person: toPersonDto(person) });
});

/**
 * Emigration is **not** an exit and carries no exemption (SPEC §5.2). This
 * endpoint sets one boolean and cannot touch liability.
 */
personsRouter.post('/persons/:personId/emigration', staff, async (req, res) => {
  const scope = requireScope(req);
  const { personId } = parseParams(personParam, req);
  const { livesAbroad } = parseBody(z.object({ livesAbroad: z.boolean() }), req);
  const person = await recordEmigration(scope, personId, livesAbroad);
  res.json({ person: toPersonDto(person) });
});

personsRouter.post('/persons/:personId/make-head', staff, async (req, res) => {
  const scope = requireScope(req);
  const { personId } = parseParams(personParam, req);
  res.json({ person: toPersonDto(await setHeadOfHousehold(scope, personId)) });
});

personsRouter.delete('/persons/:personId', staff, async (req, res) => {
  const scope = requireScope(req);
  const { personId } = parseParams(personParam, req);
  await personsRepo.softDelete(scope, personId);
  res.status(204).end();
});
