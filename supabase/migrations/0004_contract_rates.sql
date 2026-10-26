-- Dispatch Desk: contract billing rates.
-- Run once after 0001-0003: SQL Editor > New query > paste the whole file > Run.

-- A fifth classification used by some contracts (e.g. Baltimore County "Shop Mechanic").
alter table profiles drop constraint profiles_classification_check;
alter table profiles add constraint profiles_classification_check
  check (classification in ('Foreman', 'Journeyman', 'Apprentice', 'Helper', 'Shop Mechanic'));

-- Billing overtime is by time of day / weekend / holiday and is separate from
-- payroll overtime (over 40 hours), so each hours entry carries its own flag.
alter table time_entries add column after_hours boolean not null default false;

-- Equipment rentals are passed through.
alter table job_parts drop constraint job_parts_source_check;
alter table job_parts add constraint job_parts_source_check
  check (source in ('Stock', 'Purchased', 'Supplier PO', 'Subcontractor', 'Rental'));

-- How a contract bills. Markups are multipliers: 1.08 = cost plus 8 percent, 1 = at cost.
alter table contracts add column billing_method text not null default 'tm'
  check (billing_method in ('tm', 'cost_plus', 'fixed', 'pm'));
alter table contracts add column materials_multiplier numeric(6, 4) not null default 1 check (materials_multiplier >= 1);
alter table contracts add column sub_multiplier numeric(6, 4) not null default 1 check (sub_multiplier >= 1);
alter table contracts add column rental_multiplier numeric(6, 4) not null default 1 check (rental_multiplier >= 1);
alter table contracts add column trip_charge numeric(10, 2) not null default 0 check (trip_charge >= 0); -- 0 = no trip charge
alter table contracts add column notes text not null default '';

-- Labor rates. rate_class is a classification name, or 'All' for one rate for everyone.
-- label is the customer's own name for the class (e.g. Outside Mechanic).
create table contract_rates (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts(id) on delete cascade,
  rate_class text not null check (rate_class in ('All', 'Foreman', 'Journeyman', 'Apprentice', 'Helper', 'Shop Mechanic')),
  label text not null default '',
  regular numeric(10, 2) not null check (regular >= 0),
  overtime numeric(10, 2) not null check (overtime >= 0),
  unique (contract_id, rate_class)
);

-- Prices are office-only: technicians can never read what a customer is billed.
alter table contract_rates enable row level security;
create policy rates_office on contract_rates for all to authenticated
  using (public.is_office()) with check (public.is_office());
revoke all on contract_rates from anon;

-- Contract terms themselves (multipliers, trip charge) should also be office-only.
-- Technicians still need the contract name/type/dates to pick one, so expose a
-- narrow view and tighten the table.
drop policy contracts_read on contracts;
create policy contracts_read on contracts for select to authenticated using (public.is_office());
create view contracts_basic with (security_invoker = false) as
  select id, customer_id, name, type, prevailing_wage, start_date, end_date, active from contracts;
revoke all on contracts_basic from anon;
grant select on contracts_basic to authenticated;
