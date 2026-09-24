import React, { useState, useEffect } from 'react';
import { 
  X, 
  Key, 
  Mail, 
  Globe, 
  Cpu, 
  Check, 
  AlertTriangle, 
  Save, 
  Info,
  ShieldCheck,
  Eye,
  EyeOff
} from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export interface KeysState {
  anthropic: string;
  openai: string;
  grok: string;
  tavily: string;
  gmailUser: string;
  gmailAppPassword: string;
}

export function SettingsModal({ isOpen, onClose, onSaved }: SettingsModalProps) {
  const [keys, setKeys] = useState<KeysState>({
    anthropic: localStorage.getItem('harness_anthropic_key') || '',
    openai: localStorage.getItem('harness_openai_key') || '',
    grok: localStorage.getItem('harness_grok_key') || '',
    tavily: localStorage.getItem('harness_tavily_key') || '',
    gmailUser: localStorage.getItem('harness_gmail_user') || '',
    gmailAppPassword: localStorage.getItem('harness_gmail_pw') || '',
  });

  const [serverStatus, setServerStatus] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [isTestingGmail, setIsTestingGmail] = useState(false);
  const [gmailTestResult, setGmailTestResult] = useState<{ success: boolean; totalInbox?: number; diagnostic?: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetch('/api/settings')
        .then((res) => res.json())
        .then((data) => setServerStatus(data))
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Gmail sanitize rule: strip anything not A-Za-z0-9 (strips \xa0 and spaces)
  const cleanedGmailPw = keys.gmailAppPassword.replace(/[^A-Za-z0-9]/g, '');
  const isGmailPwValidLength = cleanedGmailPw.length === 16;

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);

    // Save to localStorage
    localStorage.setItem('harness_anthropic_key', keys.anthropic);
    localStorage.setItem('harness_openai_key', keys.openai);
    localStorage.setItem('harness_grok_key', keys.grok);
    localStorage.setItem('harness_tavily_key', keys.tavily);
    localStorage.setItem('harness_gmail_user', keys.gmailUser);
    localStorage.setItem('harness_gmail_pw', cleanedGmailPw);

    try {
      // Push to server runtime process.env
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anthropic: keys.anthropic || undefined,
          openai: keys.openai || undefined,
          grok: keys.grok || undefined,
          tavily: keys.tavily || undefined,
          gmailUser: keys.gmailUser || undefined,
          gmailAppPassword: cleanedGmailPw || undefined,
        }),
      });

      if (res.ok) {
        setSaveSuccess(true);
        onSaved();
        setTimeout(() => setSaveSuccess(false), 2500);
      }
    } catch (err) {
      console.error('Failed to sync settings with server:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleVisibility = (field: string) => {
    setShowPasswords((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-neutral-200/90 shadow-2xl max-w-xl w-full my-8 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-neutral-100 flex items-center justify-between bg-neutral-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-neutral-900 text-white flex items-center justify-center">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-semibold text-sm text-neutral-900">The Harness Settings</h2>
              <p className="text-[11px] text-neutral-500">
                Configure API keys and capability credentials for this session
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-800 p-1.5 rounded-lg hover:bg-neutral-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Form */}
        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          {/* Section 1: AI Providers */}
          <div className="space-y-3.5">
            <div className="flex items-center gap-2 pb-1 border-b border-neutral-100">
              <Cpu className="w-3.5 h-3.5 text-neutral-600" />
              <span className="text-xs font-semibold uppercase tracking-wider text-neutral-600">
                Model Provider Keys
              </span>
            </div>

            {/* Anthropic / Claude */}
            <div>
              <div className="flex items-center justify-between mb-1 text-xs">
                <label className="font-medium text-neutral-800">Anthropic API Key (Claude)</label>
                {serverStatus?.keys?.anthropic?.isSet ? (
                  <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> Configured in Env
                  </span>
                ) : (
                  <span className="text-[10px] text-neutral-400">Required for claude-sonnet-4-6</span>
                )}
              </div>
              <div className="relative">
                <input
                  type={showPasswords['anthropic'] ? 'text' : 'password'}
                  value={keys.anthropic}
                  onChange={(e) => setKeys({ ...keys, anthropic: e.target.value })}
                  placeholder={serverStatus?.keys?.anthropic?.preview || 'sk-ant-api03-...'}
                  className="w-full text-xs font-mono px-3 py-2 pr-9 rounded-lg border border-neutral-200 focus:outline-none focus:border-neutral-900 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => toggleVisibility('anthropic')}
                  className="absolute right-2.5 top-2.5 text-neutral-400 hover:text-neutral-700"
                >
                  {showPasswords['anthropic'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* OpenAI */}
            <div>
              <div className="flex items-center justify-between mb-1 text-xs">
                <label className="font-medium text-neutral-800">OpenAI API Key (gpt-4o)</label>
                {serverStatus?.keys?.openai?.isSet ? (
                  <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> Configured in Env
                  </span>
                ) : (
                  <span className="text-[10px] text-neutral-400">Step 3 model</span>
                )}
              </div>
              <div className="relative">
                <input
                  type={showPasswords['openai'] ? 'text' : 'password'}
                  value={keys.openai}
                  onChange={(e) => setKeys({ ...keys, openai: e.target.value })}
                  placeholder={serverStatus?.keys?.openai?.preview || 'sk-proj-...'}
                  className="w-full text-xs font-mono px-3 py-2 pr-9 rounded-lg border border-neutral-200 focus:outline-none focus:border-neutral-900 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => toggleVisibility('openai')}
                  className="absolute right-2.5 top-2.5 text-neutral-400 hover:text-neutral-700"
                >
                  {showPasswords['openai'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Grok / xAI */}
            <div>
              <div className="flex items-center justify-between mb-1 text-xs">
                <label className="font-medium text-neutral-800">xAI API Key (Grok)</label>
                {serverStatus?.keys?.grok?.isSet ? (
                  <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> Configured in Env
                  </span>
                ) : (
                  <span className="text-[10px] text-neutral-400">Step 3 model</span>
                )}
              </div>
              <div className="relative">
                <input
                  type={showPasswords['grok'] ? 'text' : 'password'}
                  value={keys.grok}
                  onChange={(e) => setKeys({ ...keys, grok: e.target.value })}
                  placeholder={serverStatus?.keys?.grok?.preview || 'xai-...'}
                  className="w-full text-xs font-mono px-3 py-2 pr-9 rounded-lg border border-neutral-200 focus:outline-none focus:border-neutral-900 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => toggleVisibility('grok')}
                  className="absolute right-2.5 top-2.5 text-neutral-400 hover:text-neutral-700"
                >
                  {showPasswords['grok'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {/* Section 2: Capability Credentials */}
          <div className="space-y-4 pt-2 border-t border-neutral-100">
            <div className="flex items-center gap-2 pb-1 border-b border-neutral-100">
              <Globe className="w-3.5 h-3.5 text-neutral-600" />
              <span className="text-xs font-semibold uppercase tracking-wider text-neutral-600">
                Capability Credentials
              </span>
            </div>

            {/* Tavily Web Search */}
            <div>
              <div className="flex items-center justify-between mb-1 text-xs">
                <label className="font-medium text-neutral-800">Tavily API Key (Web Search)</label>
                {serverStatus?.keys?.tavily?.isSet ? (
                  <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> Configured in Env
                  </span>
                ) : (
                  <span className="text-[10px] text-neutral-400">tvly-... (Step 4)</span>
                )}
              </div>
              <input
                type="password"
                value={keys.tavily}
                onChange={(e) => setKeys({ ...keys, tavily: e.target.value })}
                placeholder={serverStatus?.keys?.tavily?.preview || 'tvly-...'}
                className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-neutral-200 focus:outline-none focus:border-neutral-900 transition-colors"
              />
            </div>

            {/* Gmail Account & App Password with Runbook Fix */}
            <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-emerald-600" />
                  <span className="text-xs font-semibold text-neutral-800">
                    Gmail IMAP Configuration (Step 6)
                  </span>
                </div>
                <span className="text-[10px] text-neutral-500 bg-white px-2 py-0.5 rounded border border-neutral-200">
                  Read-only PEEK
                </span>
              </div>

              {/* Gmail User */}
              <div>
                <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                  Gmail Account Email (GMAIL_USER)
                </label>
                <input
                  type="email"
                  value={keys.gmailUser}
                  onChange={(e) => setKeys({ ...keys, gmailUser: e.target.value })}
                  placeholder="youraccount@gmail.com"
                  className="w-full text-xs bg-white px-3 py-1.5 rounded-lg border border-neutral-200 focus:outline-none focus:border-neutral-900"
                />
              </div>

              {/* Gmail App Password */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-medium text-neutral-700">
                    Gmail App Password (GMAIL_APP_PASSWORD)
                  </label>
                  <span
                    className={`text-[10px] font-mono font-medium px-1.5 py-0.5 rounded ${
                      keys.gmailAppPassword
                        ? isGmailPwValidLength
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                        : 'text-neutral-400'
                    }`}
                  >
                    Clean length: {cleanedGmailPw.length} / 16 chars
                  </span>
                </div>

                <div className="relative">
                  <input
                    type={showPasswords['gmail'] ? 'text' : 'password'}
                    value={keys.gmailAppPassword}
                    onChange={(e) => setKeys({ ...keys, gmailAppPassword: e.target.value })}
                    placeholder="xxxx xxxx xxxx xxxx"
                    className={`w-full text-xs font-mono bg-white px-3 py-1.5 pr-9 rounded-lg border focus:outline-none transition-colors ${
                      keys.gmailAppPassword && !isGmailPwValidLength
                        ? 'border-amber-400 focus:border-amber-500'
                        : 'border-neutral-200 focus:border-neutral-900'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => toggleVisibility('gmail')}
                    className="absolute right-2.5 top-2 text-neutral-400 hover:text-neutral-700"
                  >
                    {showPasswords['gmail'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {/* Live Runbook guidance note */}
                <div className="mt-1.5 flex items-start gap-1.5 text-[10px] text-neutral-500 leading-normal">
                  <Info className="w-3 h-3 text-neutral-400 shrink-0 mt-0.5" />
                  <span>
                    Auto-sanitized: Spaces and invisible <code className="bg-neutral-200 px-1 py-0.2 rounded">\xa0</code> characters are automatically stripped on save.
                  </span>
                </div>

                {/* Test Connection Button & Diagnostic result */}
                <div className="mt-2.5 pt-2 border-t border-neutral-200/60 flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={isTestingGmail || !keys.gmailUser || !cleanedGmailPw}
                    onClick={async () => {
                      setIsTestingGmail(true);
                      setGmailTestResult(null);
                      try {
                        const res = await fetch('/api/test-gmail', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            user: keys.gmailUser,
                            password: cleanedGmailPw,
                          }),
                        });
                        const data = await res.json();
                        setGmailTestResult(data);
                      } catch (err: any) {
                        setGmailTestResult({
                          success: false,
                          diagnostic: `⚠️ Gmail Diagnostic: Network error testing connection: ${err?.message}`,
                        });
                      } finally {
                        setIsTestingGmail(false);
                      }
                    }}
                    className={`w-full py-1.5 px-3 rounded-lg text-xs font-medium border flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      isTestingGmail
                        ? 'bg-neutral-100 text-neutral-500 border-neutral-200'
                        : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-300 shadow-2xs'
                    }`}
                  >
                    {isTestingGmail ? 'Connecting to imap.gmail.com:993...' : 'Test Gmail Connection (IMAP 993)'}
                  </button>

                  {gmailTestResult && (
                    <div
                      className={`p-2.5 rounded-lg text-xs leading-relaxed border ${
                        gmailTestResult.success
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : 'bg-amber-50 border-amber-200 text-amber-800'
                      }`}
                    >
                      {gmailTestResult.success ? (
                        <div className="flex items-center gap-1.5 font-medium">
                          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span>
                            Connected successfully! INBOX has {gmailTestResult.totalInbox ?? 0} messages (Read-only PEEK active).
                          </span>
                        </div>
                      ) : (
                        <div className="text-[11px] space-y-1">
                          <div className="font-semibold text-amber-900">
                            {gmailTestResult.diagnostic || '⚠️ Gmail connection failed.'}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-neutral-100 bg-neutral-50 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-neutral-500">
            {saveSuccess && (
              <span className="text-emerald-600 font-medium flex items-center gap-1 animate-in fade-in">
                <Check className="w-3.5 h-3.5" /> Saved & active for this session!
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/60 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSave}
              className="px-4 py-1.5 text-xs font-semibold bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Saving...' : 'Save for this session'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
