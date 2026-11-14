import { useMemo, useState } from 'react';
import { Check, Copy, FileJson, Upload, X } from 'lucide-react';
import { buildBatchPrompt } from '../shared/guardrails.ts';
import type { LeadRecord, ProductProfile } from '../shared/types.ts';

interface ManualBatchModalProps {
  open: boolean;
  onClose: () => void;
  leads: LeadRecord[];
  profile: ProductProfile;
  onImportSuccess: (leads: LeadRecord[], count: number) => void;
}

export function ManualBatchModal({
  open,
  onClose,
  leads,
  profile,
  onImportSuccess,
}: ManualBatchModalProps) {
  const [activePane, setActivePane] = useState<'prompt' | 'import'>('prompt');
  const [copied, setCopied] = useState(false);
  const [rawJson, setRawJson] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const promptText = useMemo(() => buildBatchPrompt(leads, profile), [leads, profile]);

  if (!open) return null;

  const handleCopyPrompt = async () => {
    await navigator.clipboard.writeText(promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleImport = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/enrich/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawJson }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Import failed');
      }
      onImportSuccess(data.leads, data.importedCount);
      setRawJson('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not parse JSON array');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-batch-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col border border-[#323947] bg-[#13161b]">
        <div className="flex items-center justify-between border-b border-[#232832] px-6 py-4">
          <div>
            <h2 id="manual-batch-title" className="text-base font-semibold text-[#e6e9ef]">
              Manual Batch Extraction ($0.00 API Cost)
            </h2>
            <p className="mt-0.5 text-xs text-[#9aa3b2]">
              Copy the raw crawl prompt into any external AI chat window, then paste the returned JSON array below.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-[#232832] p-2 text-[#9aa3b2] transition-colors hover:border-[#323947] hover:text-[#e6e9ef]"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-[#232832] bg-[#0d0f12] px-6 py-2.5">
          <button
            type="button"
            onClick={() => setActivePane('prompt')}
            className={`whitespace-nowrap px-3 py-1.5 text-xs font-medium transition-colors ${
              activePane === 'prompt'
                ? 'bg-[#171b21] text-[#f59e0b] border border-[#323947]'
                : 'text-[#9aa3b2] hover:text-[#e6e9ef]'
            }`}
          >
            1. Export Raw Crawl Prompt ({leads.length} targets)
          </button>
          <button
            type="button"
            onClick={() => setActivePane('import')}
            className={`whitespace-nowrap px-3 py-1.5 text-xs font-medium transition-colors ${
              activePane === 'import'
                ? 'bg-[#171b21] text-[#38bdf8] border border-[#323947]'
                : 'text-[#9aa3b2] hover:text-[#e6e9ef]'
            }`}
          >
            2. Import Enriched JSON
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {activePane === 'prompt' ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-mono text-xs text-[#9aa3b2]">
                  {leads.length} crawled {leads.length === 1 ? 'target' : 'targets'} ·{' '}
                  {promptText.length.toLocaleString()} chars · Zero API calls
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyPrompt}
                    className="inline-flex items-center gap-2 bg-[#f59e0b] px-4 py-2 text-xs font-semibold text-[#0d0f12] transition-colors hover:bg-[#fbbf24] whitespace-nowrap"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? 'Copied Prompt' : 'Copy Raw Crawl Prompt'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePane('import')}
                    className="inline-flex items-center gap-2 border border-[#323947] bg-[#171b21] px-4 py-2 text-xs font-medium text-[#e6e9ef] transition-colors hover:border-[#38bdf8] whitespace-nowrap"
                  >
                    Next: Paste JSON
                  </button>
                </div>
              </div>
              <textarea
                readOnly
                value={promptText}
                rows={16}
                className="w-full border border-[#232832] bg-[#0d0f12] p-4 font-mono text-xs leading-relaxed text-[#cbd5e1] focus:border-[#f59e0b] focus:outline-none"
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-[#9aa3b2]">
                  Paste the JSON array output from your chat session (markdown code fences are stripped automatically).
                </span>
              </div>

              <textarea
                value={rawJson}
                onChange={(e) => setRawJson(e.target.value)}
                rows={14}
                placeholder='[{"domain": "companydomain.com", "companyName": "...", "subjectLine": "...", "plainTextBody": "..."}]'
                className="w-full border border-[#232832] bg-[#0d0f12] p-4 font-mono text-xs leading-relaxed text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#38bdf8] focus:outline-none"
              />

              {error && (
                <div className="border border-red-500/40 bg-red-950/30 px-4 py-2.5 text-xs text-red-300">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="border border-[#232832] px-4 py-2 text-xs font-medium text-[#9aa3b2] hover:text-[#e6e9ef]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submitting || !rawJson.trim()}
                  onClick={handleImport}
                  className="inline-flex items-center gap-2 bg-[#f59e0b] px-4 py-2 text-xs font-semibold text-[#0d0f12] transition-colors hover:bg-[#fbbf24] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {submitting ? 'Validating & Importing...' : 'Import Enriched JSON to Queue'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
