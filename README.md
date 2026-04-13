# Nails by Brittney Website

Single-page public marketing site + `/admin` dashboard for content management using Supabase and Netlify Forms.

## Stack
- React + Vite
- Supabase Auth + Postgres + Storage
- Netlify Forms + Netlify SPA redirects

## Environment variables
Copy `.env.example` to `.env`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_GALLERY_BUCKET` (default `gallery`)

## Supabase setup
1. Create a Supabase project.
2. Run SQL in `supabase/schema.sql`.
3. Create Storage bucket named `gallery` (or match your env var), set it public.
4. In Auth > Users, create the single admin user (Brittney), then use `/admin` to sign in.
5. Seed services/testimonials/gallery rows from the admin UI (the app includes fallback sample records until live data exists).

## Local dev
```bash
npm install
npm run dev
```

## Deploy to Netlify
1. Connect repo in Netlify.
2. Build command: `npm run build`; publish directory: `dist`.
3. Add environment variables in Netlify UI.
4. Keep `netlify.toml` for SPA routing.
5. Form submissions from the Contact section are handled with standard Netlify Forms notifications.

## Notes
- If Supabase env vars are missing, the app runs in demo mode with editable sample data.
- The gallery seeds records for `image0.jpeg`..`image5.jpeg`; upload real files in `/admin` if they are not present in storage.
