# Dispatch Desk

Dispatch, hours, parts and billing for Patapsco Mechanical service and project crews.

**Status:** Phase 1 (sign-in, hours entry, approval, timesheets, payroll sheet). The clickable prototype that settles the screens and billing rules is in `docs/prototype.html` (open it in a browser).

## What Phase 1 does
- Everyone signs in with email and password. Roles: owner, office, foreman, technician.
- Every hour goes on a ticket, a project (optionally a task) or shop time. Daily and weekly totals are shown.
- Technicians submit the week; a foreman, the office or the owner approves (nobody but the office approves their own hours, and foremen cannot).
- Timesheet per person (jobs down, days across), a payroll sheet CSV (one row per person), and a detail CSV. Approved hours can be marked exported.
- The database enforces the rules (see `supabase/migrations/0001_phase1.sql`), not just the screens.

## One-time setup
1. **Supabase** (already created). Open the project, go to SQL Editor, paste all of `supabase/migrations/0001_phase1.sql`, and Run it once.
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
- Not in Phase 1 yet: dispatch board, checklists, photos, parts, billing, QuickBooks, offline mode. See the build plan.
