import { AlertTriangle, CheckCircle2, Mail, X } from 'lucide-react';
import type { DeliverabilityReport } from '../shared/guardrails.ts';
import type { LeadRecord, ProductProfile } from '../shared/types.ts';

interface DraftConfirmModalProps {
  open: boolean;
  lead: LeadRecord | null;
  profile: ProductProfile;
  report: DeliverabilityReport | null;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DraftConfirmModal({
  open,
  lead,
  profile,
  report,
  submitting,
  onCancel,
  onConfirm,
}: DraftConfirmModalProps) {
  if (!open || !lead || !report) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-draft-title"
    >
      <div className="w-full max-w-xl border border-[#323947] bg-[#13161b]">
        <div className="flex items-center justify-between border-b border-[#232832] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Mail className="h-4 w-4 text-[#f59e0b]" />
            <h2 id="confirm-draft-title" className="text-base font-semibold text-[#e6e9ef]">
              Confirm RFC 2822 Plain-Text Draft Staging
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="border border-[#232832] p-1.5 text-[#9aa3b2] hover:text-[#e6e9ef]"
            aria-label="Cancel draft staging"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-6 text-xs">
          <div className="grid grid-cols-[110px_1fr] gap-y-2 border border-[#232832] bg-[#0d0f12] p-4 font-mono">
            <span className="text-[#697386]">From:</span>
            <span className="text-[#e6e9ef]">
              {profile.senderName} &lt;{profile.senderEmail}&gt;
            </span>
            <span className="text-[#697386]">To:</span>
            <span className="text-[#38bdf8]">{lead.recommendedEmail}</span>
            <span className="text-[#697386]">Subject:</span>
            <span className="text-[#e6e9ef]">{lead.subjectLine}</span>
            <span className="text-[#697386]">MIME:</span>
            <span className="text-[#e6e9ef]">text/plain; charset="UTF-8" (0 HTML)</span>
          </div>

          {report.passed ? (
            <div className="flex items-center gap-2 border border-emerald-500/30 bg-emerald-950/20 px-3.5 py-2.5 text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                All deliverability guardrails passed ({report.wordCount} words · {report.linkCount} bare URL).
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2 border border-amber-500/40 bg-amber-950/25 px-3.5 py-2.5 text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#f59e0b]" />
              <span>
                Guardrail warnings active. Review the flagged items before proceeding or export.
              </span>
            </div>
          )}

          <p className="text-[#9aa3b2] leading-relaxed">
            Staging creates the base64url RFC 2822 payload locally in SQLite and marks this lead{' '}
            <span className="font-mono text-[#e6e9ef]">Staged</span> in your Outreach Queue.
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[#232832] px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="border border-[#232832] px-4 py-2 text-xs font-medium text-[#9aa3b2] hover:text-[#e6e9ef]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || !report.passed}
            onClick={onConfirm}
            className="bg-[#f59e0b] px-4 py-2 text-xs font-semibold text-[#0d0f12] transition-colors hover:bg-[#fbbf24] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Staging Draft...' : 'Stage RFC 2822 Draft'}
          </button>
        </div>
      </div>
    </div>
  );
}
