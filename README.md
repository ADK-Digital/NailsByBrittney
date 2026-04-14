# Nails by Brittney Website

Public marketing site + full booking and admin management with Supabase + Netlify Functions + Twilio + Resend.

## What was added
- Real public scheduler (service bundle selection, availability calendar, time slots, pending request submission).
- Customer matching and note history model.
- Appointment lifecycle (pending, confirmed, declined, expired, cancelled, completed, no_show).
- Admin appointment/customer/blocked-time management.
- Twilio outbound/inbound SMS flow for Brittney confirmation by reply (`yes #` / `no #`).
- Resend transactional emails for confirmed/declined/expired.
- Scheduled expiration cleanup (every 15 minutes).

## Environment variables
Copy `.env.example` to `.env` and set all values.

Required:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `BRITTNEY_NOTIFICATION_PHONE`
- `RESEND_API_KEY`
- `BOOKING_PUBLIC_BASE_URL`
- `VITE_SUPABASE_GALLERY_BUCKET` (default `gallery`)

## Supabase setup
1. Create a Supabase project.
2. Run `supabase/schema.sql`.
3. Create Storage bucket named `gallery` (public).
4. Create admin auth user in Supabase Auth.

## Twilio setup
1. Buy/configure SMS-capable Twilio number.
2. Set inbound webhook to:
   `https://<your-site>/.netlify/functions/twilio-inbound`
3. Add env vars listed above.

## Resend setup
1. Create an API key and verified sender/domain in Resend.
2. Add `RESEND_API_KEY` (and optional `RESEND_FROM_EMAIL`).

## Local dev
```bash
npm install
npm run dev
```

## Netlify
- Build command: `npm run build`
- Publish directory: `dist`
- Functions directory: `netlify/functions`
- Scheduled function: `expire-pending` (every 15 minutes)

## Verification checklist
Core business rules are implemented in DB constraints/functions plus serverless handlers for:
- Fri/Sat/Sun-only availability via `business_hours` seed rows.
- Hard close-time fit checking by duration.
- 15-minute increments in availability endpoint.
- Idempotency key uniqueness on appointments.
- Concurrency protection via exclusion constraint + transactional booking function.
- Request numbers cycling 120–950 via `request_counter` + `next_request_number()`.
- Historical service snapshots in `appointment_services`.
