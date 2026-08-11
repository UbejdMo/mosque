/**
 * Ten tables (SPEC §4.1b). Import order matters: each module may only
 * reference tables defined before it, which keeps the module graph acyclic.
 *
 * Obligations are deliberately absent — they are derived in a view (SPEC §5.3),
 * never stored. A stored obligation is a second source of truth waiting to
 * diverge.
 */
export * from './enums.js';
export * from './columns.js';
export * from './mosques.js';
export * from './households.js';
export * from './users.js';
export * from './ledger.js';
export * from './audit.js';
export * from './views.js';
