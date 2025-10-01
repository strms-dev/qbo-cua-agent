import { scrapybaraClient } from '@/lib/scrapybara';
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

    // Try to get session from Scrapybara
    try {
      const sessionData = await scrapybaraClient.getSession(sessionId);
      console.log('✅ Scrapybara session found:', sessionData.status);

      // Map Scrapybara status to our expected status
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
          .eq('scrapybara_session_id', sessionId);
      } catch (dbError) {
        console.error('⚠️ Database update failed:', dbError);
      }

      return Response.json({
        status: mappedStatus,
        browserUrl: sessionData.browser_url,
        screenshot: null,
      });

    } catch (scrapybaraError: any) {
      console.error('❌ Scrapybara session not found:', scrapybaraError.message);

      // Session doesn't exist on Scrapybara
      if (scrapybaraError.message?.includes('404')) {
        return Response.json({
          status: 'not_found',
          browserUrl: null,
          screenshot: null,
          message: `Session ${sessionId} not found. Please start a new conversation to create a browser session.`
        });
      }

      throw scrapybaraError;
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