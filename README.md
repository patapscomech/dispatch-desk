# Dispatch Desk

Dispatch, hours, parts and billing for Patapsco Mechanical service and project crews.

**Status:** Phases 1 and 2 (sign-in, hours, approvals, timesheets, payroll sheet; customers, locations, equipment, dispatch board, checklists, parts, photos, service history, offline). The clickable prototype that settles the screens and billing rules is in `docs/prototype.html` (open it in a browser).

## What Phase 1 does
- Everyone signs in with email and password. Roles: owner, office, foreman, technician.
- Every hour goes on a ticket, a project (optionally a task) or shop time. Daily and weekly totals are shown.
- Technicians submit the week; a foreman, the office or the owner approves (nobody but the office approves their own hours, and foremen cannot).
- Timesheet per person (jobs down, days across), a payroll sheet CSV (one row per person), and a detail CSV. Approved hours can be marked exported.
- The database enforces the rules (see `supabase/migrations/0001_phase1.sql`), not just the screens.

## What Phase 2 adds
- **Customers > locations > equipment** (office). Technicians can add a unit they find on site.
- **Jobs**: tickets and projects tied to a customer and location, with priority and description.
- **Dispatch board**: week grid of people by day. Assign several people over several days (weekdays) to one job; unscheduled jobs wait in a list.
- **My work** (technicians): assigned calls by day. Each call opens to Overview, History, Checklist, Parts, Photos and Hours.
- **Checklists**: templates are plain text or CSV and can be imported. A call with a checklist cannot be completed until every item is ticked and every reading entered. The office can close it anyway with a required reason; the reason, who and when are saved and shown on the call. Unticking an item reopens a call that was closed normally.
- **Technicians can dispatch a call to themselves** (My work > New call for myself): customer, location and the contract the work is under (only that customer's active contracts are offered). The call is numbered `SD-yymmdd-n`, assigned to them for today and started. Service tickets only; they cannot change customer, location or contract afterward (the office can). The office sees these flagged "self-dispatched" and can filter for them on the Jobs tab. Works without signal.
- **Contracts** (office, Customers tab): name, type, prevailing-wage flag, dates, on/off. Rates and billing rules come in the billing phase.
- **Parts and photos**: parts by source (stock, purchased, supplier PO, subcontractor), invoice or receipt photo for purchases, job photos by type and unit. Technicians can enter a part's cost but never read it back; only the office sees costs.
- **Service history**: the site's earlier visits and each unit's findings, work done and parts.
- **No signal**: the app saves the technician's assigned calls and their sites on the phone. Hours, checklist ticks, findings, parts and photos entered without signal are kept in a queue and sent, in order, when coverage returns. A banner shows how many are waiting, and shows anything the server refused.

## One-time setup
1. **Supabase** (already created). Open the project, go to SQL Editor, paste the **contents** of each migration file in order (`0001_phase1.sql`, `0002_phase2.sql`, then `0003_contracts_self_dispatch.sql`), and Run each once. Copy the file text, not its name.
2. In Supabase go to Authentication, Sign In / Providers, and turn **off** "Allow new users to sign up". Then Authentication, Users, **Add user** for each person (email plus a starting password). The **first** user you add becomes the owner; everyone after that starts as a technician and the office sets their role on the People screen.
3. **Netlify**: Add new site, Import from GitHub, choose `patapscomech/dispatch-desk`. Build command `npm run build`, publish directory `dist` (already in `netlify.toml`). No environment variables are required; `.env.example` shows the two public values if you want to override them.
4. In Supabase, Authentication, URL Configuration, set the Site URL to your Netlify address so password-reset emails link back to the app.
5. On a phone, open the Netlify address and use Add to Home Screen.

## Develop
```
npm install
npm run dev      # local site
npm test         # unit tests (hour totals, timesheet, CSV, dates)
npm run build    # type-check and production build
```

## Notes
- The pay week starts on Monday (`WEEK_START` in `src/lib/dates.ts`). Change it if payroll uses a different week.
- The publishable key in `src/supabase.ts` is meant to be public. The secret / service-role key must never be committed.
- Offline limits: unsent changes live in the phone's browser storage, so do not clear site data or remove the app until the banner clears. iPhone can discard saved data for sites not used for about a week unless the app is added to the Home Screen. Photos already uploaded are viewed with signal; a thumbnail cache is a later improvement. Calls dispatched while a technician is out of coverage cannot be saved ahead of time.
- Not built yet: projects with budgets and time by task reports, billing (T&M, cost plus, fixed, PM), QuickBooks Online, certified payroll report, push notifications, per-foreman crews.
