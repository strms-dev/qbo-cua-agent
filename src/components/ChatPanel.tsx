'use client';

import { useState, useEffect, useRef } from 'react';
// import { useChat } from 'ai/react';
import { Send, Bot, User, Camera, AlertTriangle, CheckCircle, XCircle, Square } from 'lucide-react';

interface ChatPanelProps {
  sessionId: string | null;
  onSessionChange: (id: string | null) => void;
  browserSessionId: string | null;
  onBrowserSessionChange: (id: string | null) => void;
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
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<string | null>(null);
  const [batchContext, setBatchContext] = useState<any>(null);
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
      loadSessionMessages(sessionId).then(() => {
        // After loading messages, check if there's an active task
        checkAndResumeActiveTask(sessionId);
      });
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
        toolCalls: msg.tool_calls || [],
        anthropic_request: msg.anthropic_request || undefined,
        anthropic_response: msg.anthropic_response || undefined
      })) || [];

      setMessages(formattedMessages);

      // Update browser session data if available (needed for batch API sessions accessed via webhook)
      if (data.browserSession?.onkernelSessionId) {
        console.log('🔗 Updating browser session from loaded data:', data.browserSession.onkernelSessionId);
        onBrowserSessionChange(data.browserSession.onkernelSessionId);
      }
      if (data.browserSession?.liveViewUrl) {
        console.log('🔗 Updating stream URL from loaded data:', data.browserSession.liveViewUrl);
        onStreamUrlChange(data.browserSession.liveViewUrl);
      }

      console.log('✅ Loaded', formattedMessages.length, 'messages for session', sid);
    } catch (error) {
      console.error('❌ Failed to load session messages:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const checkAndResumeActiveTask = async (sid: string) => {
    try {
      console.log('🔍 Checking for active tasks in session:', sid);

      // Fetch session data which includes task information
      const response = await fetch(`/api/sessions/${sid}`);
      if (!response.ok) return;

      const data = await response.json();

      // Check if any messages have a task_id (from metadata in messages table)
      const messagesWithTasks = data.messages?.filter((msg: any) => msg.metadata?.task_id) || [];
      if (messagesWithTasks.length === 0) {
        console.log('ℹ️ No tasks found in session');
        return;
      }

      // Get the most recent task ID
      const lastTaskId = messagesWithTasks[messagesWithTasks.length - 1].metadata.task_id;
      console.log('🔍 Found task ID:', lastTaskId);

      // Check task status from database
      const taskResponse = await fetch(`/api/tasks/${lastTaskId}`);
      if (!taskResponse.ok) {
        console.log('⚠️ Task not found in database');
        return;
      }

      const taskData = await taskResponse.json();
      console.log('📊 Task status:', taskData.status);

      // Check if task is part of a batch execution
      if (taskData.batch_execution_id) {
        console.log('📦 Task is part of batch execution:', taskData.batch_execution_id);

        // Fetch batch execution status
        const batchResponse = await fetch(`/api/batch-executions/${taskData.batch_execution_id}/status`);
        if (batchResponse.ok) {
          const batchData = await batchResponse.json();
          console.log('📦 Batch status:', batchData);

          // Store batch context for UI
          setBatchContext({
            batchExecutionId: batchData.batchExecution.id,
            totalTasks: batchData.batchExecution.totalTasks,
            completedTasks: batchData.batchExecution.completedTasks,
            tasks: batchData.tasks,
            currentTaskId: lastTaskId,
          });

          // If there's an active task in the batch (different from current one or same if running/paused)
          if (batchData.hasActiveTask && batchData.activeTask) {
            console.log('🔄 Found active task in batch:', batchData.activeTask.id);
            setCurrentTaskId(batchData.activeTask.id);
            setTaskStatus(batchData.activeTask.status);

            if (batchData.activeTask.status === 'running') {
              setIsLoading(true);
              onAgentActiveChange(true);
              // Reconnect to SSE stream for the active task
              await connectToRunningTask(batchData.activeTask.id, sid);
            } else if (batchData.activeTask.status === 'paused') {
              console.log('⏸️ Batch task is paused');
            }
            return;
          }
        }
      }

      // No batch or no active task in batch - handle single task
      if (taskData.status === 'running') {
        console.log('🔄 Found running task, setting up SSE connection:', lastTaskId);
        setCurrentTaskId(lastTaskId);
        setTaskStatus('running');
        setIsLoading(true);
        onAgentActiveChange(true);

        // Reconnect to SSE stream for this task
        await connectToRunningTask(lastTaskId, sid);
      } else if (taskData.status === 'paused') {
        console.log('⏸️ Task is paused, setting task status indicator');
        setCurrentTaskId(lastTaskId);
        setTaskStatus('paused');
      }
    } catch (error) {
      console.error('❌ Failed to check for active tasks:', error);
    }
  };

  const connectToRunningTask = async (taskId: string, sid: string) => {
    try {
      console.log('🔌 Connecting to running task:', taskId);

      // Call the chat API with continueAgent=true to resume execution and get SSE stream
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages, // Use already loaded messages
          sessionId: sid,
          browserSessionId: browserSessionId,
          continueAgent: true,
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('text/event-stream')) {
        console.log('⚠️ Response is not SSE stream');
        return;
      }

      console.log('📡 Receiving SSE stream for running task...');

      // Process SSE stream (same logic as in sendMessage)
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (!reader) {
        throw new Error('No reader available for stream');
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('✅ SSE stream completed');
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.substring(6));

            // Handle SSE events (same as sendMessage)
            switch (data.type) {
              case 'metadata':
                if (data.browserSessionId && data.browserSessionId !== browserSessionId) {
                  onBrowserSessionChange(data.browserSessionId);
                }
                if (data.streamUrl) {
                  console.log('🔗 Stream URL received:', data.streamUrl);
                  onStreamUrlChange(data.streamUrl);
                }
                if (data.taskId) {
                  console.log('📋 Task ID received:', data.taskId);
                  setCurrentTaskId(data.taskId);
                }
                break;

              case 'message':
                const agentMessage = {
                  id: data.message.id || (Date.now() + Math.random()).toString(),
                  role: data.message.role,
                  content: data.message.content,
                  thinking: data.message.thinking,
                  toolCalls: data.message.toolCalls || []
                };
                console.log('💬 Adding message in real-time:', agentMessage.content.substring(0, 100));
                setMessages(prev => [...prev, agentMessage]);
                break;

              case 'task_status':
                console.log('📊 Task status update:', data.status);
                setTaskStatus(data.status);
                break;

              case 'done':
                console.log('✅ Task completed');
                setIsLoading(false);
                onAgentActiveChange(false);
                setTaskStatus('completed');
                break;

              case 'error':
                console.error('❌ Task error:', data.message);
                const errorMsg = {
                  id: (Date.now() + Math.random()).toString(),
                  role: 'assistant',
                  content: data.message
                };
                setMessages(prev => [...prev, errorMsg]);
                setIsLoading(false);
                onAgentActiveChange(false);
                setTaskStatus('failed');
                break;
            }
          }
        }
      }
    } catch (error) {
      console.error('❌ Failed to connect to running task:', error);
      setIsLoading(false);
      onAgentActiveChange(false);
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
                  // Capture task ID from metadata
                  if (data.taskId) {
                    console.log('📋 Task ID received:', data.taskId);
                    setCurrentTaskId(data.taskId);
                    setTaskStatus('running');
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

                case 'task_status':
                  // Handle task status updates from agent
                  console.log('📊 Task status update:', data.status, data.message);
                  setTaskStatus(data.status);
                  // Note: Don't create a separate status message here
                  // The agent's message with report_task_status tool call will already display the status
                  break;

                case 'done':
                  console.log('✅ Agent completed task');
                  setIsLoading(false);
                  onAgentActiveChange(false);
                  setTaskStatus('completed');
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
                  setTaskStatus('failed');
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
    setCurrentTaskId(null);
    setTaskStatus(null);
    setBatchContext(null);
  };

  const handleStop = async () => {
    if (!currentTaskId) {
      console.warn('⚠️ No active task to stop');
      return;
    }

    console.log('🛑 Stopping task:', currentTaskId);

    try {
      const response = await fetch(`/api/tasks/${currentTaskId}/stop`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`Failed to stop task: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Task stopped:', data);

      // Update UI state
      setIsLoading(false);
      onAgentActiveChange(false);
      setTaskStatus('stopped');

      // Add system message about stop
      const stopMessage = {
        id: (Date.now() + Math.random()).toString(),
        role: 'assistant',
        content: '🛑 Task stopped by user. You can continue by sending a new message.'
      };
      setMessages(prev => [...prev, stopMessage]);

    } catch (error) {
      console.error('❌ Failed to stop task:', error);

      // Show error message
      const errorMessage = {
        id: (Date.now() + Math.random()).toString(),
        role: 'assistant',
        content: `❌ Failed to stop task: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
      setMessages(prev => [...prev, errorMessage]);
    }
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
      case 'report_task_status':
        const statusColors = {
          'completed': { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800', icon: '✅' },
          'failed': { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', icon: '❌' },
          'needs_clarification': { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-800', icon: '⏸️' }
        };
        const statusColor = statusColors[toolCall.args.status as keyof typeof statusColors] || statusColors['completed'];

        return (
          <div className={`${statusColor.bg} p-3 rounded-md border ${statusColor.border} mt-2`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{statusColor.icon}</span>
              <span className={`font-medium ${statusColor.text}`}>Task Status Report</span>
            </div>
            <div className="text-sm">
              <div><strong>Status:</strong> {toolCall.args.status}</div>
              <div className="mt-1"><strong>Message:</strong> {toolCall.args.message}</div>
              {toolCall.args.evidence && (
                <div className="mt-2">
                  <strong>Evidence:</strong>
                  {toolCall.args.evidence.screenshot_url && (
                    <div className="mt-1">
                      <a
                        href={toolCall.args.evidence.screenshot_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-xs"
                      >
                        View Screenshot
                      </a>
                    </div>
                  )}
                  {toolCall.args.evidence.extracted_data && (
                    <div className="mt-1 p-2 bg-white rounded text-xs">
                      <pre className="whitespace-pre-wrap">{JSON.stringify(toolCall.args.evidence.extracted_data, null, 2)}</pre>
                    </div>
                  )}
                  {toolCall.args.evidence.error_details && (
                    <div className="mt-1 text-red-600 text-xs">
                      {toolCall.args.evidence.error_details}
                    </div>
                  )}
                </div>
              )}
            </div>
            {toolCall.result && (
              <div className="mt-2 text-xs">
                <div className="font-medium text-green-600">
                  {toolCall.result.description}
                </div>
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
      case 'memory':
        return (
          <div className="bg-purple-50 p-3 rounded-md border border-purple-200 mt-2">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="font-medium text-purple-800">Memory Operation</span>
            </div>
            <div className="text-sm">
              <div><strong>Command:</strong> {toolCall.args.command}</div>
              <div><strong>Path:</strong> {toolCall.args.path}</div>
              {toolCall.args.file_text && (
                <div className="mt-2">
                  <strong>Content:</strong>
                  <div className="mt-1 p-2 bg-white rounded text-xs font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
                    {toolCall.args.file_text.substring(0, 500)}{toolCall.args.file_text.length > 500 ? '...' : ''}
                  </div>
                </div>
              )}
              {toolCall.args.old_str && (
                <div className="mt-1"><strong>Replace:</strong> "{toolCall.args.old_str.substring(0, 50)}{toolCall.args.old_str.length > 50 ? '...' : ''}"</div>
              )}
              {toolCall.args.new_str && (
                <div className="mt-1"><strong>With:</strong> "{toolCall.args.new_str.substring(0, 50)}{toolCall.args.new_str.length > 50 ? '...' : ''}"</div>
              )}
            </div>
            {toolCall.result && (
              <div className="mt-2 text-xs">
                <div className={`font-medium ${
                  toolCall.result.success ? 'text-green-600' : 'text-red-600'
                }`}>
                  {toolCall.result.success ? '✅ Success' : '❌ Failed'}: {toolCall.result.description}
                </div>
                {toolCall.result.error && (
                  <div className="text-red-600 mt-1 p-2 bg-red-50 rounded">
                    <strong>Error:</strong> {toolCall.result.error}
                  </div>
                )}
              </div>
            )}
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
            <h1 className="text-xl font-semibold text-gray-800">STRMS AI Agent</h1>
            <div className="flex items-center gap-2">
              <p className="text-sm text-gray-600">
                AI-powered computer use agent
              </p>
              {/* Task Status Indicator */}
              {taskStatus && taskStatus !== 'completed' && (
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  taskStatus === 'running' ? 'bg-blue-100 text-blue-700' :
                  taskStatus === 'stopped' ? 'bg-gray-100 text-gray-700' :
                  taskStatus === 'paused' ? 'bg-yellow-100 text-yellow-700' :
                  taskStatus === 'failed' ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  {taskStatus === 'running' && '🔄 Running'}
                  {taskStatus === 'stopped' && '🛑 Stopped'}
                  {taskStatus === 'paused' && '⏸️ Paused'}
                  {taskStatus === 'failed' && '❌ Failed'}
                  {!['running', 'stopped', 'paused', 'failed'].includes(taskStatus) && `📌 ${taskStatus}`}
                </span>
              )}
            </div>
            {/* Batch Execution Indicator */}
            {batchContext && (
              <div className="mt-2 text-xs text-gray-600 bg-purple-50 border border-purple-200 rounded px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-purple-700">📦 Batch Execution</span>
                  <span className="text-gray-500">|</span>
                  <span>{batchContext.completedTasks} / {batchContext.totalTasks} tasks completed</span>
                </div>
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  {batchContext.tasks.map((task: any, index: number) => (
                    <div key={task.id} className="flex items-center gap-1">
                      <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-medium ${
                        task.id === batchContext.currentTaskId
                          ? 'bg-blue-500 text-white ring-2 ring-blue-300'
                          : task.status === 'completed'
                          ? 'bg-green-500 text-white'
                          : task.status === 'running'
                          ? 'bg-blue-400 text-white animate-pulse'
                          : task.status === 'paused'
                          ? 'bg-yellow-400 text-white'
                          : task.status === 'failed'
                          ? 'bg-red-500 text-white'
                          : 'bg-gray-300 text-gray-600'
                      }`}>
                        {index + 1}
                      </span>
                      {task.status === 'completed' && <span className="text-green-600">✓</span>}
                      {task.status === 'running' && <span className="text-blue-600">▶</span>}
                      {task.status === 'paused' && <span className="text-yellow-600">⏸</span>}
                      {task.status === 'failed' && <span className="text-red-600">✗</span>}
                    </div>
                  ))}
                </div>
                {batchContext.currentTaskId && (
                  <div className="mt-1 text-xs text-gray-500">
                    Viewing messages from Task {batchContext.tasks.findIndex((t: any) => t.id === batchContext.currentTaskId) + 1}
                    {batchContext.tasks.find((t: any) => t.status === 'running' || t.status === 'paused') && (
                      <span className="ml-1">
                        • {batchContext.tasks.find((t: any) => t.status === 'running') ? 'Another task is running' : 'A task is paused'}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
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
            <p className="text-lg font-medium">Welcome to STRMS AI Agent</p>
            <p className="text-sm mt-2">
              I can navigate websites and perform tasks autonomously.
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
                {message.content && message.content.trim() !== '' && (
                  <div className="whitespace-pre-wrap">{message.content}</div>
                )}

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
            placeholder="Tell me what you'd like me to do..."
            className="flex-1 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isLoading || isWaitingForApproval}
          />
          {isLoading ? (
            <button
              type="button"
              onClick={handleStop}
              className="px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2 transition-colors"
              title="Stop current task"
            >
              <Square className="w-4 h-4" />
              <span className="hidden sm:inline">Stop</span>
            </button>
          ) : (
            <button
              type="submit"
              disabled={isWaitingForApproval || !input.trim()}
              className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}