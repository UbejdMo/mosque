# Regjistri i Xhamisë — Mosque Contribution Ledger

Annual per-person contribution ledger for a village mosque in Kosovo. Replaces the
collector's paper notebook with an auditable, offline-capable app.

**The paper receipt remains the legal record.** This app mirrors it. Every payment stores
its `receipt_number`.

See [SPEC.md](SPEC.md) for the full specification — read it before changing anything.

## Two rules that override everything else

1. The app **never** enforces the burial rule. It shows balances; humans decide.
2. **No member ever sees another member's payment status.** No debtor lists, no rankings.

## Layout

| Path | What |
|---|---|
| `shared/` | Types, enums and money helpers shared by every client |
| `api/` | Node + Express JSON API — no rendering logic, ever |
| `web/` | React + Vite SPA (PWA, offline collector workflow) |

The API is standalone so a future Expo native client can consume it verbatim.

## Getting started

```bash
npm install
npm run build --workspace shared   # api and web import shared's build output
```

## Conventions

- Money is **integer cents** (`*_cents`, `integer`). Never floats.
- Ledger years are plain integers (`2026`), calendar years.
- Obligations are **derived in SQL views**, never stored, never recomputed in TypeScript.
- Code in English, UI in Albanian (`sq` default, `en` secondary).
