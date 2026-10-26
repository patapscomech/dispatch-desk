import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { isApprover, isOffice, ROLE_LABEL, type Job, type Profile, type Task, type Customer } from './types'
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
  reload: () => Promise<void>
}

type Tab = 'hours' | 'approvals' | 'timesheets' | 'jobs' | 'people'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [data, setData] = useState<Omit<Data, 'reload'> | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('hours')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const load = useCallback(async () => {
    if (!session) return
    const [p, j, t, c] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('jobs').select('*').order('number'),
      supabase.from('job_tasks').select('*').order('name'),
      supabase.from('customers').select('*').order('name'),
    ])
    const err = p.error || j.error || t.error || c.error
    if (err) {
      setError(err.message)
      return
    }
    const people = p.data as Profile[]
    const me = people.find((x) => x.id === session.user.id)
    if (!me) {
      setError('Your login has no profile yet. Ask the office to check your account.')
      return
    }
    setError('')
    setData({ me, people, jobs: j.data as Job[], tasks: t.data as Task[], customers: c.data as Customer[] })
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

  const d: Data = { ...data, reload: load }
  const { me } = d
  if (!me.active)
    return (
      <div className="center">
        <p>Your account is turned off. Please contact the office.</p>
        <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    )

  const tabs: [Tab, string][] = [['hours', 'My hours']]
  if (isApprover(me.role)) tabs.push(['approvals', 'Approvals'], ['timesheets', 'Timesheets'])
  if (isOffice(me.role)) tabs.push(['jobs', 'Jobs'], ['people', 'People'])
  const current = tabs.some(([t]) => t === tab) ? tab : 'hours'

  return (
    <div className="app">
      <header className="top">
        <div>
          <b>Dispatch Desk</b>
          <span className="muted sm"> · {me.full_name} · {ROLE_LABEL[me.role]}</span>
        </div>
        <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      <nav className="tabs" aria-label="Sections">
        {tabs.map(([t, l]) => (
          <button key={t} className={t === current ? 'tab on' : 'tab'} onClick={() => setTab(t)}>{l}</button>
        ))}
      </nav>
      <main>
        {current === 'hours' && <Hours d={d} />}
        {current === 'approvals' && <Approvals d={d} />}
        {current === 'timesheets' && <Timesheets d={d} />}
        {current === 'jobs' && <Jobs d={d} />}
        {current === 'people' && <People d={d} />}
      </main>
    </div>
  )
}
