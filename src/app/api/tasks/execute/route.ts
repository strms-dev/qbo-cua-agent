/**
 * POST /api/tasks/execute - Batch Task Execution API
 *
 * Accepts 1+ tasks for sequential execution with shared browser session.
 * Returns immediately with batch ID while tasks execute in background.
 *
 * Authentication: Requires API_KEY_SECRET in Authorization header
 * Request body: BatchExecutionRequest (see types/batch.ts)
 * Response: 202 Accepted with BatchExecutionResponse
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { BatchExecutor } from '@/lib/batch-executor';
import {
  BatchExecutionRequest,
  BatchExecutionResponse,
  TaskConfig
} from '@/types/batch';

/**
 * API Key authentication middleware
 */
function authenticateRequest(request: NextRequest): boolean {
  const apiKey = request.headers.get('authorization')?.replace('Bearer ', '');
  const validApiKey = process.env.API_KEY_SECRET;

  if (!validApiKey) {
    console.error('⚠️ API_KEY_SECRET not configured in environment');
    return false;
  }

  return apiKey === validApiKey;
}

/**
 * Validate request body matches BatchExecutionRequest schema
 */
function validateRequestBody(body: any): { valid: boolean; error?: string } {
  // Check required fields
  if (!body.tasks || !Array.isArray(body.tasks) || body.tasks.length === 0) {
    return { valid: false, error: 'tasks array is required and must contain at least 1 task' };
  }

  // Validate each task
  for (let i = 0; i < body.tasks.length; i++) {
    const task = body.tasks[i];

    if (!task.message || typeof task.message !== 'string') {
      return { valid: false, error: `tasks[${i}].message is required and must be a string` };
    }

    if (typeof task.destroyBrowserOnCompletion !== 'boolean') {
      return { valid: false, error: `tasks[${i}].destroyBrowserOnCompletion is required and must be a boolean` };
    }

    // configOverrides is optional, but if present must be an object
    if (task.configOverrides !== undefined && typeof task.configOverrides !== 'object') {
      return { valid: false, error: `tasks[${i}].configOverrides must be an object if provided` };
    }
  }

  // Validate optional webhook fields
  if (body.webhookUrl !== undefined && typeof body.webhookUrl !== 'string') {
    return { valid: false, error: 'webhookUrl must be a string if provided' };
  }

  if (body.webhookSecret !== undefined && typeof body.webhookSecret !== 'string') {
    return { valid: false, error: 'webhookSecret must be a string if provided' };
  }

  // Validate optional globalConfigOverrides
  if (body.globalConfigOverrides !== undefined && typeof body.globalConfigOverrides !== 'object') {
    return { valid: false, error: 'globalConfigOverrides must be an object if provided' };
  }

  return { valid: true };
}

/**
 * POST /api/tasks/execute
 * Main endpoint handler
 */
export async function POST(request: NextRequest) {
  console.log('📥 POST /api/tasks/execute - Batch execution request received');

  // 1. Authenticate request
  if (!authenticateRequest(request)) {
    console.error('❌ Authentication failed');
    return NextResponse.json(
      { error: 'Unauthorized - Invalid or missing API key' },
      { status: 401 }
    );
  }

  // 2. Parse and validate request body
  let body: BatchExecutionRequest;
  try {
    body = await request.json();
  } catch (error) {
    console.error('❌ Invalid JSON in request body');
    return NextResponse.json(
      { error: 'Invalid JSON in request body' },
      { status: 400 }
    );
  }

  const validation = validateRequestBody(body);
  if (!validation.valid) {
    console.error('❌ Request validation failed:', validation.error);
    return NextResponse.json(
      { error: validation.error },
      { status: 400 }
    );
  }

  console.log(`✅ Request validated: ${body.tasks.length} tasks`);

  // 3. Create chat session (each batch gets its own session)
  const { data: session, error: sessionError } = await supabase
    .from('chat_sessions')
    .insert({
      status: 'active',
      metadata: { batch_api: true, started_at: new Date().toISOString() }
    })
    .select('id')
    .single();

  if (sessionError || !session) {
    console.error('❌ Failed to create chat session:', sessionError);
    return NextResponse.json(
      { error: 'Failed to create chat session' },
      { status: 500 }
    );
  }

  const sessionId = session.id;
  console.log(`✅ Created chat session: ${sessionId}`);

  // 4. Create batch_executions record
  const { data: batchRecord, error: batchError } = await supabase
    .from('batch_executions')
    .insert({
      session_id: sessionId,
      task_count: body.tasks.length,
      status: 'running',
      started_at: new Date().toISOString(),
      config_overrides: body.globalConfigOverrides || {},
      webhook_url: body.webhookUrl || null,
      webhook_secret: body.webhookSecret || null,
      completed_count: 0,
      failed_count: 0,
    })
    .select('id')
    .single();

  if (batchError || !batchRecord) {
    console.error('❌ Failed to create batch_executions record:', batchError);
    return NextResponse.json(
      { error: 'Failed to create batch execution record' },
      { status: 500 }
    );
  }

  const batchExecutionId = batchRecord.id;
  console.log(`✅ Created batch execution: ${batchExecutionId}`);

  // 5. Create task records for each task
  const taskRecords = body.tasks.map((task: TaskConfig, index: number) => ({
    batch_execution_id: batchExecutionId,
    task_index: index,
    user_message: task.message,
    status: 'queued',
    config_overrides: task.configOverrides || {},
    destroy_browser_on_completion: task.destroyBrowserOnCompletion,
  }));

  const { data: createdTasks, error: tasksError } = await supabase
    .from('tasks')
    .insert(taskRecords)
    .select('id');

  if (tasksError || !createdTasks) {
    console.error('❌ Failed to create task records:', tasksError);

    // Cleanup: mark batch as failed
    await supabase
      .from('batch_executions')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: 'Failed to create task records'
      })
      .eq('id', batchExecutionId);

    return NextResponse.json(
      { error: 'Failed to create task records' },
      { status: 500 }
    );
  }

  const taskIds = createdTasks.map(t => t.id);
  console.log(`✅ Created ${taskIds.length} task records`);

  // 6. Launch BatchExecutor in background (fire and forget)
  const executor = new BatchExecutor({
    batchExecutionId,
    sessionId,
    tasks: body.tasks,
    taskIds,
    globalConfig: body.globalConfigOverrides || {},
    webhookUrl: body.webhookUrl,
    webhookSecret: body.webhookSecret,
  });

  // Execute in background - don't await (fire and forget)
  executor.execute().catch(error => {
    console.error(`❌ BatchExecutor failed for batch ${batchExecutionId}:`, error);
  });

  console.log(`🚀 BatchExecutor launched in background for batch: ${batchExecutionId}`);

  // 7. Return immediate response (202 Accepted)
  const response: BatchExecutionResponse = {
    batchExecutionId,
    sessionId,
    browserSessionId: 'pending', // Browser created by executor, not yet available
    taskIds,
    status: 'running',
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(response, { status: 202 });
}
