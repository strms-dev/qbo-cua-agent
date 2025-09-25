'use client';

import { useState, useEffect } from 'react';
import { Monitor, Play, Pause, Square, RefreshCw } from 'lucide-react';

interface BrowserPanelProps {
  browserSessionId: string | null;
  chatSessionId: string | null;
}

export default function BrowserPanel({ browserSessionId, chatSessionId }: BrowserPanelProps) {
  const [browserUrl, setBrowserUrl] = useState<string>('');
  const [sessionStatus, setSessionStatus] = useState<'active' | 'paused' | 'stopped'>('stopped');
  const [isLoading, setIsLoading] = useState(false);
  const [lastScreenshot, setLastScreenshot] = useState<string>('');

  useEffect(() => {
    if (browserSessionId) {
      fetchSessionStatus();
      const interval = setInterval(fetchSessionStatus, 5000); // Poll every 5 seconds
      return () => clearInterval(interval);
    }
  }, [browserSessionId]);

  const fetchSessionStatus = async () => {
    if (!browserSessionId) return;

    try {
      const response = await fetch(`/api/browser/${browserSessionId}/status`);
      if (response.ok) {
        const data = await response.json();
        setSessionStatus(data.status);
        setBrowserUrl(data.browserUrl || '');
        if (data.screenshot) {
          setLastScreenshot(data.screenshot);
        }
      }
    } catch (error) {
      console.error('Failed to fetch session status:', error);
    }
  };

  const handleSessionAction = async (action: 'pause' | 'resume' | 'stop') => {
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

  const takeScreenshot = async () => {
    if (!browserSessionId) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/browser/${browserSessionId}/screenshot`, {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        setLastScreenshot(data.screenshot);
      }
    } catch (error) {
      console.error('Failed to take screenshot:', error);
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
                  : sessionStatus === 'paused'
                  ? 'bg-yellow-500'
                  : 'bg-gray-500'
              }`}
            />
            <span className="text-sm text-gray-600 capitalize">{sessionStatus}</span>
          </div>
        </div>

        {/* Browser Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleSessionAction(sessionStatus === 'paused' ? 'resume' : 'pause')}
            disabled={isLoading || sessionStatus === 'stopped'}
            className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {sessionStatus === 'paused' ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            {sessionStatus === 'paused' ? 'Resume' : 'Pause'}
          </button>

          <button
            onClick={() => handleSessionAction('stop')}
            disabled={isLoading || sessionStatus === 'stopped'}
            className="flex items-center gap-1 px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 disabled:opacity-50"
          >
            <Square className="w-4 h-4" />
            Stop
          </button>

          <button
            onClick={takeScreenshot}
            disabled={isLoading || sessionStatus !== 'active'}
            className="flex items-center gap-1 px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
          >
            <RefreshCw className="w-4 h-4" />
            Screenshot
          </button>
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
        {lastScreenshot ? (
          <div className="h-full flex flex-col">
            <div className="flex-1 overflow-hidden">
              <img
                src={`data:image/png;base64,${lastScreenshot}`}
                alt="Browser Screenshot"
                className="w-full h-full object-contain bg-white"
              />
            </div>
            <div className="p-2 bg-gray-50 text-xs text-gray-600 text-center border-t">
              Live browser view - Updates automatically during agent interactions
            </div>
          </div>
        ) : sessionStatus === 'active' ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-gray-600">Loading browser session...</p>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <Monitor className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-600">Browser session is {sessionStatus}</p>
              {sessionStatus === 'paused' && (
                <p className="text-sm text-gray-500 mt-2">Click Resume to continue</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}