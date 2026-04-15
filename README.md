# Nails by Brittney Website

Public marketing site + full booking and admin management with Supabase + Netlify Functions + Twilio + Resend.

## What was added in Phase 2
- Card-on-file booking flow scaffolded for Square (card is required; no charge at booking time) with a clearly labeled developer placeholder input hidden by default outside dev mode.
- Customer communication preferences (`sms`, `email`, `both`) with preference-aware customer notifications.
- Shared appointment action layer for Twilio + dashboard to keep status/charges/refunds synchronized.
- Manual financial operations for service charges, late fees, no-show fees, and refunds.
- Financial event ledger + action audit tables in Supabase.
- Richer admin appointment cards with status/payment/card visibility and action buttons.
- Expanded Twilio parser commands:
  - `yes 123`, `no 123`, `status 123`
  - `late 123`, `late 123 50%`
  - `no show 123`, `no show 123 40%`
  - `charge 123 $85`
  - `refund late 123`
  - `refund no show 123`
  - `refund services 123`
  - `refund services 123 50%`

## Environment variables
Copy `.env.example` to `.env` and set values.

Required core values:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_ENABLE_SQUARE_DEV_TOKEN_INPUT` (optional, default false; developer placeholder control)
- `SUPABASE_SERVICE_ROLE_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `BRITTNEY_NOTIFICATION_PHONE`
- `RESEND_API_KEY`
- `BOOKING_PUBLIC_BASE_URL`

Square values:
- `SQUARE_APPLICATION_ID`
- `SQUARE_LOCATION_ID`
- `SQUARE_ACCESS_TOKEN`
- `SQUARE_API_BASE_URL` (default `https://connect.squareup.com`)
- `SQUARE_API_VERSION` (default `2025-10-16`)
- `SQUARE_CURRENCY` (default `USD`)
- `SQUARE_ALLOW_MOCK` (`true` for local mock processing)

## Supabase setup
1. Create a Supabase project.
2. Run `supabase/schema.sql`.
3. Create Storage bucket named `gallery` (public).
4. Create admin auth user in Supabase Auth.

## Twilio setup
1. Buy/configure SMS-capable Twilio number.
2. Set inbound webhook to:
   `https://<your-site>/.netlify/functions/twilio-inbound`
3. Set `BRITTNEY_NOTIFICATION_PHONE` to Brittney’s authorized sender number.

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
