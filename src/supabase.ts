import { createClient } from '@supabase/supabase-js'

// Both values are public by design (the publishable key only works within the
// row-level security rules in supabase/migrations). Never put the secret key here.
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://byvbngxvxhosgagrjotd.supabase.co'
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_rsIKUNBlAsHI41hGZZbCLg_VGqRPijy'

export const supabase = createClient(url, key)
