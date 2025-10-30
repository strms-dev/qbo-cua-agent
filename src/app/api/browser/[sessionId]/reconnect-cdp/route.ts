import { onkernelClient } from '@/lib/onkernel';
import { NextRequest } from 'next/server';

/**
 * POST /api/browser/[sessionId]/reconnect-cdp
 *
 * Reconnects CDP connection to an existing OnKernel browser session.
 * Uses stored CDP URL from database to re-establish connection.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  console.log('🔌 Reconnect CDP endpoint called');

  try {
    const { sessionId } = await params;

    if (!sessionId) {
      return Response.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    console.log(`🔌 Reconnecting CDP for session: ${sessionId}`);

    // Call onkernelClient to reconnect CDP
    const result = await onkernelClient.reconnectCDP(sessionId);

    console.log(`✅ CDP reconnected successfully for session: ${sessionId}`);

    return Response.json({
      success: true,
      sessionId: sessionId,
      status: result.status,
      message: result.message,
      liveViewUrl: result.liveViewUrl,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('❌ Reconnect CDP error:', error);
    return Response.json(
      {
        error: 'Failed to reconnect CDP',
        message: error?.message || 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}
