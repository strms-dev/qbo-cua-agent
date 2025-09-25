// Simplified chat API for basic testing
export async function POST(req: Request) {
  try {
    const { messages, sessionId, browserSessionId } = await req.json();

    // Simulate a response for testing purposes
    return Response.json({
      message: {
        role: 'assistant',
        content: 'This is a placeholder response. Once you configure the API keys (Anthropic, Supabase, Scrapybara, GoToHuman), I\'ll be able to help you with QuickBooks Online bookkeeping tasks!',
      },
      sessionId: sessionId || 'demo-session-' + Date.now(),
      browserSessionId: browserSessionId || 'demo-browser-' + Date.now(),
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return Response.json(
      { error: 'Failed to process chat request' },
      { status: 500 }
    );
  }
}