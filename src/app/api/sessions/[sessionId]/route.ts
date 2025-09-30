import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET /api/sessions/[sessionId] - Get session details with all messages and screenshots
export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    // Fetch session with messages
    const { data: session, error: sessionError } = await supabase
      .from('chat_sessions')
      .select(`
        id,
        created_at,
        updated_at,
        browser_session_id,
        status,
        metadata,
        messages (
          id,
          role,
          content,
          tool_calls,
          created_at,
          metadata
        )
      `)
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { error: 'Session not found', details: sessionError?.message },
        { status: 404 }
      );
    }

    // Fetch screenshots for this session
    const { data: screenshots, error: screenshotsError } = await supabase
      .from('screenshots')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (screenshotsError) {
      console.warn('Failed to fetch screenshots:', screenshotsError);
    }

    // Get public URLs for screenshots
    const screenshotsWithUrls = screenshots?.map(screenshot => {
      // Extract filename from potential storage path
      const filename = `${sessionId}/${screenshot.created_at}.png`;

      const { data: urlData } = supabase.storage
        .from('cua-screenshots')
        .getPublicUrl(filename);

      return {
        ...screenshot,
        publicUrl: urlData.publicUrl
      };
    }) || [];

    // Sort messages by creation time
    const sortedMessages = session.messages?.sort((a: any, b: any) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    ) || [];

    return NextResponse.json({
      session: {
        id: session.id,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        browserSessionId: session.browser_session_id,
        status: session.status,
        metadata: session.metadata
      },
      messages: sortedMessages,
      screenshots: screenshotsWithUrls,
      totalMessages: sortedMessages.length,
      totalScreenshots: screenshotsWithUrls.length
    });
  } catch (error: any) {
    console.error('Error in GET /api/sessions/[sessionId]:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}