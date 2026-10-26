import { useState } from 'react'
import { supabase } from '../supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setMsg('That email and password did not work.')
    setBusy(false)
  }
  async function reset() {
    if (!email.trim()) return setMsg('Enter your email first, then tap "Forgot password".')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin })
    setMsg(error ? error.message : 'Check your email for a link to set a new password.')
  }

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <h1>Dispatch Desk</h1>
        <p className="muted">Patapsco Mechanical</p>
        <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {msg && <p className="err" role="alert">{msg}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="link" onClick={reset}>Forgot password</button>
      </form>
    </div>
  )
}
