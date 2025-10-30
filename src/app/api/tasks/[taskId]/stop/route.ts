import { supabase } from '@/lib/supabase';
import { NextRequest } from 'next/server';

/**
 * POST /api/tasks/[taskId]/stop
 *
 * Stops a running task by updating its status to 'stopped'.
 * The task can be resumed later when the user sends a new message.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  console.log('🛑 Stop task endpoint called');

  try {
    const { taskId } = await params;

    if (!taskId) {
      return Response.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    console.log(`🛑 Stopping task: ${taskId}`);

    // Check if task exists and is in a stoppable state
    const { data: existingTask, error: fetchError } = await supabase
      .from('tasks')
      .select('id, status, session_id')
      .eq('id', taskId)
      .single();

    if (fetchError || !existingTask) {
      console.error('❌ Task not found:', fetchError);
      return Response.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    // Only allow stopping tasks that are currently running
    if (existingTask.status !== 'running') {
      console.log(`⚠️ Task ${taskId} is not running (status: ${existingTask.status})`);
      return Response.json(
        {
          error: 'Task is not running',
          currentStatus: existingTask.status
        },
        { status: 400 }
      );
    }

    // Update task status to stopped
    const { error: updateError } = await supabase
      .from('tasks')
      .update({
        status: 'stopped'
        // Note: current_iteration is already being tracked by the sampling loop
      })
      .eq('id', taskId);

    if (updateError) {
      console.error('❌ Failed to stop task:', updateError);
      return Response.json(
        { error: 'Failed to stop task', details: updateError.message },
        { status: 500 }
      );
    }

    console.log(`✅ Task ${taskId} stopped successfully`);

    return Response.json({
      success: true,
      taskId: taskId,
      status: 'stopped',
      message: 'Task stopped successfully. It can be resumed by sending a new message.',
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('❌ Stop task error:', error);
    return Response.json(
      {
        error: 'Internal server error',
        message: error?.message || 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}
