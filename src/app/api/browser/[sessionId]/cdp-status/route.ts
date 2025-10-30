import { onkernelClient } from '@/lib/onkernel';
import { supabase } from '@/lib/supabase';
import { NextRequest } from 'next/server';
import { Kernel } from '@onkernel/sdk';

/**
 * GET /api/browser/[sessionId]/cdp-status
 *
 * Comprehensive CDP connection status check
 * Returns actual connection state vs database state to identify inconsistencies
 *
 * Checks performed:
 * 1. In-memory cache check (is session in activeSessions Map?)
 * 2. Database flag check (cdp_connected column)
 * 3. Connection functionality test (can we actually use the connection?)
 * 4. OnKernel browser existence check (does the browser still exist on OnKernel?)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    console.log('🔍 Checking CDP status for session:', sessionId);

    // Check 1: In-memory cache
    const activeSessions = onkernelClient.getActiveSessions();
    const inMemory = activeSessions.includes(sessionId);
    console.log('📋 In-memory cache check:', inMemory ? 'CONNECTED' : 'DISCONNECTED');

    // Check 2: Database flag
    const { data: dbStatus, error: dbError } = await supabase
      .from('browser_sessions')
      .select('cdp_connected, status, last_activity_at, cdp_ws_url, cdp_disconnected_at, live_view_url')
      .eq('onkernel_session_id', sessionId)
      .single();

    if (dbError) {
      console.error('⚠️ Database query error:', dbError);
    }

    const databaseFlag = dbStatus?.cdp_connected ?? false;
    console.log('💾 Database flag check:', databaseFlag ? 'CONNECTED' : 'DISCONNECTED');

    // Check 3: Try to actually use the connection (if in memory)
    let connectionActuallyWorks = false;
    let connectionError: string | null = null;

    if (inMemory) {
      try {
        console.log('🧪 Testing connection functionality...');
        // Attempt a lightweight operation that requires active connection
        const session = await onkernelClient.getSession(sessionId);
        connectionActuallyWorks = true;
        console.log('✅ Connection test PASSED - connection works');
      } catch (error: any) {
        connectionError = error.message;
        connectionActuallyWorks = false;
        console.log('❌ Connection test FAILED:', error.message);
      }
    } else {
      console.log('⏭️ Skipping connection test - not in memory');
    }

    // Check 4: OnKernel browser still exists
    let onkernelBrowserExists = false;
    let onkernelError: string | null = null;

    try {
      console.log('🔍 Checking OnKernel browser existence...');
      const apiKey = process.env.KERNEL_API_KEY || process.env.ONKERNEL_API_KEY;
      if (!apiKey) {
        throw new Error('No OnKernel API key found');
      }

      const kernel = new Kernel({ apiKey });
      const browserInfo = await kernel.browsers.retrieve(sessionId);
      onkernelBrowserExists = !!browserInfo;
      console.log('✅ OnKernel browser EXISTS');
    } catch (error: any) {
      onkernelError = error.message;
      onkernelBrowserExists = false;

      if (error.status === 404) {
        console.log('❌ OnKernel browser NOT FOUND (404)');
      } else {
        console.log('⚠️ OnKernel check error:', error.message);
      }
    }

    // Determine actual status and consistency
    const isConsistent = (inMemory === databaseFlag);
    const actuallyConnected = inMemory && connectionActuallyWorks;

    console.log('📊 Status summary:');
    console.log('  - Actually connected:', actuallyConnected);
    console.log('  - Data consistent:', isConsistent);
    console.log('  - Needs reconciliation:', !isConsistent);

    // Build comprehensive response
    const response = {
      sessionId,
      checks: {
        inMemoryCache: inMemory,
        databaseFlag: databaseFlag,
        connectionWorks: connectionActuallyWorks,
        onkernelBrowserExists: onkernelBrowserExists,
      },
      status: {
        cdpConnected: actuallyConnected,
        isConsistent: isConsistent,
        needsReconciliation: !isConsistent,
        summary: actuallyConnected
          ? 'CDP is connected and working'
          : inMemory
            ? 'CDP in memory but not working'
            : databaseFlag
              ? 'Database says connected but not in memory'
              : 'CDP is disconnected',
      },
      details: {
        browserStatus: dbStatus?.status || 'unknown',
        lastActivity: dbStatus?.last_activity_at || null,
        cdpDisconnectedAt: dbStatus?.cdp_disconnected_at || null,
        cdpUrl: dbStatus?.cdp_ws_url ? 'present' : 'missing',
        liveViewUrl: dbStatus?.live_view_url || null,
        connectionError: connectionError,
        onkernelError: onkernelError,
      },
      recommendations: generateRecommendations(
        inMemory,
        databaseFlag,
        connectionActuallyWorks,
        onkernelBrowserExists
      ),
      timestamp: new Date().toISOString()
    };

    return Response.json(response);
  } catch (error: any) {
    console.error('❌ CDP status check failed:', error);
    return Response.json(
      {
        error: 'Failed to check CDP status',
        message: error.message,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

/**
 * Generate recommendations based on check results
 */
function generateRecommendations(
  inMemory: boolean,
  databaseFlag: boolean,
  connectionWorks: boolean,
  onkernelExists: boolean
): string[] {
  const recommendations: string[] = [];

  // Case 1: Everything is good
  if (inMemory && databaseFlag && connectionWorks && onkernelExists) {
    recommendations.push('✅ All checks passed - CDP is healthy');
    return recommendations;
  }

  // Case 2: Database says connected but not in memory
  if (!inMemory && databaseFlag) {
    recommendations.push('⚠️ Database inconsistency detected');
    recommendations.push('Action: Update database to mark CDP as disconnected');
    if (onkernelExists) {
      recommendations.push('Note: OnKernel browser still exists - can reconnect if needed');
    }
  }

  // Case 3: In memory but database says disconnected
  if (inMemory && !databaseFlag) {
    recommendations.push('⚠️ Database inconsistency detected');
    recommendations.push('Action: Update database to mark CDP as connected');
  }

  // Case 4: In memory but connection doesn't work
  if (inMemory && !connectionWorks) {
    recommendations.push('⚠️ CDP appears connected but is not functional');
    recommendations.push('Action: Call disconnectCDP() to clean up');
    recommendations.push('Then: Can reconnect if OnKernel browser still exists');
  }

  // Case 5: OnKernel browser doesn't exist but we think we're connected
  if (!onkernelExists && (inMemory || databaseFlag)) {
    recommendations.push('⚠️ OnKernel browser no longer exists');
    recommendations.push('Action: Call disconnectCDP() and update database');
    recommendations.push('Note: Cannot reconnect - browser was destroyed');
  }

  // Case 6: Everything is disconnected (good state)
  if (!inMemory && !databaseFlag && !connectionWorks) {
    if (onkernelExists) {
      recommendations.push('✅ CDP properly disconnected');
      recommendations.push('Note: OnKernel browser still exists - can reconnect if needed');
    } else {
      recommendations.push('✅ CDP disconnected and OnKernel browser destroyed');
      recommendations.push('Note: Clean state - no resources in use');
    }
  }

  return recommendations;
}
