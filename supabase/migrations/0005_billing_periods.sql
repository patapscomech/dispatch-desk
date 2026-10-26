-- Dispatch Desk: three billing periods (regular, after hours, Sunday/holiday).
-- Run once after 0004: SQL Editor > New query > paste the whole file > Run.
alter table time_entries add column bill_period text not null default 'regular'
  check (bill_period in ('regular', 'after_hours', 'holiday'));
update time_entries set bill_period = 'after_hours' where after_hours;
alter table time_entries drop column after_hours;

-- Sunday and holiday price. Blank means the contract has none and the after-hours price is used.
alter table contract_rates add column holiday numeric(10, 2) check (holiday is null or holiday >= 0);
