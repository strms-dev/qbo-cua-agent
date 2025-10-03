import { supabase } from '@/lib/supabase';
import { scrapybaraClient } from '@/lib/scrapybara';
import Anthropic from '@anthropic-ai/sdk';

// Initialize direct Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Define computer tool (following Anthropic's official format)
const COMPUTER_TOOL = {
  type: "computer_20250124" as const,
  name: "computer" as const,
  display_width_px: 1280,
  display_height_px: 800,
  display_number: 1,
};

// Interface for tool results (following Anthropic's demo)
interface ToolResult {
  output?: string;
  error?: string;
  base64_image?: string;
  screenshot_url?: string; // URL from Supabase Storage
}

// Helper to sanitize API data by removing base64 images
// Returns a deep copy without base64 image data to reduce storage
function sanitizeApiData(obj: any): any {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    // If string looks like base64 data (very long and matches pattern), replace with marker
    if (obj.length > 1000 && obj.match(/^[A-Za-z0-9+/=]+$/)) {
      return '[BASE64_IMAGE_REMOVED]';
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeApiData);
  }

  if (obj && typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Remove base64_image, base64Image, or data fields that contain image data
      if ((key === 'base64_image' || key === 'base64Image' || key === 'data') &&
          typeof value === 'string' && value.length > 1000) {
        sanitized[key] = '[BASE64_IMAGE_REMOVED]';
      } else if (key === 'source' && typeof value === 'object' && (value as any).type === 'base64') {
        // Handle Anthropic image source format
        sanitized[key] = {
          type: 'base64',
          media_type: (value as any).media_type,
          data: '[BASE64_IMAGE_REMOVED]'
        };
      } else {
        sanitized[key] = sanitizeApiData(value);
      }
    }
    return sanitized;
  }

  return obj;
}

// Helper to trim base64 from objects for logging (defined early)
// Limits base64 strings to 100 chars for readability
function trimBase64ForLog(obj: any): any {
  if (typeof obj === 'string') {
    // If string is longer than 100 chars and looks like base64, truncate it
    if (obj.length > 100 && obj.match(/^[A-Za-z0-9+/=]+$/)) {
      return `[base64... ${obj.substring(0, 100)}... (${obj.length} total chars)]`;
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(trimBase64ForLog);
  }
  if (obj && typeof obj === 'object') {
    const trimmed: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'base64_image' || key === 'screenshot' || key === 'base64Image' || (key === 'data' && typeof value === 'string' && value.length > 100)) {
        if (typeof value === 'string' && value.length > 100) {
          trimmed[key] = `[base64... ${value.substring(0, 100)}... (${value.length} total chars)]`;
        } else {
          trimmed[key] = value;
        }
      } else {
        trimmed[key] = trimBase64ForLog(value);
      }
    }
    return trimmed;
  }
  return obj;
}

// Helper to upload screenshot to Supabase Storage
async function uploadScreenshotToStorage(base64Image: string, sessionId: string): Promise<string | null> {
  try {
    // Convert base64 to buffer
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Generate unique filename
    const timestamp = Date.now();
    const filename = `${sessionId}/${timestamp}.png`;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('cua-screenshots')
      .upload(filename, buffer, {
        contentType: 'image/png',
        upsert: false
      });

    if (error) {
      console.error('❌ Failed to upload screenshot:', error);
      return null;
    }

    // Generate signed URL with 1 year expiration (31,536,000 seconds)
    const { data: urlData, error: urlError } = await supabase.storage
      .from('cua-screenshots')
      .createSignedUrl(filename, 31536000);

    if (urlError || !urlData) {
      console.error('❌ Failed to create signed URL:', urlError);
      return null;
    }

    console.log('✅ Screenshot uploaded with signed URL:', urlData.signedUrl);
    return urlData.signedUrl;
  } catch (error) {
    console.error('❌ Screenshot upload error:', error);
    return null;
  }
}

// Execute computer tool actions using Scrapybara
async function executeComputerAction(toolInput: any, browserSessionId: string, sessionId: string): Promise<ToolResult> {
  console.log('🖥️ Executing computer action:', trimBase64ForLog(toolInput));

  try {
    const { action, coordinate, text } = toolInput;

    switch (action) {
      case 'screenshot':
        console.log('📸 Taking screenshot...');
        const screenshot = await scrapybaraClient.takeScreenshot(browserSessionId);

        // Upload to Supabase Storage
        const screenshotUrl = await uploadScreenshotToStorage(screenshot.base64Image, sessionId);

        return {
          base64_image: screenshot.base64Image, // Keep for compatibility
          screenshot_url: screenshotUrl || undefined, // Add storage URL
          output: 'Screenshot saved'
        };

      case 'left_click':
        if (!coordinate || !Array.isArray(coordinate) || coordinate.length !== 2) {
          throw new Error('left_click requires coordinate [x, y]');
        }
        console.log(`👆 Left clicking at (${coordinate[0]}, ${coordinate[1]})`);
        await scrapybaraClient.click(browserSessionId, coordinate[0], coordinate[1]);
        return {
          output: `Left clicked at coordinates (${coordinate[0]}, ${coordinate[1]})`
        };

      case 'right_click':
        if (!coordinate || !Array.isArray(coordinate) || coordinate.length !== 2) {
          throw new Error('right_click requires coordinate [x, y]');
        }
        console.log(`👆 Right clicking at (${coordinate[0]}, ${coordinate[1]})`);
        await scrapybaraClient.rightClick(browserSessionId, coordinate[0], coordinate[1]);
        return {
          output: `Right clicked at coordinates (${coordinate[0]}, ${coordinate[1]})`
        };

      case 'double_click':
        if (!coordinate || !Array.isArray(coordinate) || coordinate.length !== 2) {
          throw new Error('double_click requires coordinate [x, y]');
        }
        console.log(`👆 Double clicking at (${coordinate[0]}, ${coordinate[1]})`);
        await scrapybaraClient.doubleClick(browserSessionId, coordinate[0], coordinate[1]);
        return {
          output: `Double clicked at coordinates (${coordinate[0]}, ${coordinate[1]})`
        };

      case 'type':
        if (!text) {
          throw new Error('type requires text parameter');
        }
        console.log(`⌨️ Typing: "${text}"`);
        await scrapybaraClient.type(browserSessionId, text);
        return {
          output: `Typed: "${text}"`
        };

      case 'key':
        if (!text) {
          throw new Error('key requires text parameter');
        }
        console.log(`🔤 Pressing key: ${text}`);
        await scrapybaraClient.keyPress(browserSessionId, text);
        return {
          output: `Pressed key: ${text}`
        };

      case 'mouse_move':
        if (!coordinate || !Array.isArray(coordinate) || coordinate.length !== 2) {
          throw new Error('mouse_move requires coordinate [x, y]');
        }
        console.log(`🖱️ Moving mouse to (${coordinate[0]}, ${coordinate[1]})`);
        await scrapybaraClient.moveMouse(browserSessionId, coordinate[0], coordinate[1]);
        return {
          output: `Moved mouse to (${coordinate[0]}, ${coordinate[1]})`
        };

      case 'wait':
        const duration = toolInput.duration || 1000;
        console.log(`⏳ Waiting for ${duration}ms`);
        await new Promise(resolve => setTimeout(resolve, duration));
        return {
          output: `Waited for ${duration}ms`
        };

      case 'cursor_position':
        console.log(`📍 Getting cursor position`);
        const position = await scrapybaraClient.getCursorPosition(browserSessionId);
        return {
          output: `Cursor position retrieved: ${JSON.stringify(position)}`
        };

      default:
        throw new Error(`Unsupported computer action: ${action}`);
    }
  } catch (error: unknown) {
    console.error('❌ Computer action failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      error: `Computer action failed: ${message}`
    };
  }
}

// Create tool result block (following Anthropic's demo format)
function makeToolResult(toolResult: ToolResult, toolUseId: string): any {
  const content = [];

  if (toolResult.output) {
    content.push({
      type: "text",
      text: toolResult.output
    });
  }

  if (toolResult.base64_image) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: toolResult.base64_image
      }
    });
  }

  return {
    tool_use_id: toolUseId,
    type: "tool_result",
    content: content.length > 0 ? content : [{ type: "text", text: "Action completed" }],
    is_error: !!toolResult.error
  };
}

// Streaming sampling loop with real-time updates
async function samplingLoopWithStreaming(
  systemPrompt: string,
  messages: any[],
  browserSessionId: string,
  sessionId: string,
  streamCallback: (event: any) => void,
  maxIterations: number = 15
): Promise<{finalResponse: string, conversationHistory: any[]}> {
  let currentMessages = [...messages];
  let finalResponse = '';
  let conversationHistory: any[] = [];

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    console.log(`🔄 Sampling Loop Iteration ${iteration + 1}/${maxIterations}`);

    try {
      // Build API request
      const apiRequest = {
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        thinking: {
          type: "enabled",
          budget_tokens: 1024
        },
        system: systemPrompt,
        messages: currentMessages,
        tools: [COMPUTER_TOOL],
        betas: ["computer-use-2025-01-24"]
      };

      // Call Anthropic API
      console.log('🧠 Calling Anthropic API...');
      const response = await anthropic.beta.messages.create(apiRequest);

      console.log('🎯 Response stop_reason:', response.stop_reason);

      // Sanitize request and response for storage (remove base64 images)
      const sanitizedRequest = sanitizeApiData(apiRequest);
      const sanitizedResponse = sanitizeApiData({
        id: response.id,
        model: response.model,
        role: response.role,
        content: response.content,
        stop_reason: response.stop_reason,
        stop_sequence: response.stop_sequence,
        usage: response.usage
      });

      // Extract text content
      const textBlocks = response.content.filter(block => block.type === 'text');
      const responseText = textBlocks.map(block => block.text).join('\n');
      finalResponse = responseText;

      // Extract thinking blocks
      const thinkingBlocks = response.content.filter((block: any) => block.type === 'thinking');
      const thinking = thinkingBlocks.length > 0 ? thinkingBlocks[0].thinking : null;
      const thinkingSignature = thinkingBlocks.length > 0 ? thinkingBlocks[0].signature : null;

      console.log('📝 Claude response:', responseText);
      if (thinking) {
        console.log('🧠 Thinking extracted:', thinking.substring(0, 100) + '...');
      }

      // Create assistant message for conversation history
      const assistantMessage: {
        id: string;
        role: string;
        content: string;
        thinking?: string;
        thinking_signature?: string;
        toolCalls: Array<{
          toolCallId: string;
          toolName: string;
          args: any;
          result: {
            success: boolean;
            description: string;
            error?: string;
            screenshot?: string;
            screenshot_url?: string;
          };
        }>;
      } = {
        id: `agent-${Date.now()}-${iteration}`,
        role: "assistant",
        content: responseText,
        thinking: thinking || undefined,
        thinking_signature: thinkingSignature || undefined,
        toolCalls: []
      };

      // Add assistant message to conversation
      currentMessages.push({
        role: "assistant",
        content: response.content
      });

      // Check for tool use
      const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');

      // Execute all tool calls and build tool call history
      const toolResults = [];
      for (const toolBlock of toolUseBlocks) {
        if (toolBlock.type === 'tool_use' && toolBlock.name === 'computer') {
          console.log(`🔧 Executing tool: ${toolBlock.name} (${toolBlock.id})`, trimBase64ForLog(toolBlock.input));

          const toolResult = await executeComputerAction(toolBlock.input, browserSessionId, sessionId);
          const toolResultBlock = makeToolResult(toolResult, toolBlock.id);
          toolResults.push(toolResultBlock);

          console.log(`✅ Tool completed: ${toolBlock.id}`, trimBase64ForLog(toolResult));

          // Add to tool calls for conversation history
          assistantMessage.toolCalls.push({
            toolCallId: toolBlock.id,
            toolName: 'computer_use',
            args: toolBlock.input,
            result: {
              success: !toolResult.error,
              description: toolResult.output || toolResult.error || 'Action completed',
              error: toolResult.error,
              screenshot: toolResult.base64_image, // Keep for backward compatibility
              screenshot_url: (toolResult as any).screenshot_url // Add storage URL
            }
          });
        }
      }

      // Add assistant message with tool calls to history
      conversationHistory.push(assistantMessage);

      // Save assistant message to database (moved before tool use check to capture final messages)
      if (!sessionId.startsWith('fallback-')) {
        try {
          const { data: savedMessage, error: saveError } = await supabase
            .from('messages')
            .insert({
              session_id: sessionId,
              role: 'assistant',
              content: responseText,
              thinking: thinking || null,
              thinking_signature: thinkingSignature || null,
              tool_calls: assistantMessage.toolCalls.length > 0 ? assistantMessage.toolCalls : null,
              anthropic_request: sanitizedRequest,
              anthropic_response: sanitizedResponse,
              metadata: { iteration: iteration + 1 }
            })
            .select()
            .single();

          if (saveError) {
            console.error('⚠️ Failed to save assistant message:', saveError);
          } else {
            console.log('✅ Assistant message saved to DB:', savedMessage?.id);
          }
        } catch (error) {
          console.error('⚠️ Error in database save:', error);
        }
      }

      // Check if conversation is complete (no tool use blocks)
      if (toolUseBlocks.length === 0) {
        console.log('✅ No tools requested - conversation complete');

        // Stream final message
        streamCallback({
          type: 'message',
          message: assistantMessage
        });
        break;
      }

      console.log(`🛠️ Found ${toolUseBlocks.length} tool use blocks`);

      // Stream this message with tool calls immediately
      streamCallback({
        type: 'message',
        message: assistantMessage
      });

      // Add tool results as user message
      if (toolResults.length > 0) {
        currentMessages.push({
          role: "user",
          content: toolResults
        });
        console.log(`📤 Added ${toolResults.length} tool results to conversation`);
      }

      // Small delay between iterations
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error: unknown) {
      console.error('❌ Sampling loop error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      finalResponse = `🤖 Agent encountered an issue: ${message}`;

      // Stream error message
      streamCallback({
        type: 'error',
        message: finalResponse
      });
      break;
    }
  }

  if (finalResponse === '') {
    finalResponse = `⚠️ Agent stopped after ${maxIterations} iterations. Task may be incomplete.`;
  }

  return { finalResponse, conversationHistory };
}

// Message logging for debugging
const loggedMessages: any[] = [];

export async function POST(req: Request) {
  console.log('🤖 Agent Chat API called');

  try {
    const { messages, sessionId, browserSessionId, continueAgent, stream = true } = await req.json();
    console.log('📨 Received messages:', messages?.length || 0);

    const userMessage = messages[messages.length - 1]?.content || '';
    console.log('👤 User message:', userMessage);
    console.log('🔄 Continue agent:', continueAgent);
    console.log('📡 Stream mode:', stream);

    // Get or create chat session
    let currentSessionId = sessionId;
    let currentBrowserSessionId = browserSessionId;

    if (!currentSessionId) {
      try {
        const { data: session } = await supabase
          .from('chat_sessions')
          .insert({
            status: 'active',
            metadata: { started_at: new Date().toISOString() }
          })
          .select()
          .single();
        currentSessionId = session?.id;
        console.log('✅ Created new chat session:', currentSessionId);
      } catch (error) {
        console.error('⚠️ Failed to create chat session:', error);
        currentSessionId = 'fallback-session-' + Date.now();
      }
    }

    // Handle agent requests (navigation, QBO tasks, etc.)
    const hasActiveBrowserSession = currentBrowserSessionId &&
                                   !currentBrowserSessionId.startsWith('test-') &&
                                   !currentBrowserSessionId.startsWith('demo-') &&
                                   !currentBrowserSessionId.startsWith('fallback-');

    const hasUrlPattern = /https?:\/\/|www\.|\.com|\.ar|\.org|\.net/i.test(userMessage);

    const hasActionVerb = userMessage.toLowerCase().includes('navigate') ||
                         userMessage.toLowerCase().includes('go to') ||
                         userMessage.toLowerCase().includes('open') ||
                         userMessage.toLowerCase().includes('click') ||
                         userMessage.toLowerCase().includes('type') ||
                         userMessage.toLowerCase().includes('scroll') ||
                         userMessage.toLowerCase().includes('quickbooks') ||
                         userMessage.toLowerCase().includes('qbo') ||
                         userMessage.toLowerCase().includes('invoice') ||
                         userMessage.toLowerCase().includes('transaction') ||
                         userMessage.toLowerCase().includes('login');

    const isAgentTask = hasActiveBrowserSession || hasUrlPattern || hasActionVerb || continueAgent;

    if (isAgentTask) {
      console.log('🤖 Agent task detected or continuation requested');

      // Ensure we have a browser session for agent tasks
      if (!currentBrowserSessionId || currentBrowserSessionId.startsWith('test-')) {
        try {
          console.log('🔄 Creating new Scrapybara session for agent...');
          const browserSession = await scrapybaraClient.createSession();
          currentBrowserSessionId = browserSession.sessionId || browserSession.id || 'scrapybara-' + Date.now();
          console.log('✅ Created browser session:', currentBrowserSessionId);

          // Update chat session with browser session ID
          if (!currentSessionId.startsWith('fallback-')) {
            await supabase
              .from('chat_sessions')
              .update({ browser_session_id: currentBrowserSessionId })
              .eq('id', currentSessionId);
          }
        } catch (error) {
          console.error('❌ Failed to create Scrapybara session:', error);
          currentBrowserSessionId = 'demo-browser-' + Date.now();
        }
      }

      // Store user message
      if (!currentSessionId.startsWith('fallback-')) {
        try {
          await supabase
            .from('messages')
            .insert({
              session_id: currentSessionId,
              role: 'user',
              content: userMessage
            });
        } catch (error) {
          console.error('⚠️ Failed to store user message:', error);
        }
      }

      // Store browser session in database
      if (!currentSessionId.startsWith('fallback-') && !currentBrowserSessionId.startsWith('demo-')) {
        try {
          // Check if browser session already exists
          const { data: existingSession } = await supabase
            .from('browser_sessions')
            .select('id')
            .eq('scrapybara_session_id', currentBrowserSessionId)
            .single();

          if (!existingSession) {
            const { error: insertError } = await supabase
              .from('browser_sessions')
              .insert({
                chat_session_id: currentSessionId,
                scrapybara_session_id: currentBrowserSessionId,
                status: 'active',
                last_activity_at: new Date().toISOString(),
              });

            if (insertError) {
              console.error('⚠️ Failed to store browser session:', insertError);
            } else {
              console.log('✅ Browser session stored in database:', currentBrowserSessionId);
            }
          } else {
            console.log('ℹ️ Browser session already exists:', currentBrowserSessionId);
          }
        } catch (error) {
          console.error('⚠️ Error checking/storing browser session:', error);
        }
      }

      // Get stream URL early if we have a real browser session
      let streamUrl = null;
      if (!currentBrowserSessionId.startsWith('demo-') && !currentBrowserSessionId.startsWith('test-')) {
        try {
          const sessionData = await scrapybaraClient.getSession(currentBrowserSessionId);
          streamUrl = sessionData.browser_url;
          console.log('🔗 Stream URL obtained before agent execution:', streamUrl);
        } catch (error) {
          console.error('⚠️ Failed to get stream URL before execution:', error);
        }
      }

      // If streaming is enabled, use SSE
      if (stream && !currentBrowserSessionId.startsWith('demo-')) {
        console.log('📡 Starting SSE stream...');

        // Create a readable stream for SSE
        const encoder = new TextEncoder();
        const readable = new ReadableStream({
          async start(controller) {
            // Helper to send SSE message
            const sendEvent = (event: any) => {
              const data = JSON.stringify(event);
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            };

            try {
              // Send initial metadata including stream URL immediately
              sendEvent({
                type: 'metadata',
                sessionId: currentSessionId,
                browserSessionId: currentBrowserSessionId,
                streamUrl: streamUrl,
                timestamp: new Date().toISOString()
              });

              // Prepare system prompt
              const systemPrompt = `You are an AI agent that can see and control a browser to help with QuickBooks Online tasks.

You have access to a computer tool that supports these actions:
- screenshot: Take a screenshot to see the current browser state
- left_click: Click at specific coordinates [x, y]
- right_click: Right-click at specific coordinates [x, y]
- double_click: Double-click at specific coordinates [x, y]
- type: Type text into the currently focused field
- key: Press keyboard keys (Enter, Tab, Escape, etc.)

WORKFLOW:
1. Take a screenshot first to see what's currently on screen
2. Analyze what you see and determine what action to take next
3. Execute the appropriate computer action
4. Take another screenshot to verify the result
5. Continue until the task is complete

Be methodical and careful. Always verify your actions worked before proceeding.`;

              // Build conversation messages
              const conversationMessages = [
                ...messages.map((msg: any) => ({
                  role: msg.role,
                  content: msg.content
                }))
              ];

              if (conversationMessages.length === 0 || conversationMessages[conversationMessages.length - 1]?.role !== 'user') {
                conversationMessages.push({
                  role: 'user',
                  content: userMessage
                });
              }

              // Execute sampling loop with streaming callback
              const { finalResponse } = await samplingLoopWithStreaming(
                systemPrompt,
                conversationMessages,
                currentBrowserSessionId,
                currentSessionId,
                sendEvent,
                15
              );

              // Send completion event
              sendEvent({
                type: 'done',
                finalResponse: finalResponse,
                timestamp: new Date().toISOString()
              });

              controller.close();
            } catch (error: unknown) {
              console.error('❌ Stream error:', error);
              const message = error instanceof Error ? error.message : 'Unknown error';
              sendEvent({
                type: 'error',
                message: `Agent error: ${message}`
              });
              controller.close();
            }
          }
        });

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });
      }

      // Demo mode response (non-streaming)
      if (currentBrowserSessionId.startsWith('demo-')) {
        const responseContent = `🌐 I would help you with QuickBooks tasks, but I'm running in demo mode. In production, I would:\n\n1. ✅ Create a browser session\n2. 📸 Take screenshots to see current state\n3. 🤖 Use AI to analyze and decide actions\n4. 🎯 Execute precise computer actions\n\nThe Scrapybara integration needs API configuration to work fully.`;

        return Response.json({
          message: {
            role: 'assistant',
            content: responseContent,
          },
          sessionId: currentSessionId,
          browserSessionId: currentBrowserSessionId,
          status: 'demo',
          timestamp: new Date().toISOString()
        });
      }
    }

    // Handle screenshot requests
    if (userMessage.toLowerCase().includes('screenshot')) {
      let responseContent = '';

      if (!currentBrowserSessionId || currentBrowserSessionId.startsWith('test-') || currentBrowserSessionId.startsWith('demo-')) {
        responseContent = '📸 I need to create a browser session first before taking screenshots. Please ask me to navigate to a website, then I can take screenshots for you!';
      } else {
        responseContent = `📸 Taking screenshot of current browser session: ${currentBrowserSessionId}\n\n🔄 Capturing current page state...\n👀 I'll analyze what's visible on the screen`;
      }

      console.log('🤖 Sending screenshot response');

      // Get stream URL for browser session
      let streamUrl = null;
      if (currentBrowserSessionId && !currentBrowserSessionId.startsWith('demo-') && !currentBrowserSessionId.startsWith('test-')) {
        try {
          const sessionData = await scrapybaraClient.getSession(currentBrowserSessionId);
          streamUrl = sessionData.browser_url;
          console.log('🔗 Stream URL obtained:', streamUrl);
        } catch (error) {
          console.error('⚠️ Failed to get stream URL:', error);
        }
      }

      return Response.json({
        message: {
          role: 'assistant',
          content: responseContent,
        },
        sessionId: currentSessionId,
        browserSessionId: currentBrowserSessionId,
        streamUrl: streamUrl,
        status: 'success',
        timestamp: new Date().toISOString()
      });
    }

    // Default response
    const responseContent = `✅ Hello! I'm your QuickBooks Online AI agent. I can help you with:

🌐 **Navigation**: "Navigate to QuickBooks Online"
📸 **Screenshots**: "Take a screenshot"
📄 **QBO Tasks**: "Create an invoice", "Record a transaction", "Generate a report"
🚀 **Complex Workflows**: "Login to QBO and create 3 invoices for ABC Company"

I use computer vision and can perform actions like clicking, typing, and navigating. Just tell me what you need!

What would you like me to help you with?`;

    console.log('🤖 Sending default response');

    // Get stream URL for any active browser session
    let streamUrl = null;
    if (currentBrowserSessionId && !currentBrowserSessionId.startsWith('demo-') && !currentBrowserSessionId.startsWith('test-')) {
      try {
        const sessionData = await scrapybaraClient.getSession(currentBrowserSessionId);
        streamUrl = sessionData.browser_url;
        console.log('🔗 Stream URL obtained:', streamUrl);
      } catch (error) {
        console.error('⚠️ Failed to get stream URL:', error);
      }
    }

    return Response.json({
      message: {
        role: 'assistant',
        content: responseContent,
      },
      sessionId: currentSessionId,
      browserSessionId: currentBrowserSessionId,
      streamUrl: streamUrl,
      continueAgent: false,
      status: 'success',
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('❌ Agent Chat API error:', error);
    return Response.json(
      {
        message: {
          role: 'assistant',
          content: `❌ Agent Error: ${error?.message || 'Unknown error occurred'}`,
        },
        error: true,
        continueAgent: false,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

// GET endpoint to retrieve logged messages for debugging
export async function GET(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  if (action === 'logs') {
    return Response.json({
      messages: loggedMessages,
      total: loggedMessages.length,
      timestamp: new Date().toISOString()
    });
  }

  return Response.json({ error: 'Invalid action' }, { status: 400 });
}