'use client';

import { useState, useEffect, useRef } from 'react';
// import { useChat } from 'ai/react';
import { Send, Bot, User, Camera, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

interface ChatPanelProps {
  sessionId: string | null;
  onSessionChange: (id: string) => void;
  browserSessionId: string | null;
  onBrowserSessionChange: (id: string) => void;
  onStreamUrlChange: (url: string | null) => void;
  onAgentActiveChange: (active: boolean) => void;
}

export default function ChatPanel({
  sessionId,
  onSessionChange,
  browserSessionId,
  onBrowserSessionChange,
  onStreamUrlChange,
  onAgentActiveChange,
}: ChatPanelProps) {
  const [isWaitingForApproval, setIsWaitingForApproval] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const toggleThinking = (messageId: string) => {
    setExpandedThinking(prev => ({
      ...prev,
      [messageId]: !prev[messageId]
    }));
  };

  // Load messages when session changes
  useEffect(() => {
    if (sessionId && !sessionId.startsWith('fallback-')) {
      loadSessionMessages(sessionId);
    } else {
      // Clear messages for new session
      setMessages([]);
    }
  }, [sessionId]);

  const loadSessionMessages = async (sid: string) => {
    setIsLoadingHistory(true);
    try {
      const response = await fetch(`/api/sessions/${sid}`);

      if (!response.ok) {
        throw new Error('Failed to load session messages');
      }

      const data = await response.json();
      console.log('📥 Loaded session data:', data);

      // Format messages for display
      const formattedMessages = data.messages?.map((msg: any) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        thinking: msg.thinking || undefined,
        toolCalls: msg.tool_calls || []
      })) || [];

      setMessages(formattedMessages);

      // Update browser session if available
      if (data.session?.browserSessionId && data.session.browserSessionId !== browserSessionId) {
        onBrowserSessionChange(data.session.browserSessionId);
      }

      console.log('✅ Loaded', formattedMessages.length, 'messages for session', sid);
    } catch (error) {
      console.error('❌ Failed to load session messages:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = { id: Date.now().toString(), role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    await sendMessage([...messages, userMessage]);
  };

  const sendMessage = async (messageHistory: any[], continueAgent = false) => {
    setIsLoading(true);
    onAgentActiveChange(true); // Notify that agent is starting work

    try {
      console.log('🔥 Frontend calling agent API (streaming)...', { continueAgent });

      // Call our agent chat API with streaming
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: messageHistory,
          sessionId: sessionId,
          browserSessionId: browserSessionId,
          continueAgent: continueAgent,
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Check if response is SSE stream or regular JSON
      const contentType = response.headers.get('content-type');

      if (contentType?.includes('text/event-stream')) {
        console.log('📡 Receiving SSE stream...');

        // Process SSE stream
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        if (!reader) {
          throw new Error('No reader available for stream');
        }

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            console.log('✅ Stream completed');
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = JSON.parse(line.substring(6));

              // Trim base64 from logs (limit to 100 chars)
              const logData = { ...data };
              if (logData.message?.toolCalls) {
                logData.message.toolCalls = logData.message.toolCalls.map((tc: any) => ({
                  ...tc,
                  result: {
                    ...tc.result,
                    screenshot: tc.result?.screenshot && tc.result.screenshot.length > 100
                      ? `[base64... ${tc.result.screenshot.substring(0, 100)}... (${tc.result.screenshot.length} total chars)]`
                      : tc.result?.screenshot
                  }
                }));
              }
              console.log('📦 SSE event:', data.type, logData);

              // Handle different event types
              switch (data.type) {
                case 'metadata':
                  // Update session info and stream URL immediately
                  if (data.sessionId && data.sessionId !== sessionId) {
                    onSessionChange(data.sessionId);
                  }
                  if (data.browserSessionId && data.browserSessionId !== browserSessionId) {
                    onBrowserSessionChange(data.browserSessionId);
                  }
                  if (data.streamUrl) {
                    console.log('🔗 Stream URL received:', data.streamUrl);
                    onStreamUrlChange(data.streamUrl);
                  }
                  break;

                case 'message':
                  // Add agent message in real-time
                  const agentMessage = {
                    id: data.message.id || (Date.now() + Math.random()).toString(),
                    role: data.message.role,
                    content: data.message.content,
                    thinking: data.message.thinking || undefined,
                    toolCalls: data.message.toolCalls || []
                  };
                  console.log('💬 Adding message in real-time:', agentMessage.content.substring(0, 100));
                  setMessages(prev => [...prev, agentMessage]);
                  break;

                case 'done':
                  console.log('✅ Agent completed task');
                  setIsLoading(false);
                  onAgentActiveChange(false);
                  break;

                case 'error':
                  console.error('❌ Agent error:', data.message);
                  const errorMsg = {
                    id: (Date.now() + Math.random()).toString(),
                    role: 'assistant',
                    content: data.message
                  };
                  setMessages(prev => [...prev, errorMsg]);
                  setIsLoading(false);
                  onAgentActiveChange(false);
                  break;
              }
            }
          }
        }

      } else {
        // Fallback: Handle regular JSON response (demo mode, etc.)
        const data = await response.json();
        console.log('✅ Agent API Response (JSON):', data);

        // Update session IDs if provided
        if (data.sessionId && data.sessionId !== sessionId) {
          onSessionChange(data.sessionId);
        }
        if (data.browserSessionId && data.browserSessionId !== browserSessionId) {
          onBrowserSessionChange(data.browserSessionId);
        }
        if (data.streamUrl) {
          onStreamUrlChange(data.streamUrl);
        }

        // Add message
        const aiMessage = {
          id: (Date.now() + Math.random()).toString(),
          role: 'assistant',
          content: data.message?.content || 'No response received',
          toolCalls: data.message?.toolCalls || []
        };
        setMessages(prev => [...prev, aiMessage]);

        setIsLoading(false);
        onAgentActiveChange(false);
      }

    } catch (error) {
      console.error('❌ Agent API error:', error);

      // Fallback response on error
      const errorMessage = {
        id: (Date.now() + Math.random()).toString(),
        role: 'assistant',
        content: `❌ Error connecting to agent API: ${error instanceof Error ? error.message : 'Unknown error'}. Check console for details.`
      };
      setMessages(prev => [...prev, errorMessage]);
      setIsLoading(false);
      onAgentActiveChange(false); // Notify that agent stopped due to error
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const getMessageIcon = (role: string, toolCalls?: any[]) => {
    if (role === 'user') return <User className="w-5 h-5 text-blue-600" />;
    if (toolCalls?.some((call: any) => call.toolName === 'take_screenshot' || call.toolName === 'screenshot')) {
      return <Camera className="w-5 h-5 text-green-600" />;
    }
    if (toolCalls?.some((call: any) => call.toolName === 'computer_use')) {
      return <Bot className="w-5 h-5 text-blue-600" />;
    }
    return <Bot className="w-5 h-5 text-purple-600" />;
  };

  const handleNewChat = () => {
    onSessionChange(null);
    onBrowserSessionChange(null);
    onStreamUrlChange(null);
  };

  const formatToolCall = (toolCall: any) => {
    switch (toolCall.toolName) {
      case 'computer_use':
        return (
          <div className="bg-blue-50 p-3 rounded-md border border-blue-200 mt-2">
            <div className="flex items-center gap-2 mb-2">
              <Bot className="w-4 h-4 text-blue-600" />
              <span className="font-medium text-blue-800">Computer Action</span>
            </div>
            <div className="text-sm">
              <div><strong>Action:</strong> {toolCall.args.action}</div>
              {toolCall.args.coordinate && (
                <div><strong>Position:</strong> ({toolCall.args.coordinate[0]}, {toolCall.args.coordinate[1]})</div>
              )}
              {toolCall.args.text && (
                <div><strong>Text:</strong> "{toolCall.args.text}"</div>
              )}
              {toolCall.args.key && (
                <div><strong>Key:</strong> {toolCall.args.key}</div>
              )}
              {toolCall.args.direction && (
                <div><strong>Scroll:</strong> {toolCall.args.direction} ({toolCall.args.amount || 300}px)</div>
              )}
              {toolCall.args.description && (
                <div className="text-gray-600 italic">{toolCall.args.description}</div>
              )}
            </div>
            {toolCall.result && (
              <div className="mt-2">
                {/* Show screenshot if available */}
                {toolCall.args.action === 'screenshot' && toolCall.result.screenshot_url && (
                  <div className="mb-2">
                    <a
                      href={toolCall.result.screenshot_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block cursor-pointer hover:opacity-80 transition-opacity"
                    >
                      <img
                        src={toolCall.result.screenshot_url}
                        alt="Screenshot"
                        className="max-w-full h-auto rounded border border-gray-300 max-h-64 object-contain bg-gray-50"
                      />
                    </a>
                    <div className="flex items-center gap-2 mt-2">
                      <a
                        href={toolCall.result.screenshot_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download Full Size
                      </a>
                      <span className="text-xs text-gray-500">•</span>
                      <a
                        href={toolCall.result.screenshot_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Open in New Tab
                      </a>
                    </div>
                  </div>
                )}
                <div className="text-xs">
                  <div className={`font-medium ${
                    toolCall.result.success ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {toolCall.result.success ? '✅ Success' : '❌ Failed'}: {toolCall.result.description}
                  </div>
                  {toolCall.result.error && (
                    <div className="text-red-600 mt-1">Error: {toolCall.result.error}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      case 'take_screenshot':
      case 'screenshot':
        return (
          <div className="bg-green-50 p-3 rounded-md border border-green-200 mt-2">
            <div className="flex items-center gap-2 mb-2">
              <Camera className="w-4 h-4 text-green-600" />
              <span className="font-medium text-green-800">Screenshot Analysis</span>
            </div>
            {toolCall.args?.reason && (
              <div className="text-sm text-gray-600 mb-2">
                <strong>Reason:</strong> {toolCall.args.reason}
              </div>
            )}
            {toolCall.result?.screenshot_url ? (
              <div className="mt-2">
                <a
                  href={toolCall.result.screenshot_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block cursor-pointer hover:opacity-80 transition-opacity"
                >
                  <img
                    src={toolCall.result.screenshot_url}
                    alt="Agent Screenshot"
                    className="max-w-full h-auto rounded border border-gray-300 max-h-64 object-contain bg-gray-50"
                  />
                </a>
                <div className="flex items-center gap-2 mt-2">
                  <a
                    href={toolCall.result.screenshot_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download Full Size
                  </a>
                  <span className="text-xs text-gray-500">•</span>
                  <a
                    href={toolCall.result.screenshot_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Open in New Tab
                  </a>
                </div>
              </div>
            ) : toolCall.result?.screenshot && (
              <div className="mt-2">
                <img
                  src={`data:image/png;base64,${toolCall.result.screenshot}`}
                  alt="Agent Screenshot"
                  className="max-w-full h-auto rounded border border-gray-300 max-h-64 object-contain"
                />
              </div>
            )}
            {toolCall.result && (
              <div className="mt-2 text-xs">
                <div className={`font-medium ${
                  toolCall.result.success ? 'text-green-600' : 'text-red-600'
                }`}>
                  {toolCall.result.success ? '✅ Success' : '❌ Failed'}: {toolCall.result.description}
                </div>
                {toolCall.result.error && (
                  <div className="text-red-600 mt-1">Error: {toolCall.result.error}</div>
                )}
              </div>
            )}
          </div>
        );
      case 'approval_request':
        return (
          <div className="bg-yellow-50 p-3 rounded-md border border-yellow-200 mt-2">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-yellow-600" />
              <span className="font-medium text-yellow-800">Approval Required</span>
            </div>
            <div className="text-sm">
              <div><strong>Risk Level:</strong> {toolCall.args.riskLevel}</div>
              <div><strong>Reason:</strong> {toolCall.args.reason}</div>
            </div>
            <div className="mt-2 flex gap-2">
              {toolCall.result?.status === 'approved' && (
                <div className="flex items-center gap-1 text-green-600">
                  <CheckCircle className="w-4 h-4" />
                  <span className="text-sm">Approved</span>
                </div>
              )}
              {toolCall.result?.status === 'denied' && (
                <div className="flex items-center gap-1 text-red-600">
                  <XCircle className="w-4 h-4" />
                  <span className="text-sm">Denied</span>
                </div>
              )}
              {toolCall.result?.status === 'pending' && (
                <div className="flex items-center gap-1 text-yellow-600">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="text-sm">Pending Review</span>
                </div>
              )}
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-200 p-4 bg-white">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-800">QBO AI Agent</h1>
            <p className="text-sm text-gray-600">
              AI-powered computer use agent for QuickBooks Online
            </p>
          </div>
          {/* New Chat button - only show when reviewing a thread */}
          {sessionId && messages.length > 0 && !isLoading && (
            <button
              onClick={handleNewChat}
              className="px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-blue-200 hover:border-blue-300"
            >
              New Chat
            </button>
          )}
        </div>
        {isWaitingForApproval && (
          <div className="mt-2 flex items-center gap-2 text-yellow-600 bg-yellow-50 p-2 rounded">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm">Waiting for human approval...</span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoadingHistory ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-gray-600">Loading conversation history...</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center text-gray-500 mt-8">
            <Bot className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <p className="text-lg font-medium">Welcome to QBO AI Agent</p>
            <p className="text-sm mt-2">
              I can see your screen, navigate websites, and perform QuickBooks tasks autonomously.
              <br />
              Just tell me what you need and I'll handle it step by step!
            </p>
          </div>
        ) : null}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`flex gap-3 max-w-[80%] ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                {getMessageIcon(message.role, (message as any).toolCalls)}
              </div>
              <div
                className={`p-3 rounded-lg ${
                  message.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-800'
                }`}
              >
                <div className="whitespace-pre-wrap">{message.content}</div>

                {/* Tool Calls */}
                {(message as any).toolCalls?.map((toolCall: any, index: number) => (
                  <div key={toolCall.toolCallId || `tool-${index}`}>
                    {formatToolCall(toolCall)}
                  </div>
                ))}

                {/* Reasoning (Thinking) - only show for assistant messages */}
                {message.role === 'assistant' && (message as any).thinking && (
                  <div className="mt-3 border-t border-gray-200 pt-3">
                    <button
                      onClick={() => toggleThinking(message.id)}
                      className="text-sm font-medium text-gray-700 hover:text-gray-900 flex items-center gap-1 transition-colors"
                    >
                      <span className="text-gray-500">
                        {expandedThinking[message.id] ? '▼' : '▶'}
                      </span>
                      Reasoning
                    </button>
                    {expandedThinking[message.id] && (
                      <div className="mt-2 p-3 bg-white rounded border border-gray-300 text-sm text-gray-700 whitespace-pre-wrap">
                        {(message as any).thinking}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
              <Bot className="w-5 h-5 text-purple-600" />
            </div>
            <div className="bg-gray-100 text-gray-800 p-3 rounded-lg">
              <div className="flex items-center gap-2">
                <div className="animate-spin w-4 h-4 border-2 border-purple-600 border-t-transparent rounded-full"></div>
                <span>Agent thinking and acting...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-4 bg-white">
        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            value={input}
            onChange={handleInputChange}
            placeholder="Tell me what you'd like me to do in QuickBooks Online..."
            className="flex-1 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isLoading || isWaitingForApproval}
          />
          <button
            type="submit"
            disabled={isLoading || isWaitingForApproval || !input.trim()}
            className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}