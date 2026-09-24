import React, { useState, useRef, useEffect } from 'react';
import { 
  Globe, 
  FileText, 
  Mail, 
  Send, 
  Paperclip, 
  ChevronDown, 
  X,
  Bot,
  Check,
  Settings,
  ShieldAlert,
  Loader2,
  FileCheck
} from 'lucide-react';
import { SettingsModal } from './components/SettingsModal';

export type ProviderId = 'gemini' | 'claude' | 'openai' | 'grok';

interface ProviderOption {
  id: ProviderId;
  name: string;
  model: string;
  tag: string;
}

const PROVIDERS: ProviderOption[] = [
  { id: 'claude', name: 'Claude', model: 'claude-sonnet-4-6', tag: 'Anthropic' },
  { id: 'gemini', name: 'Gemini', model: 'gemini-2.5-flash', tag: 'Google' },
  { id: 'openai', name: 'OpenAI', model: 'gpt-4o', tag: 'OpenAI' },
  { id: 'grok', name: 'Grok', model: 'grok-2-latest', tag: 'xAI' },
];

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  provider?: ProviderId;
  sourcesUsed?: string[];
  isStreaming?: boolean;
  statusIndicator?: string | null;
}

interface UploadedDocInfo {
  filename: string;
  filesize: number;
  chunkCount: number;
  totalChars: number;
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome-1',
      role: 'assistant',
      content: "The Harness is ready. Use the toggles to enable Web search, Document RAG, or Gmail inbox reading.",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      provider: 'claude',
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('claude');
  const [isProviderMenuOpen, setIsProviderMenuOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [serverSettings, setServerSettings] = useState<any>(null);

  // Capability toggles
  const [webEnabled, setWebEnabled] = useState(false);
  const [docsEnabled, setDocsEnabled] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);

  // Attached document state
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [uploadedDocInfo, setUploadedDocInfo] = useState<UploadedDocInfo | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeProvider = PROVIDERS.find((p) => p.id === selectedProvider) || PROVIDERS[0];

  const fetchStatus = () => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => setServerSettings(d))
      .catch(() => {});

    fetch('/api/document-info')
      .then((r) => r.json())
      .then((d) => {
        if (d.docInfo) {
          setUploadedDocInfo(d.docInfo);
          setDocsEnabled(true);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsProviderMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const hasKeyForActiveProvider = () => {
    if (selectedProvider === 'gemini') return true;
    if (selectedProvider === 'claude') {
      return Boolean(serverSettings?.keys?.anthropic?.isSet || localStorage.getItem('harness_anthropic_key'));
    }
    if (selectedProvider === 'openai') {
      return Boolean(serverSettings?.keys?.openai?.isSet || localStorage.getItem('harness_openai_key'));
    }
    if (selectedProvider === 'grok') {
      return Boolean(serverSettings?.keys?.grok?.isSet || localStorage.getItem('harness_grok_key'));
    }
    return false;
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed && !attachedFile) return;
    if (isLoading) return;

    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: timeStr,
    };

    const assistantMsgId = `assistant-${Date.now() + 1}`;
    const initialAssistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: timeStr,
      provider: selectedProvider,
      isStreaming: true,
      statusIndicator: null,
      sourcesUsed: [],
    };

    setMessages((prev) => [...prev, userMsg, initialAssistantMsg]);
    setInputText('');
    setIsLoading(true);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const historyPayload = messages
        .concat(userMsg)
        .filter((m) => m.content.trim().length > 0)
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      const clientKeys = {
        anthropic: localStorage.getItem('harness_anthropic_key') || undefined,
        openai: localStorage.getItem('harness_openai_key') || undefined,
        grok: localStorage.getItem('harness_grok_key') || undefined,
        tavily: localStorage.getItem('harness_tavily_key') || undefined,
        gmailUser: localStorage.getItem('harness_gmail_user') || undefined,
        gmailAppPassword: localStorage.getItem('harness_gmail_pw') || undefined,
      };

      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProvider,
          messages: historyPayload,
          clientKeys,
          capabilities: {
            web: webEnabled,
            docs: docsEnabled,
            email: emailEnabled,
          },
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let accumulatedText = '';
      const accumulatedSources: string[] = [];
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine.startsWith('data: ')) continue;
          const payload = trimmedLine.slice(6);
          if (payload === '[DONE]') break;

          try {
            const parsed = JSON.parse(payload);
            
            // Capability firing delight indicator (shows BEFORE answer streams)
            if (parsed.type === 'status' && parsed.status) {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? { ...msg, statusIndicator: parsed.status }
                    : msg
                )
              );
            }

            // Sources used event
            if (parsed.type === 'source' && parsed.source) {
              accumulatedSources.push(parsed.source);
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? { ...msg, sourcesUsed: [...accumulatedSources] }
                    : msg
                )
              );
            }

            // Text chunk
            if (parsed.type === 'chunk' && parsed.text) {
              accumulatedText += parsed.text;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? { ...msg, content: accumulatedText, statusIndicator: null }
                    : msg
                )
              );
            }
          } catch {
            // Ignore parse errors on partial chunks
          }
        }
      }

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? { 
                ...msg, 
                isStreaming: false, 
                statusIndicator: null,
                content: accumulatedText || 'No response returned.',
                sourcesUsed: accumulatedSources,
              }
            : msg
        )
      );
    } catch (err: any) {
      console.error('Chat error:', err);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? {
                ...msg,
                isStreaming: false,
                statusIndicator: null,
                content: `⚠️ Error: ${err?.message || 'Failed to stream response.'}`,
              }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Upload document file to backend in-memory RAG store
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setAttachedFile(file);
      setIsUploadingDoc(true);

      try {
        const reader = new FileReader();
        reader.onload = async () => {
          const base64Data = (reader.result as string).split(',')[1];
          const res = await fetch('/api/upload-document', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: file.name,
              dataBase64: base64Data,
            }),
          });

          const data = await res.json();
          if (res.ok && data.docInfo) {
            setUploadedDocInfo(data.docInfo);
            setDocsEnabled(true);
          } else {
            console.error('Upload failed:', data.error);
          }
          setIsUploadingDoc(false);
        };
        reader.readAsDataURL(file);
      } catch (err) {
        console.error('File read error:', err);
        setIsUploadingDoc(false);
      }
    }
  };

  const removeAttachedFile = async () => {
    setAttachedFile(null);
    setUploadedDocInfo(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    try {
      await fetch('/api/upload-document', { method: 'DELETE' });
    } catch {
      // Ignored
    }
  };

  const keyReady = hasKeyForActiveProvider();

  return (
    <div className="flex flex-col h-screen w-full bg-[#fcfcfd] text-neutral-900 font-sans antialiased">
      {/* Top Bar */}
      <header className="h-14 border-b border-neutral-200/80 bg-white/95 px-5 flex items-center justify-between z-20 backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-neutral-900 text-white flex items-center justify-center font-semibold text-sm shadow-xs">
            H
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-sm tracking-tight text-neutral-900">
              The Harness
            </span>
            <span className="text-[11px] text-neutral-400 font-normal leading-none">
              multi-model capability hub
            </span>
          </div>
        </div>

        {/* Right side controls: Settings button & Provider Dropdown */}
        <div className="flex items-center gap-2.5">
          {/* Settings Button */}
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 hover:border-neutral-300 text-xs font-medium text-neutral-700 transition-colors shadow-xs"
            title="Configure API Keys & Capabilities"
          >
            <Settings className="w-3.5 h-3.5 text-neutral-500" />
            <span>Settings</span>
            {!keyReady && (
              <span className="w-2 h-2 rounded-full bg-amber-500" title="Key needed for active model" />
            )}
          </button>

          {/* Provider Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsProviderMenuOpen(!isProviderMenuOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 hover:border-neutral-300 transition-colors text-xs font-medium shadow-xs"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  keyReady ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'
                }`}
              />
              <span className="text-neutral-900 font-semibold">{activeProvider.name}</span>
              <span className="text-neutral-400 font-normal">({activeProvider.model})</span>
              <ChevronDown className={`w-3.5 h-3.5 text-neutral-500 transition-transform ${isProviderMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {isProviderMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-64 rounded-xl border border-neutral-200 bg-white py-1.5 shadow-lg z-30 animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-semibold text-neutral-400 border-b border-neutral-100 mb-1">
                  Select Model Provider
                </div>
                {PROVIDERS.map((provider) => {
                  const isSelected = provider.id === selectedProvider;
                  const hasKey = 
                    provider.id === 'gemini' 
                      ? true 
                      : provider.id === 'claude'
                      ? Boolean(serverSettings?.keys?.anthropic?.isSet || localStorage.getItem('harness_anthropic_key'))
                      : provider.id === 'openai'
                      ? Boolean(serverSettings?.keys?.openai?.isSet || localStorage.getItem('harness_openai_key'))
                      : Boolean(serverSettings?.keys?.grok?.isSet || localStorage.getItem('harness_grok_key'));

                  return (
                    <button
                      key={provider.id}
                      onClick={() => {
                        setSelectedProvider(provider.id);
                        setIsProviderMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between text-xs transition-colors ${
                        isSelected ? 'bg-neutral-100/80 font-medium' : 'hover:bg-neutral-50'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-neutral-900">{provider.name}</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-neutral-100 text-neutral-500 border border-neutral-200/60 font-mono">
                            {provider.tag}
                          </span>
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${hasKey ? 'bg-emerald-500' : 'bg-amber-400'}`}
                            title={hasKey ? 'Key ready' : 'Key required'}
                          />
                        </div>
                        <div className="text-[11px] text-neutral-400 font-mono mt-0.5">
                          {provider.model}
                        </div>
                      </div>
                      {isSelected && <Check className="w-4 h-4 text-neutral-900" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSaved={() => fetchStatus()}
      />

      {/* Missing Key Banner */}
      {!keyReady && (
        <div className="bg-amber-50/90 border-b border-amber-200/80 px-4 py-2 flex items-center justify-between text-xs text-amber-800">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>{activeProvider.name}</strong> key is not set yet. Click Settings to enter it for this session.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="px-2.5 py-0.5 bg-amber-600 text-white rounded font-medium hover:bg-amber-700 text-[11px] transition-colors cursor-pointer"
          >
            Open Settings
          </button>
        </div>
      )}

      {/* Message Stream */}
      <main className="flex-1 overflow-y-auto px-4 py-6 md:px-8 max-w-4xl w-full mx-auto flex flex-col space-y-5">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[88%] sm:max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed transition-all shadow-xs ${
                  isUser
                    ? 'bg-neutral-900 text-white rounded-br-sm'
                    : 'bg-white border border-neutral-200/90 text-neutral-800 rounded-bl-sm'
                }`}
              >
                {!isUser && (
                  <div className="flex items-center gap-1.5 mb-2 text-[11px] text-neutral-400 font-medium">
                    <Bot className="w-3.5 h-3.5 text-neutral-500" />
                    <span>
                      {PROVIDERS.find((p) => p.id === msg.provider)?.name || 'Harness'}
                    </span>
                    <span className="text-neutral-300">•</span>
                    <span className="text-[10px] text-neutral-400">{msg.timestamp}</span>
                    {msg.isStreaming && !msg.statusIndicator && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-neutral-400 animate-pulse ml-1">
                        streaming...
                      </span>
                    )}
                  </div>
                )}

                {/* Delight Indicator: Displays BEFORE the answer streams in */}
                {msg.statusIndicator && (
                  <div className={`mb-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium animate-pulse border ${
                    msg.statusIndicator.includes('email')
                      ? 'bg-emerald-50/90 border-emerald-200 text-emerald-800'
                      : msg.statusIndicator.includes('document')
                      ? 'bg-amber-50/90 border-amber-200 text-amber-800'
                      : 'bg-blue-50/90 border-blue-200 text-blue-700'
                  }`}>
                    {msg.statusIndicator.includes('email') ? (
                      <Mail className="w-3.5 h-3.5 text-emerald-600 animate-bounce" />
                    ) : msg.statusIndicator.includes('document') ? (
                      <FileText className="w-3.5 h-3.5 text-amber-600 animate-bounce" />
                    ) : (
                      <Globe className="w-3.5 h-3.5 text-blue-600 animate-spin" />
                    )}
                    <span>{msg.statusIndicator}</span>
                  </div>
                )}

                {/* Message Content */}
                <div className="whitespace-pre-wrap break-words">
                  {msg.content || (msg.isStreaming && !msg.statusIndicator ? 'Thinking...' : '')}
                </div>

                {/* Sources Used Line: Under answer */}
                {msg.sourcesUsed && msg.sourcesUsed.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-neutral-100 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
                    <span className="font-semibold text-neutral-600">Sources used:</span>
                    {msg.sourcesUsed.map((src, idx) => {
                      const isDoc = src.startsWith('Docs');
                      const isEmail = src.startsWith('Email');
                      return (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-neutral-100/80 border border-neutral-200/60 font-medium text-neutral-700"
                        >
                          {isEmail ? (
                            <Mail className="w-3 h-3 text-emerald-600" />
                          ) : isDoc ? (
                            <FileText className="w-3 h-3 text-amber-600" />
                          ) : (
                            <Globe className="w-3 h-3 text-blue-500" />
                          )}
                          {src}
                        </span>
                      );
                    })}
                  </div>
                )}

                {isUser && (
                  <div className="text-right mt-1 text-[10px] text-neutral-400">
                    {msg.timestamp}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </main>

      {/* Capability Toggles & Input Bar */}
      <footer className="border-t border-neutral-200/80 bg-white/90 backdrop-blur-sm p-4 z-10">
        <div className="max-w-4xl mx-auto space-y-2.5">
          {/* Capability Toggles bar */}
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mr-1">
                Capabilities:
              </span>

              {/* Web Toggle */}
              <button
                type="button"
                onClick={() => setWebEnabled(!webEnabled)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer ${
                  webEnabled
                    ? 'bg-blue-50 border-blue-300 text-blue-700 shadow-xs ring-1 ring-blue-200'
                    : 'bg-neutral-50 border-neutral-200 text-neutral-500 hover:border-neutral-300'
                }`}
                title="Toggle Web Search (Tavily)"
              >
                <Globe className={`w-3.5 h-3.5 ${webEnabled ? 'text-blue-600' : 'text-neutral-400'}`} />
                <span>Web</span>
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    webEnabled ? 'bg-blue-600' : 'bg-neutral-300'
                  }`}
                />
              </button>

              {/* Docs Toggle */}
              <button
                type="button"
                onClick={() => setDocsEnabled(!docsEnabled)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer ${
                  docsEnabled
                    ? 'bg-amber-50 border-amber-300 text-amber-700 shadow-xs ring-1 ring-amber-200'
                    : 'bg-neutral-50 border-neutral-200 text-neutral-500 hover:border-neutral-300'
                }`}
                title="Document RAG context (In-memory)"
              >
                <FileText className={`w-3.5 h-3.5 ${docsEnabled ? 'text-amber-600' : 'text-neutral-400'}`} />
                <span>Docs</span>
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    docsEnabled ? 'bg-amber-600' : 'bg-neutral-300'
                  }`}
                />
              </button>

              {/* Email Toggle */}
              <button
                type="button"
                onClick={() => setEmailEnabled(!emailEnabled)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer ${
                  emailEnabled
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-700 shadow-xs ring-1 ring-emerald-200'
                    : 'bg-neutral-50 border-neutral-200 text-neutral-500 hover:border-neutral-300'
                }`}
                title="Check recent emails via Gmail (Step 6)"
              >
                <Mail className={`w-3.5 h-3.5 ${emailEnabled ? 'text-emerald-600' : 'text-neutral-400'}`} />
                <span>Email</span>
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    emailEnabled ? 'bg-emerald-600' : 'bg-neutral-300'
                  }`}
                />
              </button>
            </div>

            {/* Attached file chip with chunk count */}
            {(attachedFile || uploadedDocInfo) && (
              <div className="flex items-center gap-1.5 text-xs bg-amber-50/80 text-amber-800 px-2.5 py-1 rounded-md border border-amber-200">
                {isUploadingDoc ? (
                  <Loader2 className="w-3.5 h-3.5 text-amber-600 animate-spin" />
                ) : (
                  <FileCheck className="w-3.5 h-3.5 text-amber-600" />
                )}
                <span className="truncate max-w-[150px] font-mono text-[11px] font-medium">
                  {uploadedDocInfo?.filename || attachedFile?.name}
                </span>
                {uploadedDocInfo && (
                  <span className="text-[10px] text-amber-700 font-sans">
                    ({uploadedDocInfo.chunkCount} chunks)
                  </span>
                )}
                <button
                  type="button"
                  onClick={removeAttachedFile}
                  className="text-amber-500 hover:text-amber-900 p-0.5 rounded"
                  title="Remove document"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          {/* Input Box Row */}
          <div className="flex items-end gap-2 bg-neutral-50 border border-neutral-200 focus-within:border-neutral-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-neutral-200/50 rounded-xl p-1.5 transition-all">
            {/* File Upload Button */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".txt,.pdf"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2.5 text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/60 rounded-lg transition-colors cursor-pointer"
              title="Attach document (.txt, .pdf, max 10MB/50pp)"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            {/* Text input area */}
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
              }}
              onKeyDown={handleKeyDown}
              placeholder={`Ask ${activeProvider.name}... ${docsEnabled && uploadedDocInfo ? '(Docs RAG active)' : ''}`}
              className="flex-1 bg-transparent border-0 resize-none px-2 py-2 text-sm text-neutral-900 focus:outline-none placeholder:text-neutral-400 max-h-32"
            />

            {/* Send Button */}
            <button
              type="button"
              disabled={(!inputText.trim() && !attachedFile) || isLoading || isUploadingDoc}
              onClick={() => handleSendMessage()}
              className={`p-2.5 rounded-lg transition-all flex items-center justify-center ${
                (inputText.trim() || attachedFile) && !isLoading && !isUploadingDoc
                  ? 'bg-neutral-900 text-white hover:bg-neutral-800 shadow-xs cursor-pointer'
                  : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
              }`}
              title="Send message"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>

          <div className="flex items-center justify-between text-[10px] text-neutral-400 px-1">
            <span>
              {docsEnabled
                ? uploadedDocInfo
                  ? `Docs ON: "${uploadedDocInfo.filename}" indexed in memory`
                  : 'Docs ON: Attach a file to query'
                : 'Docs OFF (Never queried)'}
            </span>
            <span>Model: {activeProvider.name} ({activeProvider.model})</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
