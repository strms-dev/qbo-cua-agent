# Task-Based Architecture Test Plan

## Overview
This test plan covers the task-based architecture implementation with stop functionality for the STRMS AI Agent. The system allows users to start, stop, and resume agent tasks while maintaining state across interruptions.

## Test Environment Setup

### Prerequisites
1. Supabase database with migrations applied (migrations/004_create_tasks_table.sql)
2. OnKernel API key configured (KERNEL_API_KEY in .env.local)
3. Anthropic API key configured (ANTHROPIC_API_KEY in .env.local)
4. Development server running (`npm run dev`)
5. Browser with access to http://localhost:3000

### Database Verification
Before testing, verify the tasks table exists:
```sql
SELECT * FROM tasks LIMIT 1;
SELECT * FROM information_schema.columns WHERE table_name = 'tasks';
```

---

## Test Scenarios

### 1. Task Creation
**Objective:** Verify that new tasks are created correctly when user sends a message

**Steps:**
1. Open the application in a browser
2. Enter a task message: "Navigate to google.com"
3. Click Send button
4. Check browser console for task creation log

**Expected Results:**
- Console shows: "✅ Created new task: [task-id]"
- Task status badge appears in header showing "🔄 Running"
- Send button changes to red "Stop" button
- Database has new task record with status='running'

**Database Verification:**
```sql
SELECT id, status, user_message, created_at, started_at
FROM tasks
ORDER BY created_at DESC
LIMIT 1;
```

---

### 2. Stop Button Functionality
**Objective:** Verify that users can stop a running task

**Steps:**
1. Start a task that will take some time (e.g., "Navigate to google.com and take 5 screenshots")
2. Wait for task to start running (see multiple iterations in console)
3. Click the red "Stop" button
4. Observe the UI and console

**Expected Results:**
- Console shows: "🛑 Stopping task: [task-id]"
- Console shows: "✅ Task stopped: [response]"
- Stop button changes back to Send button
- System message appears: "🛑 Task stopped by user. You can continue by sending a new message."
- Task status badge shows "🛑 Stopped"
- Database shows task status updated to 'stopped'

**Database Verification:**
```sql
SELECT id, status, current_iteration, completed_at
FROM tasks
WHERE status = 'stopped'
ORDER BY created_at DESC
LIMIT 1;
```

---

### 3. Task Resume (Silent Continue)
**Objective:** Verify that stopped/paused tasks resume automatically on new message

**Steps:**
1. Stop a running task (as in Test #2)
2. Wait for stop to complete
3. Send a new message (any message, e.g., "continue")
4. Check console logs

**Expected Results:**
- Console shows: "🔄 Resuming task [task-id] from iteration [N]"
- Task continues from the saved iteration
- Agent proceeds with the original task
- Task status changes back to "🔄 Running"
- Database shows task status changed from 'stopped' to 'running'

**Database Verification:**
```sql
SELECT id, status, current_iteration, started_at
FROM tasks
WHERE id = '[task-id]';
```

---

### 4. Agent Self-Reporting (Completed)
**Objective:** Verify that agent can report task completion

**Steps:**
1. Start a simple, achievable task: "Take a screenshot"
2. Let the task run to completion
3. Observe agent's response and database

**Expected Results:**
- Agent calls `report_task_status` tool with status="completed"
- Console shows: "✅ Task status recorded: completed"
- Console shows: "✅ Task [task-id] updated to status: completed"
- Message shows tool call with green badge: "✅ Task Status Report"
- Task status badge disappears (completed tasks don't show)
- Database shows task status='completed', agent_status='completed'

**Database Verification:**
```sql
SELECT id, status, agent_status, agent_message, result_message, completed_at
FROM tasks
WHERE status = 'completed'
ORDER BY created_at DESC
LIMIT 1;
```

---

### 5. Agent Self-Reporting (Failed)
**Objective:** Verify that agent can report task failure

**Steps:**
1. Start a task that will fail: "Navigate to https://this-site-definitely-does-not-exist-12345.com"
2. Let the task run
3. Observe agent's response

**Expected Results:**
- Agent calls `report_task_status` tool with status="failed"
- Message shows tool call with red badge: "❌ Task Status Report"
- System message: "❌ Task failed: [agent's explanation]"
- Task status badge shows "❌ Failed"
- Database shows task status='failed', agent_status='failed', error message populated

**Database Verification:**
```sql
SELECT id, status, agent_status, agent_message, error_message, completed_at
FROM tasks
WHERE status = 'failed'
ORDER BY created_at DESC
LIMIT 1;
```

---

### 6. Agent Self-Reporting (Needs Clarification)
**Objective:** Verify that agent can request clarification, pausing the task

**Steps:**
1. Start an ambiguous task: "Create an invoice"
2. Let the task run
3. Observe if agent requests clarification

**Expected Results:**
- Agent calls `report_task_status` tool with status="needs_clarification"
- Message shows tool call with yellow badge: "⏸️ Task Status Report"
- System message: "⏸️ Task paused: [agent's clarification request]"
- Task status badge shows "⏸️ Paused"
- Database shows task status='paused', agent_status='needs_clarification'
- User can send clarifying message to resume

**Database Verification:**
```sql
SELECT id, status, agent_status, agent_message, completed_at
FROM tasks
WHERE status = 'paused'
ORDER BY created_at DESC
LIMIT 1;
```

---

### 7. Max Iterations Limit
**Objective:** Verify that tasks fail gracefully when max iterations is reached

**Steps:**
1. Set AGENT_MAX_ITERATIONS=5 in .env.local (temporarily for testing)
2. Restart the server
3. Start a complex task: "Navigate to 20 different websites"
4. Let it run until max iterations

**Expected Results:**
- After 5 iterations, agent stops
- Console shows: "⚠️ Agent stopped after 5 iterations. Task may be incomplete."
- Console shows: "✅ Task [task-id] marked as failed (max iterations)"
- Database shows status='failed', error_message='Max iterations reached without task completion'

**Database Verification:**
```sql
SELECT id, status, current_iteration, max_iterations, error_message
FROM tasks
WHERE error_message LIKE '%Max iterations%'
ORDER BY created_at DESC
LIMIT 1;
```

**Cleanup:** Restore AGENT_MAX_ITERATIONS=35 in .env.local

---

### 8. Multiple Tasks in One Session
**Objective:** Verify that one session can have multiple sequential tasks

**Steps:**
1. Complete a task (e.g., "Take a screenshot")
2. After completion, send a new message: "Take another screenshot"
3. Complete the second task
4. Check database for tasks

**Expected Results:**
- First task completes (status='completed')
- Second task is created as a NEW task (not resuming the first)
- Both tasks share the same session_id
- Only one task is active at a time
- Database shows 2 tasks for the session

**Database Verification:**
```sql
SELECT id, session_id, status, user_message, created_at
FROM tasks
WHERE session_id = '[session-id]'
ORDER BY created_at;
```

---

### 9. Task State Persistence (Messages & Metrics)
**Objective:** Verify that messages and performance metrics are linked to tasks

**Steps:**
1. Start a task and let it run for 2-3 iterations
2. Stop the task
3. Check database for related records

**Expected Results:**
- All messages have task_id populated
- All performance_metrics records have task_id populated
- All computer_actions records have task_id populated
- Can query all data for a specific task

**Database Verification:**
```sql
-- Check messages linked to task
SELECT COUNT(*), task_id
FROM messages
WHERE task_id = '[task-id]'
GROUP BY task_id;

-- Check metrics linked to task
SELECT COUNT(*), task_id
FROM performance_metrics
WHERE task_id = '[task-id]'
GROUP BY task_id;

-- Check actions linked to task
SELECT COUNT(*), task_id
FROM computer_actions
WHERE task_id = '[task-id]'
GROUP BY task_id;
```

---

### 10. Error Handling During Task Execution
**Objective:** Verify that tasks are marked as failed when errors occur

**Steps:**
1. Manually stop the OnKernel session (if possible) or simulate an API error
2. Start a task
3. Observe error handling

**Expected Results:**
- Console shows error: "❌ Sampling loop error:"
- Console shows: "✅ Task [task-id] marked as failed"
- Error message appears in chat
- Database shows status='failed', error_message populated

**Database Verification:**
```sql
SELECT id, status, error_message, completed_at
FROM tasks
WHERE status = 'failed' AND error_message IS NOT NULL
ORDER BY created_at DESC
LIMIT 1;
```

---

### 11. Stop Endpoint Validation
**Objective:** Verify stop endpoint rejects invalid requests

**Test 11a: Invalid Task ID**
```bash
curl -X POST http://localhost:3000/api/tasks/invalid-uuid-12345/stop
```
**Expected:** 404 Not Found - "Task not found"

**Test 11b: Already Stopped Task**
1. Stop a task via UI
2. Call stop endpoint again with same task ID
```bash
curl -X POST http://localhost:3000/api/tasks/[task-id]/stop
```
**Expected:** 400 Bad Request - "Task is not running"

**Test 11c: Completed Task**
1. Complete a task
2. Try to stop it
```bash
curl -X POST http://localhost:3000/api/tasks/[completed-task-id]/stop
```
**Expected:** 400 Bad Request - "Task is not running"

---

### 12. New Chat Functionality
**Objective:** Verify that "New Chat" clears task state

**Steps:**
1. Start a task and stop it
2. Click "New Chat" button
3. Start a new task
4. Check that it's a new task (not resuming the old one)

**Expected Results:**
- Task state is cleared (currentTaskId = null, taskStatus = null)
- New session is created
- New task is created (not resuming old task)
- Old task remains in 'stopped' state in database

---

### 13. Browser Refresh During Task
**Objective:** Verify behavior when user refreshes browser during task

**Steps:**
1. Start a task
2. Refresh the browser (F5)
3. Observe the state

**Expected Results:**
- Session is reloaded from database
- Previous messages are displayed
- Task is still running in backend (until stopped or completed)
- UI shows loading history state
- User can send new message to resume or interact

**Note:** The task will continue running in the backend until it completes, fails, or reaches max iterations. The frontend loses track of it after refresh.

---

### 14. Task Evidence Display
**Objective:** Verify that evidence from report_task_status is displayed

**Steps:**
1. Manually trigger a report_task_status event with evidence (or wait for agent to do it)
2. Observe the UI

**Expected Results:**
- Screenshot URL evidence: Shows "View Screenshot" link
- Extracted data evidence: Shows formatted JSON in white box
- Error details evidence: Shows red text with error message
- All evidence is properly formatted and clickable

---

## Performance Tests

### 15. Large Number of Tasks
**Objective:** Verify system handles many tasks efficiently

**Steps:**
1. Create 10 tasks in sequence (complete each before starting next)
2. Check database performance
3. Verify UI remains responsive

**Expected Results:**
- All tasks complete successfully
- Database queries remain fast
- UI doesn't lag
- No memory leaks in browser

---

## Edge Cases

### 16. Rapid Stop/Resume
**Objective:** Verify system handles rapid stop/resume cycles

**Steps:**
1. Start a task
2. Immediately stop it (within 1 second)
3. Immediately send a new message to resume
4. Repeat 3 times

**Expected Results:**
- System handles rapid state changes
- No race conditions
- Tasks update correctly
- No orphaned tasks in database

---

### 17. Empty Messages
**Objective:** Verify system rejects empty task requests

**Steps:**
1. Try to send an empty message
2. Observe button state

**Expected Results:**
- Send button is disabled when input is empty
- No task is created
- No API calls are made

---

## Regression Tests

### 18. Existing Functionality Still Works
**Objective:** Verify that task architecture doesn't break existing features

**Tests:**
- Screenshots still work and display correctly
- Computer actions (click, type, scroll) still work
- Thinking blocks still expand/collapse
- Browser session creation still works
- Stream URL still displays browser view
- Session history loading still works

---

## Database Integrity Tests

### 19. Foreign Key Constraints
**Objective:** Verify database referential integrity

**Tests:**
```sql
-- Verify messages.task_id references valid tasks
SELECT m.id, m.task_id
FROM messages m
LEFT JOIN tasks t ON m.task_id = t.id
WHERE m.task_id IS NOT NULL AND t.id IS NULL;
-- Should return 0 rows

-- Verify performance_metrics.task_id references valid tasks
SELECT pm.id, pm.task_id
FROM performance_metrics pm
LEFT JOIN tasks t ON pm.task_id = t.id
WHERE pm.task_id IS NOT NULL AND t.id IS NULL;
-- Should return 0 rows
```

### 20. Task Status Transitions
**Objective:** Verify valid status transitions

**Valid Transitions:**
- queued → running
- running → stopped
- running → paused
- running → completed
- running → failed
- stopped → running (resume)
- paused → running (resume)

**Invalid Transitions (should not occur):**
- completed → running
- failed → running
- completed → stopped
- failed → stopped

**Verification Query:**
```sql
-- Look for suspicious task status history
SELECT id, status, created_at, started_at, completed_at
FROM tasks
WHERE (status = 'completed' AND completed_at IS NULL)
   OR (status = 'failed' AND completed_at IS NULL)
   OR (status = 'running' AND started_at IS NULL);
-- Should return 0 rows
```

---

## Summary of Test Coverage

- ✅ Task Creation
- ✅ Task Stop (User Initiated)
- ✅ Task Resume (Silent)
- ✅ Agent Self-Reporting (3 statuses)
- ✅ Max Iterations Handling
- ✅ Multiple Tasks per Session
- ✅ Data Persistence (Messages, Metrics)
- ✅ Error Handling
- ✅ API Endpoint Validation
- ✅ UI State Management
- ✅ Browser Refresh Handling
- ✅ Evidence Display
- ✅ Performance Tests
- ✅ Edge Cases
- ✅ Regression Tests
- ✅ Database Integrity

---

## Test Execution Checklist

- [ ] All database migrations applied successfully
- [ ] Environment variables configured correctly
- [ ] Development server running without errors
- [ ] Executed tests 1-20 in order
- [ ] Verified database records after each test
- [ ] Checked browser console for errors
- [ ] Verified UI matches expected states
- [ ] Regression tests pass (existing features work)
- [ ] Performance is acceptable
- [ ] No memory leaks detected

---

## Bug Reporting Template

If you encounter issues during testing, report them using this format:

**Test Number:** [e.g., Test #5]
**Description:** [What went wrong]
**Steps to Reproduce:**
1. [Step 1]
2. [Step 2]
3. [Step 3]

**Expected Behavior:** [What should happen]
**Actual Behavior:** [What actually happened]
**Console Logs:** [Paste relevant logs]
**Database State:** [Result of verification query]
**Screenshots:** [If applicable]

---

## Post-Testing Actions

After completing all tests:

1. Reset AGENT_MAX_ITERATIONS to 35 (if changed)
2. Clear test data from database (optional):
```sql
DELETE FROM tasks WHERE created_at > '[test-start-timestamp]';
```
3. Document any bugs found
4. Update this test plan with any new edge cases discovered
5. Consider adding automated tests for critical paths

---

**Document Version:** 1.0
**Created:** 2025-01-14
**Last Updated:** 2025-01-14
**Author:** Gonzalo Alvarez de Toledo (with Claude Code)
