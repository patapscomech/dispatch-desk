import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { isApprover, isOffice, ROLE_LABEL, type Job, type Profile, type Task, type Customer, type Location, type Template } from './types'
import { cached, clearFailed, onSync, startSync, flush, type SyncState } from './lib/offline'
import { prefetchMyWork } from './lib/field'
import MyWork from './views/MyWork'
import Dispatch from './views/Dispatch'
import Customers from './views/Customers'
import Checklists from './views/Checklists'
import JobDetail from './views/JobDetail'
import Login from './views/Login'
import Hours from './views/Hours'
import Approvals from './views/Approvals'
import Timesheets from './views/Timesheets'
import Jobs from './views/Jobs'
import People from './views/People'

export interface Data {
  me: Profile
  people: Profile[]
  jobs: Job[]
  tasks: Task[]
  customers: Customer[]
  locations: Location[]
  templates: Template[]
  reload: () => Promise<void>
  openJob: (id: string) => void
  goHours: (jobId: string) => void
}

type Tab = 'work' | 'dispatch' | 'jobs' | 'customers' | 'checklists' | 'hours' | 'approvals' | 'timesheets' | 'people'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [data, setData] = useState<Omit<Data, 'reload' | 'openJob' | 'goHours'> | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('work')
  const [jobId, setJobId] = useState<string | null>(null)
  const [hoursJob, setHoursJob] = useState('')
  const [sync, setSync] = useState<SyncState>({ waiting: 0, failed: [], online: true })

  useEffect(() => { startSync(); return onSync(setSync) }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const load = useCallback(async () => {
    if (!session) return
    await flush()
    const uid = session.user.id
    const r = await cached(`base:${uid}`, async () => {
      const [p, j, t, c, l, tp] = await Promise.all([
        supabase.from('profiles').select('*').order('full_name'),
        supabase.from('jobs').select('*').order('number'),
        supabase.from('job_tasks').select('*').order('name'),
        supabase.from('customers').select('*').order('name'),
        supabase.from('locations').select('*').order('name'),
        supabase.from('checklist_templates').select('*').order('name'),
      ])
      const err = p.error || j.error || t.error || c.error || l.error || tp.error
      if (err) throw new Error(err.message)
      return {
        people: p.data as Profile[], jobs: j.data as Job[], tasks: t.data as Task[],
        customers: c.data as Customer[], locations: l.data as Location[], templates: tp.data as Template[],
      }
    })
    if (!r.data) {
      setError('Could not load. Check your signal and try again.')
      return
    }
    const me = r.data.people.find((x) => x.id === uid)
    if (!me) {
      setError('Your login has no profile yet. Ask the office to check your account.')
      return
    }
    setError('')
    setData({ ...r.data, me })
    if (!r.fromCache) prefetchMyWork(uid)
  }, [session])

  useEffect(() => {
    if (session) load()
    else setData(null)
  }, [session, load])

  if (session === undefined) return <div className="center muted">Loading…</div>
  if (!session) return <Login />
  if (error)
    return (
      <div className="center">
        <p className="err">{error}</p>
        <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    )
  if (!data) return <div className="center muted">Loading…</div>

  const d: Data = { ...data, reload: load, openJob: (id) => setJobId(id), goHours: (id) => { setHoursJob(id); setJobId(null); setTab('hours') } }
  const { me } = d
  if (!me.active)
    return (
      <div className="center">
        <p>Your account is turned off. Please contact the office.</p>
        <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    )

  const tabs: [Tab, string][] = [['work', 'My work'], ['hours', 'My hours']]
  if (isApprover(me.role)) tabs.push(['dispatch', 'Dispatch'], ['approvals', 'Approvals'], ['timesheets', 'Timesheets'])
  if (isOffice(me.role)) tabs.push(['jobs', 'Jobs'], ['customers', 'Customers'], ['checklists', 'Checklists'], ['people', 'People'])
  const current = tabs.some(([t]) => t === tab) ? tab : 'work'

  return (
    <div className="app">
      <header className="top">
        <div>
          <b>Dispatch Desk</b>
          <span className="muted sm"> · {me.full_name} · {ROLE_LABEL[me.role]}</span>
        </div>
        <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      {(!sync.online || sync.waiting > 0 || sync.failed.length > 0) && (
        <div className="syncbar" role="status">
          {!sync.online && <span>No signal. </span>}
          {sync.waiting > 0 && <span>{sync.waiting} change{sync.waiting === 1 ? '' : 's'} waiting to send. Keep the app open until this clears. </span>}
          {sync.failed.length > 0 && (
            <span className="warn-t">{sync.failed.length} change{sync.failed.length === 1 ? ' was' : 's were'} refused: {sync.failed.map((f) => f.message).slice(0, 2).join('; ')} <button className="link" onClick={clearFailed}>Dismiss</button></span>
          )}
        </div>
      )}
      <nav className="tabs" aria-label="Sections">
        {tabs.map(([t, l]) => (
          <button key={t} className={t === current ? 'tab on' : 'tab'} onClick={() => setTab(t)}>{l}</button>
        ))}
      </nav>
      <main>
        {current === 'work' && <MyWork d={d} />}
        {current === 'dispatch' && <Dispatch d={d} />}
        {current === 'customers' && <Customers d={d} />}
        {current === 'checklists' && <Checklists d={d} />}
        {current === 'hours' && <Hours d={d} presetJob={hoursJob} />}
        {current === 'approvals' && <Approvals d={d} />}
        {current === 'timesheets' && <Timesheets d={d} />}
        {current === 'jobs' && <Jobs d={d} />}
        {current === 'people' && <People d={d} />}
      </main>
      {jobId && <JobDetail d={d} id={jobId} onClose={() => setJobId(null)} />}
    </div>
  )
}
