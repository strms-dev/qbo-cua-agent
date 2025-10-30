/**
 * API Authentication Middleware
 *
 * Validates API key from Authorization header for secure API access.
 * Used by batch execution API and other programmatic endpoints.
 */

/**
 * Validates API key from request Authorization header
 *
 * @param request - Next.js Request object
 * @returns boolean - true if valid API key, false otherwise
 */
export function validateApiKey(request: Request): boolean {
  const authHeader = request.headers.get('Authorization');

  // Check for Authorization header with Bearer token
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('⚠️ Missing or invalid Authorization header format');
    return false;
  }

  // Extract API key from "Bearer <key>"
  const apiKey = authHeader.replace('Bearer ', '').trim();

  // Get valid API key from environment
  const validKey = process.env.API_KEY_SECRET;

  if (!validKey) {
    console.error('❌ API_KEY_SECRET environment variable not configured');
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  if (apiKey.length !== validKey.length) {
    return false;
  }

  let isValid = true;
  for (let i = 0; i < apiKey.length; i++) {
    if (apiKey[i] !== validKey[i]) {
      isValid = false;
    }
  }

  return isValid;
}

/**
 * Middleware helper that returns 401 response if authentication fails
 *
 * Usage in API routes:
 * ```typescript
 * const authError = authenticationRequired(request);
 * if (authError) return authError;
 * ```
 *
 * @param request - Next.js Request object
 * @returns Response with 401 error if authentication fails, null if successful
 */
export function authenticationRequired(request: Request): Response | null {
  if (!validateApiKey(request)) {
    console.warn('🚫 Unauthorized API access attempt');
    return Response.json(
      {
        error: 'Unauthorized',
        message: 'Invalid or missing API key. Please provide a valid Authorization header with Bearer token.'
      },
      {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Bearer realm="API"'
        }
      }
    );
  }

  return null; // Authentication successful
}
