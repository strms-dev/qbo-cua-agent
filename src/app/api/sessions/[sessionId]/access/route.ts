import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/sessions/[sessionId]/access
 *
 * Redirects to the main app interface with the specified session pre-selected.
 * This endpoint is provided in webhook payloads to allow users to directly access
 * paused tasks that need interaction.
 *
 * Usage: When a task pauses (needs clarification), the webhook includes a sessionUrl
 * like: https://yourapp.com/api/sessions/abc-123/access
 *
 * Clicking this URL will redirect to: https://yourapp.com/?sessionId=abc-123
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  // Construct redirect URL to root with sessionId query parameter
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ||
                  request.headers.get('host') ?
                  `${request.headers.get('x-forwarded-proto') || 'http'}://${request.headers.get('host')}` :
                  'http://localhost:3000';

  const redirectUrl = new URL('/', baseUrl);
  redirectUrl.searchParams.set('sessionId', sessionId);

  console.log(`🔗 Redirecting to session ${sessionId}:`, redirectUrl.toString());

  return NextResponse.redirect(redirectUrl, { status: 302 });
}
