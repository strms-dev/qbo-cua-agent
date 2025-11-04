import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET /api/tasks/[taskId] - Get task details by ID
export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    const { data: task, error } = await supabase
      .from('tasks')
      .select('id, status, session_id, browser_session_id, batch_execution_id, current_iteration, max_iterations, started_at, completed_at, user_message, agent_status, agent_message, config_overrides')
      .eq('id', taskId)
      .single();

    if (error || !task) {
      return NextResponse.json(
        { error: 'Task not found', details: error?.message },
        { status: 404 }
      );
    }

    return NextResponse.json(task);
  } catch (error: any) {
    console.error('Error fetching task:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
