import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = hasSupabaseConfig ? createClient(supabaseUrl, supabaseAnonKey) : null;
export const GALLERY_BUCKET = import.meta.env.VITE_SUPABASE_GALLERY_BUCKET || 'gallery';
export const INVENTORY_RECEIPTS_BUCKET = import.meta.env.VITE_SUPABASE_INVENTORY_RECEIPTS_BUCKET || 'inventory-receipts';
