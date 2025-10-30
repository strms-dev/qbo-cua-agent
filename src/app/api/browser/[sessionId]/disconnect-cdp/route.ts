import { onkernelClient } from '@/lib/onkernel';
import { NextRequest } from 'next/server';

/**
 * POST /api/browser/[sessionId]/disconnect-cdp
 *
 * Disconnects CDP connection to stop OnKernel billing while keeping browser alive.
 * Browser can be reconnected later using the reconnect-cdp endpoint.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  console.log('🔌 Disconnect CDP endpoint called');

  try {
    const { sessionId } = await params;

    if (!sessionId) {
      return Response.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    console.log(`🔌 Disconnecting CDP for session: ${sessionId}`);

    // Call onkernelClient to disconnect CDP
    const result = await onkernelClient.disconnectCDP(sessionId);

    console.log(`✅ CDP disconnected successfully for session: ${sessionId}`);

    return Response.json({
      success: true,
      sessionId: sessionId,
      status: result.status,
      message: result.message,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('❌ Disconnect CDP error:', error);
    return Response.json(
      {
        error: 'Failed to disconnect CDP',
        message: error?.message || 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}
