create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_text text not null,
  duration text not null,
  description text not null,
  display_order int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists testimonials (
  id uuid primary key default gen_random_uuid(),
  customer text not null,
  quote text not null,
  display_order int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists gallery_items (
  id uuid primary key default gen_random_uuid(),
  storage_key text not null,
  caption text,
  display_order int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table services enable row level security;
alter table testimonials enable row level security;
alter table gallery_items enable row level security;

create policy "public read services" on services for select using (true);
create policy "public read testimonials" on testimonials for select using (true);
create policy "public read gallery" on gallery_items for select using (true);

create policy "auth manage services" on services for all to authenticated using (true) with check (true);
create policy "auth manage testimonials" on testimonials for all to authenticated using (true) with check (true);
create policy "auth manage gallery" on gallery_items for all to authenticated using (true) with check (true);
