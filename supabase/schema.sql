create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  price_text text not null,
  price_min_numeric numeric(10,2) not null default 0,
  duration text not null default '30 min',
  duration_minutes int not null default 30 check (duration_minutes > 0),
  is_variable_price boolean not null default false,
  active boolean not null default true,
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

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists customer_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  note_text text not null,
  source text not null default 'booking',
  created_at timestamptz not null default now()
);

create table if not exists business_hours (
  id uuid primary key default gen_random_uuid(),
  day_of_week int not null unique check (day_of_week between 0 and 6),
  open_time time not null,
  close_time time not null,
  active boolean not null default false
);

create table if not exists blocked_times (
  id uuid primary key default gen_random_uuid(),
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);

create table if not exists request_counter (
  singleton boolean primary key default true,
  current_value int not null default 119,
  check (current_value between 119 and 950)
);
insert into request_counter (singleton, current_value) values (true, 119)
on conflict (singleton) do nothing;

create type appointment_status as enum ('pending_confirmation','confirmed','declined','expired','cancelled','completed','no_show');

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  booking_request_number int not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null default 'America/New_York',
  status appointment_status not null,
  estimated_total_min numeric(10,2) not null,
  estimated_total_text text not null,
  total_duration_minutes int not null,
  confirmation_deadline_at timestamptz,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);

create table if not exists appointment_services (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  service_id uuid,
  service_name_snapshot text not null,
  price_text_snapshot text not null,
  price_min_snapshot numeric(10,2) not null,
  duration_minutes_snapshot int not null,
  is_variable_price_snapshot boolean not null default false
);

alter table appointments
  add constraint appointments_no_overlap
  exclude using gist (
    tstzrange(start_at, end_at, '[)') with &&
  ) where (status in ('pending_confirmation','confirmed','completed','no_show'));

create or replace function next_request_number() returns int language plpgsql as $$
declare next_val int;
begin
  update request_counter
  set current_value = case when current_value >= 950 then 120 else current_value + 1 end
  where singleton = true
  returning current_value into next_val;
  return next_val;
end;
$$;

create or replace function match_or_create_customer(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_note text default null
) returns uuid language plpgsql as $$
declare customer_row customers%rowtype;
begin
  select * into customer_row
  from customers
  where lower(first_name) = lower(p_first_name)
    and lower(last_name) = lower(p_last_name)
    and (lower(email) = lower(p_email) or phone = p_phone)
  order by updated_at desc
  limit 1;

  if customer_row.id is null then
    insert into customers(first_name,last_name,email,phone)
    values (p_first_name,p_last_name,lower(p_email),p_phone)
    returning * into customer_row;
  else
    update customers
      set email = lower(p_email),
          phone = p_phone,
          updated_at = now()
      where id = customer_row.id
      returning * into customer_row;
  end if;

  if p_note is not null and btrim(p_note) <> '' then
    insert into customer_notes(customer_id, note_text, source)
    values(customer_row.id, p_note, 'booking');
  end if;

  return customer_row.id;
end;
$$;

create or replace function create_booking_request(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_note text,
  p_service_ids uuid[],
  p_start_at timestamptz,
  p_idempotency_key text
) returns jsonb language plpgsql as $$
declare
  v_customer_id uuid;
  v_total_minutes int;
  v_total_min numeric(10,2);
  v_variable boolean;
  v_end_at timestamptz;
  v_deadline timestamptz;
  v_req int;
  v_status appointment_status := 'pending_confirmation';
  v_apt_id uuid;
  v_est_text text;
  existing jsonb;
begin
  select jsonb_build_object('appointment_id', id, 'booking_request_number', booking_request_number)
  into existing
  from appointments
  where idempotency_key = p_idempotency_key;

  if existing is not null then
    return existing || jsonb_build_object('idempotent', true);
  end if;

  select coalesce(sum(duration_minutes),0), coalesce(sum(price_min_numeric),0), bool_or(is_variable_price)
  into v_total_minutes, v_total_min, v_variable
  from services
  where id = any(p_service_ids) and active = true;

  if v_total_minutes <= 0 then
    raise exception 'No valid services selected';
  end if;

  v_end_at := p_start_at + make_interval(mins => v_total_minutes);
  v_deadline := now() + interval '48 hours';

  if exists (
    select 1 from blocked_times b
    where tstzrange(b.start_at, b.end_at, '[)') && tstzrange(p_start_at, v_end_at, '[)')
  ) then
    raise exception 'Requested time is blocked';
  end if;

  v_customer_id := match_or_create_customer(p_first_name, p_last_name, p_email, p_phone, p_note);
  v_req := next_request_number();
  v_est_text := case when v_variable then 'Estimated total starts at $' || to_char(v_total_min, 'FM9999990.00') else 'Estimated total is $' || to_char(v_total_min, 'FM9999990.00') end;

  insert into appointments(
    customer_id, booking_request_number, start_at, end_at, status,
    estimated_total_min, estimated_total_text, total_duration_minutes,
    confirmation_deadline_at, idempotency_key
  ) values (
    v_customer_id, v_req, p_start_at, v_end_at, v_status,
    v_total_min, v_est_text, v_total_minutes,
    v_deadline, p_idempotency_key
  ) returning id into v_apt_id;

  insert into appointment_services(
    appointment_id, service_id, service_name_snapshot, price_text_snapshot,
    price_min_snapshot, duration_minutes_snapshot, is_variable_price_snapshot
  )
  select v_apt_id, s.id, s.name, s.price_text, s.price_min_numeric, s.duration_minutes, s.is_variable_price
  from services s
  where s.id = any(p_service_ids);

  return jsonb_build_object(
    'appointment_id', v_apt_id,
    'booking_request_number', v_req,
    'estimated_total_text', v_est_text,
    'estimated_total_min', v_total_min,
    'total_duration_minutes', v_total_minutes,
    'idempotent', false
  );
end;
$$;

insert into business_hours (day_of_week, open_time, close_time, active)
values
  (0, '08:00', '16:30', true),
  (1, '08:00', '18:00', false),
  (2, '08:00', '18:00', false),
  (3, '08:00', '18:00', false),
  (4, '08:00', '18:00', false),
  (5, '08:00', '19:30', true),
  (6, '08:00', '19:30', true)
on conflict (day_of_week) do update
set open_time = excluded.open_time,
    close_time = excluded.close_time,
    active = excluded.active;

alter table services enable row level security;
alter table testimonials enable row level security;
alter table gallery_items enable row level security;
alter table customers enable row level security;
alter table customer_notes enable row level security;
alter table business_hours enable row level security;
alter table blocked_times enable row level security;
alter table appointments enable row level security;
alter table appointment_services enable row level security;

create policy if not exists "public read services" on services for select using (true);
create policy if not exists "public read testimonials" on testimonials for select using (true);
create policy if not exists "public read gallery" on gallery_items for select using (true);

create policy if not exists "auth manage services" on services for all to authenticated using (true) with check (true);
create policy if not exists "auth manage testimonials" on testimonials for all to authenticated using (true) with check (true);
create policy if not exists "auth manage gallery" on gallery_items for all to authenticated using (true) with check (true);
create policy if not exists "auth manage booking tables" on customers for all to authenticated using (true) with check (true);
create policy if not exists "auth manage notes" on customer_notes for all to authenticated using (true) with check (true);
create policy if not exists "auth manage business hours" on business_hours for all to authenticated using (true) with check (true);
create policy if not exists "auth manage blocked times" on blocked_times for all to authenticated using (true) with check (true);
create policy if not exists "auth manage appointments" on appointments for all to authenticated using (true) with check (true);
create policy if not exists "auth manage appointment services" on appointment_services for all to authenticated using (true) with check (true);
