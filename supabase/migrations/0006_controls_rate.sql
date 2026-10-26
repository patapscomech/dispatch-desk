-- Dispatch Desk: controls repair rate (billed by the kind of work, not by who did it).
-- Run once after 0005: SQL Editor > New query > paste the whole file > Run.
alter table time_entries add column controls boolean not null default false;
alter table contract_rates drop constraint contract_rates_rate_class_check;
alter table contract_rates add constraint contract_rates_rate_class_check
  check (rate_class in ('All', 'Foreman', 'Journeyman', 'Apprentice', 'Helper', 'Shop Mechanic', 'Controls'));
