'use client';

import { useState } from 'react';
import ChatPanel from './ChatPanel';
import BrowserPanel from './BrowserPanel';
import ThreadHistory from './ThreadHistory';

export default function QBOAgent() {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [browserSessionId, setBrowserSessionId] = useState<string | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [agentActive, setAgentActive] = useState<boolean>(false);

  const handleSessionSelect = (sessionId: string) => {
    setCurrentSessionId(sessionId);
  };

  return (
    <div className="h-screen flex bg-gray-100">
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