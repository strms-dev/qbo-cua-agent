/**
 * GET /api/dashboard/iterations/[taskId] - List all iterations (performance metrics) for a task
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export interface IterationMetrics {
  id: string;
  session_id: string;
  task_id: string | null;
  message_id: string | null;
  iteration: number;
  api_response_time_ms: number | null;
  tool_execution_time_ms: number | null;
  iteration_total_time_ms: number | null;
  metadata: Record<string, any>;
  created_at: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  if (!taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  }

  try {
    const { data: iterations, error } = await supabase
      .from('performance_metrics')
      .select(`
        id,
        session_id,
        task_id,
        message_id,
        iteration,
        api_response_time_ms,
        tool_execution_time_ms,
        iteration_total_time_ms,
        metadata,
        created_at
      `)
      .eq('task_id', taskId)
      .order('iteration', { ascending: true });

    if (error) {
      console.error('Error fetching iterations:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ iterations: iterations || [] });
  } catch (error) {
    console.error('Unexpected error in iterations API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
