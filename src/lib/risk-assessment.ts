import { anthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { z } from 'zod';

const RiskAssessmentSchema = z.object({
  riskLevel: z.enum(['low', 'medium', 'high']),
  requiresApproval: z.boolean(),
  reasoning: z.string(),
  detectedElements: z.array(z.string()),
  actionDescription: z.string(),
});

export async function assessActionRisk(
  screenshotBase64: string,
  plannedAction: {
    action: string;
    coordinate?: [number, number];
    text?: string;
  }
): Promise<z.infer<typeof RiskAssessmentSchema>> {
  const result = await generateObject({
    model: anthropic('claude-3-5-sonnet-20241022'),
    schema: RiskAssessmentSchema,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analyze this screenshot and assess the risk level of the planned action: ${JSON.stringify(plannedAction)}

            Look for high-risk buttons and elements such as:
            - Save, Submit, Post, Publish buttons
            - Delete, Remove, Cancel buttons
            - Payment or financial transaction buttons
            - Settings or configuration changes
            - Irreversible actions

            Consider the context of QuickBooks Online bookkeeping tasks.

            Return:
            - riskLevel: low/medium/high
            - requiresApproval: true if human approval needed
            - reasoning: explanation of the risk assessment
            - detectedElements: list of UI elements detected near the action
            - actionDescription: human-readable description of what the action will do`,
          },
          {
            type: 'image',
            image: screenshotBase64,
          },
        ],
      },
    ],
  });

  return result.object;
}

// High-risk button patterns for QBO
export const HIGH_RISK_PATTERNS = [
  /save/i,
  /submit/i,
  /post/i,
  /publish/i,
  /delete/i,
  /remove/i,
  /cancel/i,
  /void/i,
  /process payment/i,
  /send/i,
  /approve/i,
  /reject/i,
  /finalize/i,
  /complete/i,
];

export function containsHighRiskKeywords(text: string): boolean {
  return HIGH_RISK_PATTERNS.some(pattern => pattern.test(text));
}