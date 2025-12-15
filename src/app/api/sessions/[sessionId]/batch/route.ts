import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

/**
 * GET /api/sessions/[sessionId]/batch
 *
 * Returns batch execution info for a session, if any exists.
 * This is used to detect batch sessions even when no messages with task_id exist yet
 * (avoiding the race condition where the user views the session before the first message is saved).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    // Query batch_executions by session_id (most recent first)
    const { data: batch, error } = await supabase
      .from('batch_executions')
      .select('id, status, task_count, completed_count, browser_session_id')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !batch) {
      // No batch execution found for this session - this is normal for non-batch sessions
      return NextResponse.json({ batchExecutionId: null });
    }

    return NextResponse.json({
      batchExecutionId: batch.id,
      status: batch.status,
      taskCount: batch.task_count,
      completedCount: batch.completed_count,
      browserSessionId: batch.browser_session_id
    });
  } catch (error: any) {
    console.error('Error in GET /api/sessions/[sessionId]/batch:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
