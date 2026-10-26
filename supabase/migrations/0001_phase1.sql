-- Dispatch Desk, Phase 1: people, jobs, hours.
-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- Safe to re-run? No. Run it once on a fresh project.

create type app_role as enum ('owner', 'office', 'foreman', 'technician');
create type pay_type as enum ('regular', 'ot');
create type entry_status as enum ('open', 'submitted', 'approved', 'exported');
create type job_kind as enum ('ticket', 'project');

-- People ---------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  role app_role not null default 'technician',
  classification text not null default 'Journeyman'
    check (classification in ('Foreman', 'Journeyman', 'Apprentice', 'Helper')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Internal cost rate: owner only, never visible to anyone else.
create table employee_private (
  employee_id uuid primary key references profiles(id) on delete cascade,
  cost_rate numeric(8, 2) not null default 0
);

-- Customers and jobs ---------------------------------------------------
create table customers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  kind job_kind not null default 'ticket',
  title text not null,
  customer_id uuid references customers(id),
  status text not null default 'open' check (status in ('open', 'closed')),
  prevailing_wage boolean not null default false,
  created_at timestamptz not null default now()
);

create table job_tasks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  name text not null,
  unique (job_id, name)
);

-- Hours ----------------------------------------------------------------
-- job_id null means shop time (unallocated).
create table time_entries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references profiles(id),
  work_date date not null,
  hours numeric(4, 2) not null check (hours > 0 and hours <= 24),
  pay_type pay_type not null default 'regular',
  job_id uuid references jobs(id),
  task_id uuid references job_tasks(id),
  notes text not null default '',
  status entry_status not null default 'open',
  classification text not null default '',
  prevailing_wage boolean not null default false,
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  exported_at timestamptz,
  invoice_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (task_id is null or job_id is not null)
);
create index time_entries_employee_date on time_entries (employee_id, work_date);
create index time_entries_status on time_entries (status);

-- Role helpers ---------------------------------------------------------
create function public.my_role() returns app_role
  language sql stable security definer set search_path = public as
  $$ select role from profiles where id = auth.uid() and active $$;

create function public.is_approver() returns boolean
  language sql stable security definer set search_path = public as
  $$ select coalesce(public.my_role() in ('owner', 'office', 'foreman'), false) $$;

create function public.is_office() returns boolean
  language sql stable security definer set search_path = public as
  $$ select coalesce(public.my_role() in ('owner', 'office'), false) $$;

create function public.is_owner() returns boolean
  language sql stable security definer set search_path = public as
  $$ select coalesce(public.my_role() = 'owner', false) $$;

-- New login -> profile. The very first login becomes the owner.
create function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case when not exists (select 1 from profiles) then 'owner'::app_role else 'technician'::app_role end
  );
  insert into employee_private (employee_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Rules on hours -------------------------------------------------------
create function public.enforce_time_rules() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.task_id is not null
     and not exists (select 1 from job_tasks where id = new.task_id and job_id = new.job_id) then
    raise exception 'That task does not belong to the selected job';
  end if;

  if tg_op = 'INSERT' then
    if new.employee_id <> auth.uid() and not public.is_office() then
      raise exception 'You can only enter your own hours';
    end if;
    new.status := 'open';
    new.approved_by := null;
    new.approved_at := null;
    new.exported_at := null;
    new.invoice_id := null;
    select classification into new.classification from profiles where id = new.employee_id;
    if new.job_id is not null then
      select prevailing_wage into new.prevailing_wage from jobs where id = new.job_id;
    else
      new.prevailing_wage := false;
    end if;
    return new;
  end if;

  -- UPDATE
  new.updated_at := now();
  if new.employee_id <> old.employee_id then
    raise exception 'The employee on an entry cannot be changed';
  end if;

  if old.status <> 'open' and not public.is_office()
     and (new.hours, new.work_date, new.job_id, new.task_id, new.pay_type)
         is distinct from (old.hours, old.work_date, old.job_id, old.task_id, old.pay_type) then
    raise exception 'Hours that are submitted or approved can only be changed by the office';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'open' and new.status = 'submitted' then
      if old.employee_id <> auth.uid() and not public.is_office() then
        raise exception 'Only the employee or the office can submit hours';
      end if;
    elsif old.status = 'submitted' and new.status = 'approved' then
      if not public.is_approver() then raise exception 'Only a foreman, the office or the owner can approve'; end if;
      if old.employee_id = auth.uid() and not public.is_office() then
        raise exception 'You cannot approve your own hours';
      end if;
      new.approved_by := auth.uid();
      new.approved_at := now();
    elsif old.status = 'submitted' and new.status = 'open' then
      if not public.is_approver() then raise exception 'Only an approver can return hours'; end if;
      new.approved_by := null;
      new.approved_at := null;
    elsif old.status = 'approved' and new.status = 'exported' then
      if not public.is_office() then raise exception 'Only the office can export'; end if;
      new.exported_at := now();
    elsif old.status in ('approved', 'exported') and new.status = 'open' then
      if not public.is_office() then raise exception 'Only the office can reopen approved hours'; end if;
      if old.invoice_id is not null then raise exception 'These hours are on an invoice and are locked'; end if;
      new.approved_by := null;
      new.approved_at := null;
      new.exported_at := null;
    else
      raise exception 'That status change is not allowed (% to %)', old.status, new.status;
    end if;
  end if;
  return new;
end $$;

create trigger time_entries_rules
  before insert or update on time_entries
  for each row execute function public.enforce_time_rules();

-- Row-level security ---------------------------------------------------
alter table profiles enable row level security;
alter table employee_private enable row level security;
alter table customers enable row level security;
alter table jobs enable row level security;
alter table job_tasks enable row level security;
alter table time_entries enable row level security;

create policy profiles_read on profiles for select to authenticated using (true);
create policy profiles_update on profiles for update to authenticated
  using (public.is_office()) with check (public.is_office());

create policy private_owner on employee_private for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy customers_read on customers for select to authenticated using (true);
create policy customers_write on customers for all to authenticated
  using (public.is_office()) with check (public.is_office());

create policy jobs_read on jobs for select to authenticated using (true);
create policy jobs_write on jobs for all to authenticated
  using (public.is_office()) with check (public.is_office());

create policy tasks_read on job_tasks for select to authenticated using (true);
create policy tasks_write on job_tasks for all to authenticated
  using (public.is_office()) with check (public.is_office());

create policy entries_read on time_entries for select to authenticated
  using ((employee_id = auth.uid() and public.my_role() is not null) or public.is_approver());
create policy entries_insert on time_entries for insert to authenticated
  with check ((employee_id = auth.uid() and public.my_role() is not null) or public.is_office());
create policy entries_update on time_entries for update to authenticated
  using (
    (employee_id = auth.uid() and status = 'open' and public.my_role() is not null)
    or public.is_approver()
  )
  with check (
    (employee_id = auth.uid() and public.my_role() is not null) or public.is_approver()
  );
create policy entries_delete on time_entries for delete to authenticated
  using ((employee_id = auth.uid() and status = 'open' and public.my_role() is not null) or public.is_office());

-- Nobody who is signed out can read or write anything.
revoke all on all tables in schema public from anon;
