'use client';

import { useState, useEffect } from 'react';
import { Monitor, Square } from 'lucide-react';

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

  const handleSessionAction = async (action: 'stop') => {
    if (!browserSessionId) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/browser/${browserSessionId}/${action}`, {
        method: 'POST',
      });

      if (response.ok) {
        await fetchSessionStatus();
      }
    } catch (error) {
      console.error(`Failed to ${action} session:`, error);
    } finally {
      setIsLoading(false);
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
        <div className="flex items-center gap-2">
          {/* Stop Button - only show when active */}
          {/* Note: Onkernel handles pause/resume automatically, so we only provide Stop */}
          {sessionStatus === 'active' && (
            <button
              onClick={() => handleSessionAction('stop')}
              disabled={isLoading}
              className="flex items-center gap-1 px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 disabled:opacity-50"
            >
              <Square className="w-4 h-4" />
              Stop Session
            </button>
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