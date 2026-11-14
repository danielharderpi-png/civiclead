import { useEffect, useState } from 'react';
import { Check, Copy, Download, FileJson, FileSpreadsheet, FileText, X } from 'lucide-react';

interface ExportBatchModalProps {
  open: boolean;
  onClose: () => void;
}

export function ExportBatchModal({ open, onClose }: ExportBatchModalProps) {
  const [scope, setScope] = useState<'enriched' | 'approved' | 'all'>('enriched');
  const [activeTab, setActiveTab] = useState<'csv' | 'json' | 'txt'>('csv');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [payload, setPayload] = useState<{
    count: number;
    json: string;
    csv: string;
    plainText: string;
  }>({ count: 0, json: '[]', csv: '', plainText: '' });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/export/batch?status=${scope}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setPayload({
            count: data.count || 0,
            json: data.json || '[]',
            csv: data.csv || '',
            plainText: data.plainText || '',
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, scope]);

  if (!open) return null;

  const currentContent =
    activeTab === 'csv' ? payload.csv : activeTab === 'json' ? payload.json : payload.plainText;

  const currentFilename =
    activeTab === 'csv'
      ? 'outreach_batch.csv'
      : activeTab === 'json'
        ? 'outreach_batch.json'
        : 'outreach_batch.txt';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(currentContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownload = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-batch-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col border border-[#323947] bg-[#13161b]">
        <div className="flex items-center justify-between border-b border-[#232832] px-6 py-4">
          <div>
            <h2 id="export-batch-title" className="text-base font-semibold text-[#e6e9ef]">
              Export Outreach Batch
            </h2>
            <p className="mt-0.5 text-xs text-[#9aa3b2]">
              Download your enriched contacts and plain-text email drafts as CSV, JSON, or Plain Text (.txt).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-[#232832] p-2 text-[#9aa3b2] transition-colors hover:border-[#323947] hover:text-[#e6e9ef]"
            aria-label="Close export modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#232832] bg-[#0d0f12] px-6 py-3">
          <div className="flex items-center gap-1 border border-[#232832] bg-[#13161b] p-0.5">
            <button
              type="button"
              onClick={() => setActiveTab('csv')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                activeTab === 'csv' ? 'bg-[#171b21] text-[#f59e0b]' : 'text-[#9aa3b2] hover:text-[#e6e9ef]'
              }`}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('json')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                activeTab === 'json' ? 'bg-[#171b21] text-[#38bdf8]' : 'text-[#9aa3b2] hover:text-[#e6e9ef]'
              }`}
            >
              <FileJson className="h-3.5 w-3.5" />
              Export JSON
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('txt')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                activeTab === 'txt' ? 'bg-[#171b21] text-emerald-400' : 'text-[#9aa3b2] hover:text-[#e6e9ef]'
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              Plain Text (.txt)
            </button>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-[#9aa3b2]">
              <span>Scope:</span>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as 'enriched' | 'approved' | 'all')}
                className="border border-[#232832] bg-[#13161b] px-2.5 py-1.5 text-xs text-[#e6e9ef] focus:border-[#f59e0b] focus:outline-none"
              >
                <option value="enriched">All Enriched Leads</option>
                <option value="approved">Staged &amp; Handed Off Only</option>
                <option value="all">All Leads (Including Unenriched)</option>
              </select>
            </label>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-xs text-[#9aa3b2] tabular-nums">
              {currentFilename} · {payload.count} {payload.count === 1 ? 'record' : 'records'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#171b21] px-3 py-1.5 text-xs font-medium text-[#e6e9ef] hover:border-[#f59e0b] whitespace-nowrap"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={() =>
                  handleDownload(
                    currentContent,
                    currentFilename,
                    activeTab === 'csv'
                      ? 'text/csv'
                      : activeTab === 'json'
                        ? 'application/json'
                        : 'text/plain'
                  )
                }
                className="inline-flex items-center gap-1.5 bg-[#f59e0b] px-3 py-1.5 text-xs font-semibold text-[#0d0f12] hover:bg-[#fbbf24] whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                Download {currentFilename}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="h-80 animate-pulse border border-[#232832] bg-[#0d0f12]" />
          ) : (
            <pre className="max-h-[420px] overflow-auto border border-[#232832] bg-[#0d0f12] p-4 font-mono text-xs leading-relaxed text-[#cbd5e1]">
              {currentContent}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
