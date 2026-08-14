import { db, pool } from './client.js';
import { mosques, rates, users } from './schema/index.js';
import { hashPin } from '../lib/pin.js';
import { isProduction } from '../config/env.js';

/**
 * Bootstraps a usable mosque for development: one mosque, staff accounts, and
 * a rate for every ledger year.
 *
 * There is no self-signup for staff (SPEC §7), so the very first accounts have
 * to come from somewhere — this is that somewhere. Re-running is safe: it does
 * nothing if the mosque already exists.
 */

const LEDGER_START_YEAR = 2016;
const RATE_CENTS = 500;
const DEV_PIN = '482913';

async function seed(): Promise<void> {
  if (isProduction && !process.argv.includes('--force')) {
    throw new Error('Refusing to seed a production database without --force');
  }

  const existing = await db.select().from(mosques).limit(1);
  if (existing.length > 0) {
    console.log('Mosque already seeded — nothing to do.');
    return;
  }

  await db.transaction(async (tx) => {
    const [mosque] = await tx
      .insert(mosques)
      .values({
        name: 'Xhamia e Fshatit',
        village: 'Fshati',
        ledgerStartYear: LEDGER_START_YEAR,
        commissionPercent: 10,
      })
      .returning();
    if (!mosque) throw new Error('Failed to create mosque');

    const currentYear = new Date().getFullYear();
    const rateRows = [];
    for (let year = LEDGER_START_YEAR; year <= currentYear; year++) {
      rateRows.push({ mosqueId: mosque.id, year, amountCents: RATE_CENTS });
    }
    await tx.insert(rates).values(rateRows);

    const pinHash = await hashPin(DEV_PIN);
    await tx.insert(users).values([
      {
        mosqueId: mosque.id,
        phone: '+38344000001',
        pinHash,
        role: 'imam',
        status: 'active',
      },
      {
        mosqueId: mosque.id,
        phone: '+38344000002',
        pinHash,
        role: 'collector',
        status: 'active',
      },
    ]);

    console.log(`Seeded "${mosque.name}" (${mosque.village})`);
    console.log(`  ledger years : ${LEDGER_START_YEAR}–${currentYear} at €5.00`);
    console.log(`  imam         : +38344000001`);
    console.log(`  collector    : +38344000002`);
    console.log(`  PIN for both : ${DEV_PIN}   <- development only`);
  });
}

try {
  await seed();
} catch (err) {
  console.error(`Seed failed: ${String(err)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
