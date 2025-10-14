# Database Migrations: Performance Tracking

This directory contains SQL migration scripts to add performance tracking capabilities to the QBO AI Agent.

## Overview

These migrations add comprehensive performance tracking:
- **API response times** per request
- **Iteration timing** (API + tool execution)
- **Total conversation time** from start to completion
- **Detailed metrics** stored in a dedicated `performance_metrics` table

## Migration Files

1. **`000_run_all_migrations.sql`** - Master script that runs all migrations
2. **`001_add_timing_columns_to_messages.sql`** - Adds `anthropic_response_time_ms` to messages table
3. **`002_add_timing_columns_to_chat_sessions.sql`** - Adds conversation-level timing columns
4. **`003_create_performance_metrics_table.sql`** - Creates detailed performance metrics table

## How to Run Migrations

### Option 1: Run All Migrations at Once (Recommended)

1. Open your Supabase Dashboard
2. Go to **SQL Editor**
3. Copy and paste the contents of `000_run_all_migrations.sql`
4. Click **Run**
5. Verify you see the success messages

### Option 2: Run Migrations Individually

Run each migration in order:
1. `001_add_timing_columns_to_messages.sql`
2. `002_add_timing_columns_to_chat_sessions.sql`
3. `003_create_performance_metrics_table.sql`

## Database Schema Changes

### `messages` Table
New columns:
- `anthropic_response_time_ms` (BIGINT) - Time for Anthropic API to respond

### `chat_sessions` Table
New columns:
- `total_conversation_time_ms` (BIGINT) - Total conversation time
- `completed_at` (TIMESTAMPTZ) - When conversation completed
- `total_iterations` (INTEGER) - Number of iterations until completion

### `performance_metrics` Table (New)
Tracks detailed metrics per iteration:
- `id` (UUID) - Primary key
- `session_id` (UUID) - Reference to chat_sessions
- `message_id` (UUID) - Reference to messages
- `iteration` (INTEGER) - Iteration number
- `api_response_time_ms` (BIGINT) - Anthropic API response time
- `iteration_total_time_ms` (BIGINT) - Total iteration time
- `tool_execution_time_ms` (BIGINT) - Tool execution time
- `metadata` (JSONB) - Additional context
- `created_at` (TIMESTAMPTZ) - Timestamp

## Example Queries

### Average API Response Time
```sql
SELECT
  AVG(anthropic_response_time_ms) as avg_response_time_ms,
  AVG(anthropic_response_time_ms) / 1000.0 as avg_response_time_seconds
FROM messages
WHERE anthropic_response_time_ms IS NOT NULL;
```

### API Response Time by Iteration
```sql
SELECT
  pm.iteration,
  pm.api_response_time_ms,
  pm.iteration_total_time_ms,
  pm.tool_execution_time_ms,
  (pm.api_response_time_ms / 1000.0) as api_seconds
FROM performance_metrics pm
WHERE pm.session_id = 'your-session-id-here'
ORDER BY pm.iteration;
```

### Slowest API Responses
```sql
SELECT
  m.id,
  m.session_id,
  m.anthropic_response_time_ms,
  (m.anthropic_response_time_ms / 1000.0) as response_seconds,
  m.created_at
FROM messages m
WHERE m.anthropic_response_time_ms IS NOT NULL
ORDER BY m.anthropic_response_time_ms DESC
LIMIT 10;
```

### Performance Trends Over Time
```sql
SELECT
  DATE_TRUNC('hour', pm.created_at) as hour,
  AVG(pm.api_response_time_ms) as avg_api_time_ms,
  AVG(pm.iteration_total_time_ms) as avg_iteration_time_ms,
  AVG(pm.tool_execution_time_ms) as avg_tool_time_ms,
  COUNT(*) as total_iterations
FROM performance_metrics pm
GROUP BY DATE_TRUNC('hour', pm.created_at)
ORDER BY hour DESC;
```

### Conversation Completion Statistics
```sql
SELECT
  cs.id,
  cs.total_iterations,
  cs.total_conversation_time_ms,
  (cs.total_conversation_time_ms / 1000.0) as total_seconds,
  (cs.total_conversation_time_ms / NULLIF(cs.total_iterations, 0)) as avg_ms_per_iteration,
  cs.completed_at
FROM chat_sessions cs
WHERE cs.total_conversation_time_ms IS NOT NULL
ORDER BY cs.completed_at DESC
LIMIT 10;
```

### Performance by Iteration Number (Identify Slowdown Patterns)
```sql
SELECT
  pm.iteration,
  COUNT(*) as sample_size,
  AVG(pm.api_response_time_ms) as avg_api_time,
  MIN(pm.api_response_time_ms) as min_api_time,
  MAX(pm.api_response_time_ms) as max_api_time,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pm.api_response_time_ms) as median_api_time
FROM performance_metrics pm
GROUP BY pm.iteration
HAVING COUNT(*) >= 3  -- Only include iterations with at least 3 samples
ORDER BY pm.iteration;
```

## Rollback

If you need to rollback these migrations:

```sql
-- Drop performance_metrics table
DROP TABLE IF EXISTS performance_metrics CASCADE;

-- Remove columns from chat_sessions
ALTER TABLE chat_sessions
DROP COLUMN IF EXISTS total_conversation_time_ms,
DROP COLUMN IF EXISTS completed_at,
DROP COLUMN IF EXISTS total_iterations;

-- Remove column from messages
ALTER TABLE messages
DROP COLUMN IF EXISTS anthropic_response_time_ms;
```

## Notes

- All timing values are stored in **milliseconds** for precision
- The `performance_metrics` table uses foreign keys with CASCADE delete for automatic cleanup
- Indexes are created for common query patterns to ensure good performance
- The `metadata` JSONB field allows storing additional context without schema changes

## Next Steps

After running the migrations:
1. Restart your Next.js development server
2. The application will automatically start tracking performance metrics
3. Use the example queries above to analyze performance
4. Monitor the console logs for real-time timing information
