# STRMS AI Agent - Project Context

AI-powered browser automation platform for bookkeeping tasks using Claude's computer use capabilities.

## Tech Stack
- **Framework**: Next.js 15.5.7, React 19, TypeScript 5
- **AI**: Anthropic Claude (`claude-sonnet-4-20250514`) via @anthropic-ai/sdk
- **Browser Automation**: OnKernel SDK + Playwright (CDP over WebSocket)
- **Database**: Supabase (PostgreSQL) with Realtime subscriptions
- **UI**: Tailwind CSS 4, shadcn/ui (Radix), Lucide icons

## Project Structure
```
src/
├── app/
│   ├── api/
│   │   ├── chat/route.ts         # Main agent loop (AI brain)
│   │   ├── tasks/execute/route.ts # Batch API endpoint
│   │   ├── browser/[sessionId]/   # Browser control endpoints
│   │   ├── sessions/              # Chat session CRUD
│   │   ├── batch-executions/      # Batch status/control
│   │   ├── dashboard/             # Analytics endpoints
│   │   └── files/                 # Download management
│   ├── dashboard/page.tsx         # Analytics dashboard
│   ├── files/page.tsx             # Downloaded files viewer
│   └── page.tsx                   # Main UI entry
├── components/
│   ├── STRMSAgent.tsx            # Main 3-panel layout
│   ├── ChatPanel.tsx             # Chat interface (left)
│   ├── BrowserPanel.tsx          # Live browser view (right)
│   ├── ThreadHistory.tsx         # Session sidebar
│   ├── dashboard/                # Dashboard components
│   └── ui/                       # shadcn/ui components
├── lib/
│   ├── onkernel.ts               # Browser automation client
│   ├── batch-executor.ts         # Sequential task executor
│   ├── memory-handlers.ts        # Task memory persistence
│   ├── webhook.ts                # HMAC webhook signing
│   └── supabase.ts               # Database client
├── types/
│   ├── index.ts                  # Core types
│   └── batch.ts                  # Batch API types
└── migrations/                   # SQL migrations
```

## Two Usage Modes

### 1. Web UI (`/`)
Interactive 3-panel interface:
- Left: Chat history + message input
- Right: Live browser iframe (OnKernel stream)
- Sidebar: Session history

### 2. Batch API (`POST /api/tasks/execute`)
Programmatic execution with shared browser:
```json
{
  "tasks": [
    { "message": "Task 1 instructions", "destroyBrowserOnCompletion": false },
    { "message": "Task 2 instructions", "destroyBrowserOnCompletion": true }
  ],
  "webhookUrl": "https://...",
  "globalConfigOverrides": { "AGENT_MAX_ITERATIONS": 50 }
}
```
- Returns `202 Accepted` with batchId immediately
- Tasks execute sequentially in background
- Single browser session shared across all tasks
- Webhook notifications on task completion

## Key Files

| File | Purpose |
|------|---------|
| `src/app/api/chat/route.ts` | Agent sampling loop, tool definitions, system prompt |
| `src/lib/onkernel.ts` | OnKernel/Playwright browser client, multi-tab support |
| `src/lib/batch-executor.ts` | Sequential batch task execution |
| `src/components/ChatPanel.tsx` | Chat UI with Realtime subscriptions |
| `src/types/batch.ts` | BatchExecutionRequest, ConfigOverrides, ExecutionConfig |

## Database Tables (Supabase)
- `chat_sessions` - Conversation sessions
- `messages` - Chat history (user/assistant/tool)
- `tasks` - Individual task tracking with status
- `batch_executions` - Batch execution tracking
- `browser_sessions` - Browser session + CDP URLs
- `performance_metrics` - Timing/cost metrics
- `computer_actions` - Audit trail

## Agent Tools
1. **computer_use** - Browser control (click, type, scroll, screenshot, key, wait)
2. **report_task_status** - Task completion reporting (completed/failed/needs_clarification)
3. **memory** - Task progress persistence (JSON files at `/memories/{task_id}`)
4. **save_recent_download** - Save downloaded files to Supabase storage
5. **upload_already_downloaded_file** - Upload saved files to browser inputs

## Key Environment Variables
```
ANTHROPIC_API_KEY=           # Claude API
KERNEL_API_KEY=              # OnKernel browser automation
SUPABASE_URL=                # Database URL
SUPABASE_ANON_KEY=           # Database key
API_KEY_SECRET=              # Batch API auth

# Agent Configuration
AGENT_MAX_ITERATIONS=35      # Max loop iterations
THINKING_BUDGET_TOKENS=1024  # Claude thinking budget
MAX_BASE64_SCREENSHOTS=3     # Screenshots in context
ENABLE_PROMPT_CACHING=yes    # 90% cost reduction
ENABLE_CONTEXT_MANAGEMENT=yes # Auto context cleanup
```

## Commands
```bash
npm run dev      # Start dev server (Turbopack)
npm run build    # Production build
npm run lint     # ESLint
```

## Patterns & Conventions

### Task-Based Architecture
- Each user request = 1 Task in database
- Tasks track: status, iterations, agent_status, evidence
- Task statuses: queued → running → completed/failed/paused

### Config Overrides
- Global overrides apply to all batch tasks
- Per-task overrides merge with globals
- ConfigOverrides → ExecutionConfig normalization

### Real-time Updates
- Supabase Realtime for batch API updates in UI
- SSE streaming for task execution
- WebSocket for browser live view
- ChatPanel subscribes to task status changes and explicitly handles `running` and `paused` states

### Error Handling
- `needs_clarification` status = task paused for human input
- Webhooks include evidence (screenshots, extracted data)
- Browser persists if task paused (not destroyed)

### Session Lifecycle (Batch Executions)
- Individual task completion does NOT mark session as `completed` for batch tasks
- Session marked `completed` only when entire batch finishes (in BatchExecutor)
- This allows user input during paused tasks without 400 errors

## Current Work (Dec 2025)
- STOP button for batch executions (completed)
- Loading indicator fixes for paused tasks (completed - explicit `paused` status handling in Supabase subscription)
- Session completion fix for batch tasks (completed - session stays active until batch finishes)
- OnKernel SDK upgraded to 0.22.0
- Token metrics and config overrides support
