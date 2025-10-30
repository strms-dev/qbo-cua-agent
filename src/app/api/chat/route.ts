import { supabase } from '@/lib/supabase';
import { onkernelClient } from '@/lib/onkernel';
import { MemoryToolHandlers } from '@/lib/memory-handlers';
import Anthropic from '@anthropic-ai/sdk';

// Initialize direct Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Configure sampling loop delay (default: 100ms)
const SAMPLING_LOOP_DELAY_MS = parseInt(process.env.SAMPLING_LOOP_DELAY_MS || '100', 10);

// Configure max base64 screenshots in context (default: 3)
const MAX_BASE64_SCREENSHOTS = parseInt(process.env.MAX_BASE64_SCREENSHOTS || '3', 10);

// Configure number of recent thinking blocks to keep (default: 1)
const KEEP_RECENT_THINKING_BLOCKS = parseInt(process.env.KEEP_RECENT_THINKING_BLOCKS || '1', 10);

// Configure Anthropic thinking budget in tokens (default: 1024)
const THINKING_BUDGET_TOKENS = parseInt(process.env.THINKING_BUDGET_TOKENS || '1024', 10);

// Configure whether to store full Anthropic payload (including base64 images) in database
// WARNING: Setting this to 'yes' will significantly increase database storage usage
const FULL_ANTHROPIC_PAYLOAD = (process.env.FULL_ANTHROPIC_PAYLOAD || 'no').toLowerCase() === 'yes';

// Configure prompt caching (Anthropic feature for cost reduction)
const ENABLE_PROMPT_CACHING = (process.env.ENABLE_PROMPT_CACHING || 'yes').toLowerCase() === 'yes';

// Configure context management (Anthropic beta feature for automatic context cleanup)
const ENABLE_CONTEXT_MANAGEMENT = (process.env.ENABLE_CONTEXT_MANAGEMENT || 'yes').toLowerCase() === 'yes';
const CONTEXT_TRIGGER_TOKENS = parseInt(process.env.CONTEXT_TRIGGER_TOKENS || '0', 10); // 0 = use Anthropic default (~100k tokens)
const CONTEXT_KEEP_TOOL_USES = parseInt(process.env.CONTEXT_KEEP_TOOL_USES || '5', 10); // Keep last 5 tool executions
const CONTEXT_CLEAR_MIN_TOKENS = parseInt(process.env.CONTEXT_CLEAR_MIN_TOKENS || '20000', 10); // Clear at least 20k tokens
const CONTEXT_EXCLUDE_TOOLS = (process.env.CONTEXT_EXCLUDE_TOOLS || 'report_task_status,memory')
  .split(',')
  .map(tool => tool.trim())
  .filter(tool => tool.length > 0);

// Anthropic Model Configuration
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
const ANTHROPIC_MAX_TOKENS = parseInt(process.env.ANTHROPIC_MAX_TOKENS || '4096', 10);
const ANTHROPIC_THINKING_ENABLED = (process.env.ANTHROPIC_THINKING_ENABLED || 'yes').toLowerCase() === 'yes';
const ANTHROPIC_BETAS = process.env.ANTHROPIC_BETAS || 'computer-use-2025-01-24';

// Agent Loop Configuration
const AGENT_MAX_ITERATIONS = parseInt(process.env.AGENT_MAX_ITERATIONS || '35', 10);

// Parse betas from comma-separated string to array
const parseBetas = (betasString: string): string[] => {
  return betasString.split(',').map(beta => beta.trim()).filter(beta => beta.length > 0);
};

// Default system prompt for the agent
const DEFAULT_SYSTEM_PROMPT = `#ROLE: You are an AI agent that can see and control a browser to help the user perform bookkeeping tasks. The display is  1024x768 pixels.
#TOOLS:
You have access to these tools:
1. computer_use allows you to control the browser:
  - screenshot: Take a screenshot to see the current browser state
  - left_click: Click at specific coordinates [x, y]
  - right_click: Right-click at specific coordinates [x, y]
  - double_click: Double-click at specific coordinates [x, y]
  - type: Type text into the currently focused field
  - key: Press keyboard keys (Enter, Tab, Escape, etc.)
  - mouse_move: Move cursor to coordinates
  - scroll: Scroll in any direction with amount control
  - left_click_drag: Click and drag between coordinates
  - left_mouse_down, left_mouse_up: Fine-grained click control
  - hold_key: Hold a key while performing other actions
  - wait: Pause between actions
  - double_click, triple_click: Multiple clicks
2. report_task_status allows you to report task completion status to the user. 
3. memory allows you to store and retrieve earlier progress. 


#MEMORY MANAGEMENT:
- Each task has a unique task_id that is provided to you in the user's message via <task_id> XML tags
- Memory files are named EXACTLY using the task_id (e.g., task_id: "01e15647-d7e3-49ba-9705-96139222aed3" → memory file path: "/memories/01e15647-d7e3-49ba-9705-96139222aed3")
- At the START of each task:
  1. Extract the task_id from <task_id> tags in the user's message
  2. Attempt to retrieve the memory file: memory.view("/memories/{task_id}")
  3. If memory exists, review previous progress and continue from where you left off
  4. If no memory exists (file not found error), this is a new task - create initial memory after first meaningful action
- During task execution:
  - Update memory after completing significant milestones
  - Memory updates should be incremental - don't lose previous progress
  - Use str_replace to update specific parts of memory without losing other data
- Memory format should include:
  - current_step: string
  - completed_actions: array of action descriptions
  - important_context: object with discovered information
  - last_screenshot_description: string
  - next_planned_action: string
  - obstacles_encountered: array
  - decisions_made: array


#IMPORTANT:
- Always call the computer_use tool to control the browser.
- Always call the report_task_status tool to report task completion status to the user.
- Always extract task_id from <task_id> tags and check for existing memory at task start.
- Always update memory after significant progress - your context window might be reset at any moment.
- Memory is your lifeline for resuming interrupted tasks - use it proactively!


#WORKFLOW:
1. Extract task_id from <task_id> tags in user message
2. Attempt to load memory: memory.view("/memories/{task_id}")
3. Take a screenshot to see current browser state
4. If memory exists, verify current state matches last saved state and continue
5. If no memory (new task), proceed with task from start
6. Analyze what you see and determine what action to take next
5. Execute the appropriate computer action
6. Take another screenshot to verify the result
7. Update memory file with progress after significant steps
8. Continue until the task is complete

Be methodical and careful. Always verify your actions worked before proceeding. Treat each session as potentially your last before context reset.`;

// Allow complete override of system prompt via environment variable
const ANTHROPIC_SYSTEM_PROMPT = process.env.ANTHROPIC_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;

// Define computer tool (following Anthropic's official format)
const COMPUTER_TOOL = {
  type: "computer_20250124" as const,
  name: "computer" as const,
  display_width_px: 1024,
  display_height_px: 768,
  display_number: 1,
};

// Define report_task_status tool for agent self-reporting
const REPORT_TASK_STATUS_TOOL = {
  name: "report_task_status",
  description: `Use this tool to report task completion status to the system.

Call this tool when:
- ✅ A task is successfully completed (status: "completed")
- ❌ A task has failed and cannot continue (status: "failed")
- ⏸️ You need clarification from the user before proceeding (status: "needs_clarification")

IMPORTANT: Always call this tool when you finish a task, encounter blocking issues, or need user input.`,
  input_schema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["completed", "failed", "needs_clarification"],
        description: "Task completion status"
      },
      message: {
        type: "string",
        description: "Clear explanation of what happened and why you're reporting this status"
      },
      evidence: {
        type: "object",
        description: "Supporting evidence (optional)",
        properties: {
          screenshot_url: {
            type: "string",
            description: "URL of a relevant screenshot"
          },
          extracted_data: {
            type: "object",
            description: "Any data extracted during the task"
          },
          error_details: {
            type: "string",
            description: "Technical error details if task failed"
          }
        }
      }
    },
    required: ["status", "message"]
  }
};

// Define memory tool (Anthropic native tool for persistent context)
const MEMORY_TOOL = {
  type: "memory_20250818" as const,
  name: "memory" as const,
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
        const screenshot = await onkernelClient.takeScreenshot(browserSessionId);

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
        await onkernelClient.click(browserSessionId, coordinate[0], coordinate[1]);
        return {
          output: `Left clicked at coordinates (${coordinate[0]}, ${coordinate[1]})`
        };

      case 'right_click':
        if (!coordinate || !Array.isArray(coordinate) || coordinate.length !== 2) {
          throw new Error('right_click requires coordinate [x, y]');
        }
        console.log(`👆 Right clicking at (${coordinate[0]}, ${coordinate[1]})`);
        await onkernelClient.rightClick(browserSessionId, coordinate[0], coordinate[1]);
        return {
          output: `Right clicked at coordinates (${coordinate[0]}, ${coordinate[1]})`
        };

      case 'double_click':
        if (!coordinate || !Array.isArray(coordinate) || coordinate.length !== 2) {
          throw new Error('double_click requires coordinate [x, y]');
        }
        console.log(`👆 Double clicking at (${coordinate[0]}, ${coordinate[1]})`);
        await onkernelClient.doubleClick(browserSessionId, coordinate[0], coordinate[1]);
        return {
          output: `Double clicked at coordinates (${coordinate[0]}, ${coordinate[1]})`
        };

      case 'type':
        if (!text) {
          throw new Error('type requires text parameter');
        }
        console.log(`⌨️ Typing: "${text}"`);
        await onkernelClient.type(browserSessionId, text);
        return {
          output: `Typed: "${text}"`
        };

      case 'key':
        if (!text) {
          throw new Error('key requires text parameter');
        }
        console.log(`🔤 Pressing key: ${text}`);
        await onkernelClient.keyPress(browserSessionId, text);
        return {
          output: `Pressed key: ${text}`
        };

      case 'mouse_move':
        if (!coordinate || !Array.isArray(coordinate) || coordinate.length !== 2) {
          throw new Error('mouse_move requires coordinate [x, y]');
        }
        console.log(`🖱️ Moving mouse to (${coordinate[0]}, ${coordinate[1]})`);
        await onkernelClient.moveMouse(browserSessionId, coordinate[0], coordinate[1]);
        return {
          output: `Moved mouse to (${coordinate[0]}, ${coordinate[1]})`
        };

      case 'scroll':
        if (!coordinate || !Array.isArray(coordinate) || coordinate.length !== 2) {
          throw new Error('scroll requires coordinate [x, y]');
        }
        const scrollDirection = toolInput.scroll_direction || 'down';
        const scrollAmount = toolInput.scroll_amount || 1;
        const pixelAmount = scrollAmount * 100; // Convert scroll_amount to pixels
        console.log(`📜 Scrolling ${scrollDirection} by ${scrollAmount} units (${pixelAmount}px) at (${coordinate[0]}, ${coordinate[1]})`);
        await onkernelClient.scroll(browserSessionId, coordinate[0], coordinate[1], scrollDirection, pixelAmount);
        return {
          output: `Scrolled ${scrollDirection} by ${scrollAmount} units at (${coordinate[0]}, ${coordinate[1]})`
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
        const position = await onkernelClient.getCursorPosition(browserSessionId);
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

  // If there's an error, include it in the content
  if (toolResult.error) {
    content.push({
      type: "text",
      text: `Error: ${toolResult.error}`
    });
  } else if (toolResult.output) {
    let outputText = toolResult.output;

    // Append screenshot URL if available
    if (toolResult.screenshot_url) {
      outputText += `\n[Screenshot URL: ${toolResult.screenshot_url}]`;
    }

    content.push({
      type: "text",
      text: outputText
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

/**
 * Optimizes messages by replacing older screenshot base64 with URL references
 * Keeps only the last N screenshots as base64 for visual context
 */
function optimizeScreenshotsInMessages(messages: any[], maxBase64Screenshots: number): any[] {
  // Deep copy to avoid mutating original
  const optimizedMessages = JSON.parse(JSON.stringify(messages));

  // Find all tool_result blocks with screenshots (reverse order = newest first)
  const screenshotBlocks: Array<{
    messageIndex: number;
    contentIndex: number;
    url: string | null;
  }> = [];

  // Scan messages in reverse to find screenshots
  for (let i = optimizedMessages.length - 1; i >= 0; i--) {
    const msg = optimizedMessages[i];
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      msg.content.forEach((item: any, contentIdx: number) => {
        if (item.type === 'tool_result' && Array.isArray(item.content)) {
          // Check if this tool result has an image
          const hasImage = item.content.some((c: any) =>
            c.type === 'image' && c.source?.type === 'base64'
          );

          if (hasImage) {
            // Try to extract URL from text content
            const textContent = item.content.find((c: any) => c.type === 'text');
            let url: string | null = null;

            // Look for Supabase URL pattern in output
            if (textContent?.text) {
              const urlMatch = textContent.text.match(/\[Screenshot URL: (https:\/\/[^\]]+)\]/);
              url = urlMatch ? urlMatch[1] : null;
            }

            screenshotBlocks.push({
              messageIndex: i,
              contentIndex: contentIdx,
              url
            });
          }
        }
      });
    }
  }

  // Keep first N screenshots as base64, convert rest to URL
  screenshotBlocks.forEach((block, idx) => {
    if (idx >= maxBase64Screenshots) {
      // Replace base64 with URL reference
      const msg = optimizedMessages[block.messageIndex];
      const toolResult = msg.content[block.contentIndex];

      // Remove image from content
      toolResult.content = toolResult.content.filter((c: any) => c.type !== 'image');

      // URL should already be in the text from makeToolResult
      // Just ensure the text indicates it's a URL reference
      const textContent = toolResult.content.find((c: any) => c.type === 'text');
      if (textContent && !textContent.text.includes('[Screenshot URL:')) {
        if (block.url) {
          textContent.text += `\n[Screenshot URL: ${block.url}]`;
        }
      }
    }
  });

  return optimizedMessages;
}

/**
 * Removes old thinking blocks from messages to reduce token usage
 * Keeps only the last N thinking blocks for reasoning context
 */
function removeOldThinkingBlocks(messages: any[], keepRecentCount: number): any[] {
  // Deep copy to avoid mutating original
  const optimized = JSON.parse(JSON.stringify(messages));

  // Find all assistant messages with thinking blocks
  const assistantMessagesWithThinking: Array<{
    messageIndex: number;
    thinkingBlockIndices: number[];
  }> = [];

  // Scan messages to find assistant messages with thinking blocks
  for (let i = 0; i < optimized.length; i++) {
    const msg = optimized[i];
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const thinkingIndices = msg.content
        .map((item: any, idx: number) => item.type === 'thinking' ? idx : -1)
        .filter((idx: number) => idx !== -1);

      if (thinkingIndices.length > 0) {
        assistantMessagesWithThinking.push({
          messageIndex: i,
          thinkingBlockIndices: thinkingIndices
        });
      }
    }
  }

  // Calculate how many messages to keep thinking blocks for
  const totalMessages = assistantMessagesWithThinking.length;
  const messagesToStrip = totalMessages - keepRecentCount;

  if (messagesToStrip > 0) {
    // Remove thinking blocks from older messages (keep last N)
    for (let i = 0; i < messagesToStrip; i++) {
      const msgData = assistantMessagesWithThinking[i];
      const msg = optimized[msgData.messageIndex];

      // Remove thinking blocks in reverse order to maintain indices
      for (let j = msgData.thinkingBlockIndices.length - 1; j >= 0; j--) {
        const thinkingIdx = msgData.thinkingBlockIndices[j];
        msg.content.splice(thinkingIdx, 1);
      }
    }
  }

  return optimized;
}


// Streaming sampling loop with real-time updates
async function samplingLoopWithStreaming(
  systemPrompt: string,
  messages: any[],
  browserSessionId: string,
  sessionId: string,
  streamCallback: (event: any) => void,
  maxIterations: number = AGENT_MAX_ITERATIONS,
  taskId: string | null = null,
  startIteration: number = 0
): Promise<{finalResponse: string, conversationHistory: any[]}> {
  let currentMessages = [...messages];
  let finalResponse = '';
  let conversationHistory: any[] = [];

  // Track conversation start time
  const conversationStartTime = Date.now();

  // Declare iteration outside loop so it's accessible after loop ends
  let iteration = startIteration;
  for (; iteration < maxIterations; iteration++) {
    // Track iteration start time
    const iterationStartTime = Date.now();
    console.log(`🔄 Sampling Loop Iteration ${iteration + 1}/${maxIterations}`);

    // Update task current_iteration in database
    if (taskId && !sessionId.startsWith('fallback-')) {
      try {
        await supabase
          .from('tasks')
          .update({ current_iteration: iteration + 1 })
          .eq('id', taskId);
      } catch (error) {
        console.error('⚠️ Failed to update task iteration:', error);
      }
    }

    // ⛔ STOP CHECK #1: Check if task was stopped before starting iteration work
    if (taskId && !sessionId.startsWith('fallback-')) {
      try {
        const { data: taskStatus } = await supabase
          .from('tasks')
          .select('status')
          .eq('id', taskId)
          .single();

        if (taskStatus?.status === 'stopped') {
          console.log('🛑 Task stopped at iteration start - terminating immediately');
          const totalConversationTimeMs = Date.now() - conversationStartTime;

          // Update task with stopped status
          await supabase
            .from('tasks')
            .update({
              completed_at: new Date().toISOString(),
              agent_message: 'Task stopped by user',
              result_message: 'Task execution was stopped by user request'
            })
            .eq('id', taskId);

          // Send stop event to frontend
          streamCallback({
            type: 'task_status',
            status: 'stopped',
            agentStatus: 'stopped',
            message: 'Task stopped by user',
            timestamp: new Date().toISOString()
          });

          finalResponse = '⛔ Task was stopped by user';
          console.log(`⏱️  Total conversation time before stop: ${totalConversationTimeMs}ms (${(totalConversationTimeMs / 1000).toFixed(2)}s)`);
          console.log(`📊 Iterations completed before stop: ${iteration}`);
          break;
        }
      } catch (error) {
        console.error('⚠️ Failed to check task status at iteration start:', error);
        // Continue execution if check fails
      }
    }

    try {
      // Optimize messages (keep only last N screenshots as base64)
      const optimizedMessages = optimizeScreenshotsInMessages(currentMessages, MAX_BASE64_SCREENSHOTS);

      // Count screenshots for logging
      let totalScreenshots = 0;
      currentMessages.forEach(msg => {
        if (msg.role === 'user' && Array.isArray(msg.content)) {
          msg.content.forEach((item: any) => {
            if (item.type === 'tool_result' && Array.isArray(item.content)) {
              const hasImage = item.content.some((c: any) => c.type === 'image');
              if (hasImage) totalScreenshots++;
            }
          });
        }
      });

      const optimizedCount = Math.max(0, totalScreenshots - MAX_BASE64_SCREENSHOTS);
      if (optimizedCount > 0) {
        console.log(`📊 Screenshot optimization: ${optimizedCount} screenshots converted to URLs (keeping ${MAX_BASE64_SCREENSHOTS} as base64)`);
      }

      // Remove old thinking blocks (keep only last N)
      const finalMessages = removeOldThinkingBlocks(optimizedMessages, KEEP_RECENT_THINKING_BLOCKS);

      // Count thinking blocks for logging
      let totalThinkingBlocks = 0;
      currentMessages.forEach(msg => {
        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
          msg.content.forEach((item: any) => {
            if (item.type === 'thinking') totalThinkingBlocks++;
          });
        }
      });

      const thinkingBlocksRemoved = Math.max(0, totalThinkingBlocks - KEEP_RECENT_THINKING_BLOCKS);
      if (thinkingBlocksRemoved > 0) {
        console.log(`🧠 Thinking block optimization: ${thinkingBlocksRemoved} thinking blocks removed (keeping ${KEEP_RECENT_THINKING_BLOCKS} recent)`);
      }

      // Build base API request
      const apiRequest: any = {
        model: ANTHROPIC_MODEL,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        system: systemPrompt,
        messages: finalMessages,
        tools: [COMPUTER_TOOL, REPORT_TASK_STATUS_TOOL, MEMORY_TOOL]
      };

      // Add betas (including prompt caching and context management if enabled)
      const betasToUse = parseBetas(ANTHROPIC_BETAS);
      if (ENABLE_PROMPT_CACHING && !betasToUse.includes('prompt-caching-2024-07-31')) {
        betasToUse.push('prompt-caching-2024-07-31');
      }
      if (ENABLE_CONTEXT_MANAGEMENT && !betasToUse.includes('context-management-2025-06-27')) {
        betasToUse.push('context-management-2025-06-27');
      }

      apiRequest.betas = betasToUse;

      // Add context management configuration if enabled
      if (ENABLE_CONTEXT_MANAGEMENT) {
        const contextConfig: any = {
          edits: [
            {
              type: "clear_tool_uses_20250919",
              keep: {
                type: "tool_uses",
                value: CONTEXT_KEEP_TOOL_USES
              },
              clear_at_least: {
                type: "input_tokens",
                value: CONTEXT_CLEAR_MIN_TOKENS
              },
              exclude_tools: CONTEXT_EXCLUDE_TOOLS
            }
          ]
        };

        // Only add trigger if explicitly set (0 = use Anthropic default ~100k)
        if (CONTEXT_TRIGGER_TOKENS > 0) {
          contextConfig.edits[0].trigger = {
            type: "input_tokens",
            value: CONTEXT_TRIGGER_TOKENS
          };
        }

        apiRequest.context_management = contextConfig;

        console.log(`🧹 Context management enabled:`);
        console.log(`   - Trigger: ${CONTEXT_TRIGGER_TOKENS || '~100k (default)'} tokens`);
        console.log(`   - Keep: ${CONTEXT_KEEP_TOOL_USES} recent tool uses`);
        console.log(`   - Clear min: ${CONTEXT_CLEAR_MIN_TOKENS} tokens`);
        console.log(`   - Exclude tools: ${CONTEXT_EXCLUDE_TOOLS.join(', ')}`);
      }

      // Conditionally add thinking if enabled
      if (ANTHROPIC_THINKING_ENABLED) {
        apiRequest.thinking = {
          type: "enabled" as const,
          budget_tokens: THINKING_BUDGET_TOKENS
        };
      }

      // Add prompt caching breakpoints if enabled
      // Cache tools and system prompt (following Anthropic hierarchy: tools → system → messages)
      // Messages are NOT cached when context editing is enabled (to avoid cache invalidation)
      if (ENABLE_PROMPT_CACHING) {
        // Cache tools (most stable - rarely change)
        const lastToolIndex = apiRequest.tools.length - 1;
        apiRequest.tools[lastToolIndex] = {
          ...apiRequest.tools[lastToolIndex],
          cache_control: { type: "ephemeral" }
        };

        // Cache system prompt (semi-static per session)
        apiRequest.system = [
          {
            type: "text",
            text: systemPrompt,
            cache_control: { type: "ephemeral" }
          }
        ];

        // DO NOT cache messages when context editing is enabled
        // Context editing invalidates message cache, so focus on tools + system only
        console.log('💾 Prompt caching: tools + system (messages excluded due to context editing)');
      }

      // Log actual payload size BEFORE sending to Anthropic
      const actualRequestPayload = JSON.stringify(apiRequest);
      const actualRequestSizeBytes = actualRequestPayload.length;
      const actualRequestSizeKB = (actualRequestSizeBytes / 1024).toFixed(2);
      const actualRequestSizeMB = (actualRequestSizeBytes / (1024 * 1024)).toFixed(2);

      // Count base64 images in the actual request
      const base64ImageMatches = actualRequestPayload.match(/"data":"[A-Za-z0-9+/=]{1000,}"/g);
      const base64ImageCount = base64ImageMatches ? base64ImageMatches.length : 0;
      const base64TotalSize = base64ImageMatches
        ? base64ImageMatches.reduce((sum, match) => sum + match.length, 0)
        : 0;
      const base64TotalSizeKB = (base64TotalSize / 1024).toFixed(2);

      console.log(`📊 ACTUAL REQUEST PAYLOAD SIZE: ${actualRequestSizeBytes} bytes (${actualRequestSizeKB} KB / ${actualRequestSizeMB} MB)`);
      console.log(`🖼️  Base64 images in request: ${base64ImageCount} images (${base64TotalSizeKB} KB total)`);
      console.log(`📏 Request without images: ${((actualRequestSizeBytes - base64TotalSize) / 1024).toFixed(2)} KB`);

      // ⛔ STOP CHECK #2: Check if task was stopped before making expensive Anthropic API call
      if (taskId && !sessionId.startsWith('fallback-')) {
        try {
          const { data: taskStatus } = await supabase
            .from('tasks')
            .select('status')
            .eq('id', taskId)
            .single();

          if (taskStatus?.status === 'stopped') {
            console.log('🛑 Task stopped before API call - avoiding expensive Anthropic request');
            const totalConversationTimeMs = Date.now() - conversationStartTime;

            // Update task with stopped status
            await supabase
              .from('tasks')
              .update({
                completed_at: new Date().toISOString(),
                agent_message: 'Task stopped by user before API call',
                result_message: 'Task execution was stopped by user request'
              })
              .eq('id', taskId);

            // Send stop event to frontend
            streamCallback({
              type: 'task_status',
              status: 'stopped',
              agentStatus: 'stopped',
              message: 'Task stopped by user before API call',
              timestamp: new Date().toISOString()
            });

            finalResponse = '⛔ Task was stopped by user';
            console.log(`⏱️  Total conversation time before stop: ${totalConversationTimeMs}ms (${(totalConversationTimeMs / 1000).toFixed(2)}s)`);
            console.log(`📊 Iterations completed before stop: ${iteration}`);
            console.log(`💰 Saved Anthropic API call by catching stop signal early`);
            break;
          }
        } catch (error) {
          console.error('⚠️ Failed to check task status before API call:', error);
          // Continue execution if check fails
        }
      }

      // Call Anthropic API
      console.log('🧠 Calling Anthropic API...');
      const apiStartTime = Date.now();
      const response = await anthropic.beta.messages.create(apiRequest);
      const apiEndTime = Date.now();
      const apiResponseTimeMs = apiEndTime - apiStartTime;

      console.log(`⏱️  Anthropic API response time: ${apiResponseTimeMs}ms (${(apiResponseTimeMs / 1000).toFixed(2)}s)`);
      console.log('🎯 Response stop_reason:', response.stop_reason);

      // Prepare request and response for storage based on configuration
      const responseData = {
        id: response.id,
        model: response.model,
        role: response.role,
        content: response.content,
        stop_reason: response.stop_reason,
        stop_sequence: response.stop_sequence,
        usage: response.usage
      };

      // Store either full payload (with base64 images) or sanitized payload based on env variable
      const storedRequest = FULL_ANTHROPIC_PAYLOAD ? apiRequest : sanitizeApiData(apiRequest);
      const storedResponse = FULL_ANTHROPIC_PAYLOAD ? responseData : sanitizeApiData(responseData);

      if (FULL_ANTHROPIC_PAYLOAD) {
        console.log('💾 Storing FULL payload (including base64 images) to database');
      }

      // Validate stored request structure before saving to database
      if (storedRequest.messages && storedRequest.messages.length > 0) {
        const firstStoredMsg = storedRequest.messages[0];
        const storedContentType = Array.isArray(firstStoredMsg.content) ? 'array' : typeof firstStoredMsg.content;
        console.log(`💾 Pre-storage validation: messages[0].content type = ${storedContentType}`);

        if (storedContentType !== 'array' && storedContentType !== 'string') {
          console.error(`❌ CRITICAL: Invalid content type "${storedContentType}" detected before storage!`);
        }
      }

      // Extract text content
      const textBlocks = response.content.filter(block => block.type === 'text');
      const responseText = textBlocks.map(block => block.text).join('\n');
      finalResponse = responseText;

      // Extract thinking blocks
      const thinkingBlocks = response.content.filter((block: any) => block.type === 'thinking') as any[];
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
      const toolExecutionStartTime = Date.now();
      let taskStatusReported = false;
      let reportedTaskStatus: 'completed' | 'failed' | 'needs_clarification' | null = null;

      for (const toolBlock of toolUseBlocks) {
        if (toolBlock.type === 'tool_use' && toolBlock.name === 'computer') {
          console.log(`🔧 Executing tool: ${toolBlock.name} (${toolBlock.id})`, trimBase64ForLog(toolBlock.input));

          // Check if task has been stopped BEFORE executing tool
          let toolResult: ToolResult;
          if (taskId && !sessionId.startsWith('fallback-')) {
            try {
              const { data: taskStatus } = await supabase
                .from('tasks')
                .select('status')
                .eq('id', taskId)
                .single();

              if (taskStatus?.status === 'stopped') {
                console.log('🛑 Task stopped - returning error for tool execution');
                // Return error instead of executing
                toolResult = {
                  error: 'User interrupted execution'
                };
              } else {
                // Normal execution
                toolResult = await executeComputerAction(toolBlock.input, browserSessionId, sessionId);
              }
            } catch (error) {
              console.error('⚠️ Failed to check task status before tool execution:', error);
              // If check fails, proceed with execution
              toolResult = await executeComputerAction(toolBlock.input, browserSessionId, sessionId);
            }
          } else {
            // No task tracking, execute normally
            toolResult = await executeComputerAction(toolBlock.input, browserSessionId, sessionId);
          }

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
        } else if (toolBlock.type === 'tool_use' && toolBlock.name === 'report_task_status') {
          console.log(`📊 Task status reported: ${toolBlock.name} (${toolBlock.id})`);

          const { status, message, evidence } = toolBlock.input as {
            status: 'completed' | 'failed' | 'needs_clarification';
            message: string;
            evidence?: any;
            reasoning?: string;
            next_step?: string;
          };
          taskStatusReported = true;
          reportedTaskStatus = status;

          // Log the task status report
          console.log(`📌 Task Status: ${status}`);
          console.log(`💬 Agent Message: ${message}`);
          if (evidence) {
            console.log(`📎 Evidence:`, trimBase64ForLog(evidence));
          }

          // Map agent status to task status
          const taskStatusMap = {
            'completed': 'completed',
            'failed': 'failed',
            'needs_clarification': 'paused'
          };
          const mappedStatus = taskStatusMap[status as keyof typeof taskStatusMap] || status;

          // Stream task status event to frontend
          streamCallback({
            type: 'task_status',
            status: mappedStatus,
            agentStatus: status,
            message: message,
            evidence: evidence,
            timestamp: new Date().toISOString()
          });

          // Create acknowledgment tool result
          const toolResult: ToolResult = {
            output: `Task status recorded: ${status}\nSystem will update task accordingly.`
          };

          const toolResultBlock = {
            tool_use_id: toolBlock.id,
            type: "tool_result",
            content: [{ type: "text", text: toolResult.output }],
            is_error: false
          };

          toolResults.push(toolResultBlock);

          // Add to tool calls for conversation history
          assistantMessage.toolCalls.push({
            toolCallId: toolBlock.id,
            toolName: 'report_task_status',
            args: toolBlock.input,
            result: {
              success: true,
              description: `Task ${status}: ${message}`,
              error: undefined
            }
          });

          console.log(`✅ Task status recorded: ${status}`);
        } else if (toolBlock.type === 'tool_use' && toolBlock.name === 'memory') {
          console.log(`💾 Memory tool: ${toolBlock.id}`, trimBase64ForLog(toolBlock.input));

          const memoryHandlers = new MemoryToolHandlers();
          const { command, path, file_text, old_str, new_str, insert_line, new_path } = toolBlock.input as {
            command: 'view' | 'create' | 'str_replace' | 'insert' | 'delete' | 'rename';
            path: string;
            file_text?: string;
            old_str?: string;
            new_str?: string;
            insert_line?: number;
            new_path?: string;
          };

          let toolResult: ToolResult;
          try {
            // Execute memory command (no company/task_type needed - using task_id as path)
            switch (command) {
              case 'view':
                const content = await memoryHandlers.view(path);
                toolResult = { output: content };
                break;

              case 'create':
                await memoryHandlers.create(path, file_text!);
                toolResult = { output: `Created ${path}` };
                break;

              case 'str_replace':
                await memoryHandlers.strReplace(path, old_str!, new_str!);
                toolResult = { output: `Updated ${path}` };
                break;

              case 'insert':
                await memoryHandlers.insert(path, insert_line!, new_str!);
                toolResult = { output: `Inserted text at line ${insert_line} in ${path}` };
                break;

              case 'delete':
                await memoryHandlers.delete(path);
                toolResult = { output: `Deleted ${path}` };
                break;

              case 'rename':
                await memoryHandlers.rename(path, new_path!);
                toolResult = { output: `Renamed ${path} to ${new_path}` };
                break;

              default:
                toolResult = { error: `Unknown memory command: ${command}` };
            }

            console.log(`✅ Memory tool completed:`, trimBase64ForLog(toolResult));
          } catch (error: any) {
            console.error('❌ Memory tool error:', error);
            toolResult = { error: error.message };
          }

          const toolResultBlock = makeToolResult(toolResult, toolBlock.id);
          toolResults.push(toolResultBlock);

          // Add to tool calls for conversation history
          assistantMessage.toolCalls.push({
            toolCallId: toolBlock.id,
            toolName: 'memory',
            args: toolBlock.input,
            result: {
              success: !toolResult.error,
              description: toolResult.output || toolResult.error || 'Memory operation completed',
              error: toolResult.error
            }
          });
        }
      }

      // Calculate tool execution time
      const toolExecutionEndTime = Date.now();
      const toolExecutionTimeMs = toolExecutionEndTime - toolExecutionStartTime;

      // Calculate total iteration time
      const iterationEndTime = Date.now();
      const iterationTotalTimeMs = iterationEndTime - iterationStartTime;

      // Log timing metrics
      console.log(`⏱️  Tool execution time: ${toolExecutionTimeMs}ms (${(toolExecutionTimeMs / 1000).toFixed(2)}s)`);
      console.log(`⏱️  Iteration total time: ${iterationTotalTimeMs}ms (${(iterationTotalTimeMs / 1000).toFixed(2)}s)`);

      // Add assistant message with tool calls to history
      conversationHistory.push(assistantMessage);

      // Save assistant message to database with timing
      let savedMessageId: string | null = null;
      if (!sessionId.startsWith('fallback-')) {
        try {
          const { data: savedMessage, error: saveError} = await supabase
            .from('messages')
            .insert({
              session_id: sessionId,
              role: 'assistant',
              content: responseText,
              thinking: thinking || null,
              thinking_signature: thinkingSignature || null,
              tool_calls: assistantMessage.toolCalls.length > 0 ? assistantMessage.toolCalls : null,
              anthropic_request: storedRequest,
              anthropic_response: storedResponse,
              anthropic_response_time_ms: apiResponseTimeMs,
              task_id: taskId,
              metadata: { iteration: iteration + 1 }
            })
            .select()
            .single();

          if (saveError) {
            console.error('⚠️ Failed to save assistant message:', saveError);
          } else {
            savedMessageId = savedMessage?.id;
            console.log('✅ Assistant message saved to DB:', savedMessageId);
          }
        } catch (error) {
          console.error('⚠️ Error in database save:', error);
        }

        // Save performance metrics to performance_metrics table
        try {
          await supabase
            .from('performance_metrics')
            .insert({
              session_id: sessionId,
              message_id: savedMessageId,
              task_id: taskId,
              iteration: iteration + 1,
              api_response_time_ms: apiResponseTimeMs,
              iteration_total_time_ms: iterationTotalTimeMs,
              tool_execution_time_ms: toolExecutionTimeMs,
              metadata: {
                tools_executed: toolResults.length,
                screenshots_optimized: optimizedCount,
                thinking_blocks_removed: thinkingBlocksRemoved,
                actual_request_size_bytes: actualRequestSizeBytes,
                actual_request_size_kb: parseFloat(actualRequestSizeKB),
                base64_image_count: base64ImageCount,
                base64_total_size_kb: parseFloat(base64TotalSizeKB)
              }
            });
          console.log('✅ Performance metrics saved for iteration', iteration + 1);
        } catch (error) {
          console.error('⚠️ Failed to save performance metrics:', error);
        }
      }

      // Check if conversation is complete (no tool use blocks)
      if (toolUseBlocks.length === 0) {
        // Calculate total conversation time
        const totalConversationTimeMs = Date.now() - conversationStartTime;
        console.log('✅ No tools requested - conversation complete');
        console.log(`⏱️  Total conversation time: ${totalConversationTimeMs}ms (${(totalConversationTimeMs / 1000).toFixed(2)}s)`);
        console.log(`📊 Total iterations: ${iteration + 1}`);
        console.log(`⏱️  Average time per iteration: ${(totalConversationTimeMs / (iteration + 1)).toFixed(0)}ms`);

        // Update task to completed status
        if (taskId && !sessionId.startsWith('fallback-')) {
          try {
            await supabase
              .from('tasks')
              .update({
                status: 'completed',
                completed_at: new Date().toISOString(),
                result_message: responseText
              })
              .eq('id', taskId);
            console.log(`✅ Task ${taskId} marked as completed (natural completion)`);
          } catch (error) {
            console.error('⚠️ Failed to update task status:', error);
          }
        }

        // Update chat session with completion metrics (keep session active)
        if (!sessionId.startsWith('fallback-')) {
          try {
            await supabase
              .from('chat_sessions')
              .update({
                total_conversation_time_ms: totalConversationTimeMs,
                total_iterations: iteration + 1
              })
              .eq('id', sessionId);
            console.log('✅ Chat session updated with metrics (session remains active)');
          } catch (error) {
            console.error('⚠️ Failed to update chat session:', error);
          }
        }

        // Auto-disconnect CDP after natural completion
        if (browserSessionId && !browserSessionId.startsWith('demo-') && !browserSessionId.startsWith('test-')) {
          try {
            console.log('🔌 Auto-disconnecting CDP (natural completion)');
            await onkernelClient.disconnectCDP(browserSessionId);
            console.log('✅ CDP auto-disconnected to save costs');
          } catch (error) {
            console.error('⚠️ Failed to auto-disconnect CDP:', error);
            // Continue - not critical
          }
        }

        // Stream final message
        streamCallback({
          type: 'message',
          message: assistantMessage
        });
        break;
      }

      // Check if task status was reported - if so, stop sampling loop
      if (taskStatusReported) {
        const totalConversationTimeMs = Date.now() - conversationStartTime;
        console.log(`✅ Task status reported (${reportedTaskStatus}) - stopping agent execution`);
        console.log(`⏱️  Total conversation time: ${totalConversationTimeMs}ms (${(totalConversationTimeMs / 1000).toFixed(2)}s)`);
        console.log(`📊 Total iterations: ${iteration + 1}`);

        // Update task status based on agent report
        if (taskId && !sessionId.startsWith('fallback-')) {
          try {
            const taskStatusMap = {
              'completed': 'completed',
              'failed': 'failed',
              'needs_clarification': 'paused'
            };
            const mappedStatus = taskStatusMap[reportedTaskStatus as keyof typeof taskStatusMap] || reportedTaskStatus;

            // Extract agent message and evidence from tool calls
            const reportToolCall = assistantMessage.toolCalls.find(tc => tc.toolName === 'report_task_status');
            const agentMessage = reportToolCall?.args?.message;
            const agentEvidence = reportToolCall?.args?.evidence;

            await supabase
              .from('tasks')
              .update({
                status: mappedStatus,
                completed_at: new Date().toISOString(),
                agent_status: reportedTaskStatus,
                agent_message: agentMessage,
                agent_evidence: agentEvidence,
                result_message: responseText
              })
              .eq('id', taskId);
            console.log(`✅ Task ${taskId} updated to status: ${mappedStatus}`);
          } catch (error) {
            console.error('⚠️ Failed to update task status:', error);
          }
        }

        // Update session metrics (keep session active regardless of task status)
        if (taskStatusReported && !sessionId.startsWith('fallback-')) {
          try {
            // Update metrics only, session remains active
            await supabase
              .from('chat_sessions')
              .update({
                total_conversation_time_ms: totalConversationTimeMs,
                total_iterations: iteration + 1
              })
              .eq('id', sessionId);
            console.log(`✅ Chat session metrics updated (task ${reportedTaskStatus}, session remains active)`);
          } catch (error) {
            console.error('⚠️ Failed to update chat session metrics:', error);
          }
        }

        // Auto-disconnect CDP when task completes/fails/pauses
        if (taskStatusReported && reportedTaskStatus && browserSessionId &&
            !browserSessionId.startsWith('demo-') && !browserSessionId.startsWith('test-')) {
          try {
            console.log(`🔌 Auto-disconnecting CDP (task status: ${reportedTaskStatus})`);
            await onkernelClient.disconnectCDP(browserSessionId);
            console.log('✅ CDP auto-disconnected to save costs');
          } catch (error) {
            console.error('⚠️ Failed to auto-disconnect CDP:', error);
            // Continue - not critical
          }
        }

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

      // Small delay between iterations to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, SAMPLING_LOOP_DELAY_MS));

    } catch (error: unknown) {
      console.error('❌ Sampling loop error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      finalResponse = `🤖 Agent encountered an issue: ${message}`;

      // Update task status to failed
      if (taskId && !sessionId.startsWith('fallback-')) {
        try {
          await supabase
            .from('tasks')
            .update({
              status: 'failed',
              completed_at: new Date().toISOString(),
              error_message: message
            })
            .eq('id', taskId);
          console.log(`✅ Task ${taskId} marked as failed`);
        } catch (err) {
          console.error('⚠️ Failed to update task status:', err);
        }
      }

      // Stream error message
      streamCallback({
        type: 'error',
        message: finalResponse
      });
      break;
    }
  }

  // Handle max iterations reached
  // Only show this warning if we ACTUALLY reached max iterations
  if (iteration >= maxIterations && finalResponse === '') {
    console.log(`⚠️ Max iterations (${maxIterations}) reached - stopping agent execution`);
    finalResponse = `⚠️ Maximum iterations reached (${maxIterations}). Task may be incomplete.`;

    // Stream max iterations message to frontend
    streamCallback({
      type: 'message',
      message: {
        id: `agent-maxiter-${Date.now()}`,
        role: 'assistant',
        content: finalResponse,
        toolCalls: []
      }
    });

    // Update task to indicate max iterations reached
    if (taskId && !sessionId.startsWith('fallback-')) {
      try {
        await supabase
          .from('tasks')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: 'Max iterations reached without task completion'
          })
          .eq('id', taskId);
        console.log(`✅ Task ${taskId} marked as failed (max iterations)`);
      } catch (error) {
        console.error('⚠️ Failed to update task status:', error);
      }
    }
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

    /*const hasUrlPattern = /https?:\/\/|www\.|\.com|\.ar|\.org|\.net/i.test(userMessage);

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
*/
    //const isAgentTask = hasActiveBrowserSession || hasUrlPattern || hasActionVerb || continueAgent;
    const hasActionVerb = true;
    const isAgentTask = hasActiveBrowserSession || hasActionVerb ||continueAgent;

    if (isAgentTask) {
      console.log('🤖 Agent task detected or continuation requested');

      // Ensure we have a browser session for agent tasks
      let browserSessionData: any = null;
      if (!currentBrowserSessionId || currentBrowserSessionId.startsWith('test-')) {
        try {
          console.log('🔄 Creating new Onkernel session for agent...');
          browserSessionData = await onkernelClient.createSession(currentSessionId);
          currentBrowserSessionId = browserSessionData.sessionId || browserSessionData.id || 'onkernel-' + Date.now();
          console.log('✅ Created browser session:', currentBrowserSessionId);

          // Update chat session with browser session ID
          if (!currentSessionId.startsWith('fallback-')) {
            await supabase
              .from('chat_sessions')
              .update({ browser_session_id: currentBrowserSessionId })
              .eq('id', currentSessionId);
          }
        } catch (error) {
          console.error('❌ Failed to create Onkernel session:', error);
          currentBrowserSessionId = 'demo-browser-' + Date.now();
        }
      }

      // === TASK LIFECYCLE MANAGEMENT ===
      // Check for resumable task (stopped, paused, or failed)
      let currentTaskId: string | null = null;
      let startIteration = 0;

      if (!currentSessionId.startsWith('fallback-')) {
        try {
          // Look for resumable task
          const { data: resumableTask } = await supabase
            .from('tasks')
            .select('id, status, current_iteration, user_message')
            .eq('session_id', currentSessionId)
            .in('status', ['stopped', 'paused', 'failed'])
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          if (resumableTask) {
            // Resume existing task
            currentTaskId = resumableTask.id;
            startIteration = resumableTask.current_iteration || 0;
            console.log(`🔄 Resuming task ${currentTaskId} from iteration ${startIteration} (status: ${resumableTask.status})`);

            // Update task status to running
            await supabase
              .from('tasks')
              .update({
                status: 'running',
                started_at: new Date().toISOString()
              })
              .eq('id', currentTaskId);
          } else {
            // Create new task (company_id and task_type will be null - no extraction logic)
            const { data: newTask, error: taskError } = await supabase
              .from('tasks')
              .insert({
                session_id: currentSessionId,
                browser_session_id: currentBrowserSessionId,
                company_id: null,
                task_type: null,
                status: 'running',
                user_message: userMessage,
                started_at: new Date().toISOString(),
                max_iterations: AGENT_MAX_ITERATIONS,
                current_iteration: 0
              })
              .select()
              .single();

            if (taskError) {
              console.error('⚠️ Failed to create task:', taskError);
            } else {
              currentTaskId = newTask?.id;
              console.log(`✅ Created new task: ${currentTaskId}`);
            }
          }
        } catch (error) {
          console.error('⚠️ Error in task lifecycle management:', error);
        }
      }

      // Auto-reconnect CDP if disconnected (when starting/resuming tasks)
      if (currentBrowserSessionId && !currentBrowserSessionId.startsWith('demo-') && !currentBrowserSessionId.startsWith('test-') && !currentBrowserSessionId.startsWith('fallback-')) {
        try {
          // Check if CDP is disconnected by querying database
          const { data: browserSession } = await supabase
            .from('browser_sessions')
            .select('cdp_connected')
            .eq('onkernel_session_id', currentBrowserSessionId)
            .single();

          if (browserSession && browserSession.cdp_connected === false) {
            console.log('🔌 CDP disconnected - auto-reconnecting before task execution');
            try {
              const reconnectResult = await onkernelClient.reconnectCDP(currentBrowserSessionId);
              console.log('✅ CDP auto-reconnected:', reconnectResult.message);
            } catch (reconnectError) {
              console.error('❌ Failed to auto-reconnect CDP:', reconnectError);
              // Continue anyway - task execution will fail if CDP is required
            }
          } else {
            console.log('ℹ️ CDP already connected or session not found');
          }
        } catch (error) {
          console.error('⚠️ Error checking CDP connection status:', error);
          // Continue anyway
        }
      }

      // Enhance user message with task_id for agent memory management
      let enhancedUserMessage = userMessage;
      if (currentTaskId) {
        enhancedUserMessage = `${userMessage}\n<task_id>${currentTaskId}</task_id>`;
        console.log(`📋 Enhanced user message with task_id: ${currentTaskId}`);
      }

      // Store original user message with task_id in database
      if (!currentSessionId.startsWith('fallback-')) {
        try {
          await supabase
            .from('messages')
            .insert({
              session_id: currentSessionId,
              role: 'user',
              content: userMessage,  // Store original message without task_id tag
              task_id: currentTaskId
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
            .eq('onkernel_session_id', currentBrowserSessionId)
            .single();

          if (!existingSession) {
            const { error: insertError } = await supabase
              .from('browser_sessions')
              .insert({
                chat_session_id: currentSessionId,
                onkernel_session_id: currentBrowserSessionId,
                status: 'active',
                cdp_connected: true,
                cdp_ws_url: browserSessionData?.cdpWsUrl || null,
                live_view_url: browserSessionData?.liveViewUrl || null,
                last_activity_at: new Date().toISOString(),
              });

            if (insertError) {
              console.error('⚠️ Failed to store browser session:', insertError);
            } else {
              console.log('✅ Browser session stored in database with CDP info:', currentBrowserSessionId);
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
          const sessionData = await onkernelClient.getSession(currentBrowserSessionId);
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
              // Send initial metadata including stream URL and taskId immediately
              sendEvent({
                type: 'metadata',
                sessionId: currentSessionId,
                browserSessionId: currentBrowserSessionId,
                streamUrl: streamUrl,
                taskId: currentTaskId,
                timestamp: new Date().toISOString()
              });

              // Use configured system prompt
              const systemPrompt = ANTHROPIC_SYSTEM_PROMPT;

              // Build conversation messages - reconstruct full Anthropic format from stored data
              let conversationMessages: any[] = [];

              // Strategy: If resuming a task (continueAgent=true or resumable task exists),
              // reconstruct the FULL conversation from the last anthropic_request
              // This includes all tool_use and tool_result blocks that were lost when task was stopped
              if (messages.length > 0 && messages.some((m: any) => m.anthropic_request)) {
                // Find the last message with anthropic_request (last assistant message before stop)
                let lastRequestMessage = null;
                for (let i = messages.length - 1; i >= 0; i--) {
                  if (messages[i].anthropic_request?.messages) {
                    lastRequestMessage = messages[i];
                    break;
                  }
                }

                if (lastRequestMessage?.anthropic_request?.messages) {
                  // Validate message structure before using
                  const firstMsg = lastRequestMessage.anthropic_request.messages[0];
                  if (firstMsg) {
                    const contentType = Array.isArray(firstMsg.content) ? 'array' : typeof firstMsg.content;
                    console.log(`📊 Message structure validation: content type = ${contentType}`);

                    if (contentType === 'string' && firstMsg.content.includes('tool_use')) {
                      console.error('❌ CRITICAL: Message content is string but should be array! Tool blocks lost.');
                      console.error('   This indicates sanitizeApiData() or JSON serialization corrupted the data.');
                      // Still try to use it, but log the issue
                    }
                  }

                  // Use the full conversation history from the last request
                  conversationMessages = lastRequestMessage.anthropic_request.messages;
                  console.log(`🔄 Reconstructed ${conversationMessages.length} messages from last anthropic_request`);

                  // Add the assistant's response to this request (with tool_use blocks)
                  if (lastRequestMessage.anthropic_response?.content) {
                    conversationMessages.push({
                      role: 'assistant',
                      content: lastRequestMessage.anthropic_response.content
                    });
                    console.log(`✅ Added assistant response with ${lastRequestMessage.anthropic_response.content.length} content blocks`);
                  }
                } else {
                  // Fallback: reconstruct message by message
                  conversationMessages = messages.map((msg: any) => ({
                    role: msg.role,
                    content: msg.content
                  }));
                }
              } else {
                // No stored anthropic data, build simple messages
                // IMPORTANT: For new tasks, exclude the most recent user message because
                // we'll add it as enhancedUserMessage (with <task_id> tag) below
                const messagesToReconstruct = messages.filter((msg: any, index: number) => {
                  // Keep all messages except the last user message
                  if (index === messages.length - 1 && msg.role === 'user') {
                    return false; // Skip - will be added as enhanced version
                  }
                  return true;
                });

                conversationMessages = messagesToReconstruct.map((msg: any) => ({
                  role: msg.role,
                  content: msg.content
                }));
              }

              // Add new user message with task_id enhancement
              // For new tasks: this adds the enhanced version of the user message we just filtered out
              // For resumed tasks: this is a safety check (should already be in reconstructed messages)
              if (conversationMessages.length === 0 || conversationMessages[conversationMessages.length - 1]?.role !== 'user') {
                conversationMessages.push({
                  role: 'user',
                  content: enhancedUserMessage
                });
                console.log(`✅ Added enhanced user message with <task_id> tag to conversation`);
              } else if (currentTaskId && conversationMessages[conversationMessages.length - 1]?.role === 'user') {
                // Replace the last user message with enhanced version (ensures task_id is present)
                conversationMessages[conversationMessages.length - 1].content = enhancedUserMessage;
                console.log(`🔄 Replaced last user message with enhanced version (added <task_id> tag)`);
              }

              // Execute sampling loop with streaming callback
              // Pass taskId and startIteration for task lifecycle management
              const { finalResponse } = await samplingLoopWithStreaming(
                systemPrompt,
                conversationMessages,
                currentBrowserSessionId,
                currentSessionId,
                sendEvent,
                AGENT_MAX_ITERATIONS,
                currentTaskId,
                startIteration
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
        const responseContent = `🌐 I would help you with QuickBooks tasks, but I'm running in demo mode. In production, I would:\n\n1. ✅ Create a browser session\n2. 📸 Take screenshots to see current state\n3. 🤖 Use AI to analyze and decide actions\n4. 🎯 Execute precise computer actions\n\nThe Onkernel integration needs API configuration to work fully.`;

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
          const sessionData = await onkernelClient.getSession(currentBrowserSessionId);
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
        const sessionData = await onkernelClient.getSession(currentBrowserSessionId);
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