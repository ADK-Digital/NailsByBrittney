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
alter table services add column if not exists active boolean not null default true;

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

create table if not exists additional_availability (
  id uuid primary key default gen_random_uuid(),
  start_at timestamptz not null,
  end_at timestamptz not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);

create table if not exists request_counter (
  singleton boolean primary key default true,
  current_value int not null default 0,
  check (current_value between 0 and 999)
);

alter table request_counter alter column current_value set default 0;
alter table request_counter drop constraint if exists request_counter_current_value_check;
alter table request_counter add constraint request_counter_current_value_check check (current_value between 0 and 999);

insert into request_counter (singleton, current_value)
values (true, 0)
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
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);

alter table appointments add column if not exists archived_at timestamptz;


create table if not exists client_messages (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  direction text not null check (direction in ('customer_to_admin', 'admin_to_customer')),
  channel text not null default 'sms' check (channel in ('sms', 'email', 'both', 'none', 'unknown')),
  body text not null,
  source text not null default 'dashboard',
  status text not null default 'sent',
  created_at timestamptz not null default now()
);

create index if not exists idx_client_messages_customer_created on client_messages(customer_id, created_at desc);
create index if not exists idx_client_messages_appointment_created on client_messages(appointment_id, created_at desc);


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
  where archived_at is null
    and status = 'pending_confirmation'
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
  where (archived_at is null and status in ('pending_confirmation', 'confirmed', 'completed', 'no_show'));

create unique index if not exists idx_appointments_active_booking_request_number_unique
on appointments (booking_request_number)
where archived_at is null;

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
    date_trunc('day', ts),
    date_trunc('day', ts) + interval '90 days'
  from now_et
$$;


create table if not exists appointment_archives (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  first_appointment_date date not null,
  last_appointment_date date not null,
  appointment_count int not null,
  csv_content text not null,
  source_appointment_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now()
);

alter table appointment_archives add column if not exists source_appointment_ids uuid[] not null default '{}'::uuid[];
create unique index if not exists appointment_archives_file_name_key on appointment_archives(file_name);

create or replace function csv_cell(value text)
returns text
language sql
immutable
as $$
  select '"' || replace(coalesce(value, ''), '"', '""') || '"'
$$;

create or replace function archive_rollover_appointments()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_date date;
  v_last_date date;
  v_file_name text;
  v_csv text;
  v_count int;
  v_candidate_ids uuid[];
  v_archive_id uuid;
begin
  with candidates as (
    select id, start_at, booking_request_number
    from appointments
    where archived_at is null
      and start_at < now()
      and status in ('completed', 'cancelled', 'declined', 'no_show', 'expired')
    order by start_at, booking_request_number, id
    for update
  )
  select min((start_at at time zone 'America/New_York')::date),
         max((start_at at time zone 'America/New_York')::date),
         count(*),
         coalesce(array_agg(id order by start_at, booking_request_number, id), '{}'::uuid[])
  into v_first_date, v_last_date, v_count, v_candidate_ids
  from candidates;

  if coalesce(v_count, 0) = 0 then
    return 0;
  end if;

  v_file_name := 'appointments_' || to_char(v_first_date, 'MMDDYYYY') || '_' || to_char(v_last_date, 'MMDDYYYY') || '.csv';

  with rows as (
    select
      a.id,
      (a.start_at at time zone 'America/New_York')::date as appointment_date,
      a.start_at,
      a.end_at,
      a.booking_request_number,
      a.status::text as status,
      c.first_name,
      c.last_name,
      c.email,
      c.phone,
      a.estimated_total_text,
      a.total_duration_minutes,
      coalesce(a.service_payment_status::text, '') as service_payment_status,
      coalesce(a.late_fee_status::text, '') as late_fee_status,
      coalesce(a.no_show_fee_status::text, '') as no_show_fee_status,
      coalesce((select string_agg(aps.service_name_snapshot, '; ' order by aps.service_name_snapshot) from appointment_services aps where aps.appointment_id = a.id), '') as services
    from appointments a
    join customers c on c.id = a.customer_id
    where a.id = any(v_candidate_ids)
    order by a.start_at, a.booking_request_number, a.id
  ), csv_lines as (
    select string_agg(
      csv_cell(id::text) || ',' ||
      csv_cell(lpad(booking_request_number::text, 3, '0')) || ',' ||
      csv_cell(to_char(start_at at time zone 'America/New_York', 'YYYY-MM-DD HH24:MI')) || ',' ||
      csv_cell(to_char(end_at at time zone 'America/New_York', 'YYYY-MM-DD HH24:MI')) || ',' ||
      csv_cell(status) || ',' ||
      csv_cell(first_name) || ',' ||
      csv_cell(last_name) || ',' ||
      csv_cell(email) || ',' ||
      csv_cell(phone) || ',' ||
      csv_cell(services) || ',' ||
      csv_cell(estimated_total_text) || ',' ||
      csv_cell(total_duration_minutes::text) || ',' ||
      csv_cell(service_payment_status) || ',' ||
      csv_cell(late_fee_status) || ',' ||
      csv_cell(no_show_fee_status),
      E'\n'
    ) as body
    from rows
  )
  select 'appointment_id,booking_number,start_at_et,end_at_et,status,first_name,last_name,email,phone,services,estimated_total,total_duration_minutes,service_payment_status,late_fee_status,no_show_fee_status' || E'\n' || coalesce(body, '')
  into v_csv
  from csv_lines;

  insert into appointment_archives(file_name, first_appointment_date, last_appointment_date, appointment_count, csv_content, source_appointment_ids)
  values (v_file_name, v_first_date, v_last_date, v_count, v_csv, v_candidate_ids)
  on conflict (file_name) do update
  set first_appointment_date = excluded.first_appointment_date,
      last_appointment_date = excluded.last_appointment_date,
      appointment_count = excluded.appointment_count,
      csv_content = excluded.csv_content,
      source_appointment_ids = excluded.source_appointment_ids
  where appointment_archives.source_appointment_ids = excluded.source_appointment_ids
  returning id into v_archive_id;

  if v_archive_id is null then
    raise exception 'Archive filename collision for %', v_file_name;
  end if;

  update appointments
  set archived_at = now(),
      updated_at = now()
  where archived_at is null
    and id = any(v_candidate_ids);

  return v_count;
end;
$$;

create or replace function next_request_number()
returns int
language plpgsql
as $$
declare
  current_val int;
  next_val int;
  attempts int := 0;
begin
  select current_value
  into current_val
  from request_counter
  where singleton = true
  for update;

  if current_val is null then
    raise exception 'request_counter is not initialized';
  end if;

  if current_val >= 999 then
    perform archive_rollover_appointments();
  end if;

  next_val := case when current_val >= 999 then 1 else current_val + 1 end;

  while attempts < 999 loop
    if not exists (
      select 1
      from appointments
      where archived_at is null
        and booking_request_number = next_val
    ) then
      update request_counter
      set current_value = next_val
      where singleton = true;

      return next_val;
    end if;

    next_val := case when next_val >= 999 then 1 else next_val + 1 end;
    attempts := attempts + 1;
  end loop;

  raise exception 'No reusable booking numbers are available';
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
  v_idempotency_key text;
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
  where idempotency_key = p_idempotency_key
    and archived_at is null;

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

  if (v_start_local)::date <> (v_end_local)::date then
    raise exception 'Appointment must start and end on the same local day';
  end if;

  if not (
    (
      coalesce(v_is_active, false) = true
      and (v_start_local)::time >= v_open_time
      and (v_end_local)::time <= v_close_time
    )
    or exists (
      select 1
      from additional_availability aa
      where tstzrange(aa.start_at, aa.end_at, '[)') @> p_start_at
        and tstzrange(aa.start_at, aa.end_at, '[)') @> (v_end_at - interval '1 microsecond')
    )
  ) then
    raise exception 'Requested time is outside available hours';
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
    where a.archived_at is null
      and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(p_start_at, v_end_at, '[)')
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
  (1, '09:30', '19:30', true),
  (2, '09:30', '19:30', false),
  (3, '09:30', '19:30', false),
  (4, '09:30', '19:30', false),
  (5, '09:30', '19:30', false),
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
alter table client_messages enable row level security;
alter table business_hours enable row level security;
alter table blocked_times enable row level security;
alter table additional_availability enable row level security;
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
drop policy if exists "auth manage client messages" on client_messages;
drop policy if exists "auth manage business hours" on business_hours;
drop policy if exists "auth manage blocked times" on blocked_times;
drop policy if exists "auth manage additional availability" on additional_availability;
drop policy if exists "auth manage appointments" on appointments;
drop policy if exists "auth manage appointment services" on appointment_services;

create policy "public read services" on services
  for select
  using (active = true);

create or replace function is_service_admin()
returns boolean
language sql
stable
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'admin', 'false')) = 'true'
    or (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
    or lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'admin', 'false')) = 'true',
    false
  )
$$;

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
  using (is_service_admin())
  with check (is_service_admin());

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


create policy "auth manage client messages" on client_messages
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

create policy "auth manage additional availability" on additional_availability
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
-- Require booking/admin RPCs to pass an explicit communication preference.
-- The temporary add-column default above protects existing installs during migration only; remove it so future direct inserts cannot silently select SMS + Email.
alter table customers alter column communication_preference drop default;
alter table customers add column if not exists square_customer_id text;
alter table customers add column if not exists square_card_id text;
alter table customers add column if not exists card_brand text;
alter table customers add column if not exists card_last4 text;
alter table customers add column if not exists card_on_file_status card_on_file_status not null default 'missing';

alter table appointments add column if not exists service_payment_status payment_status not null default 'unpaid';
alter table appointments add column if not exists late_fee_status payment_status not null default 'unpaid';
alter table appointments add column if not exists no_show_fee_status payment_status not null default 'unpaid';
alter table appointments add column if not exists policy_acknowledged boolean not null default false;
alter table appointments add column if not exists sms_consent_given boolean not null default false;
alter table appointments add column if not exists sms_consented_at timestamptz;
alter table appointments add column if not exists sms_consent_text_version text;
alter table appointments add column if not exists archived_at timestamptz;


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

-- Lightweight operational payment tracking. This complements (but does not replace)
-- Square/processor-oriented appointment_financial_events.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'appointment_payment_method') then
    create type appointment_payment_method as enum (
      'square_on_file',
      'square_manual',
      'cash',
      'cashapp',
      'venmo',
      'zelle',
      'apple_cash',
      'other_card',
      'other'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'appointment_payment_direction') then
    create type appointment_payment_direction as enum ('payment', 'refund');
  end if;
  if not exists (select 1 from pg_type where typname = 'appointment_payment_processor') then
    create type appointment_payment_processor as enum ('square', 'manual', 'external');
  end if;
end
$$;

create table if not exists appointment_payment_records (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete restrict,
  customer_id uuid not null references customers(id) on delete restrict,
  amount_cents int not null check (amount_cents >= 0),
  tip_amount_cents int not null default 0 check (tip_amount_cents >= 0),
  payment_method appointment_payment_method not null,
  payment_direction appointment_payment_direction not null default 'payment',
  processor appointment_payment_processor not null default 'manual',
  external_reference text,
  note text,
  linked_financial_event_id uuid references appointment_financial_events(id) on delete restrict,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount_cents > 0 or tip_amount_cents > 0)
);

create index if not exists idx_appointment_payment_records_appointment_id on appointment_payment_records(appointment_id, created_at desc);
create index if not exists idx_appointment_payment_records_customer_id on appointment_payment_records(customer_id, created_at desc);
create index if not exists idx_appointment_payment_records_created_at on appointment_payment_records(created_at desc);
create index if not exists idx_appointment_payment_records_method on appointment_payment_records(payment_method);
create unique index if not exists appointment_payment_records_linked_financial_event_key
  on appointment_payment_records(linked_financial_event_id)
  where linked_financial_event_id is not null;

create or replace function prevent_appointment_payment_record_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'appointment_payment_records are immutable; create an offsetting payment/refund record instead';
end;
$$;

drop trigger if exists appointment_payment_records_no_update on appointment_payment_records;
create trigger appointment_payment_records_no_update
  before update on appointment_payment_records
  for each row execute function prevent_appointment_payment_record_mutation();

drop trigger if exists appointment_payment_records_no_delete on appointment_payment_records;
create trigger appointment_payment_records_no_delete
  before delete on appointment_payment_records
  for each row execute function prevent_appointment_payment_record_mutation();

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
  p_communication_preference communication_preference default null,
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
  if p_communication_preference is null then raise exception 'Communication preference is required'; end if;

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
  p_communication_preference communication_preference default null,
  p_square_customer_id text default null,
  p_square_card_id text default null,
  p_card_brand text default null,
  p_card_last4 text default null,
  p_policy_acknowledged boolean default false,
  p_sms_consent_given boolean default false,
  p_sms_consented_at timestamptz default null,
  p_sms_consent_text_version text default null
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
  v_idempotency_key text;
begin
  perform expire_stale_pending_appointments();

  if not p_policy_acknowledged then
    raise exception 'Policy acknowledgement is required';
  end if;
  if p_communication_preference is null then
    raise exception 'Communication preference is required';
  end if;
  if p_communication_preference in ('sms', 'both') and not p_sms_consent_given then
    raise exception 'SMS consent acknowledgement is required when SMS notifications are selected';
  end if;

  if p_square_card_id is null or btrim(p_square_card_id) = '' then
    raise exception 'Card on file is required';
  end if;

  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'Idempotency key is required'; end if;

  select jsonb_build_object('appointment_id', id, 'booking_request_number', booking_request_number, 'estimated_total_text', estimated_total_text, 'estimated_total_min', estimated_total_min, 'total_duration_minutes', total_duration_minutes, 'idempotent', true)
  into existing from appointments where idempotency_key = p_idempotency_key and archived_at is null;
  if existing is not null then return existing; end if;

  if p_service_ids is null or cardinality(p_service_ids) = 0 then raise exception 'At least one service is required'; end if;
  if exists (
    with selected as (
      select s.id, s.type, coalesce(s.requires_service_ids, '{}'::uuid[]) as requires_service_ids
      from services s
      where s.id = any(p_service_ids) and s.active = true
    )
    select 1
    from selected addon
    where addon.type = 'addon'
      and cardinality(addon.requires_service_ids) > 0
      and not exists (
        select 1
        from unnest(addon.requires_service_ids) as required_id
        where required_id = any(p_service_ids)
      )
  ) then raise exception 'Design and removal services must be booked with a manicure or pedicure service.'; end if;

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
  if (v_start_local)::date <> (v_end_local)::date then raise exception 'Appointment must start and end on the same local day'; end if;
  if not ((coalesce(v_is_active, false) = true and (v_start_local)::time >= v_open_time and (v_end_local)::time <= v_close_time) or exists (select 1 from additional_availability aa where tstzrange(aa.start_at, aa.end_at, '[)') @> p_start_at and tstzrange(aa.start_at, aa.end_at, '[)') @> (v_end_at - interval '1 microsecond'))) then raise exception 'Requested time is outside available hours'; end if;

  if exists (select 1 from blocked_times b where tstzrange(b.start_at, b.end_at, '[)') && tstzrange(p_start_at, v_end_at, '[)')) then raise exception 'Requested time is blocked'; end if;

  if exists (select 1 from appointments a where a.archived_at is null and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(p_start_at, v_end_at, '[)') and (a.status in ('confirmed', 'completed', 'no_show') or (a.status = 'pending_confirmation' and coalesce(a.confirmation_deadline_at, a.created_at + interval '48 hours') > now()))) then
    raise exception 'Requested time overlaps another appointment';
  end if;

  v_customer_id := match_or_create_customer(p_first_name, p_last_name, p_email, p_phone, p_note, p_communication_preference, p_square_customer_id, p_square_card_id, p_card_brand, p_card_last4);
  v_req := next_request_number();
  v_deadline := now() + interval '48 hours';

  v_est_text := case when v_variable then 'Estimated total starts at $' || to_char(v_total_min, 'FM9999990.00') else 'Estimated total is $' || to_char(v_total_min, 'FM9999990.00') end;

  insert into appointments(customer_id, booking_request_number, start_at, end_at, timezone, status, estimated_total_min, estimated_total_text, total_duration_minutes, confirmation_deadline_at, idempotency_key, policy_acknowledged, sms_consent_given, sms_consented_at, sms_consent_text_version)
  values (v_customer_id, v_req, p_start_at, v_end_at, 'America/New_York', v_status, v_total_min, v_est_text, v_total_minutes, v_deadline, p_idempotency_key, p_policy_acknowledged, p_sms_consent_given, case when p_sms_consent_given then coalesce(p_sms_consented_at, now()) else null end, p_sms_consent_text_version)
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
alter table appointment_payment_records enable row level security;

drop policy if exists "auth manage financial events" on appointment_financial_events;
drop policy if exists "auth manage appointment action audit" on appointment_action_audit;
drop policy if exists "auth read payment records" on appointment_payment_records;
drop policy if exists "auth insert payment records" on appointment_payment_records;
drop policy if exists "admin read payment records" on appointment_payment_records;
drop policy if exists "admin insert payment records" on appointment_payment_records;

create policy "auth manage financial events" on appointment_financial_events
  for all to authenticated
  using (true)
  with check (true);

create policy "auth manage appointment action audit" on appointment_action_audit
  for all to authenticated
  using (true)
  with check (true);

create policy "admin read payment records" on appointment_payment_records
  for select to authenticated
  using (is_service_admin());

create policy "admin insert payment records" on appointment_payment_records
  for insert to authenticated
  with check (is_service_admin());

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

create or replace function create_admin_appointment(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_note text,
  p_service_ids uuid[],
  p_start_at timestamptz,
  p_communication_preference communication_preference default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_total_minutes int;
  v_total_min numeric(10,2);
  v_variable boolean;
  v_end_at timestamptz;
  v_req int;
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
  v_idempotency_key text;
begin
  perform expire_stale_pending_appointments();
  if p_communication_preference is null then raise exception 'Communication preference is required'; end if;
  if p_service_ids is null or cardinality(p_service_ids) = 0 then raise exception 'At least one service is required'; end if;
  if exists (
    with selected as (
      select s.id, s.type, coalesce(s.requires_service_ids, '{}'::uuid[]) as requires_service_ids
      from services s
      where s.id = any(p_service_ids) and s.active = true
    )
    select 1
    from selected addon
    where addon.type = 'addon'
      and cardinality(addon.requires_service_ids) > 0
      and not exists (
        select 1
        from unnest(addon.requires_service_ids) as required_id
        where required_id = any(p_service_ids)
      )
  ) then raise exception 'Design and removal services must be booked with a manicure or pedicure service.'; end if;

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
  if (v_start_local)::date <> (v_end_local)::date then raise exception 'Appointment must start and end on the same local day'; end if;
  if not ((coalesce(v_is_active, false) = true and (v_start_local)::time >= v_open_time and (v_end_local)::time <= v_close_time) or exists (select 1 from additional_availability aa where tstzrange(aa.start_at, aa.end_at, '[)') @> p_start_at and tstzrange(aa.start_at, aa.end_at, '[)') @> (v_end_at - interval '1 microsecond'))) then raise exception 'Requested time is outside available hours'; end if;
  if exists (select 1 from blocked_times b where tstzrange(b.start_at, b.end_at, '[)') && tstzrange(p_start_at, v_end_at, '[)')) then raise exception 'Requested time is blocked'; end if;
  if exists (select 1 from appointments a where a.archived_at is null and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(p_start_at, v_end_at, '[)') and a.status in ('confirmed', 'completed', 'no_show', 'pending_confirmation')) then raise exception 'Requested time overlaps another appointment'; end if;

  v_customer_id := match_or_create_customer(p_first_name, p_last_name, p_email, p_phone, p_note, p_communication_preference, null, null, null, null);
  v_req := next_request_number();
  v_est_text := case when v_variable then 'Estimated total starts at $' || to_char(v_total_min, 'FM9999990.00') else 'Estimated total is $' || to_char(v_total_min, 'FM9999990.00') end;
  v_idempotency_key := 'admin-' || to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISSMS"Z"') || '-' || gen_random_uuid()::text;
  insert into appointments(customer_id, booking_request_number, start_at, end_at, timezone, status, estimated_total_min, estimated_total_text, total_duration_minutes, confirmation_deadline_at, policy_acknowledged, sms_consent_given, idempotency_key)
  values (v_customer_id, v_req, p_start_at, v_end_at, 'America/New_York', 'confirmed', v_total_min, v_est_text, v_total_minutes, null, true, false, v_idempotency_key)
  returning id into v_apt_id;

  insert into appointment_services(appointment_id, service_id, service_name_snapshot, price_text_snapshot, price_min_snapshot, duration_minutes_snapshot, is_variable_price_snapshot)
  select v_apt_id, s.id, s.name, s.price_text, s.price_min_numeric, s.duration_minutes, s.is_variable_price
  from unnest(p_service_ids) as selected_id
  join services s on s.id = selected_id;

  return jsonb_build_object('appointment_id', v_apt_id, 'booking_request_number', v_req, 'estimated_total_text', v_est_text, 'estimated_total_min', v_total_min, 'total_duration_minutes', v_total_minutes);
end;
$$;

alter table booking_intake_audit enable row level security;
drop policy if exists "auth manage booking intake audit" on booking_intake_audit;
create policy "auth manage booking intake audit" on booking_intake_audit
  for all to authenticated
  using (true)
  with check (true);

-- Lightweight operational inventory + purchase receipt tracking

do $$
begin
  if not exists (select 1 from pg_type where typname = 'inventory_adjustment_source') then
    create type inventory_adjustment_source as enum ('purchase', 'service_completion', 'manual_adjustment');
  end if;
end
$$;

create table if not exists inventory_supplies (
  id uuid primary key default gen_random_uuid(),
  supply_name text not null unique,
  current_quantity numeric(12,2) not null default 0,
  low_threshold numeric(12,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_quantity >= 0),
  check (low_threshold >= 0)
);

-- Negative inventory is blocked by service/purchase/save functions and allowed only by
-- explicit manual adjustment, so do not keep a table-level nonnegative check.
alter table inventory_supplies drop constraint if exists inventory_supplies_current_quantity_check;

create table if not exists inventory_purchase_logs (
  id uuid primary key default gen_random_uuid(),
  supply_id uuid not null references inventory_supplies(id),
  quantity_increment numeric(12,2) not null check (quantity_increment >= 0),
  total_cost numeric(12,2) not null default 0 check (total_cost >= 0),
  created_at timestamptz not null default now()
);

create table if not exists inventory_receipt_attachments (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references inventory_purchase_logs(id) on delete cascade,
  storage_key text not null,
  file_name text not null,
  content_type text not null check (content_type like 'image/%' or content_type = 'application/pdf'),
  created_at timestamptz not null default now()
);

create table if not exists service_inventory_mappings (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id) on delete cascade,
  supply_id uuid not null references inventory_supplies(id),
  amount_consumed numeric(12,2) not null check (amount_consumed > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_id, supply_id)
);

create table if not exists inventory_adjustment_logs (
  id uuid primary key default gen_random_uuid(),
  supply_id uuid not null references inventory_supplies(id),
  change_amount numeric(12,2) not null,
  resulting_quantity numeric(12,2) not null,
  source_type inventory_adjustment_source not null,
  reason text,
  appointment_id uuid references appointments(id) on delete set null,
  service_id uuid references services(id) on delete set null,
  purchase_id uuid references inventory_purchase_logs(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table appointments add column if not exists inventory_deducted_at timestamptz;

create index if not exists idx_inventory_adjustments_created on inventory_adjustment_logs(created_at desc);
create index if not exists idx_service_inventory_mappings_service on service_inventory_mappings(service_id);

create or replace function admin_update_inventory_supply(
  p_supply_id uuid,
  p_current_quantity numeric,
  p_low_threshold numeric,
  p_active boolean default null
)
returns inventory_supplies
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supply inventory_supplies;
begin
  if not is_service_admin() then raise exception 'Admin access required'; end if;
  if p_current_quantity < 0 then raise exception 'Supply quantity cannot be negative'; end if;
  if p_low_threshold < 0 then raise exception 'Low threshold cannot be negative'; end if;

  update inventory_supplies
  set current_quantity = p_current_quantity,
      low_threshold = p_low_threshold,
      active = coalesce(p_active, active),
      updated_at = now()
  where id = p_supply_id
  returning * into v_supply;

  if v_supply.id is null then raise exception 'Supply not found'; end if;
  return v_supply;
end;
$$;

create or replace function admin_create_inventory_manual_adjustment(
  p_supply_id uuid,
  p_change_amount numeric,
  p_reason text,
  p_allow_negative boolean default false
)
returns inventory_adjustment_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supply inventory_supplies;
  v_result numeric;
  v_log inventory_adjustment_logs;
begin
  if not is_service_admin() then raise exception 'Admin access required'; end if;
  if p_change_amount = 0 then raise exception 'Adjustment amount must not be zero'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Adjustment reason is required'; end if;

  select * into v_supply from inventory_supplies where id = p_supply_id for update;
  if v_supply.id is null then raise exception 'Supply not found'; end if;
  v_result := v_supply.current_quantity + p_change_amount;
  if v_result < 0 and not p_allow_negative then raise exception 'Adjustment would make inventory negative'; end if;

  update inventory_supplies set current_quantity = v_result, updated_at = now() where id = p_supply_id;
  insert into inventory_adjustment_logs(supply_id, change_amount, resulting_quantity, source_type, reason)
  values (p_supply_id, p_change_amount, v_result, 'manual_adjustment', btrim(p_reason))
  returning * into v_log;
  return v_log;
end;
$$;

create or replace function admin_create_inventory_purchase(
  p_supply_id uuid,
  p_new_supply_name text,
  p_starting_quantity numeric,
  p_low_threshold numeric,
  p_quantity_increment numeric,
  p_total_cost numeric,
  p_receipt_storage_key text default null,
  p_receipt_file_name text default null,
  p_receipt_content_type text default null
)
returns inventory_purchase_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supply_id uuid;
  v_result numeric;
  v_purchase inventory_purchase_logs;
begin
  if not is_service_admin() then raise exception 'Admin access required'; end if;
  if p_quantity_increment < 0 then raise exception 'Quantity increment cannot be negative'; end if;
  if p_total_cost < 0 then raise exception 'Total cost cannot be negative'; end if;

  if p_supply_id is null then
    if btrim(coalesce(p_new_supply_name, '')) = '' then raise exception 'Supply name is required'; end if;
    if p_starting_quantity < 0 then raise exception 'Starting quantity cannot be negative'; end if;
    if p_low_threshold < 0 then raise exception 'Low threshold cannot be negative'; end if;
    insert into inventory_supplies(supply_name, current_quantity, low_threshold)
    values (btrim(p_new_supply_name), p_starting_quantity, p_low_threshold)
    returning id into v_supply_id;
  else
    select id into v_supply_id from inventory_supplies where id = p_supply_id and active = true;
    if v_supply_id is null then raise exception 'Active supply not found'; end if;
  end if;

  update inventory_supplies
  set current_quantity = current_quantity + p_quantity_increment,
      updated_at = now()
  where id = v_supply_id
  returning current_quantity into v_result;

  insert into inventory_purchase_logs(supply_id, quantity_increment, total_cost)
  values (v_supply_id, p_quantity_increment, p_total_cost)
  returning * into v_purchase;

  if p_receipt_storage_key is not null then
    insert into inventory_receipt_attachments(purchase_id, storage_key, file_name, content_type)
    values (v_purchase.id, p_receipt_storage_key, coalesce(p_receipt_file_name, 'receipt'), coalesce(p_receipt_content_type, 'application/pdf'));
  end if;

  insert into inventory_adjustment_logs(supply_id, change_amount, resulting_quantity, source_type, purchase_id)
  values (v_supply_id, p_quantity_increment, v_result, 'purchase', v_purchase.id);

  return v_purchase;
end;
$$;

create or replace function deduct_inventory_for_completed_appointment(p_appointment_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
  v_result numeric;
begin
  update appointments
  set inventory_deducted_at = now(), updated_at = now()
  where id = p_appointment_id
    and status = 'completed'
    and inventory_deducted_at is null;

  get diagnostics v_count = row_count;
  if v_count = 0 then return 0; end if;

  for r in
    select aps.service_id, sim.supply_id, sum(sim.amount_consumed) as amount_consumed
    from appointment_services aps
    join service_inventory_mappings sim on sim.service_id = aps.service_id
    join inventory_supplies inv on inv.id = sim.supply_id and inv.active = true
    where aps.appointment_id = p_appointment_id
    group by aps.service_id, sim.supply_id
  loop
    update inventory_supplies
    set current_quantity = current_quantity - r.amount_consumed,
        updated_at = now()
    where id = r.supply_id
      and current_quantity - r.amount_consumed >= 0
    returning current_quantity into v_result;

    if v_result is null then
      raise exception 'Inventory deduction would make a supply negative';
    end if;

    insert into inventory_adjustment_logs(supply_id, change_amount, resulting_quantity, source_type, appointment_id, service_id)
    values (r.supply_id, -r.amount_consumed, v_result, 'service_completion', p_appointment_id, r.service_id);
  end loop;

  return 1;
end;
$$;

alter table inventory_supplies enable row level security;
alter table inventory_purchase_logs enable row level security;
alter table inventory_receipt_attachments enable row level security;
alter table service_inventory_mappings enable row level security;
alter table inventory_adjustment_logs enable row level security;

drop policy if exists "auth manage inventory supplies" on inventory_supplies;
drop policy if exists "auth manage inventory purchases" on inventory_purchase_logs;
drop policy if exists "auth manage inventory receipts" on inventory_receipt_attachments;
drop policy if exists "auth manage service inventory mappings" on service_inventory_mappings;
drop policy if exists "auth manage inventory adjustments" on inventory_adjustment_logs;

create policy "auth manage inventory supplies" on inventory_supplies
  for all to authenticated using (is_service_admin()) with check (is_service_admin());
create policy "auth manage inventory purchases" on inventory_purchase_logs
  for all to authenticated using (is_service_admin()) with check (is_service_admin());
create policy "auth manage inventory receipts" on inventory_receipt_attachments
  for all to authenticated using (is_service_admin()) with check (is_service_admin());
create policy "auth manage service inventory mappings" on service_inventory_mappings
  for all to authenticated using (is_service_admin()) with check (is_service_admin());
create policy "auth manage inventory adjustments" on inventory_adjustment_logs
  for all to authenticated using (is_service_admin()) with check (is_service_admin());

insert into storage.buckets (id, name, public)
values ('inventory-receipts', 'inventory-receipts', false)
on conflict (id) do nothing;

drop policy if exists "auth manage inventory receipt files" on storage.objects;
create policy "auth manage inventory receipt files" on storage.objects
  for all to authenticated
  using (bucket_id = 'inventory-receipts' and is_service_admin())
  with check (bucket_id = 'inventory-receipts' and is_service_admin());
