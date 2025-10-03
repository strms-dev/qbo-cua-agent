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