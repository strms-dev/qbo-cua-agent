import { onkernelClient } from '@/lib/onkernel';
import { supabase } from '@/lib/supabase';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    // Pause session (Onkernel handles this automatically)
    await onkernelClient.pauseSession(sessionId);

    // Update our database
    await supabase
      .from('browser_sessions')
      .update({
        status: 'paused',
        last_activity_at: new Date().toISOString(),
      })
      .eq('onkernel_session_id', sessionId);

    return Response.json({ success: true });
  } catch (error) {
    console.error('Failed to pause session:', error);
    return Response.json({ error: 'Failed to pause session' }, { status: 500 });
  }
}