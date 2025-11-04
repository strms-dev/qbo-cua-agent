import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET /api/batch-executions/[batchId]/status - Get status of all tasks in a batch execution
export async function GET(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await params;

    // Fetch batch execution details
    const { data: batchExecution, error: batchError } = await supabase
      .from('batch_executions')
      .select('id, session_id, status, total_tasks, completed_tasks, started_at, completed_at')
      .eq('id', batchId)
      .single();

    if (batchError || !batchExecution) {
      return NextResponse.json(
        { error: 'Batch execution not found', details: batchError?.message },
        { status: 404 }
      );
    }

    // Fetch all tasks in this batch
    const { data: tasks, error: tasksError } = await supabase
      .from('tasks')
      .select('id, status, user_message, started_at, completed_at, agent_status, agent_message')
      .eq('batch_execution_id', batchId)
      .order('created_at', { ascending: true });

    if (tasksError) {
      return NextResponse.json(
        { error: 'Failed to fetch tasks', details: tasksError.message },
        { status: 500 }
      );
    }

    // Determine overall batch status
    const hasRunningTask = tasks?.some(t => t.status === 'running');
    const hasPausedTask = tasks?.some(t => t.status === 'paused');
    const allCompleted = tasks?.every(t => t.status === 'completed');
    const hasFailed = tasks?.some(t => t.status === 'failed');

    let overallStatus = batchExecution.status;
    if (hasRunningTask) {
      overallStatus = 'running';
    } else if (hasPausedTask) {
      overallStatus = 'paused';
    } else if (allCompleted) {
      overallStatus = 'completed';
    } else if (hasFailed) {
      overallStatus = 'failed';
    }

    // Find currently active task (running or paused)
    const activeTask = tasks?.find(t => t.status === 'running' || t.status === 'paused');

    return NextResponse.json({
      batchExecution: {
        id: batchExecution.id,
        sessionId: batchExecution.session_id,
        status: overallStatus,
        totalTasks: batchExecution.total_tasks,
        completedTasks: tasks?.filter(t => t.status === 'completed').length || 0,
        startedAt: batchExecution.started_at,
        completedAt: batchExecution.completed_at,
      },
      tasks: tasks?.map((task, index) => ({
        id: task.id,
        taskIndex: index,
        status: task.status,
        message: task.user_message,
        startedAt: task.started_at,
        completedAt: task.completed_at,
        agentStatus: task.agent_status,
        agentMessage: task.agent_message,
      })) || [],
      activeTask: activeTask ? {
        id: activeTask.id,
        status: activeTask.status,
        message: activeTask.user_message,
      } : null,
      hasActiveTask: !!activeTask,
    });
  } catch (error: any) {
    console.error('Error fetching batch execution status:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
