'use client';

import { useState, useEffect, useRef } from 'react';
// import { useChat } from 'ai/react';
import { Send, Bot, User, Camera, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

interface ChatPanelProps {
  sessionId: string | null;
  onSessionChange: (id: string) => void;
  browserSessionId: string | null;
  onBrowserSessionChange: (id: string) => void;
}

export default function ChatPanel({
  sessionId,
  onSessionChange,
  browserSessionId,
  onBrowserSessionChange,
}: ChatPanelProps) {
  const [isWaitingForApproval, setIsWaitingForApproval] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = { id: Date.now().toString(), role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // For now, just simulate a response
      setTimeout(() => {
        const aiMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'This is a placeholder response. Once you set up the API keys, I\'ll be able to help with QBO tasks!'
        };
        setMessages(prev => [...prev, aiMessage]);
        setIsLoading(false);
      }, 1000);
    } catch (error) {
      console.error('Chat error:', error);
      setIsLoading(false);
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
    if (toolCalls?.some((call: any) => call.toolName === 'screenshot')) {
      return <Camera className="w-5 h-5 text-green-600" />;
    }
    return <Bot className="w-5 h-5 text-purple-600" />;
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
                <div><strong>Text:</strong> {toolCall.args.text}</div>
              )}
            </div>
            {toolCall.result && (
              <div className="mt-2 text-xs text-gray-600">
                <strong>Result:</strong> {JSON.stringify(toolCall.result, null, 2)}
              </div>
            )}
          </div>
        );
      case 'screenshot':
        return (
          <div className="bg-green-50 p-3 rounded-md border border-green-200 mt-2">
            <div className="flex items-center gap-2">
              <Camera className="w-4 h-4 text-green-600" />
              <span className="font-medium text-green-800">Screenshot Taken</span>
            </div>
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
        <h1 className="text-xl font-semibold text-gray-800">QBO AI Agent</h1>
        <p className="text-sm text-gray-600">
          AI-powered bookkeeping assistant for QuickBooks Online
        </p>
        {isWaitingForApproval && (
          <div className="mt-2 flex items-center gap-2 text-yellow-600 bg-yellow-50 p-2 rounded">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm">Waiting for human approval...</span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-8">
            <Bot className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <p className="text-lg font-medium">Welcome to QBO AI Agent</p>
            <p className="text-sm mt-2">
              I can help you with QuickBooks Online bookkeeping tasks.
              <br />
              Start by describing what you'd like me to do.
            </p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`flex gap-3 max-w-[80%] ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                {getMessageIcon(message.role, (message as any).toolInvocations)}
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
                {(message as any).toolInvocations?.map((toolCall: any) => (
                  <div key={toolCall.toolCallId}>
                    {formatToolCall(toolCall)}
                  </div>
                ))}
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
                <span>Thinking...</span>
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
            placeholder="Describe the bookkeeping task you'd like me to help with..."
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