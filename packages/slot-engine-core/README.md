# `@reset/slot-engine-core`

The availability and station-assignment engine. Everything here is a pure function over
plain data — no clock, no database, no cache, no environment. Design rationale lives in
[docs/05 — Slot & Station Engine](../../docs/05-slot-station-engine.md).

## Usage

```ts
import { computeAvailability, assignStation } from '@reset/slot-engine-core';

const { slots } = computeAvailability(input);
// → [{ startsAt, endsAt, stationsAvailable }, …]   — no station identity, ever

const assignment = assignStation(input, chosenStartInstant);
// → { stationId, startsAt, endsAt, blockedUntil } | null
```

`blockedUntil` is what goes into `bookings.blocked_until`, and it is the value the Postgres
exclusion constraint ranges over.

## Contract

| Guarantee | Where it is enforced |
|---|---|
| A time is only offered if the **full** session duration fits | This package |
| The buffer is respected in both directions | This package |
| Station designation and allocation rules are honoured | This package |
| Assignment is deterministic and best-fit | This package |
| **Two bookings never overlap on a station** | **Postgres**, via `EXCLUDE USING gist` |

That last row is deliberate. This package decides which station is *optimal*; the database
decides whether a booking is *legal*. Application logic can be raced, retried or refactored;
the constraint cannot be bypassed.

## Inputs are pre-resolved

The engine does no timezone arithmetic. Store hours, blackouts and allocation-rule windows
arrive as absolute instants (epoch ms), resolved for the requested date by the caller. That
is what keeps this package free of a date library and exhaustively testable.

## Tests

```bash
pnpm test
```

| File | Covers |
|---|---|
| `proposal-example.spec.ts` | The signed proposal's 9:15 worked example, as an executable contract |
| `duration-awareness.spec.ts` | A 20-min gap offers Head, refuses Full Body |
| `allocation-rules.spec.ts` | The morning ₹199 push, spillover across the window edge, rule priority |
| `station-designation.spec.ts` | The corner chair |
| `buffer.spec.ts` | Both directions, overrides, zero buffer |
| `store-hours.spec.ts` | Closing time, split hours, blackouts, lead time, grid |
| `assign-station.spec.ts` | Best-fit packing and deterministic tie-breaks |
| `interval.spec.ts` | Half-open interval arithmetic |
| `properties.spec.ts` | ~1,100 randomised trading days asserting the invariants hold for inputs nobody thought of |

`properties.spec.ts` is the one that matters most. It simulates whole days — book a slot the
engine offered, feed it back as busy time, repeat — then asserts no station is ever
double-booked, no service ever lands on a station forbidden to it, no session escapes store
hours, and identical inputs always produce identical output.
