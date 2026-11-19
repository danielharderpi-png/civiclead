import { useEffect, useState } from 'react';
import { Download, Zap } from 'lucide-react';
import { DiscoveryView } from './components/DiscoveryView.tsx';
import { EngineSetupModal } from './components/EngineSetupModal.tsx';
import { ExportBatchModal } from './components/ExportBatchModal.tsx';
import { ManualBatchModal } from './components/ManualBatchModal.tsx';
import { ProductProfileView } from './components/ProductProfileView.tsx';
import { ReviewQueueView } from './components/ReviewQueueView.tsx';
import {
  DEFAULT_PRODUCT_PROFILE,
  DEFAULT_USER_SETTINGS,
  normalizeProductProfile,
  normalizeUserSettings,
  type ExtractionMode,
  type LeadRecord,
  type ProductProfile,
  type UserSettings,
} from './shared/types.ts';

type WorkspaceTab = 'discovery' | 'review' | 'settings';

const PROFILE_STORAGE_KEY = 'civiclead_profile_v1';
const SETTINGS_STORAGE_KEY = 'civiclead_user_settings_v1';
const LEADS_STORAGE_KEY = 'civiclead_leads_v1';

function sanitizeSettingsForBrowserStorage(s: UserSettings): UserSettings {
  return {
    ...s,
    localConfig: {
      ...s.localConfig,
      apiKey: s.localConfig.apiKey ? '••••••••' : '',
    },
    externalConfig: {
      ...s.externalConfig,
      apiKey: s.externalConfig.apiKey ? '••••••••' : '',
    },
    searchConfig: {
      ...s.searchConfig,
      apiKey: s.searchConfig.apiKey ? '••••••••' : '',
    },
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('discovery');
  const [profile, setProfile] = useState<ProductProfile>(() => {
    try {
      const cached = localStorage.getItem(PROFILE_STORAGE_KEY);
      return cached
        ? normalizeProductProfile(JSON.parse(cached) as Record<string, unknown>)
        : DEFAULT_PRODUCT_PROFILE;
    } catch {
      return DEFAULT_PRODUCT_PROFILE;
    }
  });
  const [settings, setSettings] = useState<UserSettings>(() => {
    try {
      const cached = localStorage.getItem(SETTINGS_STORAGE_KEY);
      return cached
        ? normalizeUserSettings(JSON.parse(cached) as Record<string, unknown>)
        : DEFAULT_USER_SETTINGS;
    } catch {
      return DEFAULT_USER_SETTINGS;
    }
  });
  const [leads, setLeads] = useState<LeadRecord[]>(() => {
    try {
      const cached = localStorage.getItem(LEADS_STORAGE_KEY);
      return cached ? (JSON.parse(cached) as LeadRecord[]) : [];
    } catch {
      return [];
    }
  });
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [engineModalOpen, setEngineModalOpen] = useState(false);
  const [engineInitialMode, setEngineInitialMode] = useState<ExtractionMode | null>(null);
  const [manualBatchLeads, setManualBatchLeads] = useState<LeadRecord[] | null>(null);

  const openEngineSetup = (mode?: ExtractionMode) => {
    setEngineInitialMode(mode || null);
    setEngineModalOpen(true);
  };

  useEffect(() => {
    let cancelled = false;
    async function hydrateFromServer() {
      try {
        const [settingsRes, profileRes, leadsRes] = await Promise.all([
          fetch('/api/settings'),
          fetch('/api/profile'),
          fetch('/api/leads'),
        ]);
        if (cancelled) return;

        if (settingsRes.ok) {
          const sData = await settingsRes.json();
          if (sData.settings) {
            const normalized = normalizeUserSettings(sData.settings);
            setSettings(normalized);
            localStorage.setItem(
              SETTINGS_STORAGE_KEY,
              JSON.stringify(sanitizeSettingsForBrowserStorage(normalized))
            );
            if (!normalized.configured) {
              setEngineModalOpen(true);
            }
          }
        }
        if (profileRes.ok) {
          const pData = await profileRes.json();
          if (pData.profile) {
            setProfile(pData.profile);
            localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(pData.profile));
          }
        }
        if (leadsRes.ok) {
          const lData = await leadsRes.json();
          if (Array.isArray(lData.leads)) {
            setLeads(lData.leads);
            localStorage.setItem(LEADS_STORAGE_KEY, JSON.stringify(lData.leads));
          }
        }
      } catch {
        // Retain localStorage fallback seamlessly
      } finally {
        if (!cancelled) setLoadingInitial(false);
      }
    }
    hydrateFromServer();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLeadsUpdated = (nextLeads: LeadRecord[]) => {
    setLeads(nextLeads);
    try {
      localStorage.setItem(LEADS_STORAGE_KEY, JSON.stringify(nextLeads));
    } catch {
      // Ignore storage quota errors
    }
  };

  const handleSaveProfile = async (next: ProductProfile) => {
    setProfile(next);
    try {
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (res.ok) {
      const data = await res.json();
      setProfile(data.profile);
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(data.profile));
    }
  };

  const handleSaveSettings = async (next: UserSettings) => {
    setSettings(next);
    try {
      localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify(sanitizeSettingsForBrowserStorage(next))
      );
    } catch {
      // Ignore storage quota errors
    }
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!res.ok) {
      let errMsg = 'Failed to save settings';
      try {
        const errData = await res.json();
        if (errData?.error) errMsg = String(errData.error);
      } catch {
        // Ignore JSON parse errors on error response
      }
      throw new Error(errMsg);
    }
    const data = await res.json();
    const normalized = normalizeUserSettings(data.settings);
    setSettings(normalized);
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify(sanitizeSettingsForBrowserStorage(normalized))
    );
  };

  const handleUpdateSettingsPatch = async (patch: Partial<UserSettings>) => {
    await handleSaveSettings({ ...settings, ...patch });
  };

  const enrichedDraftCount = leads.filter(
    (l) => l.status === 'pending_review' || l.status === 'approved'
  ).length;

  return (
    <div className="min-h-screen bg-[#0d0f12] text-[#e6e9ef]">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 border-b border-[#232832] bg-[#0d0f12]/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-6 py-3.5">
          {/* Zone 1: Single-line Wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('discovery')}
            className="text-base font-bold tracking-tight text-[#e6e9ef] whitespace-nowrap shrink-0"
          >
            CivicLead Engine
          </button>

          {/* Zone 2: Clean Typography Nav Links */}
          <nav className="flex items-center gap-6 text-xs font-medium" aria-label="Workspace navigation">
            <button
              type="button"
              onClick={() => setActiveTab('discovery')}
              className={`border-b-2 py-1 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'discovery'
                  ? 'border-[#f59e0b] text-[#e6e9ef]'
                  : 'border-transparent text-[#9aa3b2] hover:text-[#e6e9ef]'
              }`}
            >
              Discovery
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('review')}
              className={`inline-flex items-center gap-1.5 border-b-2 py-1 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'review'
                  ? 'border-[#f59e0b] text-[#e6e9ef]'
                  : 'border-transparent text-[#9aa3b2] hover:text-[#e6e9ef]'
              }`}
            >
              <span>Review Queue</span>
              {enrichedDraftCount > 0 && (
                <span className="border border-emerald-500/50 bg-emerald-950/40 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-300 tabular-nums">
                  {enrichedDraftCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`border-b-2 py-1 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'settings'
                  ? 'border-[#f59e0b] text-[#e6e9ef]'
                  : 'border-transparent text-[#9aa3b2] hover:text-[#e6e9ef]'
              }`}
            >
              Product Profile
            </button>
          </nav>

          {/* Zone 3: Engine Setup & Secondary Export Action */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => openEngineSetup()}
              className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#171b21] px-3.5 py-2 text-xs font-medium text-[#38bdf8] transition-colors hover:border-[#38bdf8] whitespace-nowrap shrink-0"
            >
              <Zap className="h-3.5 w-3.5" />
              Configure AI Engine
            </button>
            <button
              type="button"
              onClick={() => setExportOpen(true)}
              className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#171b21] px-3.5 py-2 text-xs font-medium text-[#9aa3b2] transition-colors hover:border-[#38bdf8] hover:text-[#e6e9ef] whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              Export Batch
            </button>
          </div>
        </div>
      </header>

      <main>
        {loadingInitial ? (
          <div className="mx-auto max-w-[1440px] space-y-4 px-6 py-6">
            <div className="h-44 animate-pulse border border-[#232832] bg-[#13161b]" />
            <div className="h-64 animate-pulse border border-[#232832] bg-[#13161b]" />
          </div>
        ) : (
          <>
            {activeTab === 'discovery' && (
              <DiscoveryView
                leads={leads}
                profile={profile}
                settings={settings}
                onSaveProfile={handleSaveProfile}
                onUpdateSettings={handleUpdateSettingsPatch}
                onLeadsUpdated={handleLeadsUpdated}
                onOpenManualBatch={(selected) => setManualBatchLeads(selected)}
                onOpenEngineSetup={(mode) => openEngineSetup(mode)}
                onGoToReview={() => setActiveTab('review')}
              />
            )}
            {activeTab === 'review' && (
              <ReviewQueueView
                leads={leads}
                profile={profile}
                settings={settings}
                onLeadsUpdated={handleLeadsUpdated}
                onOpenManualBatch={(selected) => setManualBatchLeads(selected)}
                onGoToDiscovery={() => setActiveTab('discovery')}
                onOpenExport={() => setExportOpen(true)}
              />
            )}
            {activeTab === 'settings' && (
              <ProductProfileView
                profile={profile}
                settings={settings}
                onSaveProfile={handleSaveProfile}
                onOpenEngineSetup={() => openEngineSetup()}
              />
            )}
          </>
        )}
      </main>

      <EngineSetupModal
        open={engineModalOpen}
        settings={settings}
        initialMode={engineInitialMode}
        onClose={() => {
          setEngineModalOpen(false);
          setEngineInitialMode(null);
        }}
        onSaveSettings={handleSaveSettings}
      />

      <ManualBatchModal
        open={manualBatchLeads !== null}
        onClose={() => setManualBatchLeads(null)}
        leads={manualBatchLeads || []}
        profile={profile}
        onImportSuccess={(updatedLeads) => {
          handleLeadsUpdated(updatedLeads);
          setActiveTab('review');
        }}
      />

      <ExportBatchModal open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
}
