import { onkernelClient } from '@/lib/onkernel';
import { supabase } from '@/lib/supabase';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    // Destroy session in Onkernel
    await onkernelClient.destroySession(sessionId);

    // Update our database
    await supabase
      .from('browser_sessions')
      .update({
        status: 'stopped',
        last_activity_at: new Date().toISOString(),
      })
      .eq('onkernel_session_id', sessionId);

    return Response.json({ success: true });
  } catch (error) {
    console.error('Failed to stop session:', error);
    return Response.json({ error: 'Failed to stop session' }, { status: 500 });
  }
}