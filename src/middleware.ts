import { type NextRequest, NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// Routes that require authentication
const protectedRoutes = [
  '/chat',
  '/dashboard',
  '/files',
];

// Homepage also requires auth (it's the Agent/chat interface)
const protectHomepage = true;

// API routes that require authentication (except batch execution which uses API key)
const protectedApiRoutes = [
  '/api/chat',
  '/api/sessions',
  '/api/dashboard',
  '/api/files',
  '/api/browser',
];

// API routes that use API key authentication (not Supabase auth)
const apiKeyRoutes = [
  '/api/tasks/execute',
  '/api/batch-executions',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for static assets and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Skip auth check for API key authenticated routes
  if (apiKeyRoutes.some(route => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Check if route needs protection
  const isProtectedRoute = protectedRoutes.some(route =>
    pathname === route || pathname.startsWith(route + '/')
  );

  const isProtectedApiRoute = protectedApiRoutes.some(route =>
    pathname.startsWith(route)
  );

  // Check if homepage needs protection
  const isHomepage = pathname === '/';

  // Update session and get user
  const { user, supabaseResponse } = await updateSession(request);

  // If accessing protected route without auth, redirect to login
  const needsAuth = isProtectedRoute || isProtectedApiRoute || (protectHomepage && isHomepage);
  if (needsAuth && !user) {
    // For API routes, return 401 instead of redirect
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Authentication required' },
        { status: 401 }
      );
    }

    // For pages, redirect to login
    const redirectUrl = new URL('/login', request.url);
    redirectUrl.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // If user is logged in and trying to access login page, redirect to homepage
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
