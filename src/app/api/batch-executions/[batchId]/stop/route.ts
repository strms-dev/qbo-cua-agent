import { supabase } from '@/lib/supabase';
import { NextRequest } from 'next/server';

/**
 * POST /api/batch-executions/[batchId]/stop
 *
 * Stops an entire batch execution:
 * 1. Updates the batch_executions record status to 'stopped'
 * 2. Stops the currently running task (if any)
 * 3. Marks all queued tasks as 'stopped' (prevents them from starting)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  console.log('🛑 Stop batch execution endpoint called');

  try {
    const { batchId } = await params;

    if (!batchId) {
      return Response.json(
        { error: 'Batch ID is required' },
        { status: 400 }
      );
    }

    console.log(`🛑 Stopping batch execution: ${batchId}`);

    // 1. Check if batch exists and is in a stoppable state
    const { data: existingBatch, error: fetchError } = await supabase
      .from('batch_executions')
      .select('id, status, session_id')
      .eq('id', batchId)
      .single();

    if (fetchError || !existingBatch) {
      console.error('❌ Batch execution not found:', fetchError);
      return Response.json(
        { error: 'Batch execution not found' },
        { status: 404 }
      );
    }

    // Only allow stopping batches that are currently running
    if (existingBatch.status !== 'running') {
      console.log(`⚠️ Batch ${batchId} is not running (status: ${existingBatch.status})`);
      return Response.json(
        {
          error: 'Batch execution is not running',
          currentStatus: existingBatch.status
        },
        { status: 400 }
      );
    }

    // 2. Update batch_executions status to 'stopped'
    const { error: batchUpdateError } = await supabase
      .from('batch_executions')
      .update({
        status: 'stopped',
        completed_at: new Date().toISOString()
      })
      .eq('id', batchId);

    if (batchUpdateError) {
      console.error('❌ Failed to update batch status:', batchUpdateError);
      return Response.json(
        { error: 'Failed to stop batch execution', details: batchUpdateError.message },
        { status: 500 }
      );
    }

    // 3. Stop the currently running task (if any)
    const { data: runningTask, error: runningTaskError } = await supabase
      .from('tasks')
      .select('id')
      .eq('batch_execution_id', batchId)
      .eq('status', 'running')
      .single();

    let stoppedTaskId: string | null = null;
    if (runningTask && !runningTaskError) {
      const { error: taskUpdateError } = await supabase
        .from('tasks')
        .update({
          status: 'stopped',
          completed_at: new Date().toISOString(),
          result_message: 'Task stopped as part of batch stop'
        })
        .eq('id', runningTask.id);

      if (taskUpdateError) {
        console.error('⚠️ Failed to stop running task:', taskUpdateError);
        // Continue - batch is already marked stopped
      } else {
        stoppedTaskId = runningTask.id;
        console.log(`✅ Stopped running task: ${runningTask.id}`);
      }
    }

    // 4. Cancel all queued tasks (prevent them from starting)
    const { data: cancelledTasks, error: queuedUpdateError } = await supabase
      .from('tasks')
      .update({
        status: 'stopped',
        completed_at: new Date().toISOString(),
        result_message: 'Task cancelled - batch execution stopped by user'
      })
      .eq('batch_execution_id', batchId)
      .eq('status', 'queued')
      .select('id');

    if (queuedUpdateError) {
      console.error('⚠️ Failed to cancel queued tasks:', queuedUpdateError);
      // Continue - batch is already marked stopped
    } else {
      console.log(`✅ Cancelled ${cancelledTasks?.length || 0} queued tasks`);
    }

    console.log(`✅ Batch execution ${batchId} stopped successfully`);

    return Response.json({
      success: true,
      batchId: batchId,
      status: 'stopped',
      stoppedTaskId: stoppedTaskId,
      cancelledTaskCount: cancelledTasks?.length || 0,
      message: 'Batch execution stopped successfully. All queued tasks have been cancelled.',
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('❌ Stop batch execution error:', error);
    return Response.json(
      {
        error: 'Internal server error',
        message: error?.message || 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}
