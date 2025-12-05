'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Creates a Supabase client for browser-side operations (Client Components)
 * This client properly handles auth cookies for session management.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
