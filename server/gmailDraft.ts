import crypto from 'node:crypto';
import type { DraftLogEntry, LeadRecord, ProductProfile } from '../src/shared/types.ts';

export interface Rfc2822DraftResult {
  rfc2822Raw: string;
  base64UrlRaw: string;
  gmailPayload: {
    message: {
      raw: string;
      threadId?: string;
    };
  };
  logEntry: DraftLogEntry;
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export function buildRfc2822PlainTextDraft(
  lead: LeadRecord,
  profile: ProductProfile
): Rfc2822DraftResult {
  const toEmail = sanitizeHeaderValue(lead.recommendedEmail || lead.discoveredEmails[0]?.email || '');
  if (!toEmail) {
    throw new Error(`No recipient email selected for ${lead.domain}.`);
  }

  const fromHeader = `${sanitizeHeaderValue(profile.senderName)} <${sanitizeHeaderValue(profile.senderEmail)}>`;
  const subjectHeader = sanitizeHeaderValue(lead.subjectLine);
  const cleanBody = lead.plainTextBody.replace(/\r?\n/g, '\r\n').trim();

  const headers: string[] = [
    `From: ${fromHeader}`,
    `To: ${toEmail}`,
    `Subject: ${subjectHeader}`,
  ];

  const isReply = lead.threadStrategy === 'reply_existing' && Boolean(lead.threadId.trim());
  if (isReply && lead.inReplyToMessageId.trim()) {
    const msgId = sanitizeHeaderValue(lead.inReplyToMessageId);
    headers.push(`In-Reply-To: ${msgId}`);
    headers.push(`References: ${msgId}`);
  }

  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push('Content-Transfer-Encoding: 7bit');

  const rfc2822Raw = `${headers.join('\r\n')}\r\n\r\n${cleanBody}\r\n`;
  const base64UrlRaw = Buffer.from(rfc2822Raw, 'utf8').toString('base64url');

  const gmailPayload: Rfc2822DraftResult['gmailPayload'] = {
    message: {
      raw: base64UrlRaw,
      ...(isReply ? { threadId: lead.threadId.trim() } : {}),
    },
  };

  const draftId = `draft_${crypto.randomBytes(6).toString('hex')}`;
  const logEntry: DraftLogEntry = {
    id: crypto.randomUUID(),
    leadId: lead.id,
    email: toEmail,
    threadId: isReply ? lead.threadId.trim() : '',
    gmailDraftId: draftId,
    mode: 'simulated_preview',
    rfc2822Raw,
    createdAt: new Date().toISOString(),
  };

  return {
    rfc2822Raw,
    base64UrlRaw,
    gmailPayload,
    logEntry,
  };
}
