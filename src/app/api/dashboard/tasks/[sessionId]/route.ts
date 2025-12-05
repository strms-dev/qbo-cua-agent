/**
 * GET /api/dashboard/tasks/[sessionId] - List all tasks for a session
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export interface TaskWithMetrics {
  id: string;
  session_id: string;
  status: string;
  user_message: string;
  result_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  current_iteration: number | null;
  max_iterations: number | null;
  agent_status: string | null;
  agent_message: string | null;
  error_message: string | null;
  duration_ms: number | null;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  try {
    const { data: tasks, error } = await supabase
      .from('tasks')
      .select(`
        id,
        session_id,
        status,
        user_message,
        result_message,
        created_at,
        started_at,
        completed_at,
        current_iteration,
        max_iterations,
        agent_status,
        agent_message,
        error_message
      `)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching tasks:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get task IDs for token aggregation
    const taskIds = (tasks || []).map((t: any) => t.id);

    // Fetch token metrics from performance_metrics table
    let tokenTotals: Record<string, { input: number; output: number }> = {};
    if (taskIds.length > 0) {
      const { data: tokenAggregates } = await supabase
        .from('performance_metrics')
        .select('task_id, input_tokens, output_tokens')
        .in('task_id', taskIds);

      // Aggregate by task_id
      (tokenAggregates || []).forEach((row: any) => {
        if (!tokenTotals[row.task_id]) {
          tokenTotals[row.task_id] = { input: 0, output: 0 };
        }
        tokenTotals[row.task_id].input += row.input_tokens || 0;
        tokenTotals[row.task_id].output += row.output_tokens || 0;
      });
    }

    // Calculate duration and add token totals for each task
    const tasksWithDuration: TaskWithMetrics[] = (tasks || []).map((task: any) => {
      let duration_ms: number | null = null;
      if (task.started_at && task.completed_at) {
        duration_ms = new Date(task.completed_at).getTime() - new Date(task.started_at).getTime();
      }
      const taskTokens = tokenTotals[task.id];
      return {
        ...task,
        duration_ms,
        total_input_tokens: taskTokens?.input || null,
        total_output_tokens: taskTokens?.output || null,
      };
    });

    return NextResponse.json({ tasks: tasksWithDuration });
  } catch (error) {
    console.error('Unexpected error in tasks API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
