import { onkernelClient } from '@/lib/onkernel';
import { NextRequest } from 'next/server';

/**
 * POST /api/browser/[sessionId]/destroy
 *
 * Completely destroys the OnKernel browser session.
 * This closes CDP connection AND deletes the browser from OnKernel.
 * This action is irreversible - the browser cannot be reconnected after destruction.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  console.log('🗑️ Destroy browser endpoint called');

  try {
    const { sessionId } = await params;

    if (!sessionId) {
      return Response.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    console.log(`🗑️ Destroying browser session: ${sessionId}`);

    // Call onkernelClient to destroy the browser completely
    const result = await onkernelClient.destroySession(sessionId);

    console.log(`✅ Browser session destroyed successfully: ${sessionId}`);

    return Response.json({
      success: true,
      sessionId: sessionId,
      status: result.status,
      message: 'Browser session destroyed completely. OnKernel browser deleted.',
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('❌ Destroy browser error:', error);
    return Response.json(
      {
        error: 'Failed to destroy browser session',
        message: error?.message || 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}
