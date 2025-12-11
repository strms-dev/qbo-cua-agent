/**
 * GET /api/dashboard/sessions - List all chat sessions with metrics
 *
 * Query params:
 * - startDate: ISO date string (optional)
 * - endDate: ISO date string (optional)
 * - limit: number (default 50)
 * - offset: number (default 0)
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export interface SessionWithMetrics {
  id: string;
  created_at: string;
  status: string;
  total_conversation_time_ms: number | null;
  total_iterations: number | null;
  completed_at: string | null;
  task_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number;
  metadata: Record<string, any>;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  try {
    // Build query for sessions with stored token totals and task count
    let query = supabase
      .from('chat_sessions')
      .select(`
        id,
        created_at,
        status,
        total_conversation_time_ms,
        total_iterations,
        completed_at,
        metadata,
        total_input_tokens,
        total_output_tokens,
        total_cost,
        tasks:tasks(count)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply date filters
    if (startDate) {
      query = query.gte('created_at', startDate);
    }
    if (endDate) {
      query = query.lte('created_at', endDate);
    }

    const { data: sessions, error, count } = await query;

    if (error) {
      console.error('Error fetching sessions:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Transform response with stored token totals (no aggregation needed)
    const transformedSessions: SessionWithMetrics[] = (sessions || []).map((session: any) => ({
      id: session.id,
      created_at: session.created_at,
      status: session.status,
      total_conversation_time_ms: session.total_conversation_time_ms || 0,
      total_iterations: session.total_iterations || 0,
      completed_at: session.completed_at,
      metadata: session.metadata,
      task_count: session.tasks?.[0]?.count || 0,
      total_input_tokens: session.total_input_tokens || 0,
      total_output_tokens: session.total_output_tokens || 0,
      total_cost: session.total_cost || 0,
    }));

    return NextResponse.json({
      sessions: transformedSessions,
      total: count || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Unexpected error in sessions API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
