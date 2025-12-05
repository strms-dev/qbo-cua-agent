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
  // Token usage metrics
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  context_cleared_tokens: number | null;
  context_cleared_tool_uses: number | null;
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
        input_tokens,
        output_tokens,
        cache_read_input_tokens,
        cache_creation_input_tokens,
        context_cleared_tokens,
        context_cleared_tool_uses,
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
