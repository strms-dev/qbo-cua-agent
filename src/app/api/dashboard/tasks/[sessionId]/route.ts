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
  total_cost: number | null;
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
    // Fetch tasks with stored token totals (no aggregation needed)
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
        error_message,
        total_input_tokens,
        total_output_tokens,
        total_cost
      `)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching tasks:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Calculate duration for each task (duration is derived, not stored)
    const tasksWithDuration: TaskWithMetrics[] = (tasks || []).map((task: any) => {
      let duration_ms: number | null = null;
      if (task.started_at && task.completed_at) {
        duration_ms = new Date(task.completed_at).getTime() - new Date(task.started_at).getTime();
      }
      return {
        ...task,
        duration_ms,
      };
    });

    return NextResponse.json({ tasks: tasksWithDuration });
  } catch (error) {
    console.error('Unexpected error in tasks API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
