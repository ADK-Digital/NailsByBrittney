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
  type text not null default 'base' check (type in ('base', 'addon')),
  requires_service_ids uuid[] not null default '{}'::uuid[],
  requires_service_names text[] not null default '{}'::text[],
  active boolean not null default true,
  display_order int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table services add column if not exists type text not null default 'base' check (type in ('base', 'addon'));
alter table services add column if not exists requires_service_ids uuid[] not null default '{}'::uuid[];
alter table services add column if not exists requires_service_names text[] not null default '{}'::text[];

with addon_requirements as (
  select
    addon.id as addon_id,
    coalesce(array_agg(required.id order by required.display_order) filter (where required.id is not null), '{}'::uuid[]) as required_ids
  from services addon
  left join lateral unnest(coalesce(addon.requires_service_names, '{}'::text[])) as req_name(name) on true
  left join services required on required.name = req_name.name
  where addon.type = 'addon'
  group by addon.id
)
update services s
set requires_service_ids = addon_requirements.required_ids
from addon_requirements
where s.id = addon_requirements.addon_id
  and (s.requires_service_ids is null or cardinality(s.requires_service_ids) = 0);

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
  active boolean not null default false,
  check (close_time > open_time)
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

insert into request_counter (singleton, current_value)
values (true, 119)
on conflict (singleton) do nothing;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'appointment_status') then
    create type appointment_status as enum (
      'pending_confirmation',
      'confirmed',
      'declined',
      'expired',
      'cancelled',
      'completed',
      'no_show'
    );
  end if;
end
$$;

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

create or replace function expire_stale_pending_appointments()
returns int
language plpgsql
as $$
declare
  v_count int;
begin
  update appointments
  set status = 'expired',
      updated_at = now()
  where status = 'pending_confirmation'
    and coalesce(confirmation_deadline_at, created_at + interval '48 hours') <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Keep exclusion overlap protection, but stale pending rows are expired first
-- so expired requests do not continue blocking new bookings.
alter table appointments drop constraint if exists appointments_no_overlap;
alter table appointments
  add constraint appointments_no_overlap
  exclude using gist (
    tstzrange(start_at, end_at, '[)') with &&
  )
  where (status in ('pending_confirmation', 'confirmed', 'completed', 'no_show'));

create or replace function normalize_email(p_email text)
returns text
language sql
immutable
as $$
  select lower(btrim(coalesce(p_email, '')))
$$;

create or replace function normalize_phone(p_phone text)
returns text
language sql
immutable
as $$
  select case
    when length(v_digits) = 11 and left(v_digits, 1) = '1' then right(v_digits, 10)
    else v_digits
  end
  from (
    select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as v_digits
  ) s
$$;

create or replace function booking_window_bounds_et()
returns table(window_start_local timestamp, window_end_local timestamp)
language sql
stable
as $$
  with now_et as (
    select now() at time zone 'America/New_York' as ts
  )
  select
    date_trunc('day', ts) - make_interval(days => extract(dow from ts)::int),
    (date_trunc('day', ts) - make_interval(days => extract(dow from ts)::int)) + interval '5 weeks'
  from now_et
$$;

create or replace function next_request_number()
returns int
language plpgsql
as $$
declare
  next_val int;
begin
  update request_counter
  set current_value = case
    when current_value >= 950 then 120
    else current_value + 1
  end
  where singleton = true
  returning current_value into next_val;

  if next_val is null then
    raise exception 'request_counter is not initialized';
  end if;

  return next_val;
end;
$$;

create or replace function match_or_create_customer(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_note text default null
)
returns uuid
language plpgsql
as $$
declare
  v_first_name text := btrim(coalesce(p_first_name, ''));
  v_last_name text := btrim(coalesce(p_last_name, ''));
  v_email text := normalize_email(p_email);
  v_phone text := normalize_phone(p_phone);
  customer_row customers%rowtype;
begin
  if v_first_name = '' or v_last_name = '' then
    raise exception 'First and last name are required';
  end if;

  if v_email = '' then
    raise exception 'Email is required';
  end if;

  if v_phone = '' then
    raise exception 'Phone is required';
  end if;

  -- Identity match requires same first+last with matching email OR matching phone.
  select c.*
  into customer_row
  from customers c
  where lower(c.first_name) = lower(v_first_name)
    and lower(c.last_name) = lower(v_last_name)
    and (
      normalize_email(c.email) = v_email
      or normalize_phone(c.phone) = v_phone
    )
  order by c.updated_at desc
  limit 1;

  if customer_row.id is null then
    insert into customers(first_name, last_name, email, phone)
    values (v_first_name, v_last_name, v_email, v_phone)
    returning * into customer_row;
  else
    update customers
    set email = case when normalize_email(email) <> v_email then v_email else email end,
        phone = case when normalize_phone(phone) <> v_phone then v_phone else phone end,
        updated_at = now()
    where id = customer_row.id
    returning * into customer_row;
  end if;

  -- Notes are append-only history.
  if p_note is not null and btrim(p_note) <> '' then
    insert into customer_notes(customer_id, note_text, source)
    values (customer_row.id, btrim(p_note), 'booking');
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
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing jsonb;
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
  v_start_local timestamp;
  v_end_local timestamp;
  v_dow int;
  v_open_time time;
  v_close_time time;
  v_is_active boolean;
  v_window_start timestamp;
  v_window_end timestamp;
  v_selected_count int;
  v_matched_count int;
begin
  -- Synchronize stale pending rows so overlap checks and exclusion constraint agree.
  perform expire_stale_pending_appointments();

  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'Idempotency key is required';
  end if;

  select jsonb_build_object(
      'appointment_id', id,
      'booking_request_number', booking_request_number,
      'estimated_total_text', estimated_total_text,
      'estimated_total_min', estimated_total_min,
      'total_duration_minutes', total_duration_minutes,
      'idempotent', true
    )
  into existing
  from appointments
  where idempotency_key = p_idempotency_key;

  if existing is not null then
    return existing;
  end if;

  if p_service_ids is null or cardinality(p_service_ids) = 0 then
    raise exception 'At least one service is required';
  end if;

  with selected as (
    select unnest(p_service_ids) as service_id
  )
  select
    count(*),
    count(s.id),
    coalesce(sum(s.duration_minutes), 0),
    coalesce(sum(s.price_min_numeric), 0),
    coalesce(bool_or(s.is_variable_price), false)
  into v_selected_count, v_matched_count, v_total_minutes, v_total_min, v_variable
  from selected x
  left join services s on s.id = x.service_id and s.active = true;

  if v_selected_count <> v_matched_count then
    raise exception 'One or more selected services are invalid or inactive';
  end if;

  if v_total_minutes <= 0 then
    raise exception 'Total duration must be greater than 0';
  end if;

  v_start_local := p_start_at at time zone 'America/New_York';

  if date_part('second', v_start_local) <> 0
     or mod(extract(minute from v_start_local)::int, 15) <> 0 then
    raise exception 'Start time must be on a 15-minute increment';
  end if;

  if p_start_at <= now() then
    raise exception 'Start time must be in the future';
  end if;

  select window_start_local, window_end_local
  into v_window_start, v_window_end
  from booking_window_bounds_et();

  if v_start_local < v_window_start or v_start_local >= v_window_end then
    raise exception 'Requested date is outside the booking window';
  end if;

  v_end_at := p_start_at + make_interval(mins => v_total_minutes);
  v_end_local := v_end_at at time zone 'America/New_York';
  v_dow := extract(dow from v_start_local)::int;

  select bh.open_time, bh.close_time, bh.active
  into v_open_time, v_close_time, v_is_active
  from business_hours bh
  where bh.day_of_week = v_dow;

  if coalesce(v_is_active, false) = false then
    raise exception 'Requested day is not bookable';
  end if;

  if (v_start_local)::date <> (v_end_local)::date then
    raise exception 'Appointment must start and end on the same local day';
  end if;

  if (v_start_local)::time < v_open_time then
    raise exception 'Appointment starts before opening time';
  end if;

  if (v_end_local)::time > v_close_time then
    raise exception 'Appointment ends after closing time';
  end if;

  if exists (
    select 1
    from blocked_times b
    where tstzrange(b.start_at, b.end_at, '[)') && tstzrange(p_start_at, v_end_at, '[)')
  ) then
    raise exception 'Requested time is blocked';
  end if;

  if exists (
    select 1
    from appointments a
    where tstzrange(a.start_at, a.end_at, '[)') && tstzrange(p_start_at, v_end_at, '[)')
      and (
        a.status in ('confirmed', 'completed', 'no_show')
        or (
          a.status = 'pending_confirmation'
          and coalesce(a.confirmation_deadline_at, a.created_at + interval '48 hours') > now()
        )
      )
  ) then
    raise exception 'Requested time overlaps another appointment';
  end if;

  v_customer_id := match_or_create_customer(p_first_name, p_last_name, p_email, p_phone, p_note);
  v_req := next_request_number();
  v_deadline := now() + interval '48 hours';

  v_est_text := case
    when v_variable then 'Estimated total starts at $' || to_char(v_total_min, 'FM9999990.00')
    else 'Estimated total is $' || to_char(v_total_min, 'FM9999990.00')
  end;

  insert into appointments(
    customer_id,
    booking_request_number,
    start_at,
    end_at,
    timezone,
    status,
    estimated_total_min,
    estimated_total_text,
    total_duration_minutes,
    confirmation_deadline_at,
    idempotency_key
  ) values (
    v_customer_id,
    v_req,
    p_start_at,
    v_end_at,
    'America/New_York',
    v_status,
    v_total_min,
    v_est_text,
    v_total_minutes,
    v_deadline,
    p_idempotency_key
  )
  returning id into v_apt_id;

  insert into appointment_services(
    appointment_id,
    service_id,
    service_name_snapshot,
    price_text_snapshot,
    price_min_snapshot,
    duration_minutes_snapshot,
    is_variable_price_snapshot
  )
  select
    v_apt_id,
    s.id,
    s.name,
    s.price_text,
    s.price_min_numeric,
    s.duration_minutes,
    s.is_variable_price
  from unnest(p_service_ids) as selected_id
  join services s on s.id = selected_id;

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
  (0, '09:30', '16:30', true),
  (1, '09:30', '19:30', false),
  (2, '09:30', '19:30', false),
  (3, '09:30', '19:30', false),
  (4, '09:30', '19:30', false),
  (5, '09:30', '19:30', true),
  (6, '09:30', '19:30', true)
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

drop policy if exists "public read services" on services;
drop policy if exists "public read testimonials" on testimonials;
drop policy if exists "public read gallery" on gallery_items;
drop policy if exists "public read business hours" on business_hours;
drop policy if exists "auth manage services" on services;
drop policy if exists "auth manage testimonials" on testimonials;
drop policy if exists "auth manage gallery" on gallery_items;
drop policy if exists "auth manage booking tables" on customers;
drop policy if exists "auth manage notes" on customer_notes;
drop policy if exists "auth manage business hours" on business_hours;
drop policy if exists "auth manage blocked times" on blocked_times;
drop policy if exists "auth manage appointments" on appointments;
drop policy if exists "auth manage appointment services" on appointment_services;

create policy "public read services" on services
  for select
  using (true);

create policy "public read testimonials" on testimonials
  for select
  using (true);

create policy "public read gallery" on gallery_items
  for select
  using (true);

create policy "public read business hours" on business_hours
  for select
  using (true);

create policy "auth manage services" on services
  for all to authenticated
  using (true)
  with check (true);

create policy "auth manage testimonials" on testimonials
  for all to authenticated
  using (true)
  with check (true);

create policy "auth manage gallery" on gallery_items
  for all to authenticated
  using (true)
  with check (true);

create policy "auth manage booking tables" on customers
  for all to authenticated
  using (true)
  with check (true);

create policy "auth manage notes" on customer_notes
  for all to authenticated
  using (true)
  with check (true);

create policy "auth manage business hours" on business_hours
  for all to authenticated
  using (true)
  with check (true);

create policy "auth manage blocked times" on blocked_times
  for all to authenticated
  using (true)
  with check (true);

create policy "auth manage appointments" on appointments
  for all to authenticated
  using (true)
  with check (true);

create policy "auth manage appointment services" on appointment_services
  for all to authenticated
  using (true)
  with check (true);

-- Phase 2: card-on-file + financial event tracking

do $$
begin
  if not exists (select 1 from pg_type where typname = 'communication_preference') then
    create type communication_preference as enum ('sms', 'email', 'both');
  end if;
  if not exists (select 1 from pg_type where typname = 'card_on_file_status') then
    create type card_on_file_status as enum ('missing', 'on_file', 'disabled');
  end if;
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type payment_status as enum ('unpaid', 'paid', 'partially_refunded', 'refunded');
  end if;
  if not exists (select 1 from pg_type where typname = 'financial_event_type') then
    create type financial_event_type as enum ('service_charge', 'late_fee', 'no_show_fee', 'refund_service', 'refund_late', 'refund_no_show');
  end if;
  if not exists (select 1 from pg_type where typname = 'financial_initiator') then
    create type financial_initiator as enum ('dashboard', 'twilio', 'system');
  end if;
end
$$;

alter table customers add column if not exists communication_preference communication_preference not null default 'both';
alter table customers add column if not exists square_customer_id text;
alter table customers add column if not exists square_card_id text;
alter table customers add column if not exists card_brand text;
alter table customers add column if not exists card_last4 text;
alter table customers add column if not exists card_on_file_status card_on_file_status not null default 'missing';

alter table appointments add column if not exists service_payment_status payment_status not null default 'unpaid';
alter table appointments add column if not exists late_fee_status payment_status not null default 'unpaid';
alter table appointments add column if not exists no_show_fee_status payment_status not null default 'unpaid';
alter table appointments add column if not exists policy_acknowledged boolean not null default false;

create table if not exists appointment_financial_events (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  event_type financial_event_type not null,
  amount_cents int not null check (amount_cents > 0),
  percent_basis numeric(5,2),
  processor_reference text,
  status text not null default 'succeeded',
  initiated_by financial_initiator not null,
  note text,
  command_source text,
  idempotency_key text not null unique,
  related_event_id uuid references appointment_financial_events(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_appointment_financial_events_appointment_id on appointment_financial_events(appointment_id);
create index if not exists idx_appointment_financial_events_type on appointment_financial_events(event_type);

create table if not exists appointment_action_audit (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  action_type text not null,
  initiated_by financial_initiator not null default 'system',
  command_text text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_appointment_action_audit_appt on appointment_action_audit(appointment_id, created_at desc);

create or replace function match_or_create_customer(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_note text default null,
  p_communication_preference communication_preference default 'both',
  p_square_customer_id text default null,
  p_square_card_id text default null,
  p_card_brand text default null,
  p_card_last4 text default null
)
returns uuid
language plpgsql
as $$
declare
  v_first_name text := btrim(coalesce(p_first_name, ''));
  v_last_name text := btrim(coalesce(p_last_name, ''));
  v_email text := normalize_email(p_email);
  v_phone text := normalize_phone(p_phone);
  customer_row customers%rowtype;
begin
  if v_first_name = '' or v_last_name = '' then raise exception 'First and last name are required'; end if;
  if v_email = '' then raise exception 'Email is required'; end if;
  if v_phone = '' then raise exception 'Phone is required'; end if;

  select c.* into customer_row
  from customers c
  where lower(c.first_name) = lower(v_first_name)
    and lower(c.last_name) = lower(v_last_name)
    and (normalize_email(c.email) = v_email or normalize_phone(c.phone) = v_phone)
  order by c.updated_at desc
  limit 1;

  if customer_row.id is null then
    insert into customers(first_name, last_name, email, phone, communication_preference, square_customer_id, square_card_id, card_brand, card_last4, card_on_file_status)
    values (v_first_name, v_last_name, v_email, v_phone, p_communication_preference, p_square_customer_id, p_square_card_id, p_card_brand, p_card_last4,
      case when p_square_card_id is null then 'missing'::card_on_file_status else 'on_file'::card_on_file_status end)
    returning * into customer_row;
  else
    update customers
    set email = case when normalize_email(email) <> v_email then v_email else email end,
        phone = case when normalize_phone(phone) <> v_phone then v_phone else phone end,
        communication_preference = coalesce(p_communication_preference, communication_preference),
        square_customer_id = coalesce(p_square_customer_id, square_customer_id),
        square_card_id = coalesce(p_square_card_id, square_card_id),
        card_brand = coalesce(p_card_brand, card_brand),
        card_last4 = coalesce(p_card_last4, card_last4),
        card_on_file_status = case when coalesce(p_square_card_id, square_card_id) is null then card_on_file_status else 'on_file'::card_on_file_status end,
        updated_at = now()
    where id = customer_row.id
    returning * into customer_row;
  end if;

  if p_note is not null and btrim(p_note) <> '' then
    insert into customer_notes(customer_id, note_text, source)
    values (customer_row.id, btrim(p_note), 'booking');
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
  p_idempotency_key text,
  p_communication_preference communication_preference default 'both',
  p_square_customer_id text default null,
  p_square_card_id text default null,
  p_card_brand text default null,
  p_card_last4 text default null,
  p_policy_acknowledged boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing jsonb;
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
  v_start_local timestamp;
  v_end_local timestamp;
  v_dow int;
  v_open_time time;
  v_close_time time;
  v_is_active boolean;
  v_window_start timestamp;
  v_window_end timestamp;
  v_selected_count int;
  v_matched_count int;
begin
  perform expire_stale_pending_appointments();

  if not p_policy_acknowledged then
    raise exception 'Policy acknowledgement is required';
  end if;

  if p_square_card_id is null or btrim(p_square_card_id) = '' then
    raise exception 'Card on file is required';
  end if;

  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'Idempotency key is required'; end if;

  select jsonb_build_object('appointment_id', id, 'booking_request_number', booking_request_number, 'estimated_total_text', estimated_total_text, 'estimated_total_min', estimated_total_min, 'total_duration_minutes', total_duration_minutes, 'idempotent', true)
  into existing from appointments where idempotency_key = p_idempotency_key;
  if existing is not null then return existing; end if;

  if p_service_ids is null or cardinality(p_service_ids) = 0 then raise exception 'At least one service is required'; end if;

  with selected as (select unnest(p_service_ids) as service_id)
  select count(*), count(s.id), coalesce(sum(s.duration_minutes), 0), coalesce(sum(s.price_min_numeric), 0), coalesce(bool_or(s.is_variable_price), false)
  into v_selected_count, v_matched_count, v_total_minutes, v_total_min, v_variable
  from selected x left join services s on s.id = x.service_id and s.active = true;

  if v_selected_count <> v_matched_count then raise exception 'One or more selected services are invalid or inactive'; end if;
  if v_total_minutes <= 0 then raise exception 'Total duration must be greater than 0'; end if;

  v_start_local := p_start_at at time zone 'America/New_York';
  if date_part('second', v_start_local) <> 0 or mod(extract(minute from v_start_local)::int, 15) <> 0 then raise exception 'Start time must be on a 15-minute increment'; end if;
  if p_start_at <= now() then raise exception 'Start time must be in the future'; end if;

  select window_start_local, window_end_local into v_window_start, v_window_end from booking_window_bounds_et();
  if v_start_local < v_window_start or v_start_local >= v_window_end then raise exception 'Requested date is outside the booking window'; end if;

  v_end_at := p_start_at + make_interval(mins => v_total_minutes);
  v_end_local := v_end_at at time zone 'America/New_York';
  v_dow := extract(dow from v_start_local)::int;

  select bh.open_time, bh.close_time, bh.active into v_open_time, v_close_time, v_is_active from business_hours bh where bh.day_of_week = v_dow;
  if coalesce(v_is_active, false) = false then raise exception 'Requested day is not bookable'; end if;
  if (v_start_local)::date <> (v_end_local)::date then raise exception 'Appointment must start and end on the same local day'; end if;
  if (v_start_local)::time < v_open_time then raise exception 'Appointment starts before opening time'; end if;
  if (v_end_local)::time > v_close_time then raise exception 'Appointment ends after closing time'; end if;

  if exists (select 1 from blocked_times b where tstzrange(b.start_at, b.end_at, '[)') && tstzrange(p_start_at, v_end_at, '[)')) then raise exception 'Requested time is blocked'; end if;

  if exists (select 1 from appointments a where tstzrange(a.start_at, a.end_at, '[)') && tstzrange(p_start_at, v_end_at, '[)') and (a.status in ('confirmed', 'completed', 'no_show') or (a.status = 'pending_confirmation' and coalesce(a.confirmation_deadline_at, a.created_at + interval '48 hours') > now()))) then
    raise exception 'Requested time overlaps another appointment';
  end if;

  v_customer_id := match_or_create_customer(p_first_name, p_last_name, p_email, p_phone, p_note, p_communication_preference, p_square_customer_id, p_square_card_id, p_card_brand, p_card_last4);
  v_req := next_request_number();
  v_deadline := now() + interval '48 hours';

  v_est_text := case when v_variable then 'Estimated total starts at $' || to_char(v_total_min, 'FM9999990.00') else 'Estimated total is $' || to_char(v_total_min, 'FM9999990.00') end;

  insert into appointments(customer_id, booking_request_number, start_at, end_at, timezone, status, estimated_total_min, estimated_total_text, total_duration_minutes, confirmation_deadline_at, idempotency_key, policy_acknowledged)
  values (v_customer_id, v_req, p_start_at, v_end_at, 'America/New_York', v_status, v_total_min, v_est_text, v_total_minutes, v_deadline, p_idempotency_key, p_policy_acknowledged)
  returning id into v_apt_id;

  insert into appointment_services(appointment_id, service_id, service_name_snapshot, price_text_snapshot, price_min_snapshot, duration_minutes_snapshot, is_variable_price_snapshot)
  select v_apt_id, s.id, s.name, s.price_text, s.price_min_numeric, s.duration_minutes, s.is_variable_price
  from unnest(p_service_ids) as selected_id
  join services s on s.id = selected_id;

  return jsonb_build_object('appointment_id', v_apt_id, 'booking_request_number', v_req, 'estimated_total_text', v_est_text, 'estimated_total_min', v_total_min, 'total_duration_minutes', v_total_minutes, 'idempotent', false);
end;
$$;

alter table appointment_financial_events enable row level security;
alter table appointment_action_audit enable row level security;

drop policy if exists "auth manage financial events" on appointment_financial_events;
drop policy if exists "auth manage appointment action audit" on appointment_action_audit;

create policy "auth manage financial events" on appointment_financial_events
  for all to authenticated
  using (true)
  with check (true);

create policy "auth manage appointment action audit" on appointment_action_audit
  for all to authenticated
  using (true)
  with check (true);

-- Phase 2 correction pass: enforce cancellation timing + orphaned Square artifact auditing
alter table appointments add column if not exists cancelled_at timestamptz;

create table if not exists booking_intake_audit (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text,
  email text,
  phone text,
  square_customer_id text,
  square_card_id text,
  failure_reason text not null,
  cleanup_attempted boolean not null default false,
  cleanup_succeeded boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function find_matching_customer_identity(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text
)
returns table(customer_id uuid, square_customer_id text, square_card_id text)
language sql
stable
as $$
  select c.id, c.square_customer_id, c.square_card_id
  from customers c
  where lower(c.first_name) = lower(btrim(coalesce(p_first_name, '')))
    and lower(c.last_name) = lower(btrim(coalesce(p_last_name, '')))
    and (
      normalize_email(c.email) = normalize_email(p_email)
      or normalize_phone(c.phone) = normalize_phone(p_phone)
    )
  order by c.updated_at desc
  limit 1
$$;

alter table booking_intake_audit enable row level security;
drop policy if exists "auth manage booking intake audit" on booking_intake_audit;
create policy "auth manage booking intake audit" on booking_intake_audit
  for all to authenticated
  using (true)
  with check (true);
