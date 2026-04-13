import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const hasServerConfig = Boolean(url && serviceKey);

export const supabaseAdmin = hasServerConfig
  ? createClient(url, serviceKey, { auth: { persistSession: false } })
  : null;

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function ensureServerConfig() {
  if (!hasServerConfig) {
    throw new Error('Server integration missing Supabase server credentials.');
  }
}
