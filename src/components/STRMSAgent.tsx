'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import ChatPanel from './ChatPanel';
import BrowserPanel from './BrowserPanel';
import ThreadHistory from './ThreadHistory';

export default function STRMSAgent() {
  const searchParams = useSearchParams();
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [browserSessionId, setBrowserSessionId] = useState<string | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [agentActive, setAgentActive] = useState<boolean>(false);

  // Load session from URL query parameter on mount
  useEffect(() => {
    const sessionIdFromUrl = searchParams.get('sessionId');
    if (sessionIdFromUrl) {
      console.log('🔗 Loading session from URL:', sessionIdFromUrl);
      setCurrentSessionId(sessionIdFromUrl);
    }
  }, [searchParams]);

  const handleSessionSelect = (sessionId: string) => {
    setCurrentSessionId(sessionId);
  };

  return (
    <div className="h-full flex bg-gray-100">
      {/* Thread History Sidebar */}
      <ThreadHistory
        currentSessionId={currentSessionId}
        onSessionSelect={handleSessionSelect}
      />

      {/* Middle Panel - Chat Interface */}
      <div className="flex-1 border-r border-gray-300 bg-white">
        <ChatPanel
          sessionId={currentSessionId}
          onSessionChange={setCurrentSessionId}
          browserSessionId={browserSessionId}
          onBrowserSessionChange={setBrowserSessionId}
          onStreamUrlChange={setStreamUrl}
          onAgentActiveChange={setAgentActive}
        />
      </div>

      {/* Right Panel - Browser View */}
      <div className="flex-1 bg-gray-50">
        <BrowserPanel
          browserSessionId={browserSessionId}
          chatSessionId={currentSessionId}
          streamUrl={streamUrl}
          agentActive={agentActive}
        />
      </div>
    </div>
  );
}
