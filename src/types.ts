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
export type JobStatus = 'unassigned' | 'scheduled' | 'in_progress' | 'on_hold' | 'complete' | 'closed'
export const STATUS_LABEL: Record<JobStatus, string> = {
  unassigned: 'Unassigned',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  on_hold: 'On hold',
  complete: 'Complete',
  closed: 'Closed',
}
export const PRIORITIES = ['Low', 'Normal', 'High', 'Emergency'] as const
export interface Job {
  id: string
  number: string
  kind: 'ticket' | 'project'
  title: string
  customer_id: string | null
  location_id: string | null
  status: JobStatus
  priority: (typeof PRIORITIES)[number]
  description: string
  start_date: string | null
  end_date: string | null
  resolution: string
  prevailing_wage: boolean
  close_override_reason: string | null
  close_override_by: string | null
  close_override_at: string | null
}
export interface Location {
  id: string
  customer_id: string
  name: string
  address: string
  access_notes: string
}
export interface Equipment {
  id: string
  location_id: string
  tag: string
  type: string
  make: string
  model: string
  serial: string
  area: string
  install_year: number | null
  notes: string
  active: boolean
}
export interface Assignment {
  id: string
  job_id: string
  employee_id: string
  work_date: string
  is_lead: boolean
}
export interface JobEquip {
  job_id: string
  equipment_id: string
  findings: string
}
export interface ChecklistItem {
  id: string
  job_id: string
  position: number
  kind: 'check' | 'value' | 'head'
  text: string
  done: boolean
  value: string
}
export interface Template {
  id: string
  name: string
  body: string
}
export const PART_SOURCES = ['Stock', 'Purchased', 'Supplier PO', 'Subcontractor'] as const
export interface JobPart {
  id: string
  job_id: string
  description: string
  qty: number
  source: (typeof PART_SOURCES)[number]
  vendor: string
  invoice_path: string | null
}
export interface JobPhoto {
  id: string
  job_id: string
  equipment_id: string | null
  kind: 'before' | 'during' | 'after' | 'issue' | 'nameplate'
  caption: string
  path: string
}
export interface Task {
  id: string
  job_id: string
  name: string
}
export interface Customer {
  id: string
  name: string
  billing_address?: string
  notes?: string
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
