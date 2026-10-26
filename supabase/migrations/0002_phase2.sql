-- Dispatch Desk, Phase 2: locations, equipment, dispatch, checklists, parts, photos.
-- Run once in Supabase after 0001: SQL Editor > New query > paste the whole file > Run.

-- Types of job status now cover dispatch. Old 'open' jobs become 'unassigned'.
alter table jobs drop constraint jobs_status_check;
update jobs set status = 'unassigned' where status = 'open';
alter table jobs alter column status set default 'unassigned';
alter table jobs add constraint jobs_status_check
  check (status in ('unassigned', 'scheduled', 'in_progress', 'on_hold', 'complete', 'closed'));

alter table customers add column billing_address text not null default '';
alter table customers add column notes text not null default '';

create table locations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  name text not null,
  address text not null default '',
  access_notes text not null default '',
  created_at timestamptz not null default now(),
  unique (customer_id, name)
);

create table equipment (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  tag text not null,
  type text not null default '',
  make text not null default '',
  model text not null default '',
  serial text not null default '',
  area text not null default '',
  install_year int,
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (location_id, tag)
);

alter table jobs add column location_id uuid references locations(id);
alter table jobs add column priority text not null default 'Normal'
  check (priority in ('Low', 'Normal', 'High', 'Emergency'));
alter table jobs add column description text not null default '';
alter table jobs add column start_date date;
alter table jobs add column end_date date;
alter table jobs add column resolution text not null default '';
alter table jobs add column close_override_reason text;
alter table jobs add column close_override_by uuid references profiles(id);
alter table jobs add column close_override_at timestamptz;
create index jobs_location on jobs (location_id);

-- Who is scheduled when: one row per person per day, so a job can have
-- several people and run over several days.
create table job_assignments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  employee_id uuid not null references profiles(id),
  work_date date not null,
  is_lead boolean not null default false,
  unique (job_id, employee_id, work_date)
);
create index job_assignments_emp_date on job_assignments (employee_id, work_date);

-- Equipment worked on during a job, with findings.
create table job_equipment (
  job_id uuid not null references jobs(id) on delete cascade,
  equipment_id uuid not null references equipment(id),
  findings text not null default '',
  primary key (job_id, equipment_id)
);

-- Checklists -----------------------------------------------------------
-- A template is saved as plain lines: "# Heading", "Item", "Reading|value".
create table checklist_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  body text not null,
  created_at timestamptz not null default now()
);

create table job_checklist_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  position int not null,
  kind text not null check (kind in ('check', 'value', 'head')),
  text text not null,
  done boolean not null default false,
  value text not null default '',
  done_by uuid references profiles(id),
  done_at timestamptz,
  unique (job_id, position)
);

-- Parts ----------------------------------------------------------------
create table job_parts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  description text not null,
  qty numeric(10, 2) not null default 1 check (qty > 0),
  source text not null default 'Stock'
    check (source in ('Stock', 'Purchased', 'Supplier PO', 'Subcontractor')),
  vendor text not null default '',
  invoice_path text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
-- Costs live in their own table so technicians can enter a cost from a
-- receipt but never read costs back.
create table job_part_costs (
  part_id uuid primary key references job_parts(id) on delete cascade,
  unit_cost numeric(10, 2) not null default 0
);

create table job_photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  equipment_id uuid references equipment(id),
  kind text not null default 'during' check (kind in ('before', 'during', 'after', 'issue', 'nameplate')),
  caption text not null default '',
  path text not null,
  taken_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- Helpers --------------------------------------------------------------
create function public.can_work_job(j uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(
    public.is_approver()
    or (public.my_role() is not null
        and exists (select 1 from job_assignments where job_id = j and employee_id = auth.uid())),
    false)
$$;

-- Rules on jobs: who can change what, and the checklist close rule ----------
create function public.enforce_job_rules() returns trigger
  language plpgsql security definer set search_path = public as $$
declare open_items int;
begin
  if tg_op = 'INSERT' then
    if not public.is_office() then raise exception 'Only the office can create jobs'; end if;
    return new;
  end if;

  if not public.is_office() then
    if not public.can_work_job(old.id) then raise exception 'You are not assigned to this job'; end if;
    if (new.number, new.kind, new.title, new.customer_id, new.location_id, new.priority,
        new.prevailing_wage, new.description, new.start_date, new.end_date,
        new.close_override_reason, new.close_override_by, new.close_override_at)
       is distinct from
       (old.number, old.kind, old.title, old.customer_id, old.location_id, old.priority,
        old.prevailing_wage, old.description, old.start_date, old.end_date,
        old.close_override_reason, old.close_override_by, old.close_override_at) then
      raise exception 'Only the office can change those details';
    end if;
    if new.status is distinct from old.status
       and new.status not in ('in_progress', 'on_hold', 'complete') then
      raise exception 'You can set a call to in progress, on hold or complete';
    end if;
    if old.status = 'closed' then raise exception 'This job is closed'; end if;
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

create trigger jobs_rules before insert or update on jobs
  for each row execute function public.enforce_job_rules();

-- Unticking an item reopens a call that was closed normally.
create function public.reopen_on_untick() returns trigger
  language plpgsql security definer set search_path = public as $$
declare was_done boolean; is_done boolean;
begin
  if new.kind = 'head' then return new; end if;
  was_done := case when old.kind = 'value' then old.value <> '' else old.done end;
  is_done := case when new.kind = 'value' then new.value <> '' else new.done end;
  if is_done and not was_done then
    new.done_by := auth.uid();
    new.done_at := now();
  elsif was_done and not is_done then
    new.done_by := null;
    new.done_at := null;
    update jobs set status = 'in_progress'
      where id = new.job_id and status = 'complete'
        and (close_override_reason is null or btrim(close_override_reason) = '');
  end if;
  return new;
end $$;

create trigger checklist_untick before update on job_checklist_items
  for each row execute function public.reopen_on_untick();

-- Row-level security ---------------------------------------------------
alter table locations enable row level security;
alter table equipment enable row level security;
alter table job_assignments enable row level security;
alter table job_equipment enable row level security;
alter table checklist_templates enable row level security;
alter table job_checklist_items enable row level security;
alter table job_parts enable row level security;
alter table job_part_costs enable row level security;
alter table job_photos enable row level security;

-- Everyone signed in can read sites, equipment and history (needed in the field).
create policy locations_read on locations for select to authenticated using (true);
create policy locations_write on locations for all to authenticated
  using (public.is_office()) with check (public.is_office());

create policy equipment_read on equipment for select to authenticated using (true);
-- Technicians can add a unit they find on site; only the office edits or removes.
create policy equipment_insert on equipment for insert to authenticated
  with check (public.my_role() is not null);
create policy equipment_update on equipment for update to authenticated
  using (public.is_office()) with check (public.is_office());
create policy equipment_delete on equipment for delete to authenticated using (public.is_office());

create policy assignments_read on job_assignments for select to authenticated using (true);
create policy assignments_write on job_assignments for all to authenticated
  using (public.is_office()) with check (public.is_office());

create policy jobs_update_assigned on jobs for update to authenticated
  using (public.can_work_job(id)) with check (public.can_work_job(id));

create policy jobequip_read on job_equipment for select to authenticated using (true);
create policy jobequip_write on job_equipment for all to authenticated
  using (public.can_work_job(job_id)) with check (public.can_work_job(job_id));

create policy templates_read on checklist_templates for select to authenticated using (true);
create policy templates_write on checklist_templates for all to authenticated
  using (public.is_office()) with check (public.is_office());

create policy cl_read on job_checklist_items for select to authenticated using (true);
create policy cl_write on job_checklist_items for all to authenticated
  using (public.can_work_job(job_id)) with check (public.can_work_job(job_id));

create policy parts_read on job_parts for select to authenticated using (true);
create policy parts_write on job_parts for all to authenticated
  using (public.can_work_job(job_id)) with check (public.can_work_job(job_id));

create policy partcost_insert on job_part_costs for insert to authenticated
  with check (exists (select 1 from job_parts p where p.id = part_id and public.can_work_job(p.job_id)));
create policy partcost_office on job_part_costs for all to authenticated
  using (public.is_office()) with check (public.is_office());

create policy photos_read on job_photos for select to authenticated using (true);
create policy photos_write on job_photos for all to authenticated
  using (public.can_work_job(job_id)) with check (public.can_work_job(job_id));

revoke all on all tables in schema public from anon;

-- Photo and invoice files: a private bucket, readable by signed-in staff,
-- writable by people who can work the job (first folder is the job id).
insert into storage.buckets (id, name, public) values ('job-files', 'job-files', false)
  on conflict (id) do nothing;

create policy job_files_read on storage.objects for select to authenticated
  using (bucket_id = 'job-files');
create policy job_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'job-files' and public.can_work_job(((storage.foldername(name))[1])::uuid));
create policy job_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'job-files' and public.is_office());

-- Starter checklists (the office can add more or import their own).
insert into checklist_templates (name, body) values
 ('RTU Quarterly PM', E'# Safety\nLockout/tagout applied\n# Airside\nReplace filters\nInspect belts and sheaves\nSupply air temp|value\nReturn air temp|value\n# Refrigeration\nSuction pressure|value\nDischarge pressure|value\nInspect condensate drain\nClean condenser coil'),
 ('Chiller Annual Inspection', E'# Mechanical\nOil level and pressure|value\nVibration reading|value\nInspect starter and VFD connections\n# Refrigerant side\nRefrigerant charge check|value\nEvaporator approach temp|value\nCondenser approach temp|value\n# Controls\nVerify safeties\nReview trip log'),
 ('Boiler Fall Startup', E'Inspect burner and flame\nO2 percent|value\nCO ppm|value\nTest low water cutoff\nTest relief valve\nCheck expansion tank\nVerify controls and setpoints'),
 ('Backflow Test', E'Gauge serial number|value\nCheck valve 1 psi|value\nCheck valve 2 psi|value\nRelief valve opening psi|value\nTag device and file report'),
 ('Job Close-Out', E'Work area cleaned\nCustomer walkthrough done\nBefore and after photos uploaded\nParts invoices attached\nCustomer signature obtained');
