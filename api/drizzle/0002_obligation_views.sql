-- The single source of truth for money owed (SPEC §5.3).
--
--   obligation(household, Y) = count(persons liable in Y) x rate(Y)
--
-- Nothing else in the system computes a balance. Not a route handler, not a
-- report, not a React component. The point of choosing a relational database
-- here was to make divergent balances structurally impossible; reimplementing
-- this arithmetic in TypeScript would give that away.

CREATE VIEW v_household_year_obligation AS
WITH ledger_years AS (
  -- Every year from the mosque's ledger start to the current calendar year.
  -- Bounded by today on purpose: a rate entered in advance for next year must
  -- not make households look indebted before that year has arrived.
  SELECT m.id AS mosque_id, gs.year::int AS year
  FROM mosques m
  CROSS JOIN LATERAL generate_series(
    m.ledger_start_year,
    GREATEST(m.ledger_start_year, EXTRACT(YEAR FROM CURRENT_DATE)::int)
  ) AS gs(year)
),
household_years AS (
  SELECT h.mosque_id, h.id AS household_id, y.year
  FROM households h
  JOIN ledger_years y ON y.mosque_id = h.mosque_id
  -- Soft-deleted households leave the ledger; `dissolved` ones do not — their
  -- outstanding balance stays retained and reportable (SPEC §5.6).
  WHERE h.deleted_at IS NULL
),
liable AS (
  -- Membership is continuous, never paused. A person is liable for every year
  -- between joined_year and left_year, both inclusive (SPEC §5.1) — someone
  -- who dies in March still owes the full year, a baby born in November owes
  -- the full year, and living abroad is not an exemption.
  SELECT
    hy.household_id,
    hy.year,
    count(p.id)::int AS liable_person_count
  FROM household_years hy
  LEFT JOIN persons p
    ON p.household_id = hy.household_id
   AND p.deleted_at IS NULL
   AND p.joined_year <= hy.year
   AND (p.left_year IS NULL OR p.left_year >= hy.year)
  GROUP BY hy.household_id, hy.year
),
allocated AS (
  SELECT pay.household_id, pa.year, sum(pa.amount_cents)::bigint AS allocated_cents
  FROM payment_allocations pa
  JOIN payments pay ON pay.id = pa.payment_id
  GROUP BY pay.household_id, pa.year
)
SELECT
  hy.mosque_id,
  hy.household_id,
  hy.year,
  l.liable_person_count,
  r.amount_cents AS rate_cents,
  -- Lets the UI say "no rate set for 2026" instead of quietly showing €0 owed.
  (r.amount_cents IS NULL) AS rate_missing,
  (s.id IS NOT NULL) AS is_settled,
  s.source AS settlement_source,
  -- A settled year is never recomputed: it contributes zero regardless of what
  -- the person records say (SPEC §5.4). This is what makes the legacy notebook
  -- import tractable.
  CASE
    WHEN s.id IS NOT NULL THEN 0::bigint
    ELSE COALESCE(l.liable_person_count::bigint * r.amount_cents, 0::bigint)
  END AS obligation_cents,
  COALESCE(a.allocated_cents, 0::bigint) AS allocated_cents,
  CASE
    WHEN s.id IS NOT NULL THEN 0::bigint
    ELSE COALESCE(l.liable_person_count::bigint * r.amount_cents, 0::bigint)
  END - COALESCE(a.allocated_cents, 0::bigint) AS balance_cents,
  CASE
    WHEN s.id IS NOT NULL THEN 'settled'
    WHEN COALESCE(a.allocated_cents, 0) = 0
     AND COALESCE(l.liable_person_count::bigint * r.amount_cents, 0) > 0 THEN 'unpaid'
    WHEN COALESCE(a.allocated_cents, 0)
       >= COALESCE(l.liable_person_count::bigint * r.amount_cents, 0) THEN 'paid'
    ELSE 'partial'
  END AS status
FROM household_years hy
JOIN liable l ON l.household_id = hy.household_id AND l.year = hy.year
LEFT JOIN rates r ON r.mosque_id = hy.mosque_id AND r.year = hy.year
LEFT JOIN year_settlements s ON s.household_id = hy.household_id AND s.year = hy.year
LEFT JOIN allocated a ON a.household_id = hy.household_id AND a.year = hy.year;
--> statement-breakpoint

-- household_balance = SUM(obligation) - SUM(allocations), with settled years
-- already contributing zero above (SPEC §5.5).
CREATE VIEW v_household_balance AS
SELECT
  mosque_id,
  household_id,
  sum(obligation_cents)::bigint AS total_obligation_cents,
  sum(allocated_cents)::bigint  AS total_allocated_cents,
  sum(balance_cents)::bigint    AS balance_cents,
  -- Drives the arrears list: "households owing >= N years" (SPEC §12).
  count(*) FILTER (WHERE balance_cents > 0)::int AS years_unpaid,
  -- Where FIFO allocation starts (SPEC §5.5).
  min(year) FILTER (WHERE balance_cents > 0) AS oldest_unpaid_year,
  bool_or(rate_missing AND liable_person_count > 0) AS has_missing_rate
FROM v_household_year_obligation
GROUP BY mosque_id, household_id;
