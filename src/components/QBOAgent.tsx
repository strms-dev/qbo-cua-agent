'use client';

import { useState } from 'react';
import ChatPanel from './ChatPanel';
import BrowserPanel from './BrowserPanel';

export default function QBOAgent() {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [browserSessionId, setBrowserSessionId] = useState<string | null>(null);

  return (
    <div className="h-screen flex bg-gray-100">
      {/* Left Panel - Chat Interface */}
      <div className="w-1/2 border-r border-gray-300 bg-white">
        <ChatPanel
          sessionId={currentSessionId}
          onSessionChange={setCurrentSessionId}
          browserSessionId={browserSessionId}
          onBrowserSessionChange={setBrowserSessionId}
        />
      </div>

      {/* Right Panel - Browser View */}
      <div className="w-1/2 bg-gray-50">
        <BrowserPanel
          browserSessionId={browserSessionId}
          chatSessionId={currentSessionId}
        />
      </div>
    </div>
  );
}