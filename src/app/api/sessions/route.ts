import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET /api/sessions - List all chat sessions
export async function GET() {
  try {
    const { data: sessions, error } = await supabase
      .from('chat_sessions')
      .select(`
        id,
        created_at,
        updated_at,
        browser_session_id,
        status,
        metadata,
        messages (
          content
        )
      `)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch sessions:', error);
      return NextResponse.json(
        { error: 'Failed to fetch sessions', details: error.message },
        { status: 500 }
      );
    }

    // Format sessions for display
    const formattedSessions = sessions?.map((session: any) => {
      // Get first user message as preview
      const firstMessage = session.messages?.find((m: any) => m.content)?.content || 'New conversation';
      const preview = firstMessage.length > 60
        ? firstMessage.substring(0, 60) + '...'
        : firstMessage;

      return {
        id: session.id,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        browserSessionId: session.browser_session_id,
        status: session.status,
        preview: preview,
        metadata: session.metadata
      };
    }) || [];

    return NextResponse.json({
      sessions: formattedSessions,
      total: formattedSessions.length
    });
  } catch (error: any) {
    console.error('Error in GET /api/sessions:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}