import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileUp,
  Globe,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import {
  BLANK_PRODUCT_PROFILE,
  BLANK_SEARCH_CONFIG,
  SEARCH_PROVIDERS,
  type DiscoveredBusiness,
  type ExtractionMode,
  type LeadRecord,
  type ProductProfile,
  type SearchApiConfig,
  type SearchApiProvider,
  type UserSettings,
} from '../shared/types.ts';

interface DiscoveryViewProps {
  leads: LeadRecord[];
  profile: ProductProfile;
  settings: UserSettings;
  onSaveProfile: (profile: ProductProfile) => Promise<void>;
  onUpdateSettings: (patch: Partial<UserSettings>) => Promise<void>;
  onLeadsUpdated: (leads: LeadRecord[]) => void;
  onOpenManualBatch: (selectedLeads: LeadRecord[]) => void;
  onOpenEngineSetup: (mode?: ExtractionMode) => void;
  onGoToReview: () => void;
}

export function DiscoveryView({
  leads,
  profile,
  settings,
  onSaveProfile,
  onUpdateSettings,
  onLeadsUpdated,
  onOpenManualBatch,
  onOpenEngineSetup,
  onGoToReview,
}: DiscoveryViewProps) {
  // 00. Local Business Auto-Discovery state
  const quickTrades = profile.targetTrades;
  const [searchTrade, setSearchTrade] = useState(profile.targetTrades[0] || '');
  const [searchLocation, setSearchLocation] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [discoveredList, setDiscoveredList] = useState<DiscoveredBusiness[]>([]);
  const [selectedDiscoveredIds, setSelectedDiscoveredIds] = useState<string[]>([]);
  const [discoverMeta, setDiscoverMeta] = useState<{
    providerUsed?: SearchApiProvider;
    sources: { yellowpages: number; duckduckgo: number; searchApi?: number };
    rateLimited: boolean;
  } | null>(null);
  const [showSearchPromptFallback, setShowSearchPromptFallback] = useState(false);
  const [enhanceSearchOpen, setEnhanceSearchOpen] = useState(false);
  const [searchConfigDraft, setSearchConfigDraft] = useState<SearchApiConfig>(
    settings.searchConfig
  );
  const [showSearchApiKey, setShowSearchApiKey] = useState(false);
  const [savingSearchConfig, setSavingSearchConfig] = useState(false);
  const [copiedSearchPrompt, setCopiedSearchPrompt] = useState(false);
  const [copiedDomains, setCopiedDomains] = useState(false);

  // 01 & 02 state
  const isProfileIncomplete = !profile.businessName.trim() || !profile.senderName.trim();
  const [manualIngestionOpen, setManualIngestionOpen] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  const [singleUrl, setSingleUrl] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [crawling, setCrawling] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [justEnrichedCount, setJustEnrichedCount] = useState<number | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [offeringEditorOpen, setOfferingEditorOpen] = useState(() => isProfileIncomplete);
  const [draftProfile, setDraftProfile] = useState<ProductProfile>(profile);
  const [tradesInput, setTradesInput] = useState(profile.targetTrades.join(', '));
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileGuardError, setProfileGuardError] = useState<string | null>(null);
  const [missingFields, setMissingFields] = useState<{
    businessName: boolean;
    senderName: boolean;
    promoBenefit: boolean;
  }>({
    businessName: false,
    senderName: false,
    promoBenefit: false,
  });
  const [feedback, setFeedback] = useState<{ type: 'info' | 'error'; text: string } | null>(null);
  const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null);
  const [editCompanyName, setEditCompanyName] = useState('');
  const [editContactName, setEditContactName] = useState('');
  const [editTradeSpecialty, setEditTradeSpecialty] = useState('');
  const [customEmailInput, setCustomEmailInput] = useState('');
  const [savingLeadId, setSavingLeadId] = useState<string | null>(null);
  const [recrawlingId, setRecrawlingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const directoryRef = useRef<HTMLElement | null>(null);
  const section02Ref = useRef<HTMLElement | null>(null);
  const businessNameInputRef = useRef<HTMLInputElement | null>(null);
  const senderNameInputRef = useRef<HTMLInputElement | null>(null);
  const promoBenefitInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraftProfile(profile);
    setTradesInput(profile.targetTrades.join(', '));
    if (!profile.businessName.trim() || !profile.senderName.trim()) {
      setOfferingEditorOpen(true);
    }
  }, [profile]);

  useEffect(() => {
    setSearchConfigDraft(settings.searchConfig);
  }, [settings.searchConfig]);

  const crawledOrAll = useMemo(() => leads, [leads]);

  const { duplicateAliasByLeadId, duplicateAliasIds } = useMemo(() => {
    const scoreLead = (l: LeadRecord): number => {
      let s = 0;
      if (l.status === 'sent') s += 200;
      else if (l.status === 'approved') s += 150;
      else if (l.status === 'pending_review') s += 100;
      if (l.crawlMode === 'live') s += 20;
      const email = (l.recommendedEmail || l.discoveredEmails[0]?.email || '').toLowerCase();
      const cand = l.discoveredEmails.find((e) => e.email.toLowerCase() === email);
      if (cand && !cand.isRoleFallback && cand.source !== 'mx_role_fallback') s += 10;
      return s;
    };

    const ownerByEmail = new Map<string, LeadRecord>();
    const sortedForOwnership = [...leads].sort((a, b) => scoreLead(b) - scoreLead(a));
    for (const lead of sortedForOwnership) {
      const email = (lead.recommendedEmail || lead.discoveredEmails[0]?.email || '')
        .trim()
        .toLowerCase();
      if (!email) continue;
      if (!ownerByEmail.has(email)) {
        ownerByEmail.set(email, lead);
      }
    }

    const dupMap = new Map<
      string,
      { primaryLeadId: string; primaryDomain: string; email: string }
    >();
    for (const lead of leads) {
      const email = (lead.recommendedEmail || lead.discoveredEmails[0]?.email || '')
        .trim()
        .toLowerCase();
      if (!email) continue;
      const owner = ownerByEmail.get(email);
      if (owner && owner.id !== lead.id) {
        dupMap.set(lead.id, {
          primaryLeadId: owner.id,
          primaryDomain: owner.domain,
          email,
        });
      }
    }

    return {
      duplicateAliasByLeadId: dupMap,
      duplicateAliasIds: Array.from(dupMap.keys()),
    };
  }, [leads]);

  const effectiveSelectedLeads = useMemo(() => {
    if (selectedIds.length > 0) {
      return leads.filter((l) => selectedIds.includes(l.id));
    }
    const nonDupes = leads.filter((l) => !duplicateAliasByLeadId.has(l.id));
    const unenriched = nonDupes.filter((l) => l.status === 'crawled');
    return unenriched.length > 0 ? unenriched : nonDupes;
  }, [leads, selectedIds, duplicateAliasByLeadId]);

  const searchFallbackPrompt = useMemo(() => {
    return [
      `Search the web for 20 real local "${searchTrade}" businesses operating in or near "${searchLocation}".`,
      `Exclude all directories and social sites (no yelp.com, yellowpages.com, facebook.com, bbb.org, angi.com, homeadvisor.com, linkedin.com, mapquest.com).`,
      `Return ONLY a plain list of their official company root website domains, one domain per line (for example: companyname.com).`,
    ].join('\n');
  }, [searchTrade, searchLocation]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === leads.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(leads.map((l) => l.id));
    }
  };

  const toggleDiscoveredSelect = (id: string) => {
    setSelectedDiscoveredIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAllDiscovered = () => {
    if (selectedDiscoveredIds.length === discoveredList.length) {
      setSelectedDiscoveredIds([]);
    } else {
      setSelectedDiscoveredIds(discoveredList.map((d) => d.id));
    }
  };

  const isExternalSearchActive =
    settings.searchConfig.provider !== 'builtin_zero_key' &&
    ((settings.searchConfig.provider === 'custom' &&
      Boolean(settings.searchConfig.customEndpoint.trim())) ||
      (settings.searchConfig.provider !== 'custom' && Boolean(settings.searchConfig.apiKey.trim())));

  const handleSaveSearchConfig = async (nextConfig: SearchApiConfig) => {
    setSavingSearchConfig(true);
    setFeedback(null);
    try {
      await onUpdateSettings({ searchConfig: nextConfig });
      const label =
        SEARCH_PROVIDERS.find((p) => p.id === nextConfig.provider)?.label || nextConfig.provider;
      setFeedback({
        type: 'info',
        text: `Search discovery provider saved: ${label}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save search settings',
      });
    } finally {
      setSavingSearchConfig(false);
    }
  };

  const handleDiscoverBusinesses = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!searchTrade.trim() || !searchLocation.trim()) {
      setFeedback({
        type: 'error',
        text: 'Enter both a Target Trade / Keyword and a Target Location.',
      });
      return;
    }
    setFeedback(null);
    setDiscovering(true);
    try {
      const searchChanged =
        searchConfigDraft.provider !== settings.searchConfig.provider ||
        searchConfigDraft.apiKey !== settings.searchConfig.apiKey ||
        searchConfigDraft.customEndpoint !== settings.searchConfig.customEndpoint;
      if (searchChanged) {
        await onUpdateSettings({ searchConfig: searchConfigDraft });
      }

      const res = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trade: searchTrade.trim(),
          location: searchLocation.trim(),
          searchConfig: searchConfigDraft,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Auto-discovery failed');

      const results = Array.isArray(data.results) ? (data.results as DiscoveredBusiness[]) : [];
      setDiscoveredList(results);
      setSelectedDiscoveredIds(results.map((r) => r.id));
      const providerUsed = (data.providerUsed as SearchApiProvider) || 'builtin_zero_key';
      setDiscoverMeta({
        providerUsed,
        sources: data.sources || { yellowpages: 0, duckduckgo: 0, searchApi: 0 },
        rateLimited: Boolean(data.rateLimited),
      });

      if (results.length === 0) {
        setShowSearchPromptFallback(true);
        setFeedback({
          type: 'error',
          text: data.rateLimited
            ? 'Public search engines rate-limited this request. Configure an optional Search API above or use the Zero-API Directory Search Prompt.'
            : `No direct company domains found for "${searchTrade}" in "${searchLocation}". Try a broader trade keyword or use the Zero-API Directory Search Prompt.`,
        });
      } else {
        const usedLabel =
          providerUsed === 'builtin_zero_key'
            ? '$0.00 cost'
            : `${SEARCH_PROVIDERS.find((p) => p.id === providerUsed)?.label || providerUsed}`;
        setFeedback({
          type: 'info',
          text: `Discovered ${results.length} official company domains for "${searchTrade}" in ${searchLocation} (${usedLabel}). Select domains and click "Send Selected to Crawler & Run".`,
        });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Discovery search failed',
      });
    } finally {
      setDiscovering(false);
    }
  };

  const handleSendDiscoveredToCrawler = async () => {
    const selected = discoveredList.filter((d) => selectedDiscoveredIds.includes(d.id));
    if (selected.length === 0) {
      setFeedback({ type: 'error', text: 'Select at least one discovered domain to crawl.' });
      return;
    }
    await runCrawlTargets(
      selected.map((s) => ({
        url: s.websiteUrl,
        companyName: s.companyName,
      }))
    );
  };

  const getDiscoveredExportScope = () => {
    const selected = discoveredList.filter((d) => selectedDiscoveredIds.includes(d.id));
    return selected.length > 0 ? selected : discoveredList;
  };

  const handleExportDiscoveredTxt = () => {
    const items = getDiscoveredExportScope();
    if (items.length === 0) return;
    const content = items
      .map((item) => `${item.companyName} | https://${item.domain} | ${item.locality}`)
      .join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = 'discovered-businesses.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const handleCopyDiscoveredDomains = async () => {
    const items = getDiscoveredExportScope();
    if (items.length === 0) return;
    await navigator.clipboard.writeText(items.map((i) => i.domain).join('\n'));
    setCopiedDomains(true);
    setTimeout(() => setCopiedDomains(false), 1800);
  };

  const handleRemoveDiscoveredRow = (id: string) => {
    setDiscoveredList((prev) => prev.filter((item) => item.id !== id));
    setSelectedDiscoveredIds((prev) => prev.filter((itemId) => itemId !== id));
  };

  const handleRemoveSelectedDiscovered = () => {
    if (selectedDiscoveredIds.length === 0) return;
    const toRemove = new Set(selectedDiscoveredIds);
    setDiscoveredList((prev) => prev.filter((item) => !toRemove.has(item.id)));
    setSelectedDiscoveredIds([]);
  };

  const handleClearDiscovered = () => {
    setDiscoveredList([]);
    setSelectedDiscoveredIds([]);
    setDiscoverMeta(null);
  };

  const runCrawlTargets = async (targets: Array<{ url: string; companyName?: string }>) => {
    if (targets.length === 0) return;
    setFeedback(null);
    setCrawling(true);
    try {
      const res = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Crawl failed');
      onLeadsUpdated(data.leads);
      const errCount = Array.isArray(data.errors) ? data.errors.length : 0;
      const crawledCount = Array.isArray(data.crawled) ? data.crawled.length : 0;
      setFeedback({
        type: errCount > 0 && crawledCount === 0 ? 'error' : 'info',
        text:
          errCount > 0
            ? `Crawled ${crawledCount} domain(s). ${errCount} error(s) (${data.errors[0]?.url}: ${data.errors[0]?.error})`
            : `Crawled ${crawledCount} domain(s) with live HTTP + DNS MX verification.`,
      });
      setBulkInput('');
      setSingleUrl('');
      if (crawledCount > 0) {
        setTimeout(() => {
          directoryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 60);
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Crawl error',
      });
    } finally {
      setCrawling(false);
    }
  };

  const runCrawl = async (urls: string[]) => {
    await runCrawlTargets(urls.map((url) => ({ url })));
  };

  const handleCsvUpload = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const tokens = text
      .split(/[\r\n,;]+/)
      .map((t) => t.trim().replace(/^["']|["']$/g, ''))
      .filter((t) => t.includes('.') && !t.toLowerCase().includes('domain'));
    if (tokens.length === 0) {
      setFeedback({ type: 'error', text: 'No valid domain columns found in CSV.' });
      return;
    }
    await runCrawl(tokens.slice(0, 25));
  };

  const ensureProfileConfiguredForOutreach = async (): Promise<boolean> => {
    const missingBusiness = !draftProfile.businessName.trim();
    const missingSender = !draftProfile.senderName.trim();
    const missingPromoBenefit =
      Boolean(draftProfile.promoCode.trim()) && !draftProfile.promoBenefit.trim();

    if (missingBusiness || missingSender || missingPromoBenefit) {
      setOfferingEditorOpen(true);
      setMissingFields({
        businessName: missingBusiness,
        senderName: missingSender,
        promoBenefit: missingPromoBenefit,
      });
      const msg =
        missingBusiness || missingSender
          ? 'Please enter your Business Name and Sender Name first.'
          : 'Please enter the Exact Meaning of your Promo Code (Promo Benefit) so AI never guesses its terms.';
      setProfileGuardError(msg);
      setFeedback({ type: 'error', text: msg });
      setTimeout(() => {
        section02Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (missingBusiness) {
          businessNameInputRef.current?.focus();
        } else if (missingSender) {
          senderNameInputRef.current?.focus();
        } else {
          promoBenefitInputRef.current?.focus();
        }
      }, 60);
      return false;
    }

    setMissingFields({ businessName: false, senderName: false, promoBenefit: false });
    setProfileGuardError(null);

    const parsedTrades = tradesInput
      .split(/[\r\n,]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const needsSync =
      !profile.businessName.trim() ||
      !profile.senderName.trim() ||
      draftProfile.businessName !== profile.businessName ||
      draftProfile.websiteUrl !== profile.websiteUrl ||
      draftProfile.senderName !== profile.senderName ||
      draftProfile.senderContext !== profile.senderContext ||
      draftProfile.valueProp !== profile.valueProp ||
      draftProfile.standardOffer !== profile.standardOffer ||
      draftProfile.promoCode !== profile.promoCode ||
      draftProfile.promoBenefit !== profile.promoBenefit ||
      draftProfile.valueSnippet !== profile.valueSnippet ||
      draftProfile.callToAction !== profile.callToAction ||
      parsedTrades.join(',') !== profile.targetTrades.join(',');

    if (needsSync) {
      const nextProfile: ProductProfile = {
        ...draftProfile,
        websiteUrl: draftProfile.websiteUrl.trim(),
        targetTrades: parsedTrades,
      };
      await onSaveProfile(nextProfile);
    }

    return true;
  };

  const handleOpenManualBatchClick = async () => {
    if (effectiveSelectedLeads.length === 0) {
      setFeedback({ type: 'error', text: 'Load or crawl at least one target domain first.' });
      return;
    }
    const ok = await ensureProfileConfiguredForOutreach();
    if (!ok) return;
    onOpenManualBatch(effectiveSelectedLeads);
  };

  const handleEnrich = async () => {
    if (effectiveSelectedLeads.length === 0) {
      setFeedback({ type: 'error', text: 'Load or crawl at least one target domain first.' });
      return;
    }
    const ok = await ensureProfileConfiguredForOutreach();
    if (!ok) return;
    if (settings.extractionMode === 'manual_batch') {
      onOpenManualBatch(effectiveSelectedLeads);
      return;
    }

    const activeConfig =
      settings.extractionMode === 'local_llm' ? settings.localConfig : settings.externalConfig;
    if (!activeConfig.baseUrl.trim() || !activeConfig.modelId.trim()) {
      setFeedback({
        type: 'error',
        text: `Configure your ${settings.extractionMode === 'local_llm' ? 'Local LLM' : 'External API'} Base URL and Model ID first.`,
      });
      onOpenEngineSetup(settings.extractionMode);
      return;
    }

    setFeedback(null);
    setJustEnrichedCount(null);
    setEnriching(true);
    try {
      const res = await fetch('/api/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadIds: effectiveSelectedLeads.map((l) => l.id),
          overrideMode: settings.extractionMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Enrichment failed');
      onLeadsUpdated(data.leads);
      const count = data.enriched?.length || 0;
      setJustEnrichedCount(count);
      setFeedback({
        type: 'info',
        text: `Generated ${count} personalized outreach email(s) via ${activeConfig.modelId}. Ready in Review Queue.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Enrichment failed',
      });
    } finally {
      setEnriching(false);
    }
  };

  const handleDeleteLead = async (id: string) => {
    const res = await fetch(`/api/leads/${id}`, { method: 'DELETE' });
    if (res.ok) {
      const data = await res.json();
      onLeadsUpdated(data.leads);
      setSelectedIds((prev) => prev.filter((item) => item !== id));
      if (expandedLeadId === id) setExpandedLeadId(null);
    }
  };

  const toggleExpandLead = (lead: LeadRecord) => {
    if (expandedLeadId === lead.id) {
      setExpandedLeadId(null);
      return;
    }
    setExpandedLeadId(lead.id);
    setEditCompanyName(lead.companyName || '');
    setEditContactName(lead.primaryContactName || '');
    setEditTradeSpecialty(lead.tradeSpecialty || '');
    setCustomEmailInput('');
  };

  const handlePatchLead = async (
    leadId: string,
    patch: Partial<LeadRecord>,
    successMsg: string
  ) => {
    setSavingLeadId(leadId);
    setFeedback(null);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update target');
      onLeadsUpdated(data.leads);
      setFeedback({ type: 'info', text: successMsg });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update target',
      });
    } finally {
      setSavingLeadId(null);
    }
  };

  const handleRecrawlLead = async (lead: LeadRecord) => {
    setRecrawlingId(lead.id);
    setFeedback(null);
    try {
      const res = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: [lead.domain],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Re-crawl failed');
      onLeadsUpdated(data.leads);
      const updated = (data.leads as LeadRecord[]).find((l) => l.domain === lead.domain);
      if (updated && expandedLeadId === lead.id) {
        setEditCompanyName(updated.companyName || '');
        setEditContactName(updated.primaryContactName || '');
        setEditTradeSpecialty(updated.tradeSpecialty || '');
      }
      setFeedback({
        type: 'info',
        text: `Re-crawled ${lead.domain} (${updated?.crawlMode === 'blocked' ? 'HTTP Blocked (MX Checked)' : `${updated?.pagesCrawled.length || 0} pages, ${updated?.discoveredEmails.length || 0} email candidates`}).`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Re-crawl failed',
      });
    } finally {
      setRecrawlingId(null);
    }
  };

  const handleBatchDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    setBulkDeleting(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/leads/batch', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Batch delete failed');
      onLeadsUpdated(data.leads);
      if (expandedLeadId && selectedIds.includes(expandedLeadId)) {
        setExpandedLeadId(null);
      }
      setSelectedIds([]);
      setFeedback({
        type: 'info',
        text: `Deleted ${data.deletedCount ?? selectedIds.length} selected target(s) from SQLite.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Batch delete failed',
      });
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleBatchRecrawlSelected = async () => {
    const selectedLeads = leads.filter((l) => selectedIds.includes(l.id));
    if (selectedLeads.length === 0) return;
    setFeedback(null);
    setCrawling(true);
    try {
      const domains = selectedLeads.map((l) => l.domain);
      let latestLeads = leads;
      let totalCrawled = 0;
      for (let i = 0; i < domains.length; i += 25) {
        const chunk = domains.slice(i, i + 25);
        const res = await fetch('/api/crawl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: chunk }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Batch re-crawl failed');
        latestLeads = data.leads;
        totalCrawled += Array.isArray(data.crawled) ? data.crawled.length : chunk.length;
      }
      onLeadsUpdated(latestLeads);
      setFeedback({
        type: 'info',
        text: `Re-crawled ${totalCrawled} selected domain(s) with live HTTP + MX checks.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Batch re-crawl failed',
      });
    } finally {
      setCrawling(false);
    }
  };

  const handleClearEntireTable = async () => {
    setBulkDeleting(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/leads/batch', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to clear table');
      onLeadsUpdated(data.leads);
      setSelectedIds([]);
      setExpandedLeadId(null);
      setConfirmClearAll(false);
      setFeedback({
        type: 'info',
        text: `Cleared all ${data.deletedCount ?? 0} lead(s) from SQLite. Ready for a fresh batch.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to clear table',
      });
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleDeduplicateAliases = async () => {
    if (duplicateAliasIds.length === 0) return;
    setBulkDeleting(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/leads/batch', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: duplicateAliasIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Deduplication failed');
      onLeadsUpdated(data.leads);
      if (expandedLeadId && duplicateAliasIds.includes(expandedLeadId)) {
        setExpandedLeadId(null);
      }
      setSelectedIds((prev) => prev.filter((id) => !duplicateAliasIds.includes(id)));
      setFeedback({
        type: 'info',
        text: `Removed ${data.deletedCount ?? duplicateAliasIds.length} Duplicate Inbox Alias row(s) so each email is contacted once.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Deduplication failed',
      });
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleOpenOfferingEditor = () => {
    setDraftProfile(profile);
    setTradesInput(profile.targetTrades.join(', '));
    setMissingFields({ businessName: false, senderName: false, promoBenefit: false });
    setProfileGuardError(null);
    setOfferingEditorOpen((prev) => !prev);
  };

  const handleSaveInlineOffering = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const missingBusiness = !draftProfile.businessName.trim();
    const missingSender = !draftProfile.senderName.trim();
    const missingPromoBenefit =
      Boolean(draftProfile.promoCode.trim()) && !draftProfile.promoBenefit.trim();

    if (missingBusiness || missingSender || missingPromoBenefit) {
      setMissingFields({
        businessName: missingBusiness,
        senderName: missingSender,
        promoBenefit: missingPromoBenefit,
      });
      setProfileGuardError(
        missingBusiness || missingSender
          ? 'Please enter your Business Name and Sender Name first.'
          : 'Please enter the Exact Meaning of your Promo Code (Promo Benefit) so AI never guesses its terms.'
      );
      if (missingBusiness) {
        businessNameInputRef.current?.focus();
      } else if (missingSender) {
        senderNameInputRef.current?.focus();
      } else {
        promoBenefitInputRef.current?.focus();
      }
      return;
    }

    setSavingProfile(true);
    setFeedback(null);
    setProfileGuardError(null);
    setMissingFields({ businessName: false, senderName: false, promoBenefit: false });
    try {
      const parsedTrades = tradesInput
        .split(/[\r\n,]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const nextProfile: ProductProfile = {
        ...draftProfile,
        websiteUrl: draftProfile.websiteUrl.trim(),
        targetTrades: parsedTrades,
      };
      await onSaveProfile(nextProfile);
      if (parsedTrades.length > 0 && !searchTrade.trim()) {
        setSearchTrade(parsedTrades[0]);
      }
      setOfferingEditorOpen(false);
      setFeedback({
        type: 'info',
        text: `Active offering updated to "${nextProfile.businessName}". Trade chips & AI prompts are synced.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save offering profile',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleResetBlankOffering = async () => {
    setSavingProfile(true);
    setFeedback(null);
    setProfileGuardError(null);
    setMissingFields({ businessName: false, senderName: false, promoBenefit: false });
    try {
      setDraftProfile(BLANK_PRODUCT_PROFILE);
      setTradesInput('');
      await onSaveProfile(BLANK_PRODUCT_PROFILE);
      setOfferingEditorOpen(true);
      setFeedback({
        type: 'info',
        text: 'Cleared offering to a blank business profile. Enter your Business Name and Sender Name below.',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const extractionModeLabels: Array<{
    id: ExtractionMode;
    label: string;
    cost: string;
    detail: string;
    needsConfig: boolean;
  }> = [
    {
      id: 'manual_batch',
      label: 'Manual Batch',
      cost: '$0.00',
      detail: 'Copy raw prompt · paste JSON',
      needsConfig: false,
    },
    {
      id: 'local_llm',
      label: 'Local LLM',
      cost: '$0.00',
      detail: settings.localConfig.modelId.trim() || 'Click to configure model',
      needsConfig: !settings.localConfig.baseUrl.trim() || !settings.localConfig.modelId.trim(),
    },
    {
      id: 'external_api',
      label: 'External API (BYO Key)',
      cost: 'BYO Key',
      detail: settings.externalConfig.modelId.trim() || 'Click to configure model',
      needsConfig: !settings.externalConfig.baseUrl.trim() || !settings.externalConfig.modelId.trim(),
    },
  ];

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 px-6 py-6">
      {feedback && (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 border px-4 py-3 text-xs ${
            feedback.type === 'error'
              ? 'border-red-500/40 bg-red-950/25 text-red-300'
              : 'border-[#38bdf8]/40 bg-[#0d1822] text-[#bae6fd]'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {feedback.type === 'error' ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            ) : (
              <Check className="h-4 w-4 shrink-0 text-[#38bdf8]" />
            )}
            <span>{feedback.text}</span>
          </div>
          {leads.length > 0 && (
            <button
              type="button"
              onClick={() =>
                directoryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
              className="font-mono text-[11px] text-[#f59e0b] underline-offset-4 hover:underline"
            >
              Jump to {leads.length} discovered target(s)
            </button>
          )}
        </div>
      )}

      {/* Local Business Search */}
      <section className="border border-[#232832] bg-[#13161b] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#232832] pb-3">
          <div>
            <h2 className="text-sm font-semibold text-[#e6e9ef]">
              Local Business Search{' '}
              <span className="font-mono text-xs font-normal text-[#38bdf8]">
                {isExternalSearchActive ? '(Search API)' : '($0.00)'}
              </span>
            </h2>
            <p className="mt-0.5 text-xs text-[#9aa3b2]">
              {isExternalSearchActive
                ? `Using ${
                    SEARCH_PROVIDERS.find((p) => p.id === settings.searchConfig.provider)?.label ||
                    settings.searchConfig.provider
                  } to pull company domains.`
                : 'Queries public listings and filters out directory/social domains.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setEnhanceSearchOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 border px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                enhanceSearchOpen || isExternalSearchActive
                  ? 'border-[#f59e0b]/70 bg-[#171b21] text-[#f59e0b]'
                  : 'border-[#323947] bg-[#171b21] text-[#e6e9ef] hover:border-[#f59e0b]'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Search API
            </button>
            <button
              type="button"
              onClick={() => setShowSearchPromptFallback((v) => !v)}
              className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#171b21] px-3 py-1.5 text-xs font-medium text-[#38bdf8] hover:border-[#38bdf8] whitespace-nowrap shrink-0"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Search Prompt
            </button>
          </div>
        </div>

        {/* Collapsible Search API Enhancement Drawer */}
        {enhanceSearchOpen && (
          <div className="mt-4 space-y-3 border border-[#323947] bg-[#0d0f12] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#232832] pb-2">
              <div>
                <span className="font-mono text-xs font-semibold text-[#f59e0b]">
                  Optional Search API Enhancement
                </span>
                <p className="mt-0.5 text-[11px] text-[#9aa3b2]">
                  Saved locally in SQLite &amp; <span className="font-mono text-[#e6e9ef]">user-settings.json</span>. Leave on Default ($0.00) or blank to use the built-in zero-key scraper.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEnhanceSearchOpen(false)}
                className="border border-[#232832] px-2.5 py-1 text-[11px] text-[#9aa3b2] hover:text-[#e6e9ef]"
              >
                Collapse
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <label className="block text-xs md:col-span-5">
                <span className="text-[11px] text-[#9aa3b2]">Search Provider</span>
                <select
                  value={searchConfigDraft.provider}
                  onChange={(e) =>
                    setSearchConfigDraft((prev) => ({
                      ...prev,
                      provider: e.target.value as SearchApiProvider,
                    }))
                  }
                  className="mt-1 w-full border border-[#232832] bg-[#13161b] px-3 py-2 text-xs text-[#e6e9ef] focus:border-[#f59e0b] focus:outline-none"
                >
                  {SEARCH_PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>

              {searchConfigDraft.provider !== 'builtin_zero_key' && (
                <div className="text-xs md:col-span-7">
                  <label className="block text-[11px] text-[#9aa3b2]">
                    Search API Key{' '}
                    {searchConfigDraft.provider === 'custom' ? '(optional Bearer/X-API-KEY)' : '(BYO Key)'}
                  </label>
                  <div className="mt-1 flex items-center border border-[#232832] bg-[#13161b] focus-within:border-[#f59e0b]">
                    <input
                      type={showSearchApiKey ? 'text' : 'password'}
                      value={searchConfigDraft.apiKey}
                      onChange={(e) =>
                        setSearchConfigDraft((prev) => ({ ...prev, apiKey: e.target.value }))
                      }
                      autoComplete="off"
                      placeholder="Paste search API key (leave blank to use default scraper)"
                      className="w-full bg-transparent px-3 py-2 font-mono text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSearchApiKey((v) => !v)}
                      className="px-3 py-2 text-[#9aa3b2] hover:text-[#e6e9ef]"
                      aria-label={showSearchApiKey ? 'Hide Search API key' : 'Show Search API key'}
                    >
                      {showSearchApiKey ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {searchConfigDraft.provider === 'custom' && (
              <label className="block text-xs">
                <span className="text-[11px] text-[#9aa3b2]">
                  Custom Search Endpoint URL (supports GET with &#123;query&#125; placeholder or POST JSON)
                </span>
                <input
                  type="text"
                  value={searchConfigDraft.customEndpoint}
                  onChange={(e) =>
                    setSearchConfigDraft((prev) => ({ ...prev, customEndpoint: e.target.value }))
                  }
                  placeholder="e.g., https://search.example.com/api/search?q={query}"
                  className="mt-1 w-full border border-[#232832] bg-[#13161b] px-3 py-2 font-mono text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
                />
              </label>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-[#697386]">
                {SEARCH_PROVIDERS.find((p) => p.id === searchConfigDraft.provider)?.description}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={savingSearchConfig}
                  onClick={() => {
                    setSearchConfigDraft(BLANK_SEARCH_CONFIG);
                    handleSaveSearchConfig(BLANK_SEARCH_CONFIG);
                  }}
                  className="border border-[#232832] px-3 py-1.5 text-xs text-[#9aa3b2] hover:text-[#e6e9ef]"
                >
                  Reset to Default
                </button>
                <button
                  type="button"
                  disabled={savingSearchConfig}
                  onClick={() => handleSaveSearchConfig(searchConfigDraft)}
                  className="inline-flex items-center gap-1.5 bg-[#f59e0b] px-3.5 py-1.5 text-xs font-semibold text-[#0d0f12] hover:bg-[#fbbf24] disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  {savingSearchConfig ? 'Saving...' : 'Save Search Settings'}
                </button>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleDiscoverBusinesses} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <label htmlFor="search-trade" className="block text-xs font-medium text-[#9aa3b2]">
                Target Trade / Keyword
              </label>
              <div className="relative mt-1.5">
                <Search className="pointer-events-none absolute top-2.5 left-3 h-3.5 w-3.5 text-[#697386]" />
                <input
                  id="search-trade"
                  type="text"
                  value={searchTrade}
                  onChange={(e) => setSearchTrade(e.target.value)}
                  placeholder="e.g., Commercial Plumbers, HVAC Contractors"
                  className="w-full border border-[#232832] bg-[#0d0f12] py-2 pr-3 pl-9 text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
                />
              </div>
              {quickTrades.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {quickTrades.map((trade) => (
                    <button
                      key={trade}
                      type="button"
                      onClick={() => setSearchTrade(trade)}
                      className={`border px-2.5 py-1 text-[11px] transition-colors whitespace-nowrap ${
                        searchTrade === trade
                          ? 'border-[#f59e0b] bg-[#171b21] text-[#f59e0b]'
                          : 'border-[#232832] bg-[#0d0f12] text-[#9aa3b2] hover:text-[#e6e9ef]'
                      }`}
                    >
                      {trade}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-[#697386]">
                  Add Target Industries in your Offering profile below for quick-select chips.
                </p>
              )}
            </div>

            <div className="lg:col-span-4">
              <label htmlFor="search-location" className="block text-xs font-medium text-[#9aa3b2]">
                Target City / Region
              </label>
              <div className="relative mt-1.5">
                <MapPin className="pointer-events-none absolute top-2.5 left-3 h-3.5 w-3.5 text-[#697386]" />
                <input
                  id="search-location"
                  type="text"
                  value={searchLocation}
                  onChange={(e) => setSearchLocation(e.target.value)}
                  placeholder="e.g., Austin, TX"
                  className="w-full border border-[#232832] bg-[#0d0f12] py-2 pr-3 pl-9 text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-start lg:col-span-3 lg:pt-6">
              <button
                type="submit"
                disabled={discovering}
                className="inline-flex w-full items-center justify-center gap-2 bg-[#f59e0b] px-4 py-2 text-xs font-semibold text-[#0d0f12] transition-colors hover:bg-[#fbbf24] disabled:opacity-50 whitespace-nowrap"
              >
                {discovering ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
                {discovering ? 'Searching Public Listings...' : 'Find Local Businesses'}
              </button>
            </div>
          </div>
        </form>

        {/* Zero-API Directory Search Prompt Fallback Drawer */}
        {showSearchPromptFallback && (
          <div className="mt-4 space-y-3 border border-[#323947] bg-[#0d0f12] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#38bdf8]">
                Zero-API Directory Search Prompt (for any search-enabled web AI)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(searchFallbackPrompt);
                    setCopiedSearchPrompt(true);
                    setTimeout(() => setCopiedSearchPrompt(false), 1800);
                  }}
                  className="inline-flex items-center gap-1.5 bg-[#f59e0b] px-3 py-1.5 text-xs font-semibold text-[#0d0f12] hover:bg-[#fbbf24] whitespace-nowrap"
                >
                  {copiedSearchPrompt ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedSearchPrompt ? 'Copied Search Prompt' : 'Copy Search Prompt'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowSearchPromptFallback(false)}
                  className="border border-[#232832] px-2.5 py-1.5 text-xs text-[#9aa3b2] hover:text-[#e6e9ef]"
                >
                  Hide
                </button>
              </div>
            </div>
            <pre className="overflow-x-auto border border-[#232832] bg-[#13161b] p-3 font-mono text-[11px] leading-relaxed text-[#cbd5e1]">
              {searchFallbackPrompt}
            </pre>
            <p className="text-[11px] text-[#9aa3b2]">
              Paste the returned domains straight into{' '}
              <button
                type="button"
                onClick={() => setManualIngestionOpen(true)}
                className="font-mono text-[#f59e0b] underline-offset-2 hover:underline"
              >
                + Manual URLs / CSV Import
              </button>{' '}
              below to crawl all of them in one click.
            </p>
          </div>
        )}

        {/* Discovered Results Table */}
        {discoveredList.length > 0 && (
          <div className="mt-5 border border-[#232832] bg-[#0d0f12]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#232832] px-4 py-3">
              <div className="font-mono text-xs text-[#9aa3b2] tabular-nums">
                <span className="text-[#e6e9ef]">{discoveredList.length}</span> clean company domains ·{' '}
                {selectedDiscoveredIds.length} selected
                {discoverMeta
                  ? discoverMeta.providerUsed && discoverMeta.providerUsed !== 'builtin_zero_key'
                    ? ` (${
                        SEARCH_PROVIDERS.find((p) => p.id === discoverMeta.providerUsed)?.label ||
                        discoverMeta.providerUsed
                      }: ${discoverMeta.sources.searchApi ?? discoveredList.length})`
                    : ` (YellowPages: ${discoverMeta.sources.yellowpages} · DuckDuckGo: ${discoverMeta.sources.duckduckgo})`
                  : ''}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportDiscoveredTxt}
                  className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#171b21] px-3 py-2 text-xs font-medium text-[#e6e9ef] transition-colors hover:border-[#38bdf8] whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5 text-[#38bdf8]" />
                  Export Plain Text (.txt)
                </button>
                <button
                  type="button"
                  onClick={handleCopyDiscoveredDomains}
                  className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#171b21] px-3 py-2 text-xs font-medium text-[#e6e9ef] transition-colors hover:border-[#38bdf8] whitespace-nowrap"
                >
                  {copiedDomains ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-[#9aa3b2]" />
                  )}
                  {copiedDomains ? 'Copied Domains' : 'Copy Domains'}
                </button>
                {selectedDiscoveredIds.length > 0 && (
                  <button
                    type="button"
                    onClick={handleRemoveSelectedDiscovered}
                    className="inline-flex items-center gap-1.5 border border-red-500/40 bg-red-950/25 px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:border-red-400 whitespace-nowrap"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove Selected ({selectedDiscoveredIds.length})
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleClearDiscovered}
                  className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#13161b] px-3 py-2 text-xs font-medium text-[#9aa3b2] transition-colors hover:border-red-500/50 hover:text-red-300 whitespace-nowrap"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear Results
                </button>
                <button
                  type="button"
                  disabled={crawling || selectedDiscoveredIds.length === 0}
                  onClick={handleSendDiscoveredToCrawler}
                  className="inline-flex items-center gap-2 bg-[#f59e0b] px-4 py-2 text-xs font-semibold text-[#0d0f12] transition-colors hover:bg-[#fbbf24] disabled:opacity-50 whitespace-nowrap"
                >
                  {crawling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
                  {crawling
                    ? 'Crawling Selected...'
                    : `Send Selected to Crawler & Run (${selectedDiscoveredIds.length})`}
                </button>
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-[#13161b] text-[#9aa3b2]">
                  <tr className="border-b border-[#232832]">
                    <th className="w-10 px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={
                          selectedDiscoveredIds.length === discoveredList.length &&
                          discoveredList.length > 0
                        }
                        onChange={toggleSelectAllDiscovered}
                        aria-label="Select all discovered businesses"
                        className="h-3.5 w-3.5 accent-[#f59e0b]"
                      />
                    </th>
                    <th className="px-4 py-2.5 font-medium">Business Name</th>
                    <th className="px-4 py-2.5 font-medium">Official Domain</th>
                    <th className="px-4 py-2.5 font-medium">Locality / Trade</th>
                    <th className="px-4 py-2.5 text-right font-medium">Source</th>
                    <th className="w-12 px-4 py-2.5 text-right font-medium">Remove</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#232832]">
                  {discoveredList.map((item) => (
                    <tr key={item.id} className="hover:bg-[#171b21]">
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          checked={selectedDiscoveredIds.includes(item.id)}
                          onChange={() => toggleDiscoveredSelect(item.id)}
                          aria-label={`Select ${item.companyName}`}
                          className="h-3.5 w-3.5 accent-[#f59e0b]"
                        />
                      </td>
                      <td className="px-4 py-2.5 font-medium text-[#e6e9ef]">{item.companyName}</td>
                      <td className="px-4 py-2.5 font-mono">
                        <a
                          href={`https://${item.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-[#38bdf8] hover:underline"
                        >
                          {item.domain}
                          <ExternalLink className="h-3 w-3 shrink-0 opacity-80" />
                        </a>
                      </td>
                      <td className="px-4 py-2.5 text-[#9aa3b2]">
                        {item.locality} · {item.categories}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-[11px] text-[#9aa3b2]">
                        {item.source}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemoveDiscoveredRow(item.id)}
                          aria-label={`Remove ${item.domain}`}
                          className="p-1 text-[#697386] transition-colors hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Manual Target URLs / CSV Import */}
      <section className="border border-[#232832] bg-[#13161b]">
        <button
          type="button"
          onClick={() => setManualIngestionOpen((v) => !v)}
          aria-expanded={manualIngestionOpen}
          className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-[#171b21]"
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-xs font-semibold text-[#f59e0b]">
              {manualIngestionOpen ? '−' : '+'} Manual URLs / CSV Import
            </span>
            <span className="text-xs text-[#9aa3b2]">
              Paste domains, upload a CSV, or crawl a single URL
            </span>
          </div>
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-[#38bdf8] shrink-0">
            {manualIngestionOpen ? (
              <>
                Hide <ChevronDown className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                Expand <ChevronRight className="h-3.5 w-3.5" />
              </>
            )}
          </span>
        </button>

        {manualIngestionOpen && (
          <div className="space-y-4 border-t border-[#232832] p-5">
            <p className="text-xs text-[#9aa3b2]">
              Live HTTP crawl of root + up to 5 internal contact, about, team &amp; leadership links + DNS MX verification.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (singleUrl.trim()) runCrawl([singleUrl.trim()]);
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={singleUrl}
                onChange={(e) => setSingleUrl(e.target.value)}
                placeholder="Add single target (e.g. companydomain.com)"
                className="flex-1 border border-[#232832] bg-[#0d0f12] px-3 py-2 font-mono text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
              />
              <button
                type="submit"
                disabled={crawling || !singleUrl.trim()}
                className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#171b21] px-3.5 py-2 text-xs font-medium text-[#e6e9ef] hover:border-[#f59e0b] disabled:opacity-50 whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" />
                Crawl Target
              </button>
            </form>

            <div>
              <label htmlFor="bulk-urls" className="block text-xs font-medium text-[#9aa3b2]">
                Batch URLs or Domains (one per line)
              </label>
              <textarea
                id="bulk-urls"
                rows={4}
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
                placeholder="Enter one domain or URL per line (max 25)"
                className="mt-1.5 w-full border border-[#232832] bg-[#0d0f12] p-3 font-mono text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt"
                className="hidden"
                onChange={(e) => {
                  handleCsvUpload(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={crawling}
                className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#171b21] px-3 py-2 text-xs font-medium text-[#e6e9ef] hover:border-[#38bdf8] whitespace-nowrap"
              >
                <FileUp className="h-3.5 w-3.5" />
                Upload CSV
              </button>
              <button
                type="button"
                disabled={crawling || !bulkInput.trim()}
                onClick={() =>
                  runCrawl(
                    bulkInput
                      .split(/[\r\n,]+/)
                      .map((s) => s.trim())
                      .filter(Boolean)
                  )
                }
                className="inline-flex items-center gap-1.5 bg-[#f59e0b] px-4 py-2 text-xs font-semibold text-[#0d0f12] transition-colors hover:bg-[#fbbf24] disabled:opacity-50 whitespace-nowrap"
              >
                {crawling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
                {crawling ? 'Crawling...' : 'Run Crawler'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Outreach Draft Engine */}
      <section
        ref={section02Ref}
        className="flex flex-col justify-between border border-[#232832] bg-[#13161b] p-5"
      >
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#232832] pb-3">
              <div>
                <h2 className="text-sm font-semibold text-[#e6e9ef]">Outreach Draft Engine</h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[#9aa3b2]">
                  {isProfileIncomplete ? (
                    <span className="inline-flex items-center gap-1.5 border border-[#f59e0b]/50 bg-[#f59e0b]/10 px-2.5 py-1 text-xs font-medium text-[#f59e0b]">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      Enter your business name and sender name to personalize outreach
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleOpenOfferingEditor}
                      className="inline-flex items-center gap-1.5 text-left hover:text-[#e6e9ef]"
                    >
                      <span>
                        Active offering:{' '}
                        <span className="font-medium text-[#e6e9ef]">{profile.businessName}</span>
                        {profile.websiteUrl ? (
                          <span className="font-mono text-[#38bdf8]"> ({profile.websiteUrl})</span>
                        ) : null}
                        {' · '}Sender: <span className="text-[#e6e9ef]">{profile.senderName}</span>
                        {profile.promoCode ? (
                          <>
                            {' '}
                            · Promo <span className="font-mono text-[#f59e0b]">{profile.promoCode}</span>
                          </>
                        ) : null}
                      </span>
                      <span className="inline-flex items-center gap-1 border border-[#323947] bg-[#171b21] px-2 py-0.5 font-mono text-[10px] text-[#f59e0b]">
                        <Pencil className="h-2.5 w-2.5" />
                        {offeringEditorOpen ? 'Close' : 'Edit Offering'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onOpenEngineSetup()}
                className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#171b21] px-2.5 py-1 text-xs text-[#38bdf8] hover:border-[#38bdf8] whitespace-nowrap"
              >
                <Zap className="h-3 w-3" />
                Configure AI Engine
              </button>
            </div>

            {offeringEditorOpen && (
              <form
                onSubmit={handleSaveInlineOffering}
                className={`mt-4 space-y-3 border bg-[#0d0f12] p-4 ${
                  profileGuardError ? 'border-red-500/60' : 'border-[#323947]'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#232832] pb-2.5">
                  <span className="font-mono text-xs font-semibold text-[#f59e0b]">
                    Business Profile &amp; Explicit Offer Mechanics
                  </span>
                  <button
                    type="button"
                    disabled={savingProfile}
                    onClick={handleResetBlankOffering}
                    className="border border-[#323947] bg-[#13161b] px-2.5 py-1 text-[11px] font-medium text-[#e6e9ef] hover:border-[#f59e0b]"
                  >
                    Reset to Blank Profile
                  </button>
                </div>

                {profileGuardError && (
                  <div className="flex items-center gap-2 border border-red-500/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
                    <span>{profileGuardError}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-medium text-[#9aa3b2]">
                      Business or Product Name <span className="text-[#f59e0b]">*</span>
                    </label>
                    <input
                      ref={businessNameInputRef}
                      type="text"
                      value={draftProfile.businessName}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDraftProfile({ ...draftProfile, businessName: val });
                        if (val.trim()) {
                          setMissingFields((prev) => ({ ...prev, businessName: false }));
                          if (draftProfile.senderName.trim()) setProfileGuardError(null);
                        }
                      }}
                      placeholder="e.g., Acme Industrial Supply"
                      className={`mt-1 w-full border bg-[#13161b] px-2.5 py-1.5 text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:outline-none ${
                        missingFields.businessName
                          ? 'border-red-500 ring-1 ring-red-500/60 focus:border-red-400'
                          : 'border-[#232832] focus:border-[#f59e0b]'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#9aa3b2]">
                      Official Website URL
                    </label>
                    <input
                      type="text"
                      value={draftProfile.websiteUrl}
                      onChange={(e) =>
                        setDraftProfile({ ...draftProfile, websiteUrl: e.target.value })
                      }
                      placeholder="e.g., https://acmeindustrial.com"
                      className="mt-1 w-full border border-[#232832] bg-[#13161b] px-2.5 py-1.5 font-mono text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-medium text-[#9aa3b2]">
                      Sender Full Name &amp; Title <span className="text-[#f59e0b]">*</span>
                    </label>
                    <input
                      ref={senderNameInputRef}
                      type="text"
                      value={draftProfile.senderName}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDraftProfile({ ...draftProfile, senderName: val });
                        if (val.trim()) {
                          setMissingFields((prev) => ({ ...prev, senderName: false }));
                          if (draftProfile.businessName.trim()) setProfileGuardError(null);
                        }
                      }}
                      placeholder="e.g., Jordan Taylor, Founder"
                      className={`mt-1 w-full border bg-[#13161b] px-2.5 py-1.5 text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:outline-none ${
                        missingFields.senderName
                          ? 'border-red-500 ring-1 ring-red-500/60 focus:border-red-400'
                          : 'border-[#232832] focus:border-[#f59e0b]'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#9aa3b2]">
                      Local / Credibility Context (optional)
                    </label>
                    <input
                      type="text"
                      value={draftProfile.senderContext}
                      onChange={(e) =>
                        setDraftProfile({ ...draftProfile, senderContext: e.target.value })
                      }
                      placeholder="e.g., Local family-owned supplier"
                      className="mt-1 w-full border border-[#232832] bg-[#13161b] px-2.5 py-1.5 text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[#9aa3b2]">
                    Core Value Proposition / What Problem You Solve
                  </label>
                  <textarea
                    rows={2}
                    value={draftProfile.valueProp}
                    onChange={(e) =>
                      setDraftProfile({ ...draftProfile, valueProp: e.target.value })
                    }
                    placeholder="What your product does and why target customers reply..."
                    className="mt-1 w-full border border-[#232832] bg-[#13161b] px-2.5 py-1.5 text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-medium text-[#9aa3b2]">
                      Target Industries / Customer Types (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={tradesInput}
                      onChange={(e) => setTradesInput(e.target.value)}
                      placeholder="e.g., Commercial Plumbers, HVAC Contractors"
                      className="mt-1 w-full border border-[#232832] bg-[#13161b] px-2.5 py-1.5 text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#9aa3b2]">
                      Primary Offer or Trial Terms (optional)
                    </label>
                    <input
                      type="text"
                      value={draftProfile.standardOffer}
                      onChange={(e) =>
                        setDraftProfile({ ...draftProfile, standardOffer: e.target.value })
                      }
                      placeholder="e.g., 14-day free trial or Free on-site quote"
                      className="mt-1 w-full border border-[#232832] bg-[#13161b] px-2.5 py-1.5 text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[#9aa3b2]">
                      Promo Code (optional)
                    </label>
                    <input
                      type="text"
                      value={draftProfile.promoCode}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDraftProfile({ ...draftProfile, promoCode: val });
                        if (!val.trim()) {
                          setMissingFields((prev) => ({ ...prev, promoBenefit: false }));
                        }
                      }}
                      placeholder="Leave blank if none"
                      className="mt-1 w-full border border-[#232832] bg-[#13161b] px-2.5 py-1.5 font-mono text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-medium text-[#9aa3b2]">
                      Exact Meaning of Promo Code{' '}
                      {draftProfile.promoCode.trim() ? (
                        <span className="text-[#f59e0b]">* (required when code is set)</span>
                      ) : (
                        '(optional)'
                      )}
                    </label>
                    <input
                      ref={promoBenefitInputRef}
                      type="text"
                      value={draftProfile.promoBenefit}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDraftProfile({ ...draftProfile, promoBenefit: val });
                        if (val.trim()) {
                          setMissingFields((prev) => ({ ...prev, promoBenefit: false }));
                          if (draftProfile.businessName.trim() && draftProfile.senderName.trim()) {
                            setProfileGuardError(null);
                          }
                        }
                      }}
                      placeholder="e.g., Unlocks 50% off the first paid month AFTER the 14-day trial"
                      className={`mt-1 w-full border bg-[#13161b] px-2.5 py-1.5 text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:outline-none ${
                        missingFields.promoBenefit
                          ? 'border-red-500 ring-1 ring-red-500/60 focus:border-red-400'
                          : 'border-[#232832] focus:border-[#f59e0b]'
                      }`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-medium text-[#9aa3b2]">
                      Specific Hook / Proof Point / Live Data Snippet (optional)
                    </label>
                    <input
                      type="text"
                      value={draftProfile.valueSnippet}
                      onChange={(e) =>
                        setDraftProfile({ ...draftProfile, valueSnippet: e.target.value })
                      }
                      placeholder="e.g., Case study saving 6 hrs/week"
                      className="mt-1 w-full border border-[#232832] bg-[#13161b] px-2.5 py-1.5 text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#9aa3b2]">
                      Preferred Sign-off Question / CTA
                    </label>
                    <input
                      type="text"
                      value={draftProfile.callToAction}
                      onChange={(e) =>
                        setDraftProfile({ ...draftProfile, callToAction: e.target.value })
                      }
                      placeholder="e.g., Worth a quick look this week?"
                      className="mt-1 w-full border border-[#232832] bg-[#13161b] px-2.5 py-1.5 text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  {!isProfileIncomplete && (
                    <button
                      type="button"
                      onClick={() => setOfferingEditorOpen(false)}
                      className="border border-[#232832] px-3 py-1.5 text-xs text-[#9aa3b2] hover:text-[#e6e9ef]"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="inline-flex items-center gap-1.5 border border-emerald-500/60 bg-emerald-950/25 px-3.5 py-1.5 text-xs font-semibold text-emerald-300 transition-colors hover:border-emerald-400 hover:bg-emerald-950/45 disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {savingProfile ? 'Saving...' : 'Save Profile'}
                  </button>
                </div>
              </form>
            )}

            <div className="mt-4">
              <div className="text-xs font-medium text-[#9aa3b2]">Select Extraction Mode</div>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {extractionModeLabels.map((mode) => {
                  const active = settings.extractionMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => {
                        onUpdateSettings({ extractionMode: mode.id });
                        if (mode.needsConfig) {
                          onOpenEngineSetup(mode.id);
                        }
                      }}
                      className={`flex flex-col items-start border px-3.5 py-2.5 text-left transition-colors ${
                        active
                          ? 'border-[#f59e0b] bg-[#171b21]'
                          : 'border-[#232832] bg-[#0d0f12] hover:border-[#323947]'
                      }`}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className={`text-xs font-semibold ${active ? 'text-[#f59e0b]' : 'text-[#e6e9ef]'}`}>
                          {mode.label}
                        </span>
                        <span className="font-mono text-[11px] text-[#38bdf8]">{mode.cost}</span>
                      </div>
                      <span
                        className={`mt-1 w-full truncate font-mono text-[11px] ${
                          mode.needsConfig ? 'text-[#f59e0b]' : 'text-[#9aa3b2]'
                        }`}
                      >
                        {mode.detail}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-5 space-y-3 border-t border-[#232832] pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#9aa3b2]">
              <div>
                Target scope:{' '}
                <span className="font-mono text-[#e6e9ef] tabular-nums">
                  {effectiveSelectedLeads.length}{' '}
                  {selectedIds.length > 0 ? 'selected' : 'crawled / unenriched'} target(s)
                </span>
              </div>
              <span className="font-mono text-[11px] text-[#697386]">
                Mode:{' '}
                <span className="text-[#38bdf8]">
                  {settings.extractionMode === 'manual_batch'
                    ? 'Manual Batch ($0.00)'
                    : settings.extractionMode === 'local_llm'
                      ? settings.localConfig.modelId.trim() || 'Local LLM'
                      : settings.externalConfig.modelId.trim() || 'External API'}
                </span>
              </span>
            </div>

            {(() => {
              const enrichedDraftCount = leads.filter(
                (l) => l.status === 'pending_review' || l.status === 'approved'
              ).length;
              const targetCount = effectiveSelectedLeads.length;
              const isManual = settings.extractionMode === 'manual_batch';

              return (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
                  {isManual ? (
                    <button
                      type="button"
                      disabled={targetCount === 0}
                      onClick={handleOpenManualBatchClick}
                      className="inline-flex flex-1 items-center justify-center gap-2.5 bg-[#f59e0b] px-6 py-3.5 text-sm font-bold text-[#0d0f12] transition-colors hover:bg-[#fbbf24] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <span>
                        Copy Batch Prompt &amp; Paste JSON ({targetCount})
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={enriching || targetCount === 0}
                      onClick={handleEnrich}
                      className="inline-flex flex-1 items-center justify-center gap-2.5 bg-[#f59e0b] px-6 py-3.5 text-sm font-bold text-[#0d0f12] transition-colors hover:bg-[#fbbf24] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {enriching ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Generating Outreach Emails ({targetCount})...</span>
                        </>
                      ) : (
                        <span>
                          Generate Outreach Emails ({targetCount})
                        </span>
                      )}
                    </button>
                  )}

                  {enrichedDraftCount > 0 && (
                    <button
                      type="button"
                      onClick={onGoToReview}
                      className="inline-flex items-center justify-center gap-2 border border-emerald-400/70 bg-emerald-950/30 px-5 py-3 text-xs font-bold text-emerald-300 transition-colors hover:border-[#f59e0b] hover:text-[#f59e0b] whitespace-nowrap shrink-0"
                    >
                      Review Queue ({enrichedDraftCount}) →
                    </button>
                  )}
                </div>
              );
            })()}

            {enriching && (
              <div className="flex items-center justify-between gap-3 border border-[#38bdf8]/40 bg-[#0d1822] px-4 py-2.5 text-xs text-[#bae6fd]">
                <div className="flex items-center gap-2.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#38bdf8]" />
                  <span>
                    Generating plain-text outreach drafts for {effectiveSelectedLeads.length} target(s)...
                  </span>
                </div>
                <span className="font-mono text-[11px] text-[#38bdf8]">Running AI pipeline</span>
              </div>
            )}

            {justEnrichedCount !== null && justEnrichedCount > 0 && !enriching && (
              <div className="flex flex-wrap items-center justify-between gap-3 border border-emerald-500/50 bg-emerald-950/25 px-4 py-3 text-xs text-emerald-200">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span>
                    Generated <strong className="font-mono">{justEnrichedCount}</strong> personalized outreach email(s). Ready to review and send.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onGoToReview}
                  className="inline-flex items-center gap-1.5 bg-emerald-400 px-3.5 py-1.5 text-xs font-bold text-[#0d0f12] transition-colors hover:bg-emerald-300 whitespace-nowrap"
                >
                  Go to Review Queue →
                </button>
              </div>
            )}
          </div>
        </section>

      {/* Discovered Targets */}
      <section ref={directoryRef} id="target-directory" className="border border-[#232832] bg-[#13161b]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#232832] px-5 py-3.5">
          <div>
            <h3 className="text-sm font-semibold text-[#e6e9ef]">Discovered Targets</h3>
            <p className="mt-0.5 text-[11px] text-[#9aa3b2]">
              Click a row to inspect emails, edit contact details, or re-crawl.
            </p>
          </div>
          <span className="font-mono text-xs text-[#697386] tabular-nums">
            {crawledOrAll.length} domain(s)
          </span>
        </div>

        {crawledOrAll.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <p className="text-sm font-medium text-[#e6e9ef]">No targets ingested yet</p>
            <p className="mt-1 max-w-md text-xs text-[#9aa3b2]">
              Use Local Business Search above to discover official company domains automatically, or paste domains into Manual Target Ingestion.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            {/* Bulk Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#232832] bg-[#0d0f12] px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-[#9aa3b2] hover:text-[#e6e9ef]">
                  <input
                    type="checkbox"
                    checked={selectedIds.length === leads.length && leads.length > 0}
                    onChange={toggleSelectAll}
                    aria-label="Select all targets"
                    className="h-3.5 w-3.5 accent-[#f59e0b]"
                  />
                  <span className="font-mono text-[11px]">
                    {selectedIds.length > 0
                      ? `${selectedIds.length} of ${leads.length} selected`
                      : `Select All (${leads.length})`}
                  </span>
                </label>

                {selectedIds.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 border-l border-[#232832] pl-3">
                    <button
                      type="button"
                      disabled={bulkDeleting || crawling}
                      onClick={handleBatchDeleteSelected}
                      className="inline-flex items-center gap-1.5 border border-red-500/40 bg-red-950/25 px-3 py-1.5 font-mono text-[11px] font-medium text-red-300 transition-colors hover:border-red-400 hover:bg-red-950/45 disabled:opacity-50 whitespace-nowrap"
                    >
                      {bulkDeleting ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                      Delete Selected ({selectedIds.length})
                    </button>

                    <button
                      type="button"
                      disabled={crawling || bulkDeleting}
                      onClick={handleBatchRecrawlSelected}
                      className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#171b21] px-3 py-1.5 font-mono text-[11px] font-medium text-[#38bdf8] transition-colors hover:border-[#38bdf8] disabled:opacity-50 whitespace-nowrap"
                    >
                      {crawling ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      Re-Crawl Selected ({selectedIds.length})
                    </button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {duplicateAliasIds.length > 0 && (
                  <button
                    type="button"
                    disabled={bulkDeleting || crawling}
                    onClick={handleDeduplicateAliases}
                    className="inline-flex items-center gap-1.5 border border-[#f59e0b]/50 bg-[#1a150b] px-3 py-1.5 font-mono text-[11px] font-medium text-[#f59e0b] transition-colors hover:border-[#f59e0b] disabled:opacity-50 whitespace-nowrap"
                  >
                    Deduplicate Shared Inboxes ({duplicateAliasIds.length})
                  </button>
                )}

                {confirmClearAll ? (
                  <>
                    <span className="font-mono text-[11px] text-amber-300">
                      Wipe all {leads.length} lead(s) from SQLite?
                    </span>
                    <button
                      type="button"
                      disabled={bulkDeleting}
                      onClick={handleClearEntireTable}
                      className="inline-flex items-center gap-1.5 border border-red-500/50 bg-red-950/40 px-3 py-1.5 font-mono text-[11px] font-semibold text-red-200 hover:border-red-400 disabled:opacity-50 whitespace-nowrap"
                    >
                      Confirm Clear All
                    </button>
                    <button
                      type="button"
                      disabled={bulkDeleting}
                      onClick={() => setConfirmClearAll(false)}
                      className="border border-[#232832] bg-[#13161b] px-2.5 py-1.5 font-mono text-[11px] text-[#9aa3b2] hover:text-[#e6e9ef]"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={bulkDeleting || crawling}
                    onClick={() => setConfirmClearAll(true)}
                    className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#13161b] px-3 py-1.5 font-mono text-[11px] font-medium text-[#9aa3b2] transition-colors hover:border-red-500/50 hover:text-red-300 disabled:opacity-50 whitespace-nowrap"
                  >
                    <Trash2 className="h-3 w-3" />
                    Clear Entire Table
                  </button>
                )}
              </div>
            </div>

            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#232832] bg-[#0d0f12] text-[#9aa3b2]">
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.length === leads.length && leads.length > 0}
                      onChange={toggleSelectAll}
                      aria-label="Select all targets in header"
                      className="h-3.5 w-3.5 accent-[#f59e0b]"
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">Domain & Company</th>
                  <th className="px-4 py-3 font-medium">Priority Contact</th>
                  <th className="px-4 py-3 font-medium">MX & Crawl Scope</th>
                  <th className="px-4 py-3 font-medium">Leadership</th>
                  <th className="px-4 py-3 font-medium">State</th>
                  <th className="px-4 py-3 text-right font-medium">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#232832]">
                {crawledOrAll.map((lead) => {
                  const activeEmail = lead.recommendedEmail || lead.discoveredEmails[0]?.email || '';
                  const activeCandidate =
                    lead.discoveredEmails.find(
                      (e) => e.email.toLowerCase() === activeEmail.toLowerCase()
                    ) || lead.discoveredEmails[0];
                  const isExpanded = expandedLeadId === lead.id;
                  const duplicateInfo = duplicateAliasByLeadId.get(lead.id);

                  return (
                    <Fragment key={lead.id}>
                      <tr
                        onClick={() => toggleExpandLead(lead)}
                        className={`cursor-pointer transition-colors ${
                          isExpanded ? 'bg-[#171b21]' : 'hover:bg-[#171b21]'
                        }`}
                      >
                        <td
                          className="px-4 py-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(lead.id)}
                              onChange={() => toggleSelect(lead.id)}
                              aria-label={`Select ${lead.domain}`}
                              className="h-3.5 w-3.5 accent-[#f59e0b]"
                            />
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5 text-[#f59e0b]" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-[#697386]" />
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-[#e6e9ef]">
                            {lead.companyName || lead.domain}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1 font-mono text-[11px]">
                            <a
                              href={`https://${lead.domain}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-[#38bdf8] hover:underline"
                            >
                              {lead.domain}
                              <ExternalLink className="h-3 w-3 shrink-0 opacity-80" />
                            </a>
                            {lead.tradeSpecialty ? (
                              <span className="text-[#9aa3b2]">· {lead.tradeSpecialty}</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {activeEmail ? (
                            <div>
                              <div className="font-mono text-[#e6e9ef]">{activeEmail}</div>
                              <div className="mt-0.5 text-[11px] text-[#9aa3b2]">
                                {activeCandidate?.priority === 'named'
                                  ? 'Named inbox'
                                  : activeCandidate?.priority === 'desk'
                                    ? 'Estimating / Desk'
                                    : 'General inbox'}{' '}
                                · {lead.discoveredEmails.length} scraped
                              </div>
                              {duplicateInfo && (
                                <div className="mt-1 font-mono text-[11px] text-amber-400">
                                  Duplicate Inbox Alias (shared with {duplicateInfo.primaryDomain})
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="font-mono text-[11px] text-[#f59e0b]">
                              No Email Found · click to add
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] tabular-nums">
                          <div className={activeCandidate?.mxValid ? 'text-emerald-400' : 'text-amber-400'}>
                            {activeCandidate?.mxValid
                              ? `MX Valid (${activeCandidate.mxHost || 'DNS'})`
                              : 'MX Unverified'}
                          </div>
                          <div className="mt-0.5 text-[#9aa3b2]">
                            {lead.pagesCrawled.length} pages ·{' '}
                            <span
                              className={
                                lead.crawlMode === 'blocked' ? 'text-amber-400' : 'text-[#9aa3b2]'
                              }
                            >
                              {lead.crawlMode === 'live'
                                ? 'Live HTTP'
                                : 'HTTP Blocked (MX Checked)'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[#9aa3b2]">
                          {lead.leadershipNames.length > 0
                            ? lead.leadershipNames.slice(0, 2).join(', ')
                            : '—'}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px]">
                          <span
                            className={
                              lead.status === 'approved'
                                ? 'text-emerald-400'
                                : lead.status === 'pending_review'
                                  ? 'text-[#f59e0b]'
                                  : lead.status === 'rejected'
                                    ? 'text-red-400'
                                    : 'text-[#9aa3b2]'
                            }
                          >
                            {lead.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td
                          className="px-4 py-3 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => handleDeleteLead(lead.id)}
                            aria-label={`Delete ${lead.domain}`}
                            className="p-1.5 text-[#697386] transition-colors hover:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-[#0d0f12]">
                          <td colSpan={7} className="border-t border-[#232832] px-5 py-5">
                            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                              {/* All Discovered Emails & Primary Selector */}
                              <div className="space-y-3 lg:col-span-7">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <h4 className="font-mono text-xs font-semibold text-[#e6e9ef]">
                                    All Email Candidates ({lead.discoveredEmails.length})
                                  </h4>
                                  <span className="font-mono text-[11px] text-[#9aa3b2]">
                                    Primary: <span className="text-[#f59e0b]">{activeEmail || 'None'}</span>
                                  </span>
                                </div>

                                {lead.discoveredEmails.length > 0 ? (
                                  <div className="max-h-64 divide-y divide-[#232832] overflow-y-auto border border-[#232832] bg-[#13161b]">
                                    {lead.discoveredEmails.map((cand, idx) => {
                                      const isSelectedPrimary =
                                        cand.email.toLowerCase() === activeEmail.toLowerCase();
                                      return (
                                        <div
                                          key={`${cand.email}-${idx}`}
                                          className={`flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 text-xs ${
                                            isSelectedPrimary ? 'bg-[#171b21]' : ''
                                          }`}
                                        >
                                          <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                              <span className="font-mono text-[#e6e9ef]">
                                                {cand.email}
                                              </span>
                                              {cand.source === 'manual_custom' && (
                                                <span className="border border-[#38bdf8]/40 bg-[#0d1822] px-1.5 py-0.5 font-mono text-[10px] text-[#38bdf8]">
                                                  Manual Entry
                                                </span>
                                              )}
                                            </div>
                                            <div className="mt-0.5 font-mono text-[11px] text-[#9aa3b2]">
                                              {cand.priority} · src: {cand.source} ·{' '}
                                              <span
                                                className={
                                                  cand.mxValid ? 'text-emerald-400' : 'text-amber-400'
                                                }
                                              >
                                                {cand.mxValid
                                                  ? `MX OK (${cand.mxHost || 'DNS'})`
                                                  : 'MX unverified'}
                                              </span>
                                            </div>
                                          </div>

                                          <button
                                            type="button"
                                            disabled={savingLeadId === lead.id || isSelectedPrimary}
                                            onClick={() =>
                                              handlePatchLead(
                                                lead.id,
                                                { recommendedEmail: cand.email },
                                                `Primary contact email set to ${cand.email}`
                                              )
                                            }
                                            className={`px-2.5 py-1 font-mono text-[11px] transition-colors whitespace-nowrap ${
                                              isSelectedPrimary
                                                ? 'border border-[#f59e0b] bg-[#1a150b] text-[#f59e0b]'
                                                : 'border border-[#323947] bg-[#0d0f12] text-[#e6e9ef] hover:border-[#38bdf8] hover:text-[#38bdf8]'
                                            }`}
                                          >
                                            {isSelectedPrimary ? 'Primary Active' : 'Set Primary'}
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="border border-[#232832] bg-[#13161b] px-3.5 py-4 text-xs text-[#9aa3b2]">
                                    No email candidates discovered automatically. Add a custom contact email below.
                                  </div>
                                )}

                                {/* Custom Email Entry */}
                                <form
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    const cleaned = customEmailInput.trim().toLowerCase();
                                    if (!cleaned || !cleaned.includes('@')) return;
                                    handlePatchLead(
                                      lead.id,
                                      { recommendedEmail: cleaned },
                                      `Added custom email ${cleaned} as primary contact.`
                                    );
                                    setCustomEmailInput('');
                                  }}
                                  className="flex flex-wrap gap-2"
                                >
                                  <input
                                    type="email"
                                    value={customEmailInput}
                                    onChange={(e) => setCustomEmailInput(e.target.value)}
                                    placeholder={`Enter custom email (e.g. name@${lead.domain})`}
                                    className="min-w-[220px] flex-1 border border-[#232832] bg-[#13161b] px-3 py-2 font-mono text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#38bdf8] focus:outline-none"
                                  />
                                  <button
                                    type="submit"
                                    disabled={savingLeadId === lead.id || !customEmailInput.includes('@')}
                                    className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#171b21] px-3 py-2 text-xs font-medium text-[#38bdf8] hover:border-[#38bdf8] disabled:opacity-50 whitespace-nowrap"
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                    Set Custom Email
                                  </button>
                                </form>
                              </div>

                              {/* Inline Contact Editor & Re-crawl Inspector */}
                              <div className="space-y-4 border border-[#232832] bg-[#13161b] p-4 lg:col-span-5">
                                <div className="flex items-center justify-between border-b border-[#232832] pb-2.5">
                                  <h4 className="font-mono text-xs font-semibold text-[#e6e9ef]">
                                    Inline Target & Contact Editor
                                  </h4>
                                  <button
                                    type="button"
                                    disabled={recrawlingId === lead.id}
                                    onClick={() => handleRecrawlLead(lead)}
                                    className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#171b21] px-2.5 py-1 text-[11px] font-medium text-[#38bdf8] hover:border-[#38bdf8] disabled:opacity-50 whitespace-nowrap"
                                  >
                                    {recrawlingId === lead.id ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <RefreshCw className="h-3 w-3" />
                                    )}
                                    {recrawlingId === lead.id ? 'Re-crawling...' : 'Re-crawl Domain'}
                                  </button>
                                </div>

                                <div className="space-y-3">
                                  <div>
                                    <label className="block text-[11px] font-medium text-[#9aa3b2]">
                                      Company Name
                                    </label>
                                    <input
                                      type="text"
                                      value={editCompanyName}
                                      onChange={(e) => setEditCompanyName(e.target.value)}
                                      className="mt-1 w-full border border-[#232832] bg-[#0d0f12] px-3 py-1.5 text-xs text-[#e6e9ef] focus:border-[#f59e0b] focus:outline-none"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[11px] font-medium text-[#9aa3b2]">
                                      Primary Contact Name
                                    </label>
                                    <input
                                      type="text"
                                      value={editContactName}
                                      onChange={(e) => setEditContactName(e.target.value)}
                                      className="mt-1 w-full border border-[#232832] bg-[#0d0f12] px-3 py-1.5 text-xs text-[#e6e9ef] focus:border-[#f59e0b] focus:outline-none"
                                    />
                                    {lead.leadershipNames.length > 0 && (
                                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                                        {lead.leadershipNames.map((person, idx) => (
                                          <button
                                            key={`${person}-${idx}`}
                                            type="button"
                                            onClick={() => setEditContactName(person)}
                                            className="border border-[#232832] bg-[#0d0f12] px-2 py-0.5 text-[11px] text-[#9aa3b2] hover:border-[#38bdf8] hover:text-[#38bdf8]"
                                          >
                                            Use {person}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>

                                  <div>
                                    <label className="block text-[11px] font-medium text-[#9aa3b2]">
                                      Industry / Specialty
                                    </label>
                                    <input
                                      type="text"
                                      value={editTradeSpecialty}
                                      onChange={(e) => setEditTradeSpecialty(e.target.value)}
                                      placeholder="e.g., Commercial Plumbers, HVAC Contractors"
                                      className="mt-1 w-full border border-[#232832] bg-[#0d0f12] px-3 py-1.5 text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
                                    />
                                  </div>

                                  <button
                                    type="button"
                                    disabled={savingLeadId === lead.id}
                                    onClick={() =>
                                      handlePatchLead(
                                        lead.id,
                                        {
                                          companyName: editCompanyName.trim() || lead.domain,
                                          primaryContactName:
                                            editContactName.trim() || 'Primary Contact',
                                          tradeSpecialty: editTradeSpecialty.trim(),
                                        },
                                        `Saved contact details for ${lead.domain}.`
                                      )
                                    }
                                    className="inline-flex items-center gap-1.5 bg-[#f59e0b] px-3.5 py-1.5 text-xs font-semibold text-[#0d0f12] hover:bg-[#fbbf24] disabled:opacity-50"
                                  >
                                    <Save className="h-3.5 w-3.5" />
                                    Save Contact Details
                                  </button>
                                </div>

                                <div className="space-y-1.5 border-t border-[#232832] pt-3 font-mono text-[11px] text-[#9aa3b2]">
                                  {lead.crawlNote && (
                                    <div className="text-amber-300">Note: {lead.crawlNote}</div>
                                  )}
                                  <div>
                                    Phones: {lead.phones.length > 0 ? lead.phones.join(' · ') : 'None found'}
                                  </div>
                                  <div>
                                    Crawled URLs ({lead.pagesCrawled.length}):
                                    {lead.pagesCrawled.length > 0 ? (
                                      <ul className="mt-1 space-y-0.5 text-[#697386]">
                                        {Array.from(new Set(lead.pagesCrawled)).map((u, idx) => (
                                          <li key={`${u}-${idx}`} className="truncate">
                                            {u}
                                          </li>
                                        ))}
                                      </ul>
                                    ) : (
                                      ' None (HTTP blocked or unreachable)'
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
