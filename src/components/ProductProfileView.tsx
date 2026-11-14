import { useEffect, useRef, useState } from 'react';
import { Check, Download, FilePlus2, Save, Upload, Zap } from 'lucide-react';
import {
  BLANK_PRODUCT_PROFILE,
  normalizeProductProfile,
  type ProductProfile,
  type UserSettings,
} from '../shared/types.ts';

interface ProductProfileViewProps {
  profile: ProductProfile;
  settings: UserSettings;
  onSaveProfile: (next: ProductProfile) => Promise<void>;
  onOpenEngineSetup: () => void;
}

export function ProductProfileView({
  profile,
  settings,
  onSaveProfile,
  onOpenEngineSetup,
}: ProductProfileViewProps) {
  const [form, setForm] = useState<ProductProfile>(profile);
  const [tradesInput, setTradesInput] = useState(profile.targetTrades.join(', '));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);
  const promoBenefitRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setForm(profile);
    setTradesInput(profile.targetTrades.join(', '));
  }, [profile]);

  const showTempNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 2400);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (form.promoCode.trim() && !form.promoBenefit.trim()) {
      setFormError(
        'Please enter the Exact Meaning of your Promo Code (Promo Benefit) so AI never guesses its terms.'
      );
      promoBenefitRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const parsedTrades = tradesInput
        .split(/[\r\n,]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      await onSaveProfile({ ...form, targetTrades: parsedTrades });
      showTempNotice('Saved profile to SQLite');
    } finally {
      setSaving(false);
    }
  };

  const handleResetBlank = async () => {
    setFormError(null);
    setForm(BLANK_PRODUCT_PROFILE);
    setTradesInput('');
    await onSaveProfile(BLANK_PRODUCT_PROFILE);
    showTempNotice('Reset to blank business template');
  };

  const handleExportProfileJson = () => {
    const slug =
      form.businessName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'business';
    const blob = new Blob([JSON.stringify(form, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}-profile.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportProfileJson = async (file: File | undefined) => {
    if (!file) return;
    setFormError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const merged = normalizeProductProfile(parsed);
      setForm(merged);
      setTradesInput(merged.targetTrades.join(', '));
      await onSaveProfile(merged);
      showTempNotice('Imported profile JSON');
    } catch {
      setFormError('Invalid profile JSON file.');
    }
  };

  return (
    <form onSubmit={handleSave} className="mx-auto max-w-[1440px] space-y-6 px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border border-[#232832] bg-[#13161b] px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-[#e6e9ef]">
            Product Profile
          </h2>
          <p className="mt-0.5 text-xs text-[#9aa3b2]">
            Outreach copy, target industries, promo terms, and sender headers load from this configuration.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={importRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              handleImportProfileJson(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={handleResetBlank}
            className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#171b21] px-3 py-2 text-xs font-medium text-[#e6e9ef] hover:border-[#f59e0b] whitespace-nowrap"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            Reset to Blank Template
          </button>
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#171b21] px-3 py-2 text-xs font-medium text-[#9aa3b2] hover:text-[#e6e9ef] whitespace-nowrap"
          >
            <Upload className="h-3.5 w-3.5" />
            Import JSON
          </button>
          <button
            type="button"
            onClick={handleExportProfileJson}
            className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#171b21] px-3 py-2 text-xs font-medium text-[#9aa3b2] hover:text-[#e6e9ef] whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            Export JSON
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 bg-[#f59e0b] px-4 py-2 text-xs font-semibold text-[#0d0f12] hover:bg-[#fbbf24] disabled:opacity-50 whitespace-nowrap"
          >
            {notice ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            {notice || (saving ? 'Saving...' : 'Save Profile')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Business & Offer Details */}
        <section className="space-y-4 border border-[#232832] bg-[#13161b] p-5 lg:col-span-7">
          <h3 className="border-b border-[#232832] pb-2.5 text-sm font-semibold text-[#e6e9ef]">
            Business &amp; Offer Details
          </h3>

          {(!form.businessName.trim() || !form.senderName.trim()) && (
            <div className="border border-[#f59e0b]/40 bg-[#f59e0b]/10 px-3 py-2 text-xs font-medium text-[#f59e0b]">
              Enter your business and sender name to personalize outreach.
            </div>
          )}

          {formError && (
            <div className="border border-red-500/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="font-medium text-[#9aa3b2]">Business or Product Name *</span>
              <input
                type="text"
                value={form.businessName}
                placeholder="e.g., Acme Industrial Supply"
                onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                className="mt-1.5 w-full border border-[#232832] bg-[#0d0f12] px-3 py-2 text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
              />
            </label>
            <label className="block text-xs">
              <span className="font-medium text-[#9aa3b2]">Official Website URL</span>
              <input
                type="text"
                value={form.websiteUrl}
                placeholder="e.g., https://acmeindustrial.com"
                onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })}
                className="mt-1.5 w-full border border-[#232832] bg-[#0d0f12] px-3 py-2 font-mono text-xs text-[#38bdf8] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="font-medium text-[#9aa3b2]">Sender Full Name & Title *</span>
              <input
                type="text"
                value={form.senderName}
                placeholder="e.g., Jordan Taylor, Founder"
                onChange={(e) => setForm({ ...form, senderName: e.target.value })}
                className="mt-1.5 w-full border border-[#232832] bg-[#0d0f12] px-3 py-2 text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
              />
            </label>
            <label className="block text-xs">
              <span className="font-medium text-[#9aa3b2]">Sender Email (optional, for RFC/CSV)</span>
              <input
                type="email"
                value={form.senderEmail}
                placeholder="e.g., jordan@acmeindustrial.com"
                onChange={(e) => setForm({ ...form, senderEmail: e.target.value })}
                className="mt-1.5 w-full border border-[#232832] bg-[#0d0f12] px-3 py-2 font-mono text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
              />
            </label>
          </div>

          <label className="block text-xs">
            <span className="font-medium text-[#9aa3b2]">
              Local / Credibility Context (optional)
            </span>
            <input
              type="text"
              value={form.senderContext}
              placeholder="e.g., Local family-owned supplier or Independent software developer"
              onChange={(e) => setForm({ ...form, senderContext: e.target.value })}
              className="mt-1.5 w-full border border-[#232832] bg-[#0d0f12] px-3 py-2 text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
            />
          </label>

          <label className="block text-xs">
            <span className="font-medium text-[#9aa3b2]">
              Core Value Proposition / What Problem You Solve
            </span>
            <textarea
              rows={3}
              value={form.valueProp}
              placeholder="Describe what your product or service does and who benefits in 1-2 sentences..."
              onChange={(e) => setForm({ ...form, valueProp: e.target.value })}
              className="mt-1.5 w-full border border-[#232832] bg-[#0d0f12] p-3 text-xs leading-relaxed text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
            />
          </label>

          <label className="block text-xs">
            <span className="font-medium text-[#9aa3b2]">
              Target Industries / Customer Types (comma-separated)
            </span>
            <textarea
              rows={2}
              value={tradesInput}
              placeholder="e.g., Commercial Plumbers, HVAC Contractors"
              onChange={(e) => setTradesInput(e.target.value)}
              className="mt-1.5 w-full border border-[#232832] bg-[#0d0f12] p-3 text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
            />
          </label>

          <label className="block text-xs">
            <span className="font-medium text-[#9aa3b2]">
              Primary Offer or Trial Terms (optional)
            </span>
            <input
              type="text"
              value={form.standardOffer}
              placeholder="e.g., 14-day automatic free trial on signup, Free on-site quote, or No-obligation sample kit"
              onChange={(e) => setForm({ ...form, standardOffer: e.target.value })}
              className="mt-1.5 w-full border border-[#232832] bg-[#0d0f12] px-3 py-2 text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
            />
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="block text-xs">
              <span className="font-medium text-[#9aa3b2]">Promo Code (optional)</span>
              <input
                type="text"
                value={form.promoCode}
                placeholder="Leave blank if none"
                onChange={(e) => {
                  setForm({ ...form, promoCode: e.target.value });
                  if (!e.target.value.trim()) setFormError(null);
                }}
                className="mt-1.5 w-full border border-[#232832] bg-[#0d0f12] px-3 py-2 font-mono text-xs text-[#f59e0b] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
              />
            </label>
            <label className="block text-xs sm:col-span-2">
              <span className="font-medium text-[#9aa3b2]">
                Exact Meaning of Promo Code {form.promoCode.trim() ? '*' : '(optional)'}
              </span>
              <input
                ref={promoBenefitRef}
                type="text"
                value={form.promoBenefit}
                placeholder="e.g., Unlocks 50% off the first paid month AFTER the 14-day trial"
                onChange={(e) => {
                  setForm({ ...form, promoBenefit: e.target.value });
                  if (e.target.value.trim()) setFormError(null);
                }}
                className="mt-1.5 w-full border border-[#232832] bg-[#0d0f12] px-3 py-2 text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
              />
            </label>
          </div>

          <label className="block text-xs">
            <span className="font-medium text-[#9aa3b2]">
              Specific Hook / Proof Point / Live Data Snippet to Mention (optional)
            </span>
            <input
              type="text"
              value={form.valueSnippet}
              placeholder="e.g., Spotted 3 recent expansion permits near their service area"
              onChange={(e) => setForm({ ...form, valueSnippet: e.target.value })}
              className="mt-1.5 w-full border border-[#232832] bg-[#0d0f12] px-3 py-2 text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
            />
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="block text-xs sm:col-span-2">
              <span className="font-medium text-[#9aa3b2]">Preferred Sign-off Question / CTA</span>
              <input
                type="text"
                value={form.callToAction}
                placeholder="e.g., Open to taking a look if I send over a sample?"
                onChange={(e) => setForm({ ...form, callToAction: e.target.value })}
                className="mt-1.5 w-full border border-[#232832] bg-[#0d0f12] px-3 py-2 text-xs text-[#e6e9ef] placeholder:text-[#697386] focus:border-[#f59e0b] focus:outline-none"
              />
            </label>
            <label className="block text-xs">
              <span className="font-medium text-[#9aa3b2]">Max Links / Email</span>
              <input
                type="number"
                min={0}
                max={3}
                value={form.maxLinks}
                onChange={(e) => setForm({ ...form, maxLinks: Number(e.target.value) || 0 })}
                className="mt-1.5 w-full border border-[#232832] bg-[#0d0f12] px-3 py-2 font-mono text-xs text-[#e6e9ef] focus:border-[#f59e0b] focus:outline-none"
              />
            </label>
          </div>
        </section>

        {/* Active AI Engine */}
        <section className="flex flex-col justify-between border border-[#232832] bg-[#13161b] p-5 lg:col-span-5">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-[#232832] pb-2.5">
              <h3 className="text-sm font-semibold text-[#e6e9ef]">
                Active AI Engine
              </h3>
              <button
                type="button"
                onClick={onOpenEngineSetup}
                className="inline-flex items-center gap-1.5 border border-[#323947] bg-[#171b21] px-3 py-1.5 text-xs font-medium text-[#f59e0b] hover:border-[#f59e0b] whitespace-nowrap"
              >
                <Zap className="h-3.5 w-3.5" />
                Configure AI Engine
              </button>
            </div>

            <div className="grid grid-cols-[130px_1fr] gap-y-2.5 border border-[#232832] bg-[#0d0f12] p-4 font-mono text-xs">
              <span className="text-[#697386]">Storage File:</span>
              <span className="text-[#e6e9ef]">SQLite + user-settings.json</span>

              <span className="text-[#697386]">Active Mode:</span>
              <span className="text-[#f59e0b]">
                {settings.extractionMode === 'manual_batch'
                  ? 'Manual Batch ($0.00)'
                  : settings.extractionMode === 'local_llm'
                    ? 'Local LLM ($0.00)'
                    : 'External API (BYO Key)'}
              </span>

              {settings.extractionMode === 'local_llm' && (
                <>
                  <span className="text-[#697386]">Base URL:</span>
                  <span className="truncate text-[#38bdf8]">
                    {settings.localConfig.baseUrl || 'Not configured'}
                  </span>
                  <span className="text-[#697386]">Model ID:</span>
                  <span className="text-[#e6e9ef]">
                    {settings.localConfig.modelId || 'Not configured'}
                  </span>
                </>
              )}

              {settings.extractionMode === 'external_api' && (
                <>
                  <span className="text-[#697386]">Base URL:</span>
                  <span className="truncate text-[#38bdf8]">
                    {settings.externalConfig.baseUrl || 'Not configured'}
                  </span>
                  <span className="text-[#697386]">Model ID:</span>
                  <span className="text-[#e6e9ef]">
                    {settings.externalConfig.modelId || 'Not configured'}
                  </span>
                  <span className="text-[#697386]">API Key:</span>
                  <span className={settings.externalConfig.apiKey ? 'text-emerald-400' : 'text-amber-300'}>
                    {settings.externalConfig.apiKey ? 'Configured (Masked)' : 'Not configured'}
                  </span>
                </>
              )}

              <span className="text-[#697386]">SQLite Path:</span>
              <span className="text-[#9aa3b2]">{settings.dbPath}</span>
            </div>

            <p className="text-xs leading-relaxed text-[#9aa3b2]">
              No <span className="font-mono text-[#e6e9ef]">.env</span> setup is required to run locally. Click{' '}
              <span className="text-[#e6e9ef]">Configure AI Engine</span> to switch between zero-cost Manual Batch, Local Ollama / LM Studio, or any OpenAI-compatible external API with BYO Key.
            </p>
          </div>
        </section>
      </div>
    </form>
  );
}
