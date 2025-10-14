import { onkernelClient } from '@/lib/onkernel';
import { supabase } from '@/lib/supabase';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    console.log('🔍 Checking browser session status:', sessionId);

    // Handle demo/test sessions
    if (sessionId.startsWith('demo-') || sessionId.startsWith('test-')) {
      console.log('📝 Demo session detected');
      return Response.json({
        status: 'demo',
        browserUrl: 'Demo mode - no actual browser',
        screenshot: null,
        message: 'This is a demo session. Create a real browser session by asking me to navigate to a website!'
      });
    }

    // Try to get session from Onkernel
    try {
      const sessionData = await onkernelClient.getSession(sessionId);
      console.log('✅ Onkernel session found:', sessionData.status);

      // Map status to our expected status
      const mappedStatus = sessionData.status === 'running' ? 'active' : sessionData.status;
      console.log('🔄 Status mapped:', sessionData.status, '->', mappedStatus);

      // Update our database
      try {
        await supabase
          .from('browser_sessions')
          .update({
            status: mappedStatus,
            last_activity_at: new Date().toISOString(),
          })
          .eq('onkernel_session_id', sessionId);
      } catch (dbError) {
        console.error('⚠️ Database update failed:', dbError);
      }

      return Response.json({
        status: mappedStatus,
        browserUrl: sessionData.browser_url,
        screenshot: null,
      });

    } catch (onkernelError: any) {
      // Session doesn't exist in local cache or on Onkernel
      // This is expected when a session is stopped/destroyed
      if (onkernelError.message?.includes('404') || onkernelError.message?.includes('not found')) {
        console.log('ℹ️ Session not found (expected after stop):', sessionId);
        return Response.json({
          status: 'stopped',
          browserUrl: null,
          screenshot: null,
          message: `Session ${sessionId} has been stopped. Start a new conversation to create a browser session.`
        });
      }

      // Unexpected error - log and throw
      console.error('❌ Unexpected error getting session:', onkernelError.message);
      throw onkernelError;
    }

  } catch (error: any) {
    console.error('❌ Failed to get session status:', error);
    return Response.json({
      status: 'error',
      error: 'Failed to get session status',
      message: error?.message || 'Unknown error'
    }, { status: 500 });
  }
}