# SPEC.md — Mosque Contribution Ledger ("Regjistri i Xhamisë")

> Working spec for Claude Code. Read this file fully before writing code.
> Markers used in this document:
> - `<!-- ASSUMPTION: verify -->` — I inferred this. Confirm with the imam/collector before it hardens.
> - `<!-- OPEN -->` — genuinely undecided. Ask the user before implementing.

---

## 1. Context (read this first — it determines every design choice)

In Kosovo, each village mosque funds itself through an annual per-person contribution.
Households pay a fixed amount **per person per year** (currently **€5**, set centrally by
BIK — *Bashkësia Islame e Kosovës*). Paying keeps the household in good standing for
funeral rites (*janazah*) performed by the imam.

Today this is tracked in a **paper notebook** by a volunteer collector (*arkëtari*), who:
- keeps a line per **head of household** (*kryefamiljari*) with a ✅/❌ per year,
- collects cash — mostly people come to his house or the mosque, sometimes they hand it
  to him in the street,
- hands the month's cash to the imam **at the end of each month**, keeping **10%** of the
  amount collected as his fee,
- issues a **3-part paper receipt**: one copy to the collector, one to the payer, one
  upward to BIK.

**The paper receipt remains the legal record. This app is a mirror and a workflow tool,
not the system of record.** Every payment stores its `receipt_number`.

### Scale
- ~500 households, ~2,000–2,500 persons, one mosque, one village.
- Zero performance concerns. Optimise for correctness, auditability, and offline use.

### Two hard product rules — do not violate

1. **The app must never enforce the burial rule.** No "NOT ELIGIBLE" badge, no blocklist,
   no pre-funeral eligibility check screen. Show the balance; leave enforcement to humans.
   This is currently handled with discretion and a gentle tone, and automating it would
   turn a helpful tool into a resented one.
2. **No member may ever see another member's payment status.** No public debtor lists, no
   village-wide rankings, no shaming surfaces. Members see only their own household.

---

## 2. Scope

### v1 (build this)
Single mosque. Collector + imam manage the ledger. Members can view their own household's
status. Cash only, recorded manually. Offline-capable collector workflow.

### Explicitly out of scope for v1
Online/card payments, SMS gateway, BIK API integration, multi-mosque onboarding UI,
push notifications, prayer times.

### Non-negotiable forward-compat requirements
Even though v1 is one mosque, build these in from the first commit — they are cheap now
and expensive to retrofit:
- `mosque_id` on **every** tenant-scoped table; every query filtered by it.
- All data access behind the **standalone JSON API** — a future Expo native client must
  reuse it verbatim, with no server-rendered or web-only endpoints.
- `receipt_number` on every payment.
- i18n from day one (see §11).

---

## 3. Stack

Two separate deployables: a stateless JSON API and a React SPA. This is deliberate — the
future Expo native client must consume the identical API with zero server changes.
**No rendering logic on the server, ever.**

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript (strict), React Router, TanStack Query |
| Styling | Tailwind + shadcn/ui |
| Backend | Node + Express + TypeScript, Zod for request validation |
| DB | PostgreSQL on Supabase — **EU region** |
| ORM | Drizzle (preferred: keeps you close to SQL, which the ledger views need) |
| Auth | Custom: claim code + phone + PIN, JWT in an httpOnly cookie, argon2id. See §7. |
| Offline | Dexie (IndexedDB) outbox + service worker via `vite-plugin-pwa`. See §9. |
| File storage | Cloudflare R2, private bucket, presigned URLs only. See §8. |
| Money | **Integer cents everywhere.** Never floats, never `numeric` for arithmetic. Column name `*_cents`, type `integer`. |
| Dates | `date` / `timestamptz`. Ledger years are plain `integer` (e.g. `2026`). |

Deployment: API on Railway or Render, SPA on Cloudflare Pages, Postgres on Supabase,
ID photos in Cloudflare R2. All EU region.

Repo layout: `/api`, `/web`, `/shared` (types shared between both — the DTO definitions
live here so the future native client inherits them).

### 3.1 Use what Postgres gives you

The whole reason for choosing Postgres over a document store here is structural safety.
Actually take it — a Postgres schema with no constraints is just a slower Mongo.

1. **Constraints, at the database level:**
   - `FOREIGN KEY` on every reference, `ON DELETE RESTRICT` (never cascade — you do not want
     deleting a household to silently erase its payment history).
   - `CHECK (amount_cents > 0)` on payments and allocations.
   - `CHECK (left_year IS NULL OR left_year >= joined_year)` on persons.
   - `UNIQUE (mosque_id, year)` on rates.
   - `UNIQUE (client_uuid)` on payments — this is what makes offline sync idempotent.
   - `UNIQUE (mosque_id, period_year, period_month)` on batches.
   - `UNIQUE (household_id, year)` on year settlements.
2. **The obligation calculation lives in a view** (§5.3), so nothing in the system can
   compute a balance differently. This is the single biggest reason for this database.
3. **Transactions on every money write.** Recording one payment inserts the payment, its
   allocations, updates the batch total, and writes an audit row. One transaction.
4. **Migrations from commit one** (`drizzle-kit`). Never hand-edit production schema.
5. Enable Supabase's automatic backups, and **test a restore once** before the collector
   starts entering real data.

PWA: installable manifest, service worker, works on Android Chrome offline.

---

## 4. Domain model

### 4.1 Entities

**Mosque** — the tenant. Holds settings: name, village, `ledger_start_year`,
`commission_percent` (default 10), currency (EUR), locale default (`sq`).

**Household** (*familja / shtëpia*) — the billing unit. Has a head of household, a
neighbourhood (*lagja*), a contact phone, free-text notes, and a status.
`status ∈ {active, dissolved}`.

**Person** — a member of a household. **This is where the money is computed.**
Fields: `first_name`, `father_name`, `last_name`, `joined_year`, `left_year`,
`exit_reason`, `is_head`, `lives_abroad`.

> Albanian naming convention is `Emri (Atësia) Mbiemri` — given name, father's name,
> surname. `father_name` is **required**, not optional: in a village with five men named
> Ismet Krasniqi it is the only reliable disambiguator, and the paper receipt already
> uses it.

**Rate** — `(mosque_id, year, amount_cents)`. One row per year.
Set by BIK; editable by the imam. **Never a single global setting** — historical debts
must not change when the rate changes.

**Payment** — a cash payment event: household, date, total amount, `receipt_number`,
`collected_by`, `batch_id`, `note`.

**PaymentAllocation** — how a payment is split across years:
`(payment_id, year, amount_cents)`. This is what makes partial payments work.

**YearSettlement** — marks a `(household, year)` as fully settled **without recomputation**.
Used for legacy notebook import and to freeze historical years. See §5.4.

**CollectionBatch** — one calendar month of collections handed from collector to imam.
Holds gross collected, commission, net, and the imam's confirmation. See §6.

**User** — phone, PIN hash, role, optional linked household.

**AuditLog** — append-only. Every mutation and every ID-photo view.

### 4.1b Table layout

Ten tables. All tenant tables carry `mosque_id`; all carry `created_at` / `updated_at`.

```
mosques           id, name, village, ledger_start_year, commission_percent,
                  currency, default_locale

rates             id, mosque_id, year, amount_cents
                  UNIQUE (mosque_id, year)

households        id, mosque_id, status, neighbourhood, phone, notes,
                  claim_code, claim_code_used_at, deleted_at

persons           id, mosque_id, household_id, first_name, father_name, last_name,
                  joined_year, left_year, entry_reason, exit_reason,
                  is_head, lives_abroad, deleted_at

year_settlements  id, mosque_id, household_id, year, source, note, created_by
                  UNIQUE (household_id, year)                        -- §5.4

payments          id, mosque_id, household_id, batch_id, client_uuid UNIQUE,
                  paid_at, total_cents, receipt_number, collected_by, note

payment_allocations
                  id, payment_id, year, amount_cents

collection_batches                                                    -- §6
users                                                                 -- §4.2
audit_logs        append-only; no UPDATE, no DELETE grant
```

Notes:
- **Obligations are never stored.** They are derived (§5.3) from `persons` + `rates` +
  `year_settlements`. A stored obligation is a second source of truth waiting to diverge.
- `persons` is a real table, not a JSON column — life events, audit entries, and future
  reporting all reference individual people by id.
- `deleted_at` soft-deletes households and persons. Payment history is never deleted.
- Enum-ish columns (`status`, `exit_reason`, `entry_reason`, `role`, batch `status`) as
  Postgres enums or `text` + `CHECK`. Either is fine; be consistent.

### 4.2 Roles

| Role | Can do |
|---|---|
| `super_admin` | Everything, across mosques. (You.) |
| `imam` | Everything within the mosque: households, persons, payments, rates, batch confirmation, reports. |
| `collector` | Households, persons, payments, batch open/close. **Cannot** change rates, **cannot** confirm batches (separation of duties — the collector must not confirm his own handover). |
| `member` | Read-only, own household only. |

Both imam and collector can add/edit/deactivate households and persons — confirmed by the
user.

---

## 5. Business rules — the core of the app

### 5.1 Membership is continuous, never paused

A person is liable for **every year between `joined_year` and `left_year` inclusive**.
There is no "paused" or "temporarily inactive" state. You are in the system or you are not.

```
liable(person, Y)  ⟺  person.joined_year <= Y
                      AND (person.left_year IS NULL OR person.left_year >= Y)
```

<!-- ASSUMPTION: verify -->
A person is liable for the year they enter and the year they leave (both inclusive). I.e.
someone who dies in March 2024 still owes for 2024; a baby born in November 2024 owes for
2024. Confirm with the collector — the alternative (pro-rata, or exclusive on exit) is a
one-line change to the predicate above.

### 5.2 Life events → field changes

| Event | Effect |
|---|---|
| Birth | New person, `joined_year = birth year`. |
| Death (incl. abroad) | `left_year = year of death`, `exit_reason = 'deceased'`. Body returns to the village for rites; household stops paying for them thereafter. |
| Daughter marries out of the village | `left_year = marriage year`, `exit_reason = 'married_out'`. |
| Son marries, bride joins the household | New person, `joined_year = marriage year`, `exit_reason = null`, `entry_reason = 'married_in'`. Household count **+1**. |
| Emigration abroad | **No change.** Set `lives_abroad = true`. They remain fully liable — they still expect burial in the village. This is the single most commonly misunderstood rule; do not add an "abroad" exemption. |
| Son forms his own household in the village | **Household split** operation, §5.6. |

### 5.3 Obligation

```
obligation(household, Y) = count(persons liable in Y) × rate(Y)
```

Computed for every year from `mosque.ledger_start_year` to the current year, **except**
years covered by a `YearSettlement` (§5.4).

Implement as a **SQL view** (`v_household_year_obligation`, plus `v_household_balance`
aggregating it). This is the single source of truth for money owed.

Nothing — not a route handler, not a report, not a React component — computes a balance any
other way. If a screen needs a number, it comes from these views. The point of choosing a
relational database here was to make divergent balances structurally impossible; don't give
that away by reimplementing the arithmetic in TypeScript.

A thin `src/lib/ledger.ts` may wrap the queries and hold the FIFO allocation logic (§5.5),
which is procedural and belongs in application code. It must not recompute obligations.

### 5.4 Legacy import and settled years (important)

You will never have accurate per-person history going back 15 years. You do not need it.

- When importing the notebook: create current persons, and for every year the notebook
  marks ✅, insert a `YearSettlement` row with `source = 'legacy_import'`.
- A settled year is **never recomputed**. Its obligation is closed regardless of what the
  person records say.
- Only **unpaid** years are computed from person data.

This makes migration tractable and prevents a schema change from silently altering
someone's historical balance.

### 5.5 Payments and allocation

- Payments are cash, recorded by collector or imam.
- **Partial payments are allowed** but are the exception. The intended use case: a
  household owing €500 across 10 years pays €100 now and the rest over time.
- Default allocation is **FIFO — oldest unpaid year first**, spilling into the next year
  when a year is fully covered. A year may end up partially allocated; that is valid.
- The allocation must be **visible and overridable** in the UI before saving. The collector
  sometimes knows "this €50 is for 2025 specifically."
- **No discounts, no forgiveness, no bulk rebate** for paying many years at once. If a
  write-off is ever needed, it must be an explicit, audited `adjustment` record with a
  reason and the imam's user id — never a silent recalculation.
- `receipt_number` is required on every payment (matches the paper receipt).

Balance:
```
household_balance = Σ_years obligation(Y) − Σ allocations − Σ settlements
```

### 5.6 Household split / merge

A son marrying and forming his own household is common and must be a first-class operation,
not manual re-entry:
- **Split**: select persons from household A → create household B, move them, set B's head.
  Past obligations stay with A unless explicitly reassigned. Audited as one event.
- **Dissolve**: household status → `dissolved`. Outstanding balance is retained and
  reportable, not deleted. <!-- OPEN --> Who inherits the debt of a dissolved household —
  is it written off, or does it follow the heirs? Ask the imam.

### 5.7 Diaspora households
<!-- OPEN -->
A son who emigrates permanently and starts his own family in Germany — does he become his
own household on the village ledger (still paying, for burial rights), or does he stay a
person inside his father's household? Ask the collector. Model as a household with
`lives_abroad = true` on the head if the former.

---

### 5.8 Golden-case tests (write these before the UI)

The view enforces *one* definition of "owed"; these tests prove it's the *right* one. Write
them first, against a test database seeded per case:

1. Simple household, 4 persons, 3 unpaid years, flat €5 rate → €60.
2. Rate changes mid-history (€5 → €6 in 2028); unpaid years before the change still price
   at €5.
3. Death in 2022 with arrears back to 2016 → liable 2016–2022, nothing after.
4. Baby born 2024 in a household unpaid since 2016 → liable 2024 onward only.
5. Daughter marries out in 2021 → liable through 2021 inclusive.
6. Bride marries in during 2023 → liable from 2023 inclusive; household count +1.
7. Emigrant with `livesAbroad: true` → **fully liable, no exemption.**
8. Legacy `settlement` on 2019 → 2019 contributes €0 regardless of person data.
9. Partial payment of €100 against €500 of arrears → FIFO fills oldest years, one year left
   partially allocated, balance €400.
10. Manual allocation override → payment applied to the specified year, not FIFO.
11. Commission rounding: gross 1,337 cents at 10% → commission 133, net 1,204 (remainder to
    the mosque).
12. Same `clientUuid` submitted twice → one payment, balance unchanged on the replay.

If any of these ever go red, stop and fix before shipping. These are the app.

## 6. Collection batches (the imam's killer feature)

The collector holds cash through the month and hands it to the imam at month end, keeping
10%. This is currently entirely trust-based and undocumented. Making it auditable is
probably the highest-value feature in the app.

```
CollectionBatch
  mosque_id, period_year, period_month
  status ∈ {open, closed, confirmed}
  gross_collected_cents      -- Σ payments in period
  commission_percent          -- snapshot of mosque setting at close time
  commission_cents            -- round(gross × pct), see rounding rule
  net_to_mosque_cents         -- gross − commission
  closed_by, closed_at
  confirmed_by, confirmed_at  -- imam only
  discrepancy_cents, discrepancy_note  -- if cash counted ≠ system total
```

Flow:
1. Every payment auto-attaches to the mosque's currently `open` batch for its month.
2. Collector reviews the month, taps **Close batch**. Batch becomes read-only; system shows
   gross / commission / net.
3. Imam opens the batch, counts the cash, taps **Confirm received**. Optionally records a
   discrepancy with a note.
4. A confirmed batch can only be reopened by the imam, and reopening is audited.

Rules:
- The collector **cannot** confirm a batch he closed. Separation of duties.
- `commission_percent` is snapshotted onto the batch at close time — if BIK changes the
  percentage later, historical batches must not move.
- Rounding: commission = `floor(gross_cents × pct / 100)`; remainder goes to the mosque.
  Document this on the batch detail screen so nobody has to guess.

---

## 7. Authentication & registration

**Do not use SMS OTP in v1.** It costs money per message and requires a payment
relationship with a gateway before you have a single user. Use the process that already
exists in the village instead.

### Member registration flow
1. Collector/imam generates a **claim code** for a household (short, unambiguous:
   8 chars, no `0/O/1/I/l`). It prints on the receipt or is written on a slip during the
   collector's normal rounds.
2. Member opens the web app → enters claim code + their phone number → sets a 6-digit PIN.
3. **Optional** step: upload a photo of their ID card (§8).
4. The registration lands in a **pending approvals** queue.
5. Collector or imam approves or rejects. On approval the account is linked to the
   household and activated.

Login = phone + PIN. Rate-limit hard (5 attempts, then a 15-minute lockout). PIN hashed
with argon2id. Sessions: httpOnly cookie, 30-day sliding expiry.

Staff accounts (imam, collector) are created manually by `super_admin` — no self-signup.

<!-- ASSUMPTION: verify -->
Households where nobody has a smartphone simply never register. That is fine — the app must
be fully usable by the collector alone. **The member app is optional; the collector app is
not.** Do not build any workflow that breaks if zero members register.

---

## 8. ID photo handling (build carefully or not at all)

The user chose: collect an ID photo, human review, delete after approval.
Kosovo's Law No. 06/L-082 on Protection of Personal Data is GDPR-aligned and enforced by
the Information and Privacy Agency. Implement all of the following:

- Image goes to a **private bucket**. Never into a Postgres column. Never a public URL.
  Access exclusively via short-lived (≤5 min) signed URLs.
- **Delete on decision.** On approve or reject, the object is deleted. Hard delete, not a
  flag.
- **TTL sweep**: a scheduled job deletes any pending ID image older than 7 days and
  auto-rejects the registration.
- Store **nothing** extracted from the document. No ID number, no scan text. The only
  persisted output is `identity_verified: boolean` plus `reviewed_by` and `reviewed_at`.
- Viewable **one at a time** by imam/collector only. No gallery, no bulk view, no download.
- **Every view writes an audit log row** (`actor`, `subject`, `timestamp`).
- Upload is **optional**. The claim-code path alone is sufficient for approval — older
  villagers will not manage a clean ID photo and must not be blocked.
- A short privacy notice in Albanian at the upload step: what is collected, why, who sees
  it, how long it is kept (until review, max 7 days), and how to request deletion.

No OCR, no face matching, no third-party verification vendor in v1.

---

## 9. Offline support (collector app only)

The collector records payments while walking around the village, sometimes in courtyards
with poor signal. Offline is a requirement, not a nice-to-have.

- Cache the full household + person + balance list locally (≈500 households — trivial size).
- Payment creation writes to an **IndexedDB outbox** with a client-generated UUID and
  syncs when online.
- The server accepts the client UUID as an **idempotency key** — replaying a sync must
  never create a duplicate payment.
- The UI shows an unmistakable **"N payments waiting to sync"** banner. The collector must
  never be in doubt about whether money is recorded.
- Conflict policy: payments are append-only and effectively conflict-free. Household/person
  *edits* made offline use last-write-wins with a warning; keep the surface small by making
  offline edits read-mostly — offline should support **recording payments and looking up
  balances**, nothing more.
- Receipt numbers come from the paper book, so they are entered by hand and can be entered
  offline. Flag duplicates on sync rather than blocking.

---

## 10. Screens

### Collector / imam
- **Dashboard** — collected this month, current batch status, count of households in
  arrears, pending approvals badge.
- **Household list** — search by name, father's name, or neighbourhood; filter by
  balance owed, years unpaid, neighbourhood; sort by amount owed. This is the screen the
  collector lives in — make search instant and typo-tolerant (Albanian diacritics: a search
  for `Krasniqi` must match `Krasniqi`, and `Berisha` must match `Bërisha`).
- **Household detail** — persons with join/leave years, year-by-year grid (paid / partial /
  unpaid) with amounts, payment history, notes, actions (record payment, add person, mark
  life event, split household, generate claim code).
- **Record payment** — household, amount, date, receipt number, auto-allocation preview
  (editable), note. Must work offline.
- **Batches** — list by month; detail with gross/commission/net; close (collector),
  confirm (imam).
- **Approvals** — pending member registrations, with the ID photo view if uploaded.
- **Rates** — year → amount table. Imam only.
- **Reports** — see §12.
- **Audit log** — imam and super_admin only.

### Member
- **My household** — the year grid, amount owed, payment history with receipt numbers.
- **My details** — read-only household composition, phone update request.

Nothing else. In particular, no comparison to other households, ever.

---

## 11. Localisation

- **Albanian (`sq`) is the default and the primary language.** English (`en`) secondary.
- All UI strings in message catalogs from the first commit — no hardcoded strings, not even
  during prototyping.
- Domain terms in the UI use the words people actually use: *xhamia*, *arkëtari*,
  *kryefamiljari*, *lagja*, *anëtarësia*. Keep the **code** in English (`household`,
  `collector`) and the **UI** in Albanian.
- Currency `€`, `de-DE`-style number formatting (`1.234,50`), dates `dd.MM.yyyy`.
- Ledger years are **calendar years**, confirmed. (Hijri display is a possible later
  nicety, never the accounting basis.)

---

## 12. Reports

**Priority 1 — the BIK/KBI report.**
The existing paper format contains: name (father's name) surname, year of payment, amount,
and the signature of the imam or collector.
<!-- OPEN --> The user will send a photo of the actual form. Until then, build a generic
exportable table with exactly those columns plus a signature line, PDF and XLSX output.
Auto-generating this form is a large, concrete win — prioritise it once the format is known.

Also:
- Monthly batch statement (gross, commission, net, payment list) — PDF, for the handover.
- Arrears list for the collector's rounds: households owing ≥ N years, grouped by
  neighbourhood, sorted by amount. **This screen is for the collector's own use only and
  must never be shareable or exportable to a group chat.**
- Annual summary: expected vs collected, collection rate, per-neighbourhood breakdown.

---

## 13. Security & privacy baseline

- Every query scoped by `mosque_id`, enforced in a shared repository layer rather than
  per-handler. One forgotten filter is a cross-tenant leak.
- Validate every request body and query param with Zod before it reaches the data layer.
  Drizzle parameterises queries, so injection isn't the risk — malformed or out-of-range
  values reaching the ledger is.
- Role checks server-side on every route. Never trust the client.
- Members can only ever read their own `household_id` — write an explicit test for this.
- Audit log is append-only: no UPDATE, no DELETE. Capture actor, action, entity, before,
  after, timestamp, IP.
- Soft-delete households and persons (`deleted_at`); hard-delete only ID photos.
- Nightly automated DB backup with a documented, actually-tested restore procedure. This is
  someone's money record — an untested backup is not a backup.
- A written privacy notice in Albanian, linked in the footer.

---

## 14. Build order

**Phase 0 — foundation**
Repo layout (`/api`, `/web`, `/shared`), Drizzle schema + migrations + all constraints from
§3.1, seed script, the obligation views (§5.3) with the §5.8 tests green, tenancy-scoped
repository layer, audit log, i18n scaffolding, auth.

Get the schema, the constraints, and the views right before writing a single screen.
Everything downstream assumes they're correct.

**Phase 1 — the ledger (this is the MVP)**
Households, persons, life events, rates, obligation view, payments with allocation, legacy
import (CSV/manual entry of the notebook), household detail with the year grid.
*Ship this to the collector and let him run it in parallel with the notebook for one month.*

**Phase 2 — collector workflow**
Offline outbox, arrears list, batches with close/confirm, monthly statement PDF.

**Phase 3 — members**
Claim codes, registration, approvals queue, ID photo pipeline, member views.

**Phase 4 — reports**
BIK form generation once the format is known, annual summary, exports.

**Later (not now)**
Native Expo client, multi-mosque onboarding, SMS/Viber reminders (soft tone, opt-in,
configurable), online/card payments for the diaspora, funeral announcements, prayer times,
mosque expense transparency ledger.

---

## 15. Data migration reality check

The notebook is the hardest part of this project and it is not a coding problem.

- ~500 households × ~15 years of ✅/❌ is thousands of data points, transcribed by hand
  from handwriting.
- Build a **fast keyboard-driven bulk entry screen** before you need it: household name →
  member names → tick the paid years → next. Optimise for the person doing 500 of these.
- Accept a CSV import path too, in case someone wants to prep it in a spreadsheet.
- Run **parallel for at least one month** — notebook and app both — and reconcile before
  trusting the app.
- Expect the notebook to contain contradictions. Build an "unclear / needs review" flag on
  households rather than forcing a decision at entry time.

---

## 16. Open questions to resolve with the imam and collector

1. Is a person liable for the year they die / are born? (§5.1)
2. What happens to the debt of a dissolved household? (§5.6)
3. Do permanently emigrated sons become their own households on the ledger? (§5.7)
4. Exact BIK/KBI report format — photo pending. (§12)
5. Is there any hardship exemption in practice, even informal? If yes it needs an audited
   `exemption` record, not an off-books adjustment.
6. Does the imam want the collector to see the batch commission figures before he confirms?
   (Default: yes, full transparency both ways.)
