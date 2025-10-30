/**
 * Webhook Utilities
 *
 * Handles webhook delivery for batch task execution status updates.
 * Sends HTTP POST requests with optional HMAC signature verification.
 */

import crypto from 'crypto';
import { WebhookPayload } from '@/types/batch';

/**
 * Sends a webhook notification to the configured URL
 *
 * Features:
 * - HMAC SHA-256 signature for verification (if secret provided)
 * - 10 second timeout
 * - Graceful error handling (logs but doesn't throw)
 * - Per requirement: webhook failures don't stop task execution
 *
 * @param webhookUrl - The URL to POST the webhook to
 * @param payload - The webhook payload (typically WebhookPayload)
 * @param webhookSecret - Optional secret for HMAC signature
 */
export async function sendWebhook(
  webhookUrl: string,
  payload: WebhookPayload | any,
  webhookSecret?: string
): Promise<void> {
  try {
    const body = JSON.stringify(payload);

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'QBO-CUA-Agent/1.0',
      'X-Webhook-Timestamp': new Date().toISOString()
    };

    // Add HMAC signature if secret provided
    if (webhookSecret) {
      const signature = generateHmacSignature(body, webhookSecret);
      headers['X-Webhook-Signature'] = `sha256=${signature}`;
      console.log('🔐 Added HMAC signature to webhook');
    }

    console.log('📤 Sending webhook to:', webhookUrl);
    console.log('📦 Webhook payload type:', payload.type);

    // Send webhook with 10 second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // Check response status
    if (!response.ok) {
      console.warn(`⚠️  Webhook returned ${response.status}: ${response.statusText}`);
      const responseText = await response.text().catch(() => '');
      if (responseText) {
        console.warn(`⚠️  Response body: ${responseText.substring(0, 200)}`);
      }
    } else {
      console.log('✅ Webhook delivered successfully');
    }
  } catch (error: any) {
    // Log error but don't throw - task execution should continue
    if (error.name === 'AbortError') {
      console.error('❌ Webhook delivery timeout (10s exceeded)');
    } else if (error.code === 'ENOTFOUND') {
      console.error('❌ Webhook delivery failed: DNS lookup failed for', webhookUrl);
    } else if (error.code === 'ECONNREFUSED') {
      console.error('❌ Webhook delivery failed: Connection refused');
    } else {
      console.error('❌ Webhook delivery failed:', error.message);
    }

    // Don't throw - per requirement #6, continue task execution on webhook failure
  }
}

/**
 * Generates HMAC SHA-256 signature for webhook verification
 *
 * The signature can be verified by the webhook receiver:
 * ```typescript
 * const receivedSignature = request.headers['x-webhook-signature'].replace('sha256=', '');
 * const computedSignature = generateHmacSignature(requestBody, secret);
 * const isValid = receivedSignature === computedSignature;
 * ```
 *
 * @param payload - The JSON string payload to sign
 * @param secret - The shared secret key
 * @returns Hex-encoded HMAC signature
 */
export function generateHmacSignature(payload: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

/**
 * Validates HMAC signature from webhook request
 *
 * Used by webhook receivers to verify the webhook came from an authorized sender.
 *
 * @param payload - The raw request body as string
 * @param signature - The signature from X-Webhook-Signature header (without 'sha256=' prefix)
 * @param secret - The shared secret key
 * @returns true if signature is valid
 */
export function validateHmacSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const computedSignature = generateHmacSignature(payload, secret);

  // Constant-time comparison to prevent timing attacks
  if (signature.length !== computedSignature.length) {
    return false;
  }

  let isValid = true;
  for (let i = 0; i < signature.length; i++) {
    if (signature[i] !== computedSignature[i]) {
      isValid = false;
    }
  }

  return isValid;
}
