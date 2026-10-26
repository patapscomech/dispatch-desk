-- Dispatch Desk: contracts, and technicians dispatching calls to themselves.
-- Run once in Supabase after 0001 and 0002: SQL Editor > New query > paste the whole file > Run.
-- Contract rates and billing rules arrive in a later migration; this only records
-- which contract a call is worked under.

create table contracts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  name text not null,
  type text not null default 'Service' check (type in ('Service', 'Project', 'Emergency')),
  prevailing_wage boolean not null default false,
  start_date date,
  end_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (customer_id, name)
);

alter table jobs add column contract_id uuid references contracts(id);
alter table jobs add column created_by uuid references profiles(id);
alter table jobs add column self_dispatched boolean not null default false;
create index jobs_contract on jobs (contract_id);

create sequence self_dispatch_seq;

alter table contracts enable row level security;
create policy contracts_read on contracts for select to authenticated using (true);
create policy contracts_write on contracts for all to authenticated
  using (public.is_office()) with check (public.is_office());

-- A technician (or foreman) may create a service ticket for themselves, for
-- a customer location and one of that customer's active contracts.
create policy jobs_insert_self on jobs for insert to authenticated
  with check (self_dispatched and kind = 'ticket' and created_by = auth.uid());

create policy assignments_self_insert on job_assignments for insert to authenticated
  with check (
    employee_id = auth.uid()
    and public.my_role() is not null
    and exists (select 1 from jobs j where j.id = job_id and j.self_dispatched and j.created_by = auth.uid())
  );

-- Replaces the 0002 version: same rules plus contract handling and self-dispatch.
create or replace function public.enforce_job_rules() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  open_items int;
  loc_customer uuid;
  c record;
  admin_ctx boolean := auth.uid() is null; -- SQL editor or backend, not a signed-in person
begin
  if tg_op = 'INSERT' then
    if admin_ctx then
      null; -- imports and fixes run from the Supabase SQL editor are trusted
    elsif public.is_office() then
      new.created_by := auth.uid();
      new.self_dispatched := false;
    else
      if public.my_role() is null then raise exception 'Your account is turned off'; end if;
      if new.kind <> 'ticket' then raise exception 'You can only create service tickets'; end if;
      if new.location_id is null or new.contract_id is null then
        raise exception 'Choose the location and the contract for this call';
      end if;
      select customer_id into loc_customer from locations where id = new.location_id;
      select * into c from contracts where id = new.contract_id;
      if loc_customer is null or c.id is null or c.customer_id <> loc_customer then
        raise exception 'That contract does not belong to this customer';
      end if;
      if not c.active or (c.end_date is not null and c.end_date < (now() at time zone 'America/New_York')::date)
         or (c.start_date is not null and c.start_date > (now() at time zone 'America/New_York')::date) then
        raise exception 'That contract is not active today';
      end if;
      new.customer_id := loc_customer;
      new.created_by := auth.uid();
      new.self_dispatched := true;
      new.status := 'in_progress';
      new.number := 'SD-' || to_char(now() at time zone 'America/New_York', 'YYMMDD') || '-' || nextval('self_dispatch_seq');
      new.start_date := (now() at time zone 'America/New_York')::date;
      new.end_date := new.start_date;
      new.resolution := '';
      new.close_override_reason := null;
      new.close_override_by := null;
      new.close_override_at := null;
    end if;
    if new.contract_id is not null then
      select prevailing_wage into c from contracts where id = new.contract_id;
      new.prevailing_wage := new.prevailing_wage or coalesce(c.prevailing_wage, false);
    end if;
    return new;
  end if;

  -- UPDATE
  if not admin_ctx and not public.is_office() then
    if not public.can_work_job(old.id) then raise exception 'You are not assigned to this job'; end if;
    if (new.number, new.kind, new.title, new.customer_id, new.location_id, new.contract_id, new.priority,
        new.prevailing_wage, new.description, new.start_date, new.end_date,
        new.close_override_reason, new.close_override_by, new.close_override_at,
        new.created_by, new.self_dispatched)
       is distinct from
       (old.number, old.kind, old.title, old.customer_id, old.location_id, old.contract_id, old.priority,
        old.prevailing_wage, old.description, old.start_date, old.end_date,
        old.close_override_reason, old.close_override_by, old.close_override_at,
        old.created_by, old.self_dispatched) then
      raise exception 'Only the office can change those details';
    end if;
    if new.status is distinct from old.status
       and new.status not in ('in_progress', 'on_hold', 'complete') then
      raise exception 'You can set a call to in progress, on hold or complete';
    end if;
    if old.status = 'closed' then raise exception 'This job is closed'; end if;
  end if;

  if new.contract_id is distinct from old.contract_id and new.contract_id is not null then
    select prevailing_wage into c from contracts where id = new.contract_id;
    new.prevailing_wage := new.prevailing_wage or coalesce(c.prevailing_wage, false);
  end if;

  if new.status is distinct from old.status and new.status in ('complete', 'closed')
     and old.status not in ('complete', 'closed') then
    select count(*) into open_items from job_checklist_items
      where job_id = new.id and kind <> 'head' and not (case when kind = 'value' then value <> '' else done end);
    if open_items > 0 then
      if new.close_override_reason is not null and btrim(new.close_override_reason) <> '' and public.is_office()
         and (old.close_override_reason is distinct from new.close_override_reason) then
        new.close_override_by := auth.uid();
        new.close_override_at := now();
      elsif old.close_override_reason is not null and btrim(old.close_override_reason) <> '' then
        null; -- already overridden earlier
      else
        raise exception 'The checklist is not finished (% items open). The office can close it with a reason.', open_items;
      end if;
    end if;
  end if;
  return new;
end $$;

revoke all on all tables in schema public from anon;
