# Integration Test Guide: Message Reconstruction Fix

## Quick Summary

The fix has been implemented and verified with mock data. Here's how to test it live:

---

## Automated Test (Already Completed ✅)

We ran `test-message-reconstruction.js` which demonstrated:

**Before Fix:**
- ❌ 3 simple text messages
- ❌ 0 tool_use blocks
- ❌ 0 tool_result blocks

**After Fix:**
- ✅ 5 properly structured messages
- ✅ 2 tool_use blocks
- ✅ 1 tool_result block

**Test Status:** PASSED ✅

---

## Manual Integration Test (For You to Run)

### Prerequisites
- Dev server running (`npm run dev`)
- Anthropic API key configured
- OnKernel API key configured

### Step-by-Step Test

#### 1. Start a Task
Open http://localhost:3000 in your browser and enter:
```
Navigate to https://www.google.com
```

#### 2. Wait for Tool Executions
Watch the console for logs like:
```
🔄 Sampling Loop Iteration 1/35
🔧 Executing tool: computer (toolu_...)
📸 Taking screenshot...
✅ Tool completed
```

Wait until you see at least 2-3 tool executions.

#### 3. Stop the Task
Click the red "Stop" button in the UI.

You should see:
```
🛑 Stopping task: [task-id]
✅ Task stopped successfully
```

#### 4. Resume with New Message
Type a new message:
```
continue please
```

#### 5. Check Server Console for Verification

**🔍 CRITICAL VERIFICATION POINTS:**

Look for these NEW logs (added by the fix):
```
🔄 Reconstructed X messages from last anthropic_request
✅ Added assistant response with Y content blocks
```

If you see these logs → **Fix is working!** ✅

If you DON'T see these logs → Something went wrong ❌

#### 6. Verify Claude's Behavior

After resume, Claude should:
- ✅ Reference previous actions ("I already took a screenshot...")
- ✅ NOT repeat already-performed actions
- ✅ Continue from where it stopped

---

## Database Verification (Optional)

### Check that messages have anthropic_request/response populated:

```sql
SELECT
  m.id,
  m.role,
  m.anthropic_request IS NOT NULL as has_request,
  m.anthropic_response IS NOT NULL as has_response,
  CASE
    WHEN m.anthropic_response IS NOT NULL
    THEN jsonb_array_length(m.anthropic_response->'content')
    ELSE NULL
  END as content_blocks
FROM messages m
WHERE m.task_id = '[your-task-id]'
ORDER BY m.created_at;
```

**Expected:**
- User messages: `has_request = false`, `has_response = false`
- Assistant messages: `has_request = true`, `has_response = true`
- Content blocks > 1 (includes text + tool_use blocks)

### Check reconstructed conversation:

```sql
SELECT
  anthropic_request->'messages' as full_conversation
FROM messages
WHERE task_id = '[your-task-id]'
  AND anthropic_request IS NOT NULL
ORDER BY created_at DESC
LIMIT 1;
```

This shows the FULL conversation history that will be sent to Anthropic on resume.

---

## What the Fix Does

### Code Changes Made:

1. **Sessions Endpoint** (`src/app/api/sessions/[sessionId]/route.ts:29-30`)
   - Added `anthropic_request` and `anthropic_response` to query

2. **Frontend** (`src/components/ChatPanel.tsx:70-71`)
   - Preserved Anthropic data when loading messages

3. **Chat Route** (`src/app/api/chat/route.ts:1430-1480`) **← MAIN FIX**
   - Reconstructs full conversation from `anthropic_request`
   - Includes all tool_use and tool_result blocks

### How It Works:

```
1. Agent executes → Stores full request/response in DB
                     ↓
2. User stops task → Task status = 'stopped'
                     ↓
3. Load messages   → Includes anthropic_request/response
                     ↓
4. Resume task     → Reconstructs from anthropic_request
                     ↓
5. Send to Claude  → Full context with all tool blocks ✅
```

---

## Troubleshooting

### Issue: No reconstruction logs appear

**Cause:** Messages don't have `anthropic_request` populated

**Fix:**
- Check database query results
- Ensure task ran long enough to save at least one assistant message
- Verify migrations are applied

### Issue: Claude repeats actions

**Cause:** Fix not working, tool blocks not reconstructed

**Fix:**
- Check server console for errors
- Verify code changes are deployed
- Check that `anthropic_request` contains `messages` array

### Issue: Error about malformed messages

**Cause:** Message structure incompatible

**Fix:**
- Check Anthropic API version (should be `computer-use-2025-01-24`)
- Verify message content is arrays, not strings

---

## Success Criteria Checklist

- [ ] ✅ Reconstruction logs appear in console
- [ ] ✅ Request payload includes tool_use blocks
- [ ] ✅ Request payload includes tool_result blocks
- [ ] ✅ Claude references previous actions
- [ ] ✅ Claude doesn't repeat actions
- [ ] ✅ Task completes successfully
- [ ] ✅ No errors in console

---

## Test Status Summary

| Test Type | Status | Evidence |
|-----------|--------|----------|
| Mock Data Test | ✅ PASSED | `test-message-reconstruction.js` output |
| Code Review | ✅ PASSED | 3 files changed correctly |
| TypeScript Compilation | ✅ PASSED | No errors |
| Dev Server | ✅ PASSED | Runs without issues |
| Live Integration | ⏸️ PENDING | Requires your manual testing |

---

## Conclusion

The fix is **implemented and verified** through:
1. ✅ Code analysis
2. ✅ Mock data testing
3. ✅ Compilation checks

**Ready for live testing whenever you have time!**

The fix ensures that when you stop a task and send a new message, Claude will have complete context of all previous actions, eliminating the issue shown in your screenshot.

---

**Next Steps:**
1. Run the manual integration test above
2. If everything works, close this issue
3. If issues occur, check troubleshooting section

**Estimated Test Time:** 5-10 minutes
