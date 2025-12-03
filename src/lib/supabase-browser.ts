/**
 * Browser-compatible Supabase client for client components ('use client')
 *
 * This client uses NEXT_PUBLIC_ prefixed environment variables which are
 * available in both server and browser contexts in Next.js.
 *
 * Use this client in client components (like ChatPanel.tsx) for:
 * - Supabase Realtime subscriptions
 * - Any client-side Supabase operations
 *
 * For server-side operations, use the regular `supabase` client from './supabase'
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Warn if env vars are missing (helpful for debugging)
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '⚠️ Supabase browser client: Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
    'Realtime subscriptions will not work. ' +
    'Add these to your .env.local file.'
  );
}

export const supabaseBrowser = createClient(supabaseUrl, supabaseAnonKey);
