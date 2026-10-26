export type Role = 'owner' | 'office' | 'foreman' | 'technician'
export type PayType = 'regular' | 'ot'
export type Status = 'open' | 'submitted' | 'approved' | 'exported'

export interface Profile {
  id: string
  full_name: string
  email: string | null
  role: Role
  classification: string
  active: boolean
}
export interface Job {
  id: string
  number: string
  kind: 'ticket' | 'project'
  title: string
  customer_id: string | null
  status: 'open' | 'closed'
  prevailing_wage: boolean
}
export interface Task {
  id: string
  job_id: string
  name: string
}
export interface Customer {
  id: string
  name: string
}
export interface Entry {
  id: string
  employee_id: string
  work_date: string
  hours: number
  pay_type: PayType
  job_id: string | null
  task_id: string | null
  notes: string
  status: Status
  classification: string
  prevailing_wage: boolean
}

export const CLASSES = ['Foreman', 'Journeyman', 'Apprentice', 'Helper'] as const
export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  office: 'Office',
  foreman: 'Foreman',
  technician: 'Technician',
}
export const isApprover = (r: Role) => r === 'owner' || r === 'office' || r === 'foreman'
export const isOffice = (r: Role) => r === 'owner' || r === 'office'
