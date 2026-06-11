# Nails by Brittney Website

Public marketing site + full booking and admin management with Supabase + Netlify Functions + Square + Twilio + Resend.

## Twilio inbound commands (current production set)
- `help`
- `list`
- `details 123`
- `yes 123`
- `no 123`
- `status 123`
- `balance 123`
- `charge 123 $85`
- `late 123 [50%]`
- `no show 123 [40%]`
- `refund late 123`
- `refund services 123 [50%]`
- `text 123 message`
- `reply 123 message`
- `block 123`
- `unblock 123`
- `today`, `tomorrow`, `day Friday`
- `find name-or-phone`
- `undo 123`
- `remind 123`

SMS is used for appointment/admin command workflows only. Email is outbound transactional email through Resend; inbound email threading is not part of the current production system.

## Environment variables
Copy `.env.example` to `.env` and set values.

Required core values:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_EMAILS` (required for admin portal access; comma-separated Supabase Auth email addresses)
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_SMS_FROM_NUMBER`
- `BRITTNEY_NOTIFICATION_PHONE`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` (required in production; must be a Resend-verified sender/domain)
- `BOOKING_PUBLIC_BASE_URL=https://nailsbybrittney.com`

Square production values:
- `SQUARE_APPLICATION_ID`
- `SQUARE_LOCATION_ID`
- `SQUARE_ACCESS_TOKEN`
- `SQUARE_API_BASE_URL=https://connect.squareup.com`
- `SQUARE_API_VERSION=2025-10-16`
- `SQUARE_CURRENCY=USD`
- `VITE_SQUARE_APPLICATION_ID`
- `VITE_SQUARE_LOCATION_ID`
- `VITE_SQUARE_ENVIRONMENT=production`
- `VITE_ENABLE_SQUARE_DEV_TOKEN_INPUT=false`

Square sandbox/local testing values only:
- `SQUARE_API_BASE_URL=https://connect.squareupsandbox.com`
- `VITE_SQUARE_ENVIRONMENT=sandbox`
- `SQUARE_ALLOW_MOCK=true` may be used for local mock processing only.

Do not leave sandbox Square values or `SQUARE_ALLOW_MOCK=true` in production, because production card-on-file and payment calls must use Square production credentials and `https://connect.squareup.com`.

Customer-facing booking/status links are generated from `BOOKING_PUBLIC_BASE_URL`. Leave this set to `https://nailsbybrittney.com` in production; if it is missing, invalid, or accidentally set to a Netlify-generated/deploy-preview/internal host, outbound customer communications fall back to the production domain.

## Supabase setup
1. Create a Supabase project.
2. Run `supabase/schema.sql`.
3. Create Storage bucket named `gallery` (public).
4. Create admin auth user in Supabase Auth.
5. Set `ADMIN_EMAILS` to the admin auth user email address(es).

## Twilio setup
1. Buy/configure SMS-capable Twilio number.
2. Set inbound webhook to:
   `https://nailsbybrittney.com/.netlify/functions/twilio-inbound`
3. Set `BRITTNEY_NOTIFICATION_PHONE` to Brittney’s authorized sender number for admin SMS commands.

## Resend setup
1. Create an API key and verified sender/domain in Resend.
2. Add `RESEND_API_KEY` and production-required `RESEND_FROM_EMAIL`.

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
