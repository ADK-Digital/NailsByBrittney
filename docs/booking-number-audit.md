# Booking Request Number Recycling Audit

## Scope examined
- `supabase/schema.sql` (allocator, archival routine, constraints, booking RPCs)
- `netlify/functions/create-booking.js` (public booking entrypoint into RPC)
- `netlify/functions/twilio-inbound.js` and `netlify/functions/_lib/bookingActions.js` (lookup by booking number)

## 1) Current booking-number lifecycle

### Allocation path
`create-booking` calls Supabase RPC `create_booking_request`, and that RPC calls `next_request_number()` before inserting into `appointments`.

- Public booking flow: `netlify/functions/create-booking.js` -> `supabaseAdmin.rpc('create_booking_request', ...)`
- SQL booking RPCs that call allocator:
  - `create_booking_request(...)` (customer-facing)
  - `create_admin_appointment(...)` (admin-created)

### Generator details (`next_request_number()`)
- Reads `request_counter.current_value` with `FOR UPDATE` row lock (singleton row), which serializes concurrent allocators.
- If `current_value >= 999`, it runs `archive_rollover_appointments()` first.
- Seed/roll behavior:
  - `request_counter` initialized at `0`.
  - first allocation is `1` (`current + 1`).
  - wrap logic is `999 -> 1`.
- Collision handling:
  - It tests candidate `next_val` against **unarchived** appointments only (`archived_at is null and booking_request_number = next_val`).
  - If occupied, increments and retries in a loop.
- Retry loop:
  - up to 999 attempts.
  - if no free number found, throws `No reusable booking numbers are available`.

### Effective range in implementation
The actual allocator range is **1..999** (not hardcoded 120..999). Any “120-based” behavior must come from current data state, not allocator configuration.

## 2) Exact rollover/recycling behavior (at/after 999)

When current counter reaches 999:
1. `archive_rollover_appointments()` runs.
2. Then allocator candidate resets to `1`.
3. It linearly scans for first free number among unarchived appointments.

### What archive step does
`archive_rollover_appointments()` selects candidates where:
- `archived_at is null`
- `start_at < now()`
- `status in ('completed','cancelled','declined','no_show','expired')`

Then it:
- builds a CSV snapshot in `appointment_archives`
- sets those appointment rows `archived_at = now()` (soft-archive)

### Critical behaviors
- It **does wrap automatically** (to 1).
- It **does scan for available numbers** (linear probe).
- It **does not overwrite rows**.
- It **does not delete rows** from `appointments` (soft archive only).
- It **can fail** with `No reusable booking numbers are available` if all 999 numbers are currently attached to unarchived appointments.
- Reuse eligibility depends on `archived_at` (allocator only sees unarchived rows), not directly on status.

## 3) Preservation of active/incomplete appointments

### Protection model
Allocator never reuses a number that exists on any `appointments` row where `archived_at is null`, regardless of status.

Because archive routine only archives statuses:
- completed
- cancelled
- declined
- no_show
- expired

it leaves active/incomplete operational rows untouched (still unarchived), including:
- pending_confirmation
- confirmed
- any future no_show not yet `start_at < now()` and archived during rollover
- rows with unpaid service/late/no-show balances (those statuses remain unarchived unless archived by rollover criteria)

Result: active/incomplete appointments are not overwritten, and their numbers are not reused while unarchived.

## 4) Historical record handling when numbers are reused

When recycling occurs:
- historical appointments remain in `appointments` with `archived_at` timestamp (soft archive)
- point-in-time CSV snapshot is stored in `appointment_archives` with source appointment ids
- historical rows are intentionally excluded from operational queries that filter `archived_at is null`

Search/export implications:
- existing RPC export logic (`export_archived_appointments_csv`) exports from `appointment_archives`.
- operational features that query appointment by booking number almost always apply `archived_at is null`, so they target the current live row for that number.

## 5) Constraints / triggers / functions influencing reuse

### Key objects
- `request_counter` table + `request_counter_current_value_check (0..999)`
- `next_request_number()` allocator function
- `archive_rollover_appointments()` archival function
- `appointments.archived_at` soft-archive marker

### Not present
- No DB unique index on `appointments.booking_request_number`
- No partial unique index on `(booking_request_number) where archived_at is null`

The uniqueness guard is procedural (allocator + row lock), not declarative via unique constraint.

## 6) Safety assessment and risk

### What is safe today
- No row overwrite on reuse.
- Active unarchived rows are protected from number reuse.
- Counter row lock prevents two concurrent allocator transactions from assigning same number.
- Explicit exhaustion error prevents silent corruption.

### Real risk observed
- **Configured range mismatch**: implementation is 1..999, not 120..999.
  - If operations expect only 120..999, system behavior does not enforce that.
- **No declarative uniqueness constraint** on active numbers.
  - If any non-standard/manual insert bypasses allocator, duplicate live booking numbers could be created.

## 7) Recommendations (only due to real issues)

1. If business requirement is truly 120..999, enforce it in allocator logic and counter check constraint.
2. Add a defensive unique partial index:
   - `unique (booking_request_number) where archived_at is null`
   This makes active-number uniqueness robust even if future code paths bypass allocator.
