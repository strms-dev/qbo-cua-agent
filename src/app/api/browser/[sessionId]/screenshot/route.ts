import { scrapybaraClient } from '@/lib/scrapybara';
import { supabase } from '@/lib/supabase';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    // Take screenshot
    const screenshotData = await scrapybaraClient.takeScreenshot(sessionId);

    // Log the screenshot action in database
    const { data: browserSession } = await supabase
      .from('browser_sessions')
      .select('chat_session_id')
      .eq('scrapybara_session_id', sessionId)
      .single();

    if (browserSession) {
      await supabase.from('computer_actions').insert({
        session_id: browserSession.chat_session_id,
        action_type: 'screenshot',
        screenshot_url: screenshotData.screenshot,
        risk_level: 'low',
        requires_approval: false,
        executed_at: new Date().toISOString(),
        result: { success: true },
      });
    }

    return Response.json({
      success: true,
      screenshot: screenshotData.screenshot,
    });
  } catch (error) {
    console.error('Failed to take screenshot:', error);
    return Response.json({ error: 'Failed to take screenshot' }, { status: 500 });
  }
}