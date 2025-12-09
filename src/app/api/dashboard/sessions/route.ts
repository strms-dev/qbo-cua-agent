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
  metadata: Record<string, any>;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  try {
    // Build query for sessions with task count
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

    // Get session IDs for aggregation queries
    const sessionIds = (sessions || []).map((s: any) => s.id);

    // Aggregate task metrics per session (actual total time and iterations from tasks)
    let sessionTaskMetrics: Record<string, { totalDurationMs: number; totalIterations: number }> = {};
    if (sessionIds.length > 0) {
      const { data: taskAggregates } = await supabase
        .from('tasks')
        .select('session_id, current_iteration, started_at, completed_at')
        .in('session_id', sessionIds);

      (taskAggregates || []).forEach((task: any) => {
        if (!sessionTaskMetrics[task.session_id]) {
          sessionTaskMetrics[task.session_id] = { totalDurationMs: 0, totalIterations: 0 };
        }
        // Add iterations
        sessionTaskMetrics[task.session_id].totalIterations += task.current_iteration || 0;
        // Add duration
        if (task.started_at && task.completed_at) {
          const duration = new Date(task.completed_at).getTime() - new Date(task.started_at).getTime();
          sessionTaskMetrics[task.session_id].totalDurationMs += duration;
        }
      });
    }

    // Aggregate token metrics per session from performance_metrics
    let sessionTokenMetrics: Record<string, { input: number; output: number }> = {};
    if (sessionIds.length > 0) {
      const { data: tokenAggregates } = await supabase
        .from('performance_metrics')
        .select('session_id, input_tokens, output_tokens')
        .in('session_id', sessionIds);

      (tokenAggregates || []).forEach((row: any) => {
        if (!sessionTokenMetrics[row.session_id]) {
          sessionTokenMetrics[row.session_id] = { input: 0, output: 0 };
        }
        sessionTokenMetrics[row.session_id].input += row.input_tokens || 0;
        sessionTokenMetrics[row.session_id].output += row.output_tokens || 0;
      });
    }

    // Transform response with aggregated metrics
    const transformedSessions: SessionWithMetrics[] = (sessions || []).map((session: any) => {
      const taskMetrics = sessionTaskMetrics[session.id];
      const tokenMetrics = sessionTokenMetrics[session.id];

      return {
        id: session.id,
        created_at: session.created_at,
        status: session.status,
        // Use aggregated task metrics instead of denormalized fields
        total_conversation_time_ms: taskMetrics?.totalDurationMs || 0,
        total_iterations: taskMetrics?.totalIterations || 0,
        completed_at: session.completed_at,
        metadata: session.metadata,
        task_count: session.tasks?.[0]?.count || 0,
        total_input_tokens: tokenMetrics?.input || 0,
        total_output_tokens: tokenMetrics?.output || 0,
      };
    });

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
