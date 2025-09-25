# QBO CUA Agent

An AI-powered agent for performing bookkeeping tasks in QuickBooks Online using Anthropic's Computer Use API, with human-in-the-loop approval for critical actions.

## Features

- 🤖 **AI-powered automation** using Claude's computer use capabilities
- 🖥️ **Split-panel UI** showing chat on left, live browser session on right
- 🛡️ **Risk assessment** with AI vision analysis of high-risk buttons
- ✋ **Human approval workflow** for critical actions (Save, Post, Delete, etc.)
- 📊 **Audit trail** storing all actions, screenshots, and chat history
- 🔄 **Session management** with pause/resume functionality
- 🏦 **QBO-focused** designed specifically for bookkeeping tasks

## Architecture

```
Frontend (Next.js) ↔ Vercel AI SDK ↔ Anthropic Claude
                ↓
            Scrapybara Browser Sessions
                ↓
          GoToHuman Approvals
                ↓
        Supabase (Database + Storage)
```

## Tech Stack

- **Frontend**: Next.js 15, React, TypeScript, Tailwind CSS
- **AI**: Anthropic Claude via Vercel AI SDK
- **Browser Automation**: Scrapybara API
- **Database**: Supabase (PostgreSQL)
- **Human Approval**: GoToHuman API
- **Icons**: Lucide React

## Setup Instructions

### 1. Clone and Install

```bash
git clone <repository-url>
cd qbo-cua-agent
npm install
```

### 2. Set up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the schema from `supabase/schema.sql`
3. Get your project URL and anon key from **Settings > API**

### 3. Set up API Keys

Create a `.env.local` file with the following:

```bash
# Anthropic API Key
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Supabase Configuration
SUPABASE_URL=your_supabase_project_url_here
SUPABASE_ANON_KEY=your_supabase_anon_key_here

# Scrapybara API Configuration
SCRAPYBARA_API_KEY=your_scrapybara_api_key_here
SCRAPYBARA_BASE_URL=https://api.scrapybara.com

# GoToHuman Configuration
GOTOHUMAN_API_KEY=your_gotohuman_api_key_here
GOTOHUMAN_BASE_URL=https://api.gotohuman.com

# Next.js Configuration
NEXTAUTH_SECRET=your_nextauth_secret_here
NEXTAUTH_URL=http://localhost:3000
```

### 4. API Key Setup Guide

#### Anthropic API
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an API key with Claude access
3. Add to `ANTHROPIC_API_KEY`

#### Scrapybara API
1. Sign up at [scrapybara.com](https://scrapybara.com)
2. Get API key from dashboard
3. Add to `SCRAPYBARA_API_KEY`

#### GoToHuman API
1. Sign up at [gotohuman.com](https://gotohuman.com)
2. Create an approval form called "qbo-action-approval" with fields:
   - `action_description` (text)
   - `screenshot` (image)
   - `risk_assessment` (textarea)
   - `approval_decision` (select: approve/deny)
3. Get API key and add to `GOTOHUMAN_API_KEY`

### 5. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the application.

## Usage

1. **Start a conversation** - Type a bookkeeping request in the chat
2. **Browser session creation** - A Scrapybara browser session is automatically created
3. **AI actions** - Claude takes screenshots and performs actions based on your request
4. **Risk assessment** - High-risk actions trigger AI vision analysis
5. **Human approval** - Critical actions pause for human review via GoToHuman
6. **Audit trail** - All actions and decisions are logged in Supabase

### Example Prompts

- "Help me create a new invoice for customer ABC Corp"
- "Navigate to the reconcile page and help me match transactions"
- "Generate a profit & loss report for last month"
- "Add a new expense transaction for $500 office supplies"

## Safety Features

- **Risk Assessment**: AI analyzes screenshots before high-risk clicks
- **Human Approval**: Pause execution for human review of critical actions
- **Audit Logging**: Complete trail of all actions and decisions
- **Session Control**: Pause/resume browser sessions at any time
- **Isolated Environment**: Browser sessions run in Scrapybara's secure environment

## Database Schema

The application uses the following main tables:

- `chat_sessions` - Chat session metadata
- `messages` - Conversation history
- `computer_actions` - All AI actions with risk levels
- `approval_requests` - Human approval workflows
- `browser_sessions` - Scrapybara session tracking

See `supabase/schema.sql` for complete schema.

## Development

### Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── chat/           # Main chat API with AI tools
│   │   └── browser/        # Browser session management
│   └── page.tsx           # Main application page
├── components/
│   ├── QBOAgent.tsx       # Main app component
│   ├── ChatPanel.tsx      # Left panel - chat interface
│   └── BrowserPanel.tsx   # Right panel - browser view
├── lib/
│   ├── supabase.ts        # Supabase client
│   ├── scrapybara.ts      # Scrapybara API client
│   ├── gotohuman.ts       # GoToHuman API client
│   └── risk-assessment.ts # AI risk assessment logic
└── types/
    └── index.ts           # TypeScript interfaces
```

### Adding New Features

1. **New AI Tools**: Add to `src/app/api/chat/route.ts` tools object
2. **Risk Patterns**: Update `HIGH_RISK_PATTERNS` in `lib/risk-assessment.ts`
3. **UI Components**: Create in `src/components/`
4. **Database Changes**: Update `supabase/schema.sql`

## Deployment

### Vercel Deployment

1. Push to GitHub
2. Import to Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

### Environment Variables for Production

Update the following for production:
- `NEXTAUTH_URL` - Your production domain
- All API keys should be production keys
- Supabase should be production project

## Troubleshooting

### Common Issues

1. **API Key Errors**: Verify all API keys are correct and have proper permissions
2. **Supabase Connection**: Check URL and anon key, ensure schema is applied
3. **Scrapybara Sessions**: Sessions timeout after 1 hour by default
4. **Risk Assessment**: Requires Claude 3.5 Sonnet for vision capabilities

### Logs

- Browser console for frontend issues
- Vercel Function logs for API issues
- Supabase logs for database issues

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Security Note

This application is designed for legitimate bookkeeping automation. Always:
- Use in controlled environments
- Implement proper access controls
- Review all high-risk actions
- Maintain audit trails
- Follow your organization's security policies
