import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  detectNonTargetIndustryWarning,
  evaluateDeliverability,
} from '../shared/guardrails.ts';
import type { LeadRecord, ProductProfile, UserSettings } from '../shared/types.ts';
import { DraftConfirmModal } from './DraftConfirmModal.tsx';

interface ReviewQueueViewProps {
  leads: LeadRecord[];
  profile: ProductProfile;
  settings: UserSettings;
  onLeadsUpdated: (leads: LeadRecord[]) => void;
  onOpenManualBatch: (selectedLeads: LeadRecord[]) => void;
  onGoToDiscovery: () => void;
  onOpenExport?: () => void;
}

type ReviewWindowTab = 'queue' | 'archive';

const WINDOW_TABS: Array<{ id: ReviewWindowTab; label: string }> = [
  { id: 'queue', label: 'Outreach Queue' },
  { id: 'archive', label: 'Archive' },
];

function isQueueLead(lead: LeadRecord): boolean {
  return lead.status === 'pending_review' || lead.status === 'approved';
}

function isArchivedLead(lead: LeadRecord): boolean {
  return lead.status === 'sent' || lead.status === 'rejected';
}

export function ReviewQueueView({
  leads,
  profile,
  settings,
  onLeadsUpdated,
  onOpenManualBatch,
  onGoToDiscovery,
  onOpenExport,
}: ReviewQueueViewProps) {
  const [activeWindow, setActiveWindow] = useState<ReviewWindowTab>(() => {
    const hasQueue = leads.some(isQueueLead);
    if (!hasQueue && leads.some(isArchivedLead)) {
      return 'archive';
    }
    return 'queue';
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedQueueIds, setSelectedQueueIds] = useState<string[]>([]);
  const [deletingQueue, setDeletingQueue] = useState(false);
  const [confirmClearQueue, setConfirmClearQueue] = useState(false);
  const [copiedFullDraft, setCopiedFullDraft] = useState(false);
  const [subjectDraft, setSubjectDraft] = useState('');
  const [bodyDraft, setBodyDraft] = useState('');
  const [manualEmailInput, setManualEmailInput] = useState('');
  const [showManualEmailForm, setShowManualEmailForm] = useState(false);
  const [angleHint, setAngleHint] = useState('');
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [staging, setStaging] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showRfcPreview, setShowRfcPreview] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'info' | 'error'; text: string } | null>(null);

  const filteredLeads = useMemo(() => {
    return activeWindow === 'queue'
      ? leads.filter(isQueueLead)
      : leads.filter(isArchivedLead);
  }, [leads, activeWindow]);

  useEffect(() => {
    const visibleIds = new Set(filteredLeads.map((l) => l.id));
    setSelectedQueueIds((prev) => prev.filter((id) => visibleIds.has(id)));
    setConfirmClearQueue(false);
  }, [activeWindow, filteredLeads.length]);

  const activeLead = useMemo(() => {
    if (filteredLeads.length === 0) return null;
    return filteredLeads.find((l) => l.id === activeId) || filteredLeads[0];
  }, [filteredLeads, activeId]);

  useEffect(() => {
    if (activeLead) {
      setSubjectDraft(activeLead.subjectLine || '');
      setBodyDraft(activeLead.plainTextBody || '');
      setManualEmailInput('');
      setShowManualEmailForm(false);
      setFeedback(null);
      setShowRfcPreview(false);
    }
  }, [activeLead?.id]);

  const activeRealEmails = useMemo(() => {
    if (!activeLead) return [];
    return activeLead.discoveredEmails.filter(
      (e) => !e.isRoleFallback && e.source !== 'mx_role_fallback'
    );
  }, [activeLead]);

  const activeFitWarning = useMemo(() => {
    if (!activeLead) return null;
    return detectNonTargetIndustryWarning(activeLead, profile);
  }, [activeLead, profile]);

  const activeEmailCandidate = useMemo(() => {
    if (!activeLead?.recommendedEmail) return null;
    return (
      activeRealEmails.find(
        (e) => e.email.toLowerCase() === activeLead.recommendedEmail.toLowerCase()
      ) || null
    );
  }, [activeLead, activeRealEmails]);

  const report = useMemo(() => {
    if (!activeLead) return null;
    return evaluateDeliverability(subjectDraft, bodyDraft, profile.maxLinks);
  }, [activeLead, subjectDraft, bodyDraft, profile.maxLinks]);

  const sharedEmailMap = useMemo(() => {
    const groups = new Map<string, LeadRecord[]>();
    for (const l of leads) {
      if (l.status === 'rejected') continue;
      const email = l.recommendedEmail?.trim().toLowerCase();
      if (!email) continue;
      const arr = groups.get(email) || [];
      arr.push(l);
      groups.set(email, arr);
    }
    return groups;
  }, [leads]);

  const activeSharedLeads = useMemo(() => {
    if (!activeLead?.recommendedEmail) return [];
    const key = activeLead.recommendedEmail.trim().toLowerCase();
    return (sharedEmailMap.get(key) || []).filter((l) => l.id !== activeLead.id);
  }, [activeLead, sharedEmailMap]);

  const patchLead = async (id: string, patch: Partial<LeadRecord>) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update lead');
      onLeadsUpdated(data.leads);
      return data.lead as LeadRecord;
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Update failed',
      });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSingleLead = async (id: string) => {
    setDeletingQueue(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/leads/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete lead');
      onLeadsUpdated(data.leads);
      setSelectedQueueIds((prev) => prev.filter((item) => item !== id));
      if (activeId === id) {
        setActiveId(null);
      }
      setFeedback({ type: 'info', text: 'Deleted lead from queue and SQLite.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to delete lead',
      });
    } finally {
      setDeletingQueue(false);
    }
  };

  const handleDeleteSelectedQueue = async () => {
    if (selectedQueueIds.length === 0) return;
    setDeletingQueue(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/leads/batch', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedQueueIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Batch delete failed');
      onLeadsUpdated(data.leads);
      if (activeId && selectedQueueIds.includes(activeId)) {
        setActiveId(null);
      }
      setSelectedQueueIds([]);
      setFeedback({
        type: 'info',
        text: `Deleted ${data.deletedCount ?? selectedQueueIds.length} lead(s) from Review Queue.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Batch delete failed',
      });
    } finally {
      setDeletingQueue(false);
    }
  };

  const handleClearVisibleQueue = async () => {
    const idsToClear = filteredLeads.map((l) => l.id);
    if (idsToClear.length === 0) return;
    setDeletingQueue(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/leads/batch', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: idsToClear }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Clear queue failed');
      onLeadsUpdated(data.leads);
      setSelectedQueueIds([]);
      setActiveId(null);
      setConfirmClearQueue(false);
      setFeedback({
        type: 'info',
        text: `Cleared ${data.deletedCount ?? idsToClear.length} lead(s) from ${WINDOW_TABS.find((t) => t.id === activeWindow)?.label}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Clear queue failed',
      });
    } finally {
      setDeletingQueue(false);
    }
  };

  const toggleQueueSelect = (id: string) => {
    setSelectedQueueIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleQueueSelectAll = () => {
    if (selectedQueueIds.length === filteredLeads.length) {
      setSelectedQueueIds([]);
    } else {
      setSelectedQueueIds(filteredLeads.map((l) => l.id));
    }
  };

  const handleRegenerate = async () => {
    if (!activeLead) return;
    if (!profile.businessName.trim() || !profile.senderName.trim()) {
      setFeedback({
        type: 'error',
        text: 'Enter your Business Name and Sender Name in Discovery first.',
      });
      return;
    }
    if (profile.promoCode.trim() && !profile.promoBenefit.trim()) {
      setFeedback({
        type: 'error',
        text: 'Enter your Promo Code benefit in the Offering profile first.',
      });
      return;
    }
    if (settings.extractionMode === 'manual_batch') {
      onOpenManualBatch([activeLead]);
      return;
    }
    setFeedback(null);
    setRegenerating(true);
    try {
      const res = await fetch('/api/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadIds: [activeLead.id],
          overrideMode: settings.extractionMode,
          angleHint: angleHint.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Regeneration failed');
      onLeadsUpdated(data.leads);
      const updated = (data.leads as LeadRecord[]).find((l) => l.id === activeLead.id);
      if (updated) {
        setSubjectDraft(updated.subjectLine);
        setBodyDraft(updated.plainTextBody);
      }
      setFeedback({ type: 'info', text: 'Draft angle regenerated.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Regeneration failed',
      });
    } finally {
      setRegenerating(false);
    }
  };

  const handleStageGmailDraft = async () => {
    if (!activeLead) return;
    setStaging(true);
    setFeedback(null);
    try {
      // Save latest editor changes first
      await patchLead(activeLead.id, {
        subjectLine: subjectDraft,
        plainTextBody: bodyDraft,
      });

      const res = await fetch('/api/gmail/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: activeLead.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to stage draft');
      onLeadsUpdated(data.leads);
      setConfirmOpen(false);
      setShowRfcPreview(true);
      setFeedback({
        type: 'info',
        text: `Draft staged (${data.draft.gmailDraftId}) in RFC 2822 text/plain format.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Draft staging failed',
      });
    } finally {
      setStaging(false);
    }
  };

  const moveLeadAndAdvance = async (
    lead: LeadRecord,
    nextStatus: 'sent' | 'rejected' | 'pending_review',
    extraPatch?: Partial<LeadRecord>
  ) => {
    const currentIndex = filteredLeads.findIndex((l) => l.id === lead.id);
    const nextCandidate =
      filteredLeads[currentIndex + 1] || filteredLeads[currentIndex - 1] || null;
    const updated = await patchLead(lead.id, {
      ...extraPatch,
      status: nextStatus,
    });
    if (updated) {
      setActiveId(nextCandidate ? nextCandidate.id : null);
      if (nextStatus === 'sent') {
        setFeedback({
          type: 'info',
          text: `Archived ${lead.companyName || lead.domain} as Handed Off.`,
        });
      } else if (nextStatus === 'rejected') {
        setFeedback({
          type: 'info',
          text: `Moved ${lead.companyName || lead.domain} to Archive (Rejected).`,
        });
      } else {
        setFeedback({
          type: 'info',
          text: `Restored ${lead.companyName || lead.domain} to Outreach Queue.`,
        });
      }
    }
  };

  const countsByWindow = useMemo(() => {
    let queue = 0;
    let archive = 0;
    for (const l of leads) {
      if (isQueueLead(l)) queue += 1;
      else if (isArchivedLead(l)) archive += 1;
    }
    return { queue, archive };
  }, [leads]);

  return (
    <div className="mx-auto max-w-[1440px] space-y-5 px-6 py-6">
      {/* Two-Window Switcher Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-[#232832] bg-[#13161b] px-4 py-3">
        <div className="flex items-center gap-1.5">
          {WINDOW_TABS.map((tab) => {
            const active = activeWindow === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveWindow(tab.id)}
                className={`whitespace-nowrap px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'border border-[#f59e0b]/60 bg-[#171b21] text-[#f59e0b]'
                    : 'border border-transparent text-[#9aa3b2] hover:text-[#e6e9ef]'
                }`}
              >
                {tab.label}{' '}
                <span className="ml-1 font-mono text-[11px] opacity-80 tabular-nums">
                  ({countsByWindow[tab.id]})
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {activeLead && (
            <div className="font-mono text-xs text-[#9aa3b2]">
              Active: <span className="text-[#e6e9ef]">{activeLead.domain}</span>
            </div>
          )}
          {onOpenExport && (
            <button
              type="button"
              onClick={onOpenExport}
              className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#171b21] px-3 py-1.5 text-xs font-medium text-[#9aa3b2] transition-colors hover:border-[#38bdf8] hover:text-[#e6e9ef] whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              Export Batch
            </button>
          )}
        </div>
      </div>

      {filteredLeads.length === 0 ? (
        <div className="flex flex-col items-center justify-center border border-[#232832] bg-[#13161b] px-6 py-16 text-center">
          <p className="text-sm font-medium text-[#e6e9ef]">
            {activeWindow === 'queue' ? 'Outreach Queue is empty' : 'Archive is empty'}
          </p>
          <p className="mt-1 max-w-md text-xs text-[#9aa3b2]">
            {activeWindow === 'queue'
              ? 'Generate outreach drafts in Discovery to populate this queue.'
              : 'Leads marked Handed Off or Rejected appear here.'}
          </p>
          {activeWindow === 'queue' && (
            <button
              type="button"
              onClick={onGoToDiscovery}
              className="mt-4 bg-[#f59e0b] px-4 py-2 text-xs font-semibold text-[#0d0f12] hover:bg-[#fbbf24]"
            >
              Go to Discovery
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* Queue List Sidebar */}
          <aside className="border border-[#232832] bg-[#13161b] lg:col-span-3">
            <div className="space-y-2 border-b border-[#232832] px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[#e6e9ef]">
                  <input
                    type="checkbox"
                    checked={
                      filteredLeads.length > 0 && selectedQueueIds.length === filteredLeads.length
                    }
                    onChange={toggleQueueSelectAll}
                    aria-label="Select all leads in queue"
                    className="h-3.5 w-3.5 accent-[#f59e0b]"
                  />
                  <span>Queue ({filteredLeads.length})</span>
                </label>

                {confirmClearQueue ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={deletingQueue}
                      onClick={handleClearVisibleQueue}
                      className="border border-red-500/50 bg-red-950/40 px-2 py-0.5 font-mono text-[10px] font-semibold text-red-200 hover:border-red-400"
                    >
                      Confirm Clear
                    </button>
                    <button
                      type="button"
                      disabled={deletingQueue}
                      onClick={() => setConfirmClearQueue(false)}
                      className="border border-[#232832] px-2 py-0.5 font-mono text-[10px] text-[#9aa3b2] hover:text-[#e6e9ef]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={deletingQueue || filteredLeads.length === 0}
                    onClick={() => setConfirmClearQueue(true)}
                    className="inline-flex items-center gap-1 border border-[#323947] bg-[#0d0f12] px-2 py-1 font-mono text-[10px] text-[#9aa3b2] hover:border-red-500/50 hover:text-red-300 disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" />
                    Clear Queue
                  </button>
                )}
              </div>

              {selectedQueueIds.length > 0 && (
                <button
                  type="button"
                  disabled={deletingQueue}
                  onClick={handleDeleteSelectedQueue}
                  className="inline-flex w-full items-center justify-center gap-1.5 border border-red-500/40 bg-red-950/25 px-3 py-1.5 font-mono text-[11px] font-medium text-red-300 hover:border-red-400 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete Selected ({selectedQueueIds.length})
                </button>
              )}
            </div>

            <div className="max-h-[680px] divide-y divide-[#232832] overflow-y-auto">
              {filteredLeads.map((lead) => {
                const selected = activeLead?.id === lead.id;
                const realEmails = lead.discoveredEmails.filter(
                  (e) => !e.isRoleFallback && e.source !== 'mx_role_fallback'
                );
                const hasRealEmail = Boolean(lead.recommendedEmail?.trim()) || realEmails.length > 0;
                const emailKey = lead.recommendedEmail?.trim().toLowerCase() || '';
                const isSharedInbox = emailKey ? (sharedEmailMap.get(emailKey)?.length || 0) > 1 : false;
                const rowFitWarning = detectNonTargetIndustryWarning(lead, profile);

                return (
                  <div
                    key={lead.id}
                    onClick={() => setActiveId(lead.id)}
                    className={`flex w-full cursor-pointer items-start gap-2.5 px-3.5 py-3 text-left transition-colors ${
                      selected ? 'bg-[#171b21]' : 'hover:bg-[#171b21]/60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedQueueIds.includes(lead.id)}
                      onChange={() => toggleQueueSelect(lead.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${lead.domain}`}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#f59e0b]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex w-full items-center justify-between gap-2">
                        <span
                          className={`truncate text-xs font-semibold ${
                            selected ? 'text-[#f59e0b]' : 'text-[#e6e9ef]'
                          }`}
                        >
                          {lead.companyName || lead.domain}
                        </span>
                        {!hasRealEmail && (
                          <span className="shrink-0 border border-[#f59e0b]/50 bg-[#f59e0b]/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[#f59e0b]">
                            No Email Found
                          </span>
                        )}
                      </div>
                      <div
                        className={`mt-0.5 truncate font-mono text-[11px] ${
                          hasRealEmail ? 'text-[#38bdf8]' : 'text-[#9aa3b2]'
                        }`}
                      >
                        {lead.recommendedEmail || lead.domain}
                      </div>
                      <div className="mt-1 flex w-full items-center justify-between gap-2">
                        <span className="truncate text-[11px] text-[#697386]">
                          {lead.tradeSpecialty || lead.domain}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          {activeWindow === 'queue' && lead.status === 'approved' && (
                            <span className="border border-emerald-500/40 bg-emerald-950/30 px-1.5 py-0.5 font-mono text-[9px] text-emerald-300">
                              Staged
                            </span>
                          )}
                          {activeWindow === 'archive' && (
                            <span
                              className={`border px-1.5 py-0.5 font-mono text-[9px] ${
                                lead.status === 'sent'
                                  ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                                  : 'border-red-500/40 bg-red-950/30 text-red-300'
                              }`}
                            >
                              {lead.status === 'sent' ? 'Handed Off' : 'Rejected'}
                            </span>
                          )}
                          {rowFitWarning && (
                            <span className="border border-red-500/40 bg-red-950/30 px-1 py-0.5 font-mono text-[9px] text-amber-300">
                              Fit
                            </span>
                          )}
                          {isSharedInbox && (
                            <span className="font-mono text-[10px] text-[#f59e0b]">Alias</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={deletingQueue}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSingleLead(lead.id);
                      }}
                      aria-label={`Delete ${lead.domain}`}
                      title="Delete Lead"
                      className="mt-0.5 shrink-0 p-1 text-[#697386] transition-colors hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </aside>

          {/* Split-Screen Review Studio */}
          {activeLead && report && (
            <div className="grid grid-cols-1 gap-5 lg:col-span-9 xl:grid-cols-12">
              {/* Middle Column: Company & Crawl Summary Card */}
              <section className="space-y-4 border border-[#232832] bg-[#13161b] p-5 xl:col-span-5">
                {activeFitWarning && (
                  <div className="flex items-start gap-2.5 border border-red-500/50 bg-gradient-to-r from-red-950/45 to-[#f59e0b]/15 px-3.5 py-2.5 text-xs text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#f59e0b]" />
                    <div>
                      <div className="font-mono text-[11px] font-bold text-[#f59e0b]">
                        ⚠️ Non-Target Industry
                      </div>
                      <p className="mt-0.5 text-xs text-red-200/90">{activeFitWarning}</p>
                    </div>
                  </div>
                )}

                <div className="border-b border-[#232832] pb-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-[#9aa3b2]">
                      Company Summary
                    </span>
                    <span className="font-mono text-[11px] text-[#697386] tabular-nums">
                      {activeLead.pagesCrawled.length}{' '}
                      {activeLead.pagesCrawled.length === 1 ? 'page crawled' : 'pages crawled'}
                    </span>
                  </div>
                  <h3 className="mt-1.5 text-base font-semibold text-[#e6e9ef]">
                    {activeLead.companyName || activeLead.domain}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#9aa3b2]">
                    <a
                      href={`https://${activeLead.domain.replace(/^https?:\/\//i, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-[#38bdf8] hover:underline"
                    >
                      <Globe className="h-3 w-3 shrink-0" />
                      {activeLead.domain}
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                    <span>·</span>
                    <span>{activeLead.primaryContactName || 'Primary Contact'}</span>
                  </div>
                  {activeLead.tradeSpecialty && (
                    <div className="mt-1.5 font-mono text-[11px] text-[#cbd5e1]">
                      {activeLead.tradeSpecialty}
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-xs font-medium text-[#9aa3b2]">What They Do</div>
                  <p className="mt-1 text-xs leading-relaxed text-[#e6e9ef]">
                    {activeLead.detectedWorkflow || 'Not enriched yet — run enrichment or paste JSON.'}
                  </p>
                </div>

                <div>
                  <div className="text-xs font-medium text-[#9aa3b2]">Timely Outreach Trigger</div>
                  <p className="mt-1 text-xs leading-relaxed text-[#38bdf8]">
                    {activeLead.civicTrigger || 'Pending relevance trigger'}
                  </p>
                </div>

                {/* Scraped Email Source OR Missing-Email Finder */}
                <div className="border-t border-[#232832] pt-4">
                  {activeLead.recommendedEmail || activeRealEmails.length > 0 ? (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-[#9aa3b2]">Email Found On</span>
                        <button
                          type="button"
                          onClick={() => setShowManualEmailForm((v) => !v)}
                          className="inline-flex items-center gap-1 font-mono text-[11px] text-[#38bdf8] hover:underline"
                        >
                          <Plus className="h-3 w-3" />
                          {showManualEmailForm ? 'Hide manual input' : 'Add manual email'}
                        </button>
                      </div>

                      {(() => {
                        const source = activeEmailCandidate?.source || '';
                        if (source === 'manual_custom') {
                          return (
                            <div className="border border-[#232832] bg-[#0d0f12] px-3 py-2 font-mono text-[11px] text-[#38bdf8]">
                              Added manually ({activeLead.recommendedEmail})
                            </div>
                          );
                        }
                        if (source === 'manual_import') {
                          return (
                            <div className="border border-[#232832] bg-[#0d0f12] px-3 py-2 font-mono text-[11px] text-[#9aa3b2]">
                              Imported via Batch JSON ({activeLead.recommendedEmail})
                            </div>
                          );
                        }
                        const resolvedSourceUrl = source.startsWith('http')
                          ? source
                          : source.startsWith('/')
                            ? `https://${activeLead.domain}${source}`
                            : `https://${activeLead.domain}/`;
                        return (
                          <div className="border border-[#232832] bg-[#0d0f12] px-3 py-2">
                            <a
                              href={resolvedSourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex max-w-full items-center gap-1.5 font-mono text-[11px] text-emerald-300 hover:underline"
                            >
                              <span className="truncate">{resolvedSourceUrl}</span>
                              <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                            {activeRealEmails.length > 1 && (
                              <div className="mt-1 font-mono text-[10px] text-[#9aa3b2]">
                                {activeRealEmails.length} real emails scraped — switch recipient in the To: bar on the right.
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {showManualEmailForm && (
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const cleaned = manualEmailInput.trim().toLowerCase();
                            if (!cleaned || !cleaned.includes('@')) return;
                            await patchLead(activeLead.id, { recommendedEmail: cleaned });
                            setManualEmailInput('');
                            setShowManualEmailForm(false);
                          }}
                          className="flex gap-2"
                        >
                          <input
                            type="email"
                            value={manualEmailInput}
                            onChange={(e) => setManualEmailInput(e.target.value)}
                            placeholder={`Paste email (e.g. name@${activeLead.domain})`}
                            className="min-w-0 flex-1 border border-[#232832] bg-[#0d0f12] px-2.5 py-1.5 font-mono text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
                          />
                          <button
                            type="submit"
                            disabled={saving || !manualEmailInput.includes('@')}
                            className="bg-[#f59e0b] px-3 py-1.5 text-xs font-semibold text-[#0d0f12] hover:bg-[#fbbf24] disabled:opacity-50 whitespace-nowrap"
                          >
                            Save Email
                          </button>
                        </form>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3 border border-[#f59e0b]/40 bg-[#f59e0b]/10 p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-[#f59e0b]">
                          No Email Found on Website
                        </span>
                        <span className="font-mono text-[10px] text-[#9aa3b2]">0 scraped</span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-[#cbd5e1]">
                        No real email address was listed on their crawled pages. Search Google for a public inbox or paste one below:
                      </p>
                      <a
                        href={`https://www.google.com/search?q=${encodeURIComponent(
                          `"@${activeLead.domain}" email`
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex w-full items-center justify-center gap-2 border border-[#323947] bg-[#171b21] px-3 py-2 text-xs font-medium text-[#38bdf8] transition-colors hover:border-[#38bdf8]"
                      >
                        <Search className="h-3.5 w-3.5" />
                        <span>🔍 Search Google for &quot;@{activeLead.domain}&quot; email</span>
                        <ExternalLink className="h-3 w-3 opacity-80" />
                      </a>
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const cleaned = manualEmailInput.trim().toLowerCase();
                          if (!cleaned || !cleaned.includes('@')) return;
                          await patchLead(activeLead.id, { recommendedEmail: cleaned });
                          setManualEmailInput('');
                        }}
                        className="flex gap-2"
                      >
                        <input
                          type="email"
                          value={manualEmailInput}
                          onChange={(e) => setManualEmailInput(e.target.value)}
                          placeholder={`Paste found email (e.g. name@${activeLead.domain})`}
                          className="min-w-0 flex-1 border border-[#232832] bg-[#0d0f12] px-2.5 py-2 font-mono text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={saving || !manualEmailInput.includes('@')}
                          className="bg-[#f59e0b] px-3.5 py-2 text-xs font-semibold text-[#0d0f12] hover:bg-[#fbbf24] disabled:opacity-50 whitespace-nowrap"
                        >
                          Save Email
                        </button>
                      </form>
                    </div>
                  )}
                </div>

                {/* Pages Crawled */}
                <div className="border-t border-[#232832] pt-3">
                  <div className="text-xs font-medium text-[#9aa3b2]">
                    Pages Crawled ({activeLead.pagesCrawled.length})
                  </div>
                  {activeLead.pagesCrawled.length > 0 ? (
                    <div className="mt-1.5 space-y-1 font-mono text-[11px] text-[#697386]">
                      {Array.from(new Set(activeLead.pagesCrawled)).map((u, idx) => (
                        <div key={`${u}-${idx}`} className="truncate">
                          <a
                            href={u}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-[#38bdf8] hover:underline"
                          >
                            {u}
                          </a>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-1 font-mono text-[11px] text-amber-300/90">
                      {activeLead.crawlMode === 'blocked'
                        ? 'HTTP Blocked (MX Checked) — site blocked automated requests'
                        : 'No pages recorded'}
                    </div>
                  )}
                </div>
              </section>

              {/* Right Column: Plain-Text Editor, To: Bar & Deliverability Guardrail Bar */}
              <section className="flex flex-col justify-between border border-[#232832] bg-[#13161b] p-5 xl:col-span-7">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#232832] pb-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[#e6e9ef]">
                        Outreach Editor
                      </h3>
                      <p className="mt-0.5 text-[11px] text-[#9aa3b2]">
                        Edit recipient, subject, and plain-text body before sending.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {saving && <span className="font-mono text-[11px] text-[#9aa3b2]">Saving...</span>}
                      <button
                        type="button"
                        disabled={deletingQueue}
                        onClick={() => handleDeleteSingleLead(activeLead.id)}
                        className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#171b21] px-2.5 py-1.5 text-xs font-medium text-red-400 hover:border-red-500/50 whitespace-nowrap"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </div>
                  </div>

                  {activeSharedLeads.length > 0 && (
                    <div className="flex items-start gap-2 border border-[#f59e0b]/40 bg-[#f59e0b]/10 px-3 py-2 text-xs text-[#f59e0b]">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        <strong>Duplicate Inbox Alias:</strong>{' '}
                        <span className="font-mono">{activeLead.recommendedEmail}</span> is also assigned to{' '}
                        {activeSharedLeads.map((l) => l.domain).join(', ')}. Swap the contact or reject duplicates to avoid sending twice to the same inbox.
                      </span>
                    </div>
                  )}

                  {/* Real-Time Deliverability & Spam Guardrail Bar */}
                  <div className="border border-[#232832] bg-[#0d0f12] p-3">
                    <div className="flex items-center justify-between pb-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#e6e9ef]">
                        <ShieldCheck
                          className={`h-4 w-4 ${report.passed ? 'text-emerald-400' : 'text-[#f59e0b]'}`}
                        />
                        Deliverability Check
                      </span>
                      <span
                        className={`font-mono text-xs ${
                          report.passed ? 'text-emerald-400' : 'text-[#f59e0b]'
                        }`}
                      >
                        {report.passed ? 'PASS' : 'ACTION REQUIRED'}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {report.checks.map((chk) => (
                        <div
                          key={chk.id}
                          className="flex items-center justify-between border border-[#232832] bg-[#13161b] px-3 py-1.5 text-[11px]"
                        >
                          <span className="inline-flex items-center gap-1.5 text-[#e6e9ef]">
                            {chk.passed ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                            ) : (
                              <AlertTriangle className="h-3.5 w-3.5 text-[#f59e0b] shrink-0" />
                            )}
                            {chk.label}
                          </span>
                          <span className="font-mono text-[#9aa3b2] tabular-nums">{chk.detail}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Prominent Recipient To: Header Bar */}
                  <div
                    className={`flex flex-wrap items-center justify-between gap-3 border px-3.5 py-2.5 ${
                      activeLead.recommendedEmail
                        ? 'border-emerald-500/40 bg-[#0d0f12]'
                        : 'border-[#f59e0b]/50 bg-[#f59e0b]/10'
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <span className="font-mono text-xs font-semibold text-[#9aa3b2] shrink-0">
                        To:
                      </span>
                      {activeRealEmails.length > 1 ? (
                        <select
                          aria-label="Select recipient email"
                          value={activeLead.recommendedEmail || activeRealEmails[0].email}
                          onChange={(e) =>
                            patchLead(activeLead.id, { recommendedEmail: e.target.value })
                          }
                          className="min-w-0 flex-1 border border-[#232832] bg-[#13161b] px-2.5 py-1.5 font-mono text-xs font-medium text-[#38bdf8] focus:border-[#f59e0b] focus:outline-none"
                        >
                          {activeRealEmails.map((cand) => (
                            <option key={cand.email} value={cand.email}>
                              {cand.email} ({cand.priority})
                            </option>
                          ))}
                        </select>
                      ) : activeLead.recommendedEmail ? (
                        <span className="truncate font-mono text-xs font-semibold text-[#38bdf8]">
                          {activeLead.recommendedEmail}
                        </span>
                      ) : (
                        <span className="font-mono text-xs font-medium text-[#f59e0b]">
                          No Email Found — search Google or paste one in the Summary card
                        </span>
                      )}
                    </div>

                    {activeLead.recommendedEmail ? (
                      activeEmailCandidate?.source === 'manual_custom' ? (
                        <span className="inline-flex items-center gap-1 border border-[#38bdf8]/40 bg-[#0d1822] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#38bdf8] shrink-0">
                          ✓ Added manually
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 border border-emerald-500/40 bg-emerald-950/30 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-300 shrink-0">
                          ✓ Scraped from site
                        </span>
                      )
                    ) : (
                      <span className="inline-flex items-center gap-1 border border-[#f59e0b]/50 bg-[#1a150b] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#f59e0b] shrink-0">
                        Missing Recipient
                      </span>
                    )}
                  </div>

                  <div>
                    <label htmlFor="subject-editor" className="block text-xs font-medium text-[#9aa3b2]">
                      Subject Line (plain text, low-key peer-to-peer)
                    </label>
                    <input
                      id="subject-editor"
                      type="text"
                      value={subjectDraft}
                      onChange={(e) => setSubjectDraft(e.target.value)}
                      onBlur={() => {
                        if (subjectDraft !== activeLead.subjectLine) {
                          patchLead(activeLead.id, { subjectLine: subjectDraft });
                        }
                      }}
                      className="mt-1.5 w-full border border-[#232832] bg-[#0d0f12] px-3 py-2 font-mono text-xs text-[#e6e9ef] focus:border-[#f59e0b] focus:outline-none"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <label htmlFor="body-editor" className="block text-xs font-medium text-[#9aa3b2]">
                        Message Body (100% text/plain MIME)
                      </label>
                      <span className="font-mono text-[11px] text-[#697386] tabular-nums">
                        {report.wordCount} words
                      </span>
                    </div>
                    <textarea
                      id="body-editor"
                      rows={11}
                      value={bodyDraft}
                      onChange={(e) => setBodyDraft(e.target.value)}
                      onBlur={() => {
                        if (bodyDraft !== activeLead.plainTextBody) {
                          patchLead(activeLead.id, { plainTextBody: bodyDraft });
                        }
                      }}
                      className="mt-1.5 w-full border border-[#232832] bg-[#0d0f12] p-3.5 font-mono text-xs leading-relaxed text-[#e6e9ef] focus:border-[#f59e0b] focus:outline-none"
                    />
                  </div>

                  {feedback && (
                    <div
                      className={`border px-3.5 py-2.5 text-xs ${
                        feedback.type === 'error'
                          ? 'border-red-500/40 bg-red-950/25 text-red-300'
                          : 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300'
                      }`}
                    >
                      {feedback.text}
                    </div>
                  )}

                  {activeLead.rfc2822Preview && (
                    <div className="border border-[#232832] bg-[#0d0f12] p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] text-[#38bdf8]">
                          Staged Draft ID: {activeLead.gmailDraftId}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setShowRfcPreview((v) => !v)}
                            className="text-[11px] text-[#9aa3b2] hover:text-[#e6e9ef]"
                          >
                            {showRfcPreview ? 'Hide RFC 2822' : 'Inspect RFC 2822'}
                          </button>
                          <button
                            type="button"
                            onClick={() => navigator.clipboard.writeText(activeLead.rfc2822Preview || '')}
                            className="inline-flex items-center gap-1 text-[11px] text-[#9aa3b2] hover:text-[#e6e9ef]"
                          >
                            <Copy className="h-3 w-3" />
                            Copy MIME
                          </button>
                        </div>
                      </div>
                      {showRfcPreview && (
                        <pre className="mt-2 max-h-48 overflow-auto border-t border-[#232832] pt-2 font-mono text-[11px] text-[#cbd5e1]">
                          {activeLead.rfc2822Preview}
                        </pre>
                      )}
                    </div>
                  )}
                </div>

                {/* Action Bar */}
                <div className="mt-5 space-y-3 border-t border-[#232832] pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={angleHint}
                      onChange={(e) => setAngleHint(e.target.value)}
                      placeholder="Optional angle note for regeneration (e.g. mention recent project, hiring, or workflow fit)"
                      className="flex-1 border border-[#232832] bg-[#0d0f12] px-3 py-2 text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#38bdf8] focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={regenerating}
                      onClick={handleRegenerate}
                      className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#171b21] px-3.5 py-2 text-xs font-medium text-[#38bdf8] hover:border-[#38bdf8] disabled:opacity-50 whitespace-nowrap"
                    >
                      {regenerating ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Regenerate Angle
                    </button>
                  </div>

                  {/* Send & Handoff Bar */}
                  <div className="border border-[#323947] bg-[#0d0f12] p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5">
                      <span className="font-mono text-[11px] font-semibold text-[#f59e0b]">
                        Send &amp; Handoff
                      </span>
                      {activeLead.status === 'approved' && (
                        <span className="font-mono text-[10px] text-emerald-300">
                          RFC Draft Staged
                        </span>
                      )}
                      {activeLead.status === 'sent' && (
                        <span className="font-mono text-[10px] text-emerald-300">
                          Handed Off · Archived
                        </span>
                      )}
                      {activeLead.status === 'rejected' && (
                        <span className="font-mono text-[10px] text-red-300">
                          Rejected · Archived
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {activeLead.recommendedEmail ? (
                        <>
                          <a
                            href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
                              activeLead.recommendedEmail
                            )}&su=${encodeURIComponent(subjectDraft)}&body=${encodeURIComponent(
                              bodyDraft
                            )}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => {
                              if (
                                subjectDraft !== activeLead.subjectLine ||
                                bodyDraft !== activeLead.plainTextBody
                              ) {
                                patchLead(activeLead.id, {
                                  subjectLine: subjectDraft,
                                  plainTextBody: bodyDraft,
                                });
                              }
                            }}
                            className="inline-flex items-center gap-1.5 bg-[#f59e0b] px-4 py-2 text-xs font-semibold text-[#0d0f12] transition-colors hover:bg-[#fbbf24] whitespace-nowrap"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Open in Gmail
                          </a>

                          <a
                            href={`mailto:${encodeURIComponent(
                              activeLead.recommendedEmail
                            )}?subject=${encodeURIComponent(subjectDraft)}&body=${encodeURIComponent(
                              bodyDraft
                            )}`}
                            className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#171b21] px-3.5 py-2 text-xs font-medium text-[#38bdf8] hover:border-[#38bdf8] whitespace-nowrap"
                          >
                            <Mail className="h-3.5 w-3.5" />
                            Mail App
                          </a>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled
                            title="Add a recipient email first"
                            className="inline-flex cursor-not-allowed items-center gap-1.5 bg-[#f59e0b]/40 px-4 py-2 text-xs font-semibold text-[#0d0f12]/70 whitespace-nowrap"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Open in Gmail (Add Email First)
                          </button>

                          <button
                            type="button"
                            disabled
                            title="Add a recipient email first"
                            className="inline-flex cursor-not-allowed items-center gap-1.5 border border-[#232832] bg-[#13161b] px-3.5 py-2 text-xs font-medium text-[#697386] whitespace-nowrap"
                          >
                            <Mail className="h-3.5 w-3.5" />
                            Mail App
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={async () => {
                          const formatted = `To: ${activeLead.recommendedEmail}\nSubject: ${subjectDraft}\n\n${bodyDraft}`;
                          await navigator.clipboard.writeText(formatted);
                          setCopiedFullDraft(true);
                          setTimeout(() => setCopiedFullDraft(false), 1800);
                        }}
                        className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#171b21] px-3.5 py-2 text-xs font-medium text-[#e6e9ef] hover:border-[#f59e0b] whitespace-nowrap"
                      >
                        {copiedFullDraft ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        {copiedFullDraft ? 'Copied' : 'Copy Draft'}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {activeWindow === 'queue' ? (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() =>
                            moveLeadAndAdvance(activeLead, 'rejected', {
                              subjectLine: subjectDraft,
                              plainTextBody: bodyDraft,
                            })
                          }
                          className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#171b21] px-3.5 py-2 text-xs font-medium text-red-400 hover:border-red-500/50 disabled:opacity-50 whitespace-nowrap"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Reject
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => moveLeadAndAdvance(activeLead, 'pending_review')}
                          className="inline-flex items-center gap-1.5 border border-[#38bdf8]/60 bg-[#0d1822] px-4 py-2 text-xs font-semibold text-[#38bdf8] hover:border-[#38bdf8] disabled:opacity-50 whitespace-nowrap"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Restore to Queue
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={!activeLead.recommendedEmail || !subjectDraft.trim() || !bodyDraft.trim()}
                        onClick={() => setConfirmOpen(true)}
                        className="inline-flex items-center gap-2 border border-[#323947] bg-[#171b21] px-3.5 py-2 text-xs font-medium text-[#e6e9ef] transition-colors hover:border-[#f59e0b] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
                      >
                        <Mail className="h-3.5 w-3.5 text-[#f59e0b]" />
                        Stage RFC Draft
                      </button>
                    </div>

                    {activeWindow === 'queue' && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() =>
                          moveLeadAndAdvance(activeLead, 'sent', {
                            subjectLine: subjectDraft,
                            plainTextBody: bodyDraft,
                          })
                        }
                        className="inline-flex items-center gap-2 bg-emerald-500 px-5 py-2 text-xs font-bold text-[#0d0f12] transition-colors hover:bg-emerald-400 disabled:opacity-50 whitespace-nowrap"
                      >
                        <Archive className="h-3.5 w-3.5" />
                        Hand Off &amp; Archive
                      </button>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      )}

      <DraftConfirmModal
        open={confirmOpen}
        lead={
          activeLead
            ? { ...activeLead, subjectLine: subjectDraft, plainTextBody: bodyDraft }
            : null
        }
        profile={profile}
        report={report}
        submitting={staging}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleStageGmailDraft}
      />
    </div>
  );
}
