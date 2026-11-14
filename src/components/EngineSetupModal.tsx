import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import {
  PROVIDER_PRESETS,
  type ExtractionMode,
  type OpenAiEngineConfig,
  type ProviderPresetId,
  type UserSettings,
} from '../shared/types.ts';

interface EngineSetupModalProps {
  open: boolean;
  settings: UserSettings;
  initialMode?: ExtractionMode | null;
  onClose: () => void;
  onSaveSettings: (next: UserSettings) => Promise<void>;
}

export function EngineSetupModal({
  open,
  settings,
  initialMode,
  onClose,
  onSaveSettings,
}: EngineSetupModalProps) {
  const [draft, setDraft] = useState<UserSettings>(settings);
  const [showApiKey, setShowApiKey] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const comboboxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setDraft({
        ...settings,
        extractionMode: initialMode || settings.extractionMode,
      });
      setShowApiKey(false);
      setDropdownOpen(false);
      setFeedback(null);
    }
  }, [open, settings, initialMode]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (comboboxRef.current && !comboboxRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [dropdownOpen]);

  const activeSlot: 'localConfig' | 'externalConfig' =
    draft.extractionMode === 'local_llm' ? 'localConfig' : 'externalConfig';
  const activeConfig: OpenAiEngineConfig = draft[activeSlot];

  const filteredModels = useMemo(() => {
    const q = activeConfig.modelId.trim().toLowerCase();
    const list = activeConfig.discoveredModels;
    if (!q) return list;
    const matches = list.filter((m) => m.toLowerCase().includes(q));
    return matches.length > 0 ? matches : list;
  }, [activeConfig.discoveredModels, activeConfig.modelId]);

  if (!open) return null;

  const updateActiveConfig = (patch: Partial<OpenAiEngineConfig>) => {
    setDraft((prev) => {
      const slot = prev.extractionMode === 'local_llm' ? 'localConfig' : 'externalConfig';
      return {
        ...prev,
        [slot]: {
          ...prev[slot],
          ...patch,
        },
      };
    });
  };

  const handleSelectPreset = (presetId: ProviderPresetId) => {
    const preset = PROVIDER_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setDraft((prev) => {
      const nextMode: ExtractionMode =
        preset.category === 'local'
          ? 'local_llm'
          : preset.category === 'external'
            ? 'external_api'
            : prev.extractionMode === 'manual_batch'
              ? 'external_api'
              : prev.extractionMode;
      const targetSlot = nextMode === 'local_llm' ? 'localConfig' : 'externalConfig';
      const currentSlot = prev[targetSlot];
      return {
        ...prev,
        extractionMode: nextMode,
        [targetSlot]: {
          ...currentSlot,
          preset: preset.id,
          baseUrl: preset.id === 'custom' ? currentSlot.baseUrl : preset.baseUrl,
        },
      };
    });
    setFeedback(null);
  };

  const handleFetchModels = async () => {
    if (!activeConfig.baseUrl.trim()) {
      setFeedback({ ok: false, message: 'Enter or select a Provider Base URL first.' });
      return;
    }
    setFetchingModels(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/ai/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: activeConfig.baseUrl.trim(),
          apiKey: activeConfig.apiKey.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFeedback({
          ok: false,
          message:
            data.error ||
            'Could not fetch /models. You can still type any custom Model ID manually below.',
        });
        return;
      }
      const models = Array.isArray(data.models) ? (data.models as string[]) : [];
      updateActiveConfig({
        discoveredModels: models,
      });
      if (models.length > 0) {
        setDropdownOpen(true);
      }
      setFeedback({
        ok: true,
        message:
          models.length > 0
            ? `Fetched ${models.length} text model(s) from ${data.endpointUsed}. Pick from the dropdown or type any custom Model ID.`
            : `Connected to ${data.endpointUsed}, no text models returned — type your Model ID manually below.`,
      });
    } catch (err) {
      setFeedback({
        ok: false,
        message: err instanceof Error ? err.message : 'Failed to fetch models',
      });
    } finally {
      setFetchingModels(false);
    }
  };

  const handleTestConnection = async () => {
    if (!activeConfig.baseUrl.trim()) {
      setFeedback({ ok: false, message: 'Enter or select a Provider Base URL first.' });
      return;
    }
    if (!activeConfig.modelId.trim()) {
      setFeedback({ ok: false, message: 'Select or type a Model ID before testing.' });
      return;
    }
    setTestingConnection(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: activeConfig.baseUrl.trim(),
          apiKey: activeConfig.apiKey.trim(),
          modelId: activeConfig.modelId.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFeedback({
          ok: false,
          message: data.error || 'Connection test failed.',
        });
        return;
      }
      setFeedback({
        ok: true,
        message: `Verified ${activeConfig.modelId.trim()} via ${data.endpointUsed} (${data.latencyMs}ms · reply: "${data.reply}").`,
      });
    } catch (err) {
      setFeedback({
        ok: false,
        message: err instanceof Error ? err.message : 'Connection test failed',
      });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveSettings({ ...draft, configured: true });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDismiss = async () => {
    if (!settings.configured) {
      await onSaveSettings({ ...settings, configured: true });
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="engine-setup-title"
    >
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col border border-[#323947] bg-[#13161b]">
        <div className="flex items-center justify-between border-b border-[#232832] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Zap className="h-4 w-4 text-[#f59e0b]" />
            <div>
              <h2 id="engine-setup-title" className="text-base font-semibold text-[#e6e9ef]">
                Configure AI Engine (OpenAI-Compatible)
              </h2>
              <p className="mt-0.5 text-xs text-[#9aa3b2]">
                100% provider-agnostic proxy persisted in local SQLite &amp;{' '}
                <span className="font-mono text-[#e6e9ef]">user-settings.json</span> — zero hardcoded models or keys.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            className="border border-[#232832] p-1.5 text-[#9aa3b2] hover:text-[#e6e9ef]"
            aria-label="Close engine setup"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {/* Extraction Mode Selector Cards */}
          <div className="space-y-2.5">
            {(
              [
                {
                  id: 'manual_batch',
                  icon: Sparkles,
                  title: 'A. Manual Batch Mode ($0.00)',
                  badge: 'Zero API Config',
                  subtitle:
                    'Export crawled website prompts and paste JSON from any external AI chat window.',
                },
                {
                  id: 'local_llm',
                  icon: Cpu,
                  title: 'B. Local LLM ($0.00)',
                  badge: draft.localConfig.modelId || 'No model configured',
                  subtitle:
                    'Connect to Ollama, LM Studio, or any local OpenAI-compatible inference server on your machine.',
                },
                {
                  id: 'external_api',
                  icon: Globe,
                  title: 'C. External API (BYO Key)',
                  badge: draft.externalConfig.modelId || 'No model configured',
                  subtitle:
                    'Connect any OpenAI-compatible cloud provider (Gemini OpenAI-Compat, OpenRouter, OpenAI, Groq, or custom URL).',
                },
              ] as Array<{
                id: ExtractionMode;
                icon: typeof Sparkles;
                title: string;
                badge: string;
                subtitle: string;
              }>
            ).map((opt) => {
              const Icon = opt.icon;
              const active = draft.extractionMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setDraft((prev) => ({ ...prev, extractionMode: opt.id }));
                    setFeedback(null);
                    setDropdownOpen(false);
                  }}
                  className={`flex w-full items-start gap-3 border p-3.5 text-left transition-colors ${
                    active
                      ? 'border-[#f59e0b] bg-[#171b21]'
                      : 'border-[#232832] bg-[#0d0f12] hover:border-[#323947]'
                  }`}
                >
                  <Icon
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      active ? 'text-[#f59e0b]' : 'text-[#9aa3b2]'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className={`text-xs font-semibold ${
                          active ? 'text-[#f59e0b]' : 'text-[#e6e9ef]'
                        }`}
                      >
                        {opt.title}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="max-w-[220px] truncate font-mono text-[11px] text-[#38bdf8]">
                          {opt.badge}
                        </span>
                        {active && <CheckCircle2 className="h-4 w-4 text-[#f59e0b] shrink-0" />}
                      </div>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-[#9aa3b2]">{opt.subtitle}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Unified OpenAI-Compatible Configuration Panel */}
          {draft.extractionMode !== 'manual_batch' && (
            <div className="space-y-4 border border-[#232832] bg-[#0d0f12] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#232832] pb-2.5">
                <span className="font-mono text-xs font-semibold text-[#f59e0b]">
                  {draft.extractionMode === 'local_llm'
                    ? 'Local OpenAI-Compatible Endpoint'
                    : 'External API (BYO Key) — OpenAI-Compatible Endpoint'}
                </span>
                <span className="font-mono text-[10px] text-[#9aa3b2]">
                  POST &#123;BaseURL&#125;/chat/completions (Server Proxy)
                </span>
              </div>

              {/* a) Provider Preset Selector + Editable Base URL */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block text-xs">
                  <span className="text-[11px] text-[#9aa3b2]">Provider Preset</span>
                  <select
                    value={activeConfig.preset}
                    onChange={(e) => handleSelectPreset(e.target.value as ProviderPresetId)}
                    className="mt-1 w-full border border-[#232832] bg-[#13161b] px-3 py-2 text-xs text-[#e6e9ef] focus:border-[#f59e0b] focus:outline-none"
                  >
                    {PROVIDER_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs">
                  <span className="text-[11px] text-[#9aa3b2]">Base URL (Editable)</span>
                  <input
                    type="text"
                    value={activeConfig.baseUrl}
                    onChange={(e) => updateActiveConfig({ baseUrl: e.target.value })}
                    placeholder="e.g., http://localhost:11434/v1 or https://api.openai.com/v1"
                    className="mt-1 w-full border border-[#232832] bg-[#13161b] px-3 py-2 font-mono text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
                  />
                </label>
              </div>

              {/* b) Password-Masked API Key */}
              <div>
                <label className="block text-[11px] text-[#9aa3b2]">
                  API Key{' '}
                  {draft.extractionMode === 'local_llm'
                    ? '(optional for local servers)'
                    : '(stored locally, never hardcoded)'}
                </label>
                <div className="mt-1 flex items-center border border-[#232832] bg-[#13161b] focus-within:border-[#f59e0b]">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={activeConfig.apiKey}
                    onChange={(e) => updateActiveConfig({ apiKey: e.target.value })}
                    autoComplete="off"
                    placeholder={
                      draft.extractionMode === 'local_llm'
                        ? 'Leave blank for local Ollama / LM Studio'
                        : 'Paste your provider API key'
                    }
                    className="w-full bg-transparent px-3 py-2 font-mono text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((v) => !v)}
                    className="px-3 py-2 text-[#9aa3b2] hover:text-[#e6e9ef]"
                    aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                  >
                    {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* c) Dynamic Model Selector + Search/Custom Combobox + Fetch Models + d) Test Connection */}
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-end gap-2.5">
                  <div ref={comboboxRef} className="relative min-w-[240px] flex-1">
                    <label className="block text-[11px] text-[#9aa3b2]">
                      Model ID (Search fetched models or type any custom ID)
                    </label>
                    <div className="mt-1 flex items-center border border-[#232832] bg-[#13161b] focus-within:border-[#f59e0b]">
                      <input
                        type="text"
                        value={activeConfig.modelId}
                        onFocus={() => {
                          if (activeConfig.discoveredModels.length > 0) setDropdownOpen(true);
                        }}
                        onChange={(e) => {
                          updateActiveConfig({ modelId: e.target.value });
                          if (activeConfig.discoveredModels.length > 0) setDropdownOpen(true);
                        }}
                        placeholder="Type any Model ID or click Fetch Models"
                        className="w-full bg-transparent px-3 py-2 font-mono text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:outline-none"
                      />
                      {activeConfig.discoveredModels.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setDropdownOpen((v) => !v)}
                          aria-label="Toggle fetched models list"
                          className="border-l border-[#232832] px-2.5 py-2 text-[#9aa3b2] hover:text-[#e6e9ef]"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {dropdownOpen && activeConfig.discoveredModels.length > 0 && (
                      <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto border border-[#323947] bg-[#13161b] shadow-xl">
                        <div className="sticky top-0 flex items-center justify-between border-b border-[#232832] bg-[#0d0f12] px-3 py-1.5 font-mono text-[10px] text-[#9aa3b2]">
                          <span>
                            {filteredModels.length} text model(s)
                            {activeConfig.discoveredModels.length !== filteredModels.length
                              ? ` (filtered from ${activeConfig.discoveredModels.length})`
                              : ''}
                          </span>
                          <button
                            type="button"
                            onClick={() => setDropdownOpen(false)}
                            className="text-[#9aa3b2] hover:text-[#e6e9ef]"
                          >
                            Close
                          </button>
                        </div>
                        {filteredModels.map((modelName) => {
                          const isSelected = activeConfig.modelId === modelName;
                          return (
                            <button
                              key={modelName}
                              type="button"
                              onClick={() => {
                                updateActiveConfig({ modelId: modelName });
                                setDropdownOpen(false);
                              }}
                              className={`flex w-full items-center justify-between px-3 py-1.5 text-left font-mono text-xs transition-colors ${
                                isSelected
                                  ? 'bg-[#171b21] text-[#f59e0b]'
                                  : 'text-[#e6e9ef] hover:bg-[#171b21]'
                              }`}
                            >
                              <span className="truncate">{modelName}</span>
                              {isSelected && <Check className="h-3 w-3 shrink-0 text-[#f59e0b]" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={fetchingModels || testingConnection}
                    onClick={handleFetchModels}
                    className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#171b21] px-3.5 py-2 text-xs font-medium text-[#38bdf8] hover:border-[#38bdf8] disabled:opacity-50 whitespace-nowrap"
                  >
                    {fetchingModels ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    Fetch Models
                  </button>

                  <button
                    type="button"
                    disabled={testingConnection || fetchingModels}
                    onClick={handleTestConnection}
                    className="inline-flex items-center gap-1.5 border border-[#f59e0b]/60 bg-[#171b21] px-3.5 py-2 text-xs font-medium text-[#f59e0b] hover:border-[#f59e0b] disabled:opacity-50 whitespace-nowrap"
                  >
                    {testingConnection ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Zap className="h-3.5 w-3.5" />
                    )}
                    Test Connection
                  </button>
                </div>

                {activeConfig.discoveredModels.length > 0 && (
                  <p className="font-mono text-[10px] text-[#697386]">
                    {activeConfig.discoveredModels.length} non-embedding text model(s) cached. Clear text in Model ID to view full list or type any custom ID.
                  </p>
                )}
              </div>

              {feedback && (
                <div
                  className={`border px-3 py-2 font-mono text-[11px] ${
                    feedback.ok
                      ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300'
                      : 'border-amber-500/40 bg-amber-950/20 text-amber-200'
                  }`}
                >
                  {feedback.message}
                </div>
              )}
            </div>
          )}

          {/* Local Persistence Path */}
          <div className="border border-[#232832] bg-[#0d0f12] px-4 py-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[#9aa3b2]">Local SQLite Ledger Path:</span>
              <span className="font-mono text-[#e6e9ef]">{draft.dbPath}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[#232832] px-6 py-4">
          <button
            type="button"
            onClick={handleDismiss}
            className="border border-[#232832] px-4 py-2 text-xs font-medium text-[#9aa3b2] hover:text-[#e6e9ef]"
          >
            Continue with Current Mode
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="inline-flex items-center gap-2 bg-[#f59e0b] px-4 py-2 text-xs font-semibold text-[#0d0f12] hover:bg-[#fbbf24] disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : 'Save Engine Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
