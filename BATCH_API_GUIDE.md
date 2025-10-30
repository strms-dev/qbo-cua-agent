# Batch API Guide

**Version:** 1.0
**Last Updated:** 2025-01-30

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [API Endpoint](#api-endpoint)
4. [Request Format](#request-format)
5. [Response Format](#response-format)
6. [Configuration Overrides](#configuration-overrides)
7. [Webhook Notifications](#webhook-notifications)
8. [Examples](#examples)
9. [Error Handling](#error-handling)
10. [Monitoring & Debugging](#monitoring--debugging)
11. [Best Practices](#best-practices)

---

## Overview

The Batch API allows you to execute multiple agent tasks sequentially with a shared browser session. This enables:

- **Cost efficiency**: Single browser session for multiple tasks
- **State preservation**: Later tasks can build on earlier task state (cookies, auth, page navigation)
- **Parallel execution**: Fire-and-forget API returns immediately while tasks execute in background
- **Webhook notifications**: Receive real-time status updates as tasks complete
- **Fine-grained control**: Override configuration per-batch or per-task

### Key Concepts

- **Batch Execution**: A collection of 1+ tasks executed sequentially
- **Task**: A single instruction for the agent to execute
- **Shared Browser**: All tasks in a batch use the same browser session
- **Sequential Execution**: Tasks execute in order (task 0, then 1, then 2, etc.)
- **Fire-and-Forget**: API returns immediately with batch ID; execution happens in background

---

## Authentication

All requests must include an API key in the `Authorization` header:

```http
Authorization: Bearer your-secret-api-key-here
```

### Setup

1. Set `API_KEY_SECRET` in your `.env.local` file:
   ```bash
   API_KEY_SECRET=your-secret-api-key-here
   ```

2. Restart your development server:
   ```bash
   npm run dev
   ```

3. Include the key in all API requests.

**Security Note**: Never commit API keys to version control. Store them securely in environment variables.

---

## API Endpoint

### POST /api/tasks/execute

Execute a batch of tasks sequentially with a shared browser session.

**Request:**
- Method: `POST`
- Content-Type: `application/json`
- Authentication: Required (Bearer token)

**Response:**
- Status: `202 Accepted` (success)
- Status: `400 Bad Request` (validation error)
- Status: `401 Unauthorized` (auth error)
- Status: `500 Internal Server Error` (server error)

---

## Request Format

### BatchExecutionRequest Schema

```typescript
interface BatchExecutionRequest {
  // Required: Array of tasks to execute (1 or more)
  tasks: TaskConfig[];

  // Optional: Webhook URL for status notifications
  webhookUrl?: string;

  // Optional: Secret for webhook HMAC signature verification
  webhookSecret?: string;

  // Optional: Global configuration overrides applied to all tasks
  globalConfigOverrides?: ConfigOverrides;
}
```

### TaskConfig Schema

```typescript
interface TaskConfig {
  // Required: The instruction/message for the agent
  message: string;

  // Required: Whether to destroy browser after this task completes
  // Set to true only on the last task to save costs
  destroyBrowserOnCompletion: boolean;

  // Optional: Configuration overrides for this specific task
  // Takes precedence over globalConfigOverrides
  configOverrides?: ConfigOverrides;
}
```

### Example Request

```json
{
  "tasks": [
    {
      "message": "Go to example.com and take a screenshot",
      "destroyBrowserOnCompletion": false
    },
    {
      "message": "Now go to wikipedia.org and extract the main heading",
      "destroyBrowserOnCompletion": true
    }
  ],
  "webhookUrl": "https://webhook.site/your-unique-url",
  "globalConfigOverrides": {
    "AGENT_MAX_ITERATIONS": 30,
    "TYPING_DELAY_MS": 50
  }
}
```

---

## Response Format

### BatchExecutionResponse Schema

```typescript
interface BatchExecutionResponse {
  // Unique ID for this batch execution
  batchExecutionId: string;

  // Chat session ID
  sessionId: string;

  // Browser session ID (or 'pending' if not yet created)
  browserSessionId: string;

  // Array of task IDs (in execution order)
  taskIds: string[];

  // Current status (always 'running' on immediate response)
  status: 'running';

  // ISO 8601 timestamp
  timestamp: string;
}
```

### Example Response

```json
{
  "batchExecutionId": "01e15647-d7e3-49ba-9705-96139222aed3",
  "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "browserSessionId": "pending",
  "taskIds": [
    "task-uuid-1",
    "task-uuid-2"
  ],
  "status": "running",
  "timestamp": "2025-01-30T12:34:56.789Z"
}
```

---

## Configuration Overrides

Override default agent behavior on a per-batch or per-task basis.

### Available Overrides

```typescript
interface ConfigOverrides {
  // Agent Loop Configuration
  AGENT_MAX_ITERATIONS?: number;         // Default: 35
  SAMPLING_LOOP_DELAY_MS?: number;       // Default: 100

  // Screenshot & Context Management
  MAX_BASE64_SCREENSHOTS?: number;       // Default: 3
  KEEP_RECENT_THINKING_BLOCKS?: number;  // Default: 1

  // Anthropic API Configuration
  THINKING_BUDGET_TOKENS?: number;       // Default: 1024
  ANTHROPIC_MAX_TOKENS?: number;         // Default: 4096
  ANTHROPIC_MODEL?: string;              // Default: claude-sonnet-4-20250514

  // OnKernel/Playwright Configuration
  TYPING_DELAY_MS?: number;              // Default: 0
  ONKERNEL_TIMEOUT_SECONDS?: number;     // Default: 180
}
```

### Precedence Rules

1. **Task-level overrides** (highest priority)
2. **Global overrides** (batch-level)
3. **Environment variables** (lowest priority)

### Example: Override Agent Iterations

```json
{
  "tasks": [
    {
      "message": "Complex task requiring many iterations",
      "destroyBrowserOnCompletion": true,
      "configOverrides": {
        "AGENT_MAX_ITERATIONS": 50
      }
    }
  ]
}
```

---

## Webhook Notifications

Receive real-time status updates when tasks complete, fail, or need clarification.

### Webhook Payload

```typescript
interface WebhookPayload {
  type: 'task_status';
  batchExecutionId: string;
  taskId: string;
  taskIndex: number;
  status: 'completed' | 'failed' | 'paused';
  agentStatus: 'completed' | 'failed' | 'needs_clarification';
  message: string;
  reasoning?: string;
  nextStep?: string;
  evidence?: {
    screenshot_url?: string;
    extracted_data?: any;
    error_details?: string;
    [key: string]: any;
  };
  timestamp: string;
}
```

### Status Mapping

- `completed` (agent) → `completed` (database)
- `failed` (agent) → `failed` (database)
- `needs_clarification` (agent) → `paused` (database)

### HMAC Signature Verification

When `webhookSecret` is provided, webhook requests include an `X-Signature` header with HMAC-SHA256 signature:

```javascript
const signature = crypto
  .createHmac('sha256', webhookSecret)
  .update(JSON.stringify(payload))
  .digest('hex');
```

**Verification Example:**

```javascript
const receivedSignature = req.headers['x-signature'];
const computedSignature = crypto
  .createHmac('sha256', webhookSecret)
  .update(req.body)
  .digest('hex');

if (receivedSignature !== computedSignature) {
  throw new Error('Invalid webhook signature');
}
```

### Testing Webhooks

Use [webhook.site](https://webhook.site) to test webhook notifications:

1. Go to webhook.site and copy your unique URL
2. Use it in your API request:
   ```json
   {
     "webhookUrl": "https://webhook.site/your-unique-url"
   }
   ```
3. Monitor incoming webhooks on the webhook.site page

---

## Examples

### Example 1: Single Simple Task

```bash
curl -X POST http://localhost:3000/api/tasks/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "tasks": [
      {
        "message": "Go to example.com and take a screenshot",
        "destroyBrowserOnCompletion": true
      }
    ]
  }'
```

### Example 2: Multi-Task with Shared Browser

```bash
curl -X POST http://localhost:3000/api/tasks/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "tasks": [
      {
        "message": "Go to github.com/login",
        "destroyBrowserOnCompletion": false
      },
      {
        "message": "Login with username testuser and password testpass123",
        "destroyBrowserOnCompletion": false
      },
      {
        "message": "Navigate to settings and take a screenshot",
        "destroyBrowserOnCompletion": true
      }
    ]
  }'
```

### Example 3: With Configuration Overrides

```bash
curl -X POST http://localhost:3000/api/tasks/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "tasks": [
      {
        "message": "Extract all product prices from example.com/shop",
        "destroyBrowserOnCompletion": true,
        "configOverrides": {
          "AGENT_MAX_ITERATIONS": 40,
          "ANTHROPIC_MAX_TOKENS": 8192
        }
      }
    ],
    "globalConfigOverrides": {
      "TYPING_DELAY_MS": 100,
      "SAMPLING_LOOP_DELAY_MS": 200
    }
  }'
```

### Example 4: With Webhook Notifications

```bash
curl -X POST http://localhost:3000/api/tasks/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "tasks": [
      {
        "message": "Go to example.com and report completion",
        "destroyBrowserOnCompletion": true
      }
    ],
    "webhookUrl": "https://webhook.site/your-unique-url",
    "webhookSecret": "my-secret-key"
  }'
```

### Example 5: Using TypeScript Test Script

```bash
# Run test with default scenario (single task)
npx tsx test-batch-api.ts

# Run specific test scenario
npx tsx test-batch-api.ts multi_task_shared_browser

# With environment variables
API_URL=http://localhost:3000 \
API_KEY_SECRET=your-key \
WEBHOOK_URL=https://webhook.site/your-url \
npx tsx test-batch-api.ts with_webhook
```

---

## Error Handling

### API Errors

| Status Code | Error | Cause |
|-------------|-------|-------|
| 400 | `tasks array is required` | Missing or empty tasks array |
| 400 | `tasks[0].message is required` | Missing message in task |
| 400 | `tasks[0].destroyBrowserOnCompletion is required` | Missing boolean flag |
| 401 | `Unauthorized - Invalid or missing API key` | Invalid/missing Authorization header |
| 500 | `Failed to create chat session` | Database error |
| 500 | `Failed to create batch execution record` | Database error |
| 500 | `Failed to create task records` | Database error |

### Task Execution Errors

Tasks that fail during execution:
- Do NOT stop the batch
- Are marked as `failed` in database
- Increment `failed_count` in batch_executions
- Trigger webhook notification (if configured)
- Next task continues execution

### Example Error Response

```json
{
  "error": "tasks array is required and must contain at least 1 task"
}
```

---

## Monitoring & Debugging

### Database Tables

**1. batch_executions** - Track overall batch progress

```sql
SELECT
  id,
  status,
  task_count,
  completed_count,
  failed_count,
  created_at,
  completed_at
FROM batch_executions
WHERE id = 'your-batch-id';
```

**2. tasks** - Track individual task status

```sql
SELECT
  id,
  task_index,
  status,
  message,
  result_message,
  started_at,
  completed_at
FROM tasks
WHERE batch_execution_id = 'your-batch-id'
ORDER BY task_index;
```

**3. browser_sessions** - Track browser lifecycle

```sql
SELECT
  id,
  status,
  cdp_connected,
  created_at,
  last_activity_at
FROM browser_sessions
WHERE id IN (
  SELECT browser_session_id
  FROM batch_executions
  WHERE id = 'your-batch-id'
);
```

### Server Logs

Monitor execution in real-time by watching server logs:

```bash
npm run dev
# Look for these log patterns:
# 🚀 BatchExecutor starting for batch: ...
# ✅ Browser session created: ...
# 📝 Executing task 1/3 (ID: ...)
# ✅ Task 1 completed successfully
# 📡 Webhook notification sent to: ...
```

### Webhook Debugging

Use webhook.site to debug webhook notifications:

1. Create unique URL: https://webhook.site
2. Use URL in API request
3. View incoming webhooks with full payload
4. Check timing, status, and evidence fields

---

## Best Practices

### 1. Browser Lifecycle Management

- **Set `destroyBrowserOnCompletion: true` ONLY on the last task**
- Earlier tasks should use `false` to reuse the browser
- Browser destruction stops OnKernel billing

```json
{
  "tasks": [
    {"message": "Task 1", "destroyBrowserOnCompletion": false},
    {"message": "Task 2", "destroyBrowserOnCompletion": false},
    {"message": "Task 3", "destroyBrowserOnCompletion": true}  // ← Only last task
  ]
}
```

### 2. Task Granularity

- Break complex workflows into smaller tasks
- Each task = one logical step
- Easier debugging and monitoring
- Better webhook notifications

**❌ Bad (monolithic):**
```json
{
  "message": "Go to site, login, navigate to dashboard, extract data, logout"
}
```

**✅ Good (granular):**
```json
[
  {"message": "Go to site and login with credentials"},
  {"message": "Navigate to dashboard"},
  {"message": "Extract all data from the table"},
  {"message": "Logout"}
]
```

### 3. Configuration Overrides

- Use `globalConfigOverrides` for batch-wide settings
- Use `task.configOverrides` for task-specific needs
- Common overrides:
  - `AGENT_MAX_ITERATIONS`: Increase for complex tasks
  - `ANTHROPIC_MAX_TOKENS`: Increase for data extraction
  - `TYPING_DELAY_MS`: Increase for slower sites

### 4. Error Recovery

- Design tasks to be idempotent when possible
- Use memory tool to track progress across tasks
- Check task evidence in webhooks for debugging
- Review `result_message` in database for failure details

### 5. Webhook Best Practices

- Always use `webhookSecret` for production
- Verify HMAC signature on webhook receiver
- Handle webhook failures gracefully (they don't retry)
- Log webhook payloads for debugging

### 6. Testing Strategy

1. **Local Development**: Use `test-batch-api.ts` script
2. **Webhook Testing**: Use webhook.site for initial testing
3. **Database Verification**: Check tables after execution
4. **Production**: Implement proper webhook receiver with HMAC verification

### 7. Cost Optimization

- Reuse browser sessions across tasks
- Destroy browser after last task
- Use appropriate `AGENT_MAX_ITERATIONS` limits
- Monitor `failed_count` to catch runaway tasks

### 8. Security

- **Never commit `API_KEY_SECRET` to version control**
- Use environment variables for secrets
- Implement webhook signature verification
- Use HTTPS for webhook URLs in production
- Rotate API keys regularly

---

## Additional Resources

- **TypeScript Types**: See `src/types/batch.ts` for full type definitions
- **Test Script**: See `test-batch-api.ts` for testing examples
- **Implementation**: See `src/lib/batch-executor.ts` for execution logic
- **API Endpoint**: See `src/app/api/tasks/execute/route.ts` for endpoint code

---

## Support

For issues or questions:
1. Check server logs for error details
2. Verify database records (batch_executions, tasks tables)
3. Test webhooks with webhook.site
4. Review this guide for best practices

---

**Version History:**
- v1.0 (2025-01-30): Initial release with core batch API functionality
