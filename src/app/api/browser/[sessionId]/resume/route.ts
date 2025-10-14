import { onkernelClient } from '@/lib/onkernel';
import { supabase } from '@/lib/supabase';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    // Resume session (Onkernel handles this automatically)
    await onkernelClient.resumeSession(sessionId);

    // Update our database
    await supabase
      .from('browser_sessions')
      .update({
        status: 'active',
        last_activity_at: new Date().toISOString(),
      })
      .eq('onkernel_session_id', sessionId);

    return Response.json({ success: true });
  } catch (error) {
    console.error('Failed to resume session:', error);
    return Response.json({ error: 'Failed to resume session' }, { status: 500 });
  }
}