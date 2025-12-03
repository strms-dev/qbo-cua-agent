/**
 * GET /api/files - List and search downloaded files
 *
 * Query params:
 * - practice: Filter by practice_protect_name (partial match)
 * - bankAccount: Filter by bank_account_name (partial match)
 * - startDate: ISO date string (optional)
 * - endDate: ISO date string (optional)
 * - limit: number (default 50)
 * - offset: number (default 0)
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export interface DownloadedFile {
  id: string;
  filename: string;
  supabase_path: string;
  supabase_url: string | null;
  file_size: number | null;
  content_type: string | null;
  file_type: string;
  practice_protect_name: string;
  bank_account_name: string;
  quickbooks_company_name: string;
  quickbooks_bank_account_name: string;
  downloaded_at: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const practice = searchParams.get('practice');
  const bankAccount = searchParams.get('bankAccount');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  try {
    let query = supabase
      .from('downloaded_files')
      .select(`
        id,
        filename,
        supabase_path,
        supabase_url,
        file_size,
        content_type,
        file_type,
        practice_protect_name,
        bank_account_name,
        quickbooks_company_name,
        quickbooks_bank_account_name,
        downloaded_at
      `, { count: 'exact' })
      .order('downloaded_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (practice) {
      query = query.ilike('practice_protect_name', `%${practice}%`);
    }
    if (bankAccount) {
      query = query.ilike('bank_account_name', `%${bankAccount}%`);
    }
    if (startDate) {
      query = query.gte('downloaded_at', startDate);
    }
    if (endDate) {
      query = query.lte('downloaded_at', endDate);
    }

    const { data: files, error, count } = await query;

    if (error) {
      console.error('Error fetching files:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Also fetch distinct values for filters
    const { data: practices } = await supabase
      .from('downloaded_files')
      .select('practice_protect_name')
      .order('practice_protect_name');

    const { data: bankAccounts } = await supabase
      .from('downloaded_files')
      .select('bank_account_name')
      .order('bank_account_name');

    // Get unique values
    const uniquePractices = [...new Set((practices || []).map(p => p.practice_protect_name))];
    const uniqueBankAccounts = [...new Set((bankAccounts || []).map(b => b.bank_account_name))];

    return NextResponse.json({
      files: files || [],
      total: count || 0,
      limit,
      offset,
      filters: {
        practices: uniquePractices,
        bankAccounts: uniqueBankAccounts,
      },
    });
  } catch (error) {
    console.error('Unexpected error in files API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
