/**
 * Batch API Test Script
 *
 * Tests the POST /api/tasks/execute endpoint with sample tasks.
 *
 * Usage:
 *   1. Start local dev server: npm run dev
 *   2. Set API_KEY_SECRET in .env.local
 *   3. Run: npx tsx test-batch-api.ts
 *
 * Optional:
 *   - Set WEBHOOK_URL to test webhook notifications (use webhook.site)
 */

import { BatchExecutionRequest, BatchExecutionResponse } from './src/types/batch';

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY_SECRET || 'your-secret-api-key-here';
const WEBHOOK_URL = process.env.WEBHOOK_URL; // Optional: webhook.site URL
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; // Optional: for HMAC verification

// Test scenarios
const TEST_SCENARIOS = {
  // Simple single-task test
  single_task: {
    tasks: [
      {
        message: 'Go to example.com and take a screenshot',
        destroyBrowserOnCompletion: true,
      }
    ]
  },

  // Multi-task test with shared browser
  multi_task_shared_browser: {
    tasks: [
      {
        message: 'Go to example.com and take a screenshot',
        destroyBrowserOnCompletion: false, // Keep browser for next task
      },
      {
        message: 'Now go to wikipedia.org and take a screenshot',
        destroyBrowserOnCompletion: false,
      },
      {
        message: 'Finally go to github.com and take a screenshot',
        destroyBrowserOnCompletion: true, // Destroy after last task
      }
    ]
  },

  // Test with configuration overrides
  with_config_overrides: {
    tasks: [
      {
        message: 'Go to example.com, take a screenshot, and extract all visible text',
        destroyBrowserOnCompletion: true,
        configOverrides: {
          AGENT_MAX_ITERATIONS: 25, // Task-specific limit
          ANTHROPIC_MAX_TOKENS: 8192, // More tokens for extraction
        }
      }
    ],
    globalConfigOverrides: {
      TYPING_DELAY_MS: 50, // Slower typing for all tasks
      SAMPLING_LOOP_DELAY_MS: 200, // More time between iterations
    }
  },

  // Test with webhook notifications
  with_webhook: {
    tasks: [
      {
        message: 'Go to example.com and report completion with screenshot evidence',
        destroyBrowserOnCompletion: true,
      }
    ],
    webhookUrl: WEBHOOK_URL,
    webhookSecret: WEBHOOK_SECRET,
  },
};

/**
 * Execute a test scenario
 */
async function runTest(scenarioName: keyof typeof TEST_SCENARIOS) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🧪 Testing scenario: ${scenarioName}`);
  console.log('='.repeat(60));

  const scenario = TEST_SCENARIOS[scenarioName];

  // Build request body
  const requestBody: BatchExecutionRequest = {
    tasks: scenario.tasks,
    webhookUrl: WEBHOOK_URL,
    webhookSecret: WEBHOOK_SECRET,
    globalConfigOverrides: 'globalConfigOverrides' in scenario ? scenario.globalConfigOverrides : undefined,
  };

  console.log('\n📤 Request:');
  console.log(JSON.stringify(requestBody, null, 2));

  try {
    // Send request
    const response = await fetch(`${API_URL}/api/tasks/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    console.log(`\n📥 Response Status: ${response.status} ${response.statusText}`);

    // Parse response
    const responseData = await response.json();
    console.log('\n📦 Response Body:');
    console.log(JSON.stringify(responseData, null, 2));

    if (response.ok) {
      const batchResponse = responseData as BatchExecutionResponse;
      console.log('\n✅ Batch execution started successfully!');
      console.log(`   Batch ID: ${batchResponse.batchExecutionId}`);
      console.log(`   Session ID: ${batchResponse.sessionId}`);
      console.log(`   Task IDs: ${batchResponse.taskIds.join(', ')}`);
      console.log(`   Status: ${batchResponse.status}`);

      if (WEBHOOK_URL) {
        console.log(`\n📡 Webhook notifications will be sent to:`);
        console.log(`   ${WEBHOOK_URL}`);
        console.log(`   Check your webhook.site URL for status updates!`);
      }

      console.log(`\n💡 Monitor progress:`);
      console.log(`   1. Check database: batch_executions table`);
      console.log(`   2. Check database: tasks table`);
      console.log(`   3. Watch server logs for execution details`);
      if (WEBHOOK_URL) {
        console.log(`   4. Check webhook.site for notifications`);
      }
    } else {
      console.error('\n❌ Request failed!');
      console.error(`   Error: ${responseData.error || 'Unknown error'}`);
    }

  } catch (error: any) {
    console.error('\n❌ Test failed with exception:');
    console.error(`   ${error.message}`);
    console.error('\n📋 Troubleshooting:');
    console.error('   1. Is the dev server running? (npm run dev)');
    console.error('   2. Is API_KEY_SECRET set in .env.local?');
    console.error('   3. Is the API_URL correct?');
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

/**
 * Main test runner
 */
async function main() {
  console.log('🚀 Batch API Test Runner');
  console.log(`   API URL: ${API_URL}`);
  console.log(`   API Key: ${API_KEY.substring(0, 10)}...`);
  if (WEBHOOK_URL) {
    console.log(`   Webhook: ${WEBHOOK_URL}`);
  }

  // Get scenario from command line or use default
  const scenarioArg = process.argv[2] as keyof typeof TEST_SCENARIOS;
  const scenario = scenarioArg || 'single_task';

  if (!TEST_SCENARIOS[scenario]) {
    console.error(`\n❌ Unknown scenario: ${scenario}`);
    console.log('\n📋 Available scenarios:');
    Object.keys(TEST_SCENARIOS).forEach(name => {
      console.log(`   - ${name}`);
    });
    console.log('\nUsage: npx tsx test-batch-api.ts [scenario_name]');
    process.exit(1);
  }

  await runTest(scenario);

  console.log('✅ Test complete!');
}

// Run tests
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
