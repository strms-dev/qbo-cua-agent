'use client';

import { useState, useEffect } from 'react';
import { Monitor, Unplug, Plug, Trash2 } from 'lucide-react';

interface BrowserPanelProps {
  browserSessionId: string | null;
  chatSessionId: string | null;
  streamUrl?: string | null;
  agentActive?: boolean; // Add flag to track if agent is currently active
}

export default function BrowserPanel({ browserSessionId, chatSessionId, streamUrl, agentActive = false }: BrowserPanelProps) {
  const [browserUrl, setBrowserUrl] = useState<string>('');
  const [sessionStatus, setSessionStatus] = useState<'active' | 'stopped' | 'terminated' | 'demo' | 'not_found' | 'error'>('stopped');
  const [isLoading, setIsLoading] = useState(false);
  const [lastScreenshot, setLastScreenshot] = useState<string>('');
  const [cdpConnected, setCdpConnected] = useState<boolean>(false);
  const [showDestroyConfirm, setShowDestroyConfirm] = useState(false);

  // Debug logging
  console.log('🖥️ BrowserPanel props:', {
    browserSessionId,
    streamUrl,
    sessionStatus,
    agentActive,
    showIframe: streamUrl && sessionStatus === 'active'
  });

  // Initial fetch when browserSessionId changes with retry for stream URL
  useEffect(() => {
    if (browserSessionId) {
      fetchSessionStatusWithRetry();
    }
  }, [browserSessionId]);

  const fetchSessionStatusWithRetry = async () => {
    const data = await fetchSessionStatus();

    // If stream URL is not available after first fetch, retry once after 3 seconds
    if (data && !data.browserUrl && data.status === 'active') {
      console.log('🔄 Stream URL not available, retrying in 3 seconds...');
      setTimeout(async () => {
        await fetchSessionStatus();
      }, 3000);
    }
  };

  const fetchSessionStatus = async () => {
    if (!browserSessionId) return null;

    try {
      const response = await fetch(`/api/browser/${browserSessionId}/status`);
      if (response.ok) {
        const data = await response.json();
        setSessionStatus(data.status);
        setBrowserUrl(data.browserUrl || '');
        if (data.screenshot) {
          setLastScreenshot(data.screenshot);
        }
        return data;
      }
    } catch (error) {
      console.error('Failed to fetch session status:', error);
    }
    return null;
  };

  // Fetch CDP connection status from chat session API
  const fetchCdpStatus = async () => {
    if (!chatSessionId) return;

    try {
      const response = await fetch(`/api/sessions/${chatSessionId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.browserSession) {
          setCdpConnected(data.browserSession.cdpConnected ?? true);
        }
      }
    } catch (error) {
      console.error('Failed to fetch CDP status:', error);
    }
  };

  // Fetch CDP status when component mounts or browserSessionId changes
  useEffect(() => {
    if (browserSessionId && chatSessionId) {
      fetchCdpStatus();
    }
  }, [browserSessionId, chatSessionId]);

  const handleDisconnectCDP = async () => {
    if (!browserSessionId) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/browser/${browserSessionId}/disconnect-cdp`, {
        method: 'POST',
      });

      if (response.ok) {
        setCdpConnected(false);
        console.log('✅ CDP disconnected successfully');
      }
    } catch (error) {
      console.error('Failed to disconnect CDP:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReconnectCDP = async () => {
    if (!browserSessionId) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/browser/${browserSessionId}/reconnect-cdp`, {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        setCdpConnected(true);
        if (data.liveViewUrl) {
          setBrowserUrl(data.liveViewUrl);
        }
        console.log('✅ CDP reconnected successfully');
        // Refresh page to reload iframe
        window.location.reload();
      }
    } catch (error) {
      console.error('Failed to reconnect CDP:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDestroyBrowser = async () => {
    if (!browserSessionId) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/browser/${browserSessionId}/destroy`, {
        method: 'POST',
      });

      if (response.ok) {
        console.log('✅ Browser session destroyed successfully');

        // Also mark chat session as completed
        if (chatSessionId) {
          try {
            await fetch(`/api/sessions/${chatSessionId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'completed' })
            });
            console.log('✅ Chat session marked as completed');
          } catch (error) {
            console.error('⚠️ Failed to update chat session status:', error);
          }
        }

        // Reload the page to reset the UI
        window.location.reload();
      }
    } catch (error) {
      console.error('Failed to destroy browser:', error);
    } finally {
      setIsLoading(false);
      setShowDestroyConfirm(false);
    }
  };


  if (!browserSessionId) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Monitor className="w-16 h-16 mx-auto mb-4 text-gray-400" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">No Browser Session</h3>
          <p className="text-sm text-gray-500">
            Start a conversation to create a browser session
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Browser Panel Header */}
      <div className="border-b border-gray-300 p-4 bg-white">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-800">Browser Session</h2>
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                sessionStatus === 'active'
                  ? 'bg-green-500'
                  : 'bg-gray-500'
              }`}
            />
            <span className="text-sm text-gray-600 capitalize">{sessionStatus}</span>
          </div>
        </div>

        {/* Browser Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Disconnect CDP Button - show when CDP connected */}
          {cdpConnected && (
            <button
              onClick={handleDisconnectCDP}
              disabled={isLoading}
              className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              <Unplug className="w-4 h-4" />
              Disconnect CDP
            </button>
          )}

          {/* Reconnect CDP Button - show when CDP disconnected */}
          {!cdpConnected && (
            <>
              <button
                onClick={handleReconnectCDP}
                disabled={isLoading}
                className="flex items-center gap-1 px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
              >
                <Plug className="w-4 h-4" />
                Reconnect CDP
              </button>
              <div className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
                ℹ️ CDP disconnected to save costs
              </div>
            </>
          )}

          {/* Destroy Session Button - always show, with confirmation */}
          {!showDestroyConfirm ? (
            <button
              onClick={() => setShowDestroyConfirm(true)}
              disabled={isLoading}
              className="flex items-center gap-1 px-3 py-1 bg-red-700 text-white rounded text-sm hover:bg-red-800 disabled:opacity-50 border-2 border-red-900"
            >
              <Trash2 className="w-4 h-4" />
              Destroy Session
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-red-600 font-semibold">Confirm destroy session?</span>
              <button
                onClick={handleDestroyBrowser}
                disabled={isLoading}
                className="px-3 py-1 bg-red-700 text-white rounded text-sm hover:bg-red-800 disabled:opacity-50"
              >
                Yes, Destroy Session
              </button>
              <button
                onClick={() => setShowDestroyConfirm(false)}
                disabled={isLoading}
                className="px-3 py-1 bg-gray-300 text-gray-700 rounded text-sm hover:bg-gray-400 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Browser URL */}
        {browserUrl && (
          <div className="mt-3">
            <div className="text-xs text-gray-600 mb-1">Current URL:</div>
            <div className="bg-gray-100 p-2 rounded text-sm text-gray-800 break-all">
              {browserUrl}
            </div>
          </div>
        )}
      </div>

      {/* Browser Content */}
      <div className="flex-1 bg-white relative">
        {/* Debug info */}
        <div className="absolute top-2 right-2 bg-black bg-opacity-75 text-white text-xs p-2 rounded z-10">
          Status: {sessionStatus} | Agent: {agentActive ? 'ACTIVE' : 'IDLE'} | StreamUrl: {streamUrl ? 'YES' : 'NO'} | Show: {streamUrl ? 'YES' : 'NO'}
        </div>

        {/* Live Stream View - Show iframe whenever we have streamUrl */}
        {streamUrl ? (
          <div className="h-full flex flex-col">
            <div className="flex-1 overflow-hidden">
              <iframe
                src={streamUrl}
                className="w-full h-full border-0"
                allow="clipboard-write"
                title="Live Browser Session"
                onLoad={() => console.log('✅ Live stream iframe loaded successfully')}
                onError={(e) => console.error('❌ Live stream iframe failed to load:', e)}
                style={{ minHeight: '400px' }}
              />
            </div>
            <div className={`p-2 text-xs text-center border-t ${
              sessionStatus === 'active'
                ? 'bg-green-50 text-green-700 border-green-200'
                : agentActive
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-yellow-50 text-yellow-700 border-yellow-200'
            }`}>
              {sessionStatus === 'active' && !agentActive ? (
                <>🟢 Live Browser Session Ready | URL: {streamUrl}</>
              ) : agentActive ? (
                <>🔵 Agent Working - Live Browser Session | URL: {streamUrl}</>
              ) : (
                <>⚠️ Live Browser Session (Status: {sessionStatus}) | URL: {streamUrl}</>
              )}
            </div>
          </div>
        ) :
        /* Screenshot Fallback */
        lastScreenshot ? (
          <div className="h-full flex flex-col">
            <div className="flex-1 overflow-hidden">
              <img
                src={`data:image/png;base64,${lastScreenshot}`}
                alt="Browser Screenshot"
                className="w-full h-full object-contain bg-white"
              />
            </div>
            <div className="p-2 bg-blue-50 text-xs text-blue-700 text-center border-t border-blue-200">
              📸 Latest Screenshot - Click Screenshot button to refresh
            </div>
          </div>
        ) : sessionStatus === 'active' ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-gray-600">Loading browser session...</p>
              <p className="text-sm text-gray-500 mt-2">Setting up live stream...</p>
            </div>
          </div>
        ) : sessionStatus === 'demo' ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <Monitor className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-600">Browser session is demo</p>
              <p className="text-sm text-gray-500 mt-2">
                Start a conversation to create a browser session
              </p>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <Monitor className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-600">Browser session is {sessionStatus}</p>
              <p className="text-sm text-gray-500 mt-2">Start a new conversation to create a session</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}