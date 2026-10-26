import { supabase } from '../supabase'
import { addDays, today } from './dates'
import { cached, remember } from './offline'
import type { Assignment, ChecklistItem, Customer, Equipment, Job, JobEquip, JobPart, JobPhoto, Location } from '../types'

export interface JobBundle {
  job: Job
  location: Location | null
  customer: Customer | null
  equipment: Equipment[] // every unit at the site
  jobEquip: JobEquip[]
  assignments: Assignment[]
  checklist: ChecklistItem[]
  parts: JobPart[]
  costs: Record<string, number> // office only; empty for technicians
  photos: JobPhoto[]
}

export interface SiteHistory {
  location: Location | null
  equipment: Equipment[]
  jobs: Job[] // past and current jobs at the site, newest first
  jobEquip: JobEquip[]
  parts: JobPart[]
}

const must = <T>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message)
  return r.data as T
}

export async function fetchJobBundle(jobId: string): Promise<JobBundle> {
  const job = must(await supabase.from('jobs').select('*').eq('id', jobId).single()) as Job
  const [loc, cust, equip, je, asg, cl, parts, costs, photos] = await Promise.all([
    job.location_id ? supabase.from('locations').select('*').eq('id', job.location_id).single() : null,
    job.customer_id ? supabase.from('customers').select('*').eq('id', job.customer_id).single() : null,
    job.location_id ? supabase.from('equipment').select('*').eq('location_id', job.location_id).order('tag') : null,
    supabase.from('job_equipment').select('*').eq('job_id', jobId),
    supabase.from('job_assignments').select('*').eq('job_id', jobId).order('work_date'),
    supabase.from('job_checklist_items').select('*').eq('job_id', jobId).order('position'),
    supabase.from('job_parts').select('*').eq('job_id', jobId).order('created_at'),
    supabase.from('job_part_costs').select('*'),
    supabase.from('job_photos').select('*').eq('job_id', jobId).order('created_at'),
  ])
  const partRows = must(parts) as JobPart[]
  const ids = new Set(partRows.map((p) => p.id))
  const costMap: Record<string, number> = {}
  ;((costs.data as { part_id: string; unit_cost: number }[] | null) ?? []).forEach((c) => {
    if (ids.has(c.part_id)) costMap[c.part_id] = Number(c.unit_cost)
  })
  return {
    job,
    location: loc ? (must(loc) as Location) : null,
    customer: cust ? (must(cust) as Customer) : null,
    equipment: equip ? (must(equip) as Equipment[]) : [],
    jobEquip: must(je) as JobEquip[],
    assignments: must(asg) as Assignment[],
    checklist: must(cl) as ChecklistItem[],
    parts: partRows,
    costs: costMap,
    photos: must(photos) as JobPhoto[],
  }
}

export async function fetchSite(locationId: string): Promise<SiteHistory> {
  const [loc, equip, jobs] = await Promise.all([
    supabase.from('locations').select('*').eq('id', locationId).single(),
    supabase.from('equipment').select('*').eq('location_id', locationId).order('tag'),
    supabase.from('jobs').select('*').eq('location_id', locationId).order('created_at', { ascending: false }).limit(80),
  ])
  const jobRows = must(jobs) as Job[]
  const ids = jobRows.map((j) => j.id)
  const [je, parts] = ids.length
    ? await Promise.all([
        supabase.from('job_equipment').select('*').in('job_id', ids),
        supabase.from('job_parts').select('*').in('job_id', ids),
      ])
    : [{ data: [], error: null }, { data: [], error: null }]
  return {
    location: must(loc) as Location,
    equipment: must(equip) as Equipment[],
    jobs: jobRows,
    jobEquip: must(je) as JobEquip[],
    parts: must(parts) as JobPart[],
  }
}

export const loadJob = (id: string) => cached(`job:${id}`, () => fetchJobBundle(id))
export const loadSite = (id: string) => cached(`site:${id}`, () => fetchSite(id))
export const saveJob = (b: JobBundle) => remember(`job:${b.job.id}`, b)

// Assigned calls for the coming days; also saves each call and its site for no-signal use.
export async function loadMyWork(employeeId: string, jobs: Job[]) {
  const from = addDays(today(), -1)
  const to = addDays(today(), 14)
  const r = await cached<Assignment[]>(`mywork:${employeeId}`, async () => {
    const q = await supabase.from('job_assignments').select('*').eq('employee_id', employeeId)
      .gte('work_date', from).lte('work_date', to).order('work_date')
    return must(q) as Assignment[]
  })
  return { assignments: r.data ?? [], fromCache: r.fromCache, jobs }
}

// Called when signed in with signal: keep my calls and their sites on the phone.
export async function prefetchMyWork(employeeId: string) {
  try {
    const from = addDays(today(), -1)
    const to = addDays(today(), 14)
    const q = await supabase.from('job_assignments').select('*').eq('employee_id', employeeId)
      .gte('work_date', from).lte('work_date', to).order('work_date')
    const asg = must(q) as Assignment[]
    await remember(`mywork:${employeeId}`, asg)
    const jobIds = [...new Set(asg.map((a) => a.job_id))]
    const sites = new Set<string>()
    for (const id of jobIds) {
      const b = await fetchJobBundle(id)
      await saveJob(b)
      if (b.job.location_id) sites.add(b.job.location_id)
    }
    for (const s of sites) await remember(`site:${s}`, await fetchSite(s))
  } catch {
    /* no signal: keep whatever is already saved */
  }
}
