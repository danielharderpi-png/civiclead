import type { LeadRecord } from '../src/shared/types.ts';

function escapeCsv(val: string): string {
  const str = String(val ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildBatchCsv(leads: LeadRecord[]): string {
  const headers = [
    'id',
    'domain',
    'companyName',
    'tradeSpecialty',
    'primaryContactName',
    'recommendedEmail',
    'status',
    'threadStrategy',
    'threadId',
    'inReplyToMessageId',
    'civicTrigger',
    'subjectLine',
    'plainTextBody',
    'gmailDraftId',
  ];
  const rows = leads.map((lead) =>
    [
      lead.id,
      lead.domain,
      lead.companyName,
      lead.tradeSpecialty,
      lead.primaryContactName,
      lead.recommendedEmail,
      lead.status,
      lead.threadStrategy,
      lead.threadId,
      lead.inReplyToMessageId,
      lead.civicTrigger,
      lead.subjectLine,
      lead.plainTextBody,
      lead.gmailDraftId || '',
    ]
      .map(escapeCsv)
      .join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

export function buildBatchPlainText(leads: LeadRecord[]): string {
  if (leads.length === 0) {
    return 'No matching leads found for the selected export scope.';
  }

  return leads
    .map((lead, idx) => {
      const contact = lead.primaryContactName || 'Primary Contact';
      const email = lead.recommendedEmail || '(no email)';
      const subject = lead.subjectLine || '(no subject)';
      const body = lead.plainTextBody || '(no draft body yet)';
      return [
        `[${idx + 1}] ${lead.companyName || lead.domain} (${lead.domain})`,
        `To: ${contact} <${email}>`,
        `Status: ${lead.status}`,
        `Subject: ${subject}`,
        '',
        body,
      ].join('\n');
    })
    .join('\n\n------------------------------------------------------------------------\n\n');
}
