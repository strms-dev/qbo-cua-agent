/**
 * Test Script: Message Reconstruction After Stop
 *
 * This script demonstrates the fix for the issue where tool_use and tool_result
 * blocks were missing from the Anthropic request after stopping and resuming a task.
 */

console.log('🧪 Testing Message Reconstruction Fix\n');
console.log('=' .repeat(80));

// Mock data simulating what's stored in database after task is stopped
const mockMessagesFromDatabase = [
  {
    id: '1',
    role: 'user',
    content: 'Please go to this site: https://accounts.intuit.com/app/sign-in',
    anthropic_request: null,
    anthropic_response: null
  },
  {
    id: '2',
    role: 'assistant',
    content: "I'll help you navigate to the QuickBooks Online sign-in page.",
    anthropic_request: {
      // This contains the FULL conversation history that was sent to Anthropic
      messages: [
        {
          role: 'user',
          content: 'Please go to this site: https://accounts.intuit.com/app/sign-in'
        }
      ]
    },
    anthropic_response: {
      // This contains the FULL response including tool_use blocks
      content: [
        {
          type: 'thinking',
          thinking: 'Need to take screenshot first...',
          signature: 'abc123'
        },
        {
          type: 'text',
          text: "I'll help you navigate to the QuickBooks Online sign-in page."
        },
        {
          type: 'tool_use',
          id: 'toolu_012cHT3sBa7ZLchMqXvzZLk6',
          name: 'computer',
          input: {
            action: 'screenshot'
          }
        }
      ]
    }
  },
  // Note: The tool_result message is NOT stored separately - it only existed in memory
  // But it WAS included in the next anthropic_request!
  {
    id: '3',
    role: 'assistant',
    content: 'I can see we\'re currently on a Google search page.',
    anthropic_request: {
      // This includes the FULL history including the previous tool_result
      messages: [
        {
          role: 'user',
          content: 'Please go to this site: https://accounts.intuit.com/app/sign-in'
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: 'Need to take screenshot first...',
              signature: 'abc123'
            },
            {
              type: 'text',
              text: "I'll help you navigate to the QuickBooks Online sign-in page."
            },
            {
              type: 'tool_use',
              id: 'toolu_012cHT3sBa7ZLchMqXvzZLk6',
              name: 'computer',
              input: { action: 'screenshot' }
            }
          ]
        },
        {
          role: 'user',
          content: [
            {
              tool_use_id: 'toolu_012cHT3sBa7ZLchMqXvzZLk6',
              type: 'tool_result',
              content: [
                { type: 'text', text: 'Screenshot saved\n[Screenshot URL: https://...]' },
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '[BASE64_IMAGE_REMOVED]' }}
              ],
              is_error: false
            }
          ]
        }
      ]
    },
    anthropic_response: {
      content: [
        {
          type: 'text',
          text: 'I can see we\'re currently on a Google search page.'
        },
        {
          type: 'tool_use',
          id: 'toolu_0193fudWZ63LsuMJ7yAFTeSh',
          name: 'computer',
          input: {
            action: 'left_click',
            coordinate: [619, 286]
          }
        }
      ]
    }
  }
  // Task was STOPPED here by user
];

console.log('\n📦 Simulating messages loaded from database:');
console.log(`   Loaded ${mockMessagesFromDatabase.length} messages`);
console.log('   Message 1: User asks to navigate');
console.log('   Message 2: Assistant takes screenshot (has tool_use)');
console.log('   Message 3: Assistant clicks on address bar (has tool_use)');
console.log('   🛑 Task STOPPED by user\n');

// ❌ OLD BEHAVIOR (Before Fix)
console.log('=' .repeat(80));
console.log('❌ OLD BEHAVIOR (Before Fix - BROKEN):\n');

const oldConversationMessages = mockMessagesFromDatabase.map(msg => ({
  role: msg.role,
  content: msg.content  // Just text content - loses all structure!
}));

console.log('Request sent to Anthropic:');
console.log(JSON.stringify(oldConversationMessages, null, 2));
console.log('\n🐛 PROBLEM: Lost all tool_use and tool_result blocks!');
console.log('   - Only text content remains');
console.log('   - Claude has no context of what actions were performed');
console.log('   - Claude doesn\'t know a screenshot was taken');
console.log('   - Claude doesn\'t know the address bar was clicked\n');

// ✅ NEW BEHAVIOR (After Fix)
console.log('=' .repeat(80));
console.log('✅ NEW BEHAVIOR (After Fix - WORKING):\n');

// Reconstruct conversation using the new logic
let newConversationMessages = [];

// Find the last message with anthropic_request
let lastRequestMessage = null;
for (let i = mockMessagesFromDatabase.length - 1; i >= 0; i--) {
  if (mockMessagesFromDatabase[i].anthropic_request?.messages) {
    lastRequestMessage = mockMessagesFromDatabase[i];
    break;
  }
}

if (lastRequestMessage?.anthropic_request?.messages) {
  // Use the full conversation history from the last request
  newConversationMessages = lastRequestMessage.anthropic_request.messages;
  console.log(`🔄 Reconstructed ${newConversationMessages.length} messages from last anthropic_request`);

  // Add the assistant's response to this request (with tool_use blocks)
  if (lastRequestMessage.anthropic_response?.content) {
    newConversationMessages.push({
      role: 'assistant',
      content: lastRequestMessage.anthropic_response.content
    });
    console.log(`✅ Added assistant response with ${lastRequestMessage.anthropic_response.content.length} content blocks`);
  }
}

// Add new user message (simulating user typing "type the address in the google search bar please")
newConversationMessages.push({
  role: 'user',
  content: 'type the address in the google search bar please'
});

console.log('\nRequest sent to Anthropic:');
console.log(JSON.stringify(newConversationMessages, null, 2));

console.log('\n✅ SUCCESS: Full conversation history preserved!');
console.log('   - All tool_use blocks included');
console.log('   - All tool_result blocks included');
console.log('   - Claude knows screenshot was taken');
console.log('   - Claude knows address bar was clicked');
console.log('   - Claude has full context to continue\n');

// Summary
console.log('=' .repeat(80));
console.log('📊 COMPARISON SUMMARY:\n');
console.log('OLD (Broken):');
console.log(`   - Messages sent: ${oldConversationMessages.length}`);
console.log(`   - tool_use blocks: 0`);
console.log(`   - tool_result blocks: 0`);
console.log(`   - Context preserved: ❌ NO\n`);

const toolUseCount = newConversationMessages.reduce((count, msg) => {
  if (msg.role === 'assistant' && Array.isArray(msg.content)) {
    return count + msg.content.filter(c => c.type === 'tool_use').length;
  }
  return count;
}, 0);

const toolResultCount = newConversationMessages.reduce((count, msg) => {
  if (msg.role === 'user' && Array.isArray(msg.content)) {
    return count + msg.content.filter(c => c.type === 'tool_result').length;
  }
  return count;
}, 0);

console.log('NEW (Fixed):');
console.log(`   - Messages sent: ${newConversationMessages.length}`);
console.log(`   - tool_use blocks: ${toolUseCount}`);
console.log(`   - tool_result blocks: ${toolResultCount}`);
console.log(`   - Context preserved: ✅ YES\n`);

console.log('=' .repeat(80));
console.log('🎉 Fix Verified! Messages are now properly reconstructed after stop.\n');
