import { scrapybaraClient } from '@/lib/scrapybara';
import { supabase } from '@/lib/supabase';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    // Get session from Scrapybara
    const sessionData = await scrapybaraClient.getSession(sessionId);

    // Update our database
    await supabase
      .from('browser_sessions')
      .update({
        status: sessionData.status,
        last_activity_at: new Date().toISOString(),
      })
      .eq('scrapybara_session_id', sessionId);

    // Get latest screenshot if session is active
    let screenshot = null;
    if (sessionData.status === 'active') {
      try {
        const screenshotData = await scrapybaraClient.takeScreenshot(sessionId);
        screenshot = screenshotData.screenshot;
      } catch (error) {
        console.error('Failed to get screenshot:', error);
      }
    }

    return Response.json({
      status: sessionData.status,
      browserUrl: sessionData.browser_url,
      screenshot,
    });
  } catch (error) {
    console.error('Failed to get session status:', error);
    return Response.json({ error: 'Failed to get session status' }, { status: 500 });
  }
}