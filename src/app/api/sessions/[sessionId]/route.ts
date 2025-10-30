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
          thinking,
          thinking_signature,
          tool_calls,
          anthropic_request,
          anthropic_response,
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

    // Sort messages by creation time
    const sortedMessages = session.messages?.sort((a: any, b: any) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    ) || [];

    // Fetch browser session details if available
    let browserSession = null;
    if (session.browser_session_id) {
      const { data: browserData } = await supabase
        .from('browser_sessions')
        .select('onkernel_session_id, cdp_connected, live_view_url, status')
        .eq('chat_session_id', sessionId)
        .single();

      if (browserData) {
        browserSession = {
          onkernelSessionId: browserData.onkernel_session_id,
          cdpConnected: browserData.cdp_connected,
          liveViewUrl: browserData.live_view_url,
          status: browserData.status
        };
      }
    }

    return NextResponse.json({
      session: {
        id: session.id,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        browserSessionId: session.browser_session_id,
        status: session.status,
        metadata: session.metadata
      },
      browserSession: browserSession,
      messages: sortedMessages,
      totalMessages: sortedMessages.length
    });
  } catch (error: any) {
    console.error('Error in GET /api/sessions/[sessionId]:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

// PATCH /api/sessions/[sessionId] - Update session status
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body = await request.json();
    const { status } = body;

    if (!status) {
      return NextResponse.json(
        { error: 'Status is required' },
        { status: 400 }
      );
    }

    // Update session status
    const { error } = await supabase
      .from('chat_sessions')
      .update({
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to update session', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      sessionId,
      status
    });
  } catch (error: any) {
    console.error('Error in PATCH /api/sessions/[sessionId]:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}