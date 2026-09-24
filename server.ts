import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { searchWeb } from './web.ts';
import { storeDocument, clearDocument, getActiveDocumentInfo, queryDocument } from './rag.ts';
import { fetchRecentEmails } from './gmail.ts';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '20mb' }));

// Exact model constants
export const MODELS = {
  claude: 'claude-sonnet-4-6',
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o',
  grok: 'grok-2-latest',
};

export interface AskParams {
  provider: 'gemini' | 'claude' | 'openai' | 'grok';
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  clientKeys?: {
    anthropic?: string;
    openai?: string;
    grok?: string;
    gemini?: string;
    tavily?: string;
    gmailUser?: string;
    gmailAppPassword?: string;
  };
  capabilities?: {
    web?: boolean;
    docs?: boolean;
    email?: boolean;
  };
}

// Settings API to check status
app.get('/api/settings', (_req: Request, res: Response) => {
  const sanitizeLength = (pw?: string) => (pw ? pw.replace(/[^A-Za-z0-9]/g, '').length : 0);

  res.json({
    keys: {
      anthropic: {
        isSet: Boolean(process.env.ANTHROPIC_API_KEY),
        preview: process.env.ANTHROPIC_API_KEY ? `sk-ant-...${process.env.ANTHROPIC_API_KEY.slice(-4)}` : '',
      },
      gemini: {
        isSet: Boolean(process.env.GEMINI_API_KEY),
        preview: process.env.GEMINI_API_KEY ? `AIza...${process.env.GEMINI_API_KEY.slice(-4)}` : '',
      },
      openai: {
        isSet: Boolean(process.env.OPENAI_API_KEY),
        preview: process.env.OPENAI_API_KEY ? `sk-...${process.env.OPENAI_API_KEY.slice(-4)}` : '',
      },
      grok: {
        isSet: Boolean(process.env.XAI_API_KEY),
        preview: process.env.XAI_API_KEY ? `xai-...${process.env.XAI_API_KEY.slice(-4)}` : '',
      },
      tavily: {
        isSet: Boolean(process.env.TAVILY_API_KEY),
        preview: process.env.TAVILY_API_KEY ? `tvly-...${process.env.TAVILY_API_KEY.slice(-4)}` : '',
      },
      gmail: {
        user: process.env.GMAIL_USER || '',
        isSet: Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD),
        cleanPwLength: sanitizeLength(process.env.GMAIL_APP_PASSWORD),
      },
    },
    models: MODELS,
  });
});

// Update settings in runtime process.env
app.post('/api/settings', (req: Request, res: Response) => {
  const { anthropic, openai, grok, gemini, tavily, gmailUser, gmailAppPassword } = req.body;

  if (anthropic !== undefined) process.env.ANTHROPIC_API_KEY = anthropic.trim();
  if (openai !== undefined) process.env.OPENAI_API_KEY = openai.trim();
  if (grok !== undefined) process.env.XAI_API_KEY = grok.trim();
  if (gemini !== undefined) process.env.GEMINI_API_KEY = gemini.trim();
  if (tavily !== undefined) process.env.TAVILY_API_KEY = tavily.trim();
  if (gmailUser !== undefined) process.env.GMAIL_USER = gmailUser.trim();
  if (gmailAppPassword !== undefined) {
    const cleanedPw = (gmailAppPassword || '').replace(/[^A-Za-z0-9]/g, '');
    console.log('[Gmail Config] Cleaned password length:', cleanedPw.length);
    process.env.GMAIL_APP_PASSWORD = cleanedPw;
  }

  res.json({
    success: true,
    message: 'Settings updated for this session',
  });
});

// Diagnostic test endpoint for Gmail
app.post('/api/test-gmail', async (req: Request, res: Response) => {
  const { user, password } = req.body;
  const result = await fetchRecentEmails(user, password);
  res.json(result);
});

// Document upload & management endpoints (RAG)
app.post('/api/upload-document', async (req: Request, res: Response) => {
  const { filename, dataBase64 } = req.body;
  if (!filename || !dataBase64) {
    return res.status(400).json({ error: 'Missing filename or dataBase64' });
  }

  try {
    const buffer = Buffer.from(dataBase64, 'base64');
    const result = await storeDocument(filename, buffer);
    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }
    const docInfo = getActiveDocumentInfo();
    res.json({ success: true, docInfo, message: result.message });
  } catch (err: any) {
    res.status(500).json({ error: `Upload failed: ${err?.message || 'Error processing document'}` });
  }
});

app.get('/api/document-info', (_req: Request, res: Response) => {
  res.json({ docInfo: getActiveDocumentInfo() });
});

app.delete('/api/upload-document', (_req: Request, res: Response) => {
  clearDocument();
  res.json({ success: true, message: 'Document cleared from session' });
});

// Tool definitions
const WEB_TOOL_OPENAI = {
  type: 'function' as const,
  function: {
    name: 'search_web',
    description: 'Search the web using Tavily for up-to-date facts, current events, recent news, or live information.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query to look up on the web' },
      },
      required: ['query'],
    },
  },
};

const DOCS_TOOL_OPENAI = {
  type: 'function' as const,
  function: {
    name: 'read_document',
    description: 'Read and search relevant sections from the uploaded document to answer questions about its contents.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The query, topic, or question to find in the document' },
      },
      required: ['query'],
    },
  },
};

const EMAIL_TOOL_OPENAI = {
  type: 'function' as const,
  function: {
    name: 'check_email',
    description: 'Fetch and read the 10 most recent emails from the user Gmail inbox read-only (PEEK) to check for messages, updates, or status.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional keywords or sender to filter recent emails' },
      },
    },
  },
};

const WEB_TOOL_CLAUDE: Anthropic.Tool = {
  name: 'search_web',
  description: 'Search the web using Tavily for up-to-date facts, current events, recent news, or live information.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query to look up on the web' },
    },
    required: ['query'],
  },
};

const DOCS_TOOL_CLAUDE: Anthropic.Tool = {
  name: 'read_document',
  description: 'Read and search relevant sections from the uploaded document to answer questions about its contents.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The query, topic, or question to find in the document' },
    },
    required: ['query'],
  },
};

const EMAIL_TOOL_CLAUDE: Anthropic.Tool = {
  name: 'check_email',
  description: 'Fetch and read the 10 most recent emails from the user Gmail inbox read-only (PEEK) to check for messages, updates, or status.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Optional keywords or sender to filter recent emails' },
    },
  },
};

// Single ask() handler with streaming SSE across all providers
app.post('/api/ask', async (req: Request, res: Response) => {
  const { provider = 'claude', messages = [], clientKeys, capabilities = {} } = req.body as AskParams;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (obj: any) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  const sendChunk = (text: string) => {
    sendEvent({ type: 'chunk', text });
  };

  const sendStatus = (status: string) => {
    sendEvent({ type: 'status', status });
  };

  const sendSource = (source: string) => {
    sendEvent({ type: 'source', source });
  };

  const sendEnd = () => {
    res.write(`data: [DONE]\n\n`);
    res.end();
  };

  const tavilyKey = clientKeys?.tavily || process.env.TAVILY_API_KEY;
  const gmailUser = clientKeys?.gmailUser || process.env.GMAIL_USER;
  const gmailPw = clientKeys?.gmailAppPassword || process.env.GMAIL_APP_PASSWORD;

  const isWebAllowed = Boolean(capabilities.web);
  const isDocsAllowed = Boolean(capabilities.docs);
  const isEmailAllowed = Boolean(capabilities.email);

  // Helper to execute capability tool calls
  const executeToolCall = async (toolName: string, args: any) => {
    if (toolName === 'search_web' && isWebAllowed) {
      sendStatus("Searching the web…");
      const searchRes = await searchWeb(args.query || '', tavilyKey);
      sendSource(`Web — ${searchRes.results.length} results`);
      return searchRes.error
        ? `Search error: ${searchRes.error}`
        : JSON.stringify(searchRes.results);
    }

    if (toolName === 'read_document' && isDocsAllowed) {
      sendStatus("Reading your document…");
      const ragRes = queryDocument(args.query || '');
      const docName = ragRes.filename || 'uploaded document';
      sendSource(`Docs — ${ragRes.chunks.length} chunks (${docName})`);
      if (ragRes.chunks.length === 0) {
        return `No matching sections found in the document "${docName}".`;
      }
      return `Sections from "${docName}":\n\n` + ragRes.chunks.join('\n\n---\n\n');
    }

    if (toolName === 'check_email' && isEmailAllowed) {
      sendStatus("Checking email…");
      const emailRes = await fetchRecentEmails(gmailUser, gmailPw);
      if (!emailRes.success) {
        sendSource("Email — failed to connect");
        return emailRes.diagnostic || "Unable to access Gmail.";
      }
      if (emailRes.emails.length === 0) {
        sendSource("Email — no recent messages");
        return "No recent messages found in Gmail inbox.";
      }
      sendSource(`Email — ${emailRes.emails.length} recent messages`);
      return (
        `Recent emails from ${gmailUser || 'user inbox'}:\n\n` +
        emailRes.emails
          .map(
            (em, idx) =>
              `[${idx + 1}] Date: ${em.date}\nFrom: ${em.from}\nSubject: ${em.subject}\nBody: ${em.bodySnippet}`
          )
          .join('\n\n---\n\n')
      );
    }

    return `Tool ${toolName} not available or capability not enabled.`;
  };

  try {
    // PROVIDER 1: Claude (Anthropic)
    if (provider === 'claude') {
      const apiKey = clientKeys?.anthropic || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        sendChunk("⚠️ ANTHROPIC_API_KEY is not configured. Please open Settings and enter your key.");
        return sendEnd();
      }

      const anthropic = new Anthropic({ apiKey });
      const currentMessages: any[] = messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      const tools: Anthropic.Tool[] = [];
      if (isWebAllowed) tools.push(WEB_TOOL_CLAUDE);
      if (isDocsAllowed) tools.push(DOCS_TOOL_CLAUDE);
      if (isEmailAllowed) tools.push(EMAIL_TOOL_CLAUDE);

      try {
        let modelToUse = MODELS.claude;
        const createOptions: any = {
          model: modelToUse,
          max_tokens: 4096,
          messages: currentMessages,
        };
        if (tools.length > 0) createOptions.tools = tools;

        let response = await anthropic.messages.create(createOptions).catch(async (err: any) => {
          if (err?.status === 404 && err?.message?.includes('model')) {
            modelToUse = 'claude-3-5-sonnet-latest';
            createOptions.model = modelToUse;
            return anthropic.messages.create(createOptions);
          }
          throw err;
        });

        const toolUseBlock = response.content.find((b) => b.type === 'tool_use') as any;

        if (
          toolUseBlock &&
          (toolUseBlock.name === 'search_web' ||
            toolUseBlock.name === 'read_document' ||
            toolUseBlock.name === 'check_email')
        ) {
          const toolResult = await executeToolCall(toolUseBlock.name, toolUseBlock.input || {});

          currentMessages.push({
            role: 'assistant',
            content: response.content,
          });

          currentMessages.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: toolUseBlock.id,
                content: toolResult,
              },
            ],
          });

          const stream = await anthropic.messages.stream({
            model: modelToUse,
            max_tokens: 4096,
            messages: currentMessages,
          });

          for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
              sendChunk(chunk.delta.text);
            }
          }
          return sendEnd();
        }

        for (const block of response.content) {
          if (block.type === 'text') {
            sendChunk(block.text);
          }
        }
        sendEnd();
      } catch (anthropicErr: any) {
        console.error('Claude API error:', anthropicErr?.message || anthropicErr);
        sendChunk(`⚠️ Claude Error: ${anthropicErr?.message || 'Unable to communicate with Claude API.'}`);
        sendEnd();
      }
    }

    // PROVIDER 2: OpenAI (gpt-4o)
    else if (provider === 'openai') {
      const apiKey = clientKeys?.openai || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        sendChunk("⚠️ OPENAI_API_KEY is not configured. Please open Settings in the top bar and enter your key.");
        return sendEnd();
      }

      const openaiClient = new OpenAI({ apiKey });
      const currentMessages: any[] = messages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      }));

      const tools: any[] = [];
      if (isWebAllowed) tools.push(WEB_TOOL_OPENAI);
      if (isDocsAllowed) tools.push(DOCS_TOOL_OPENAI);
      if (isEmailAllowed) tools.push(EMAIL_TOOL_OPENAI);

      try {
        const initialResponse = await openaiClient.chat.completions.create({
          model: MODELS.openai,
          messages: currentMessages,
          tools: tools.length > 0 ? tools : undefined,
        });

        const choice = initialResponse.choices[0];
        const toolCall: any = choice?.message?.tool_calls?.find(
          (tc: any) =>
            tc.function?.name === 'search_web' ||
            tc.function?.name === 'read_document' ||
            tc.function?.name === 'check_email'
        );

        if (toolCall) {
          let toolArgs = {};
          try {
            toolArgs = JSON.parse(toolCall.function?.arguments || '{}');
          } catch {
            toolArgs = {};
          }

          const toolResult = await executeToolCall(toolCall.function.name, toolArgs);

          currentMessages.push(choice.message);
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult,
          });

          const stream = await openaiClient.chat.completions.create({
            model: MODELS.openai,
            messages: currentMessages,
            stream: true,
          });

          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content || '';
            if (text) sendChunk(text);
          }
          return sendEnd();
        }

        if (choice?.message?.content) {
          sendChunk(choice.message.content);
        }
        sendEnd();
      } catch (openaiErr: any) {
        console.error('OpenAI API error:', openaiErr?.message || openaiErr);
        sendChunk(`⚠️ OpenAI Error: ${openaiErr?.message || 'Unable to communicate with OpenAI API.'}`);
        sendEnd();
      }
    }

    // PROVIDER 3: Grok (grok-2-latest)
    else if (provider === 'grok') {
      const apiKey = clientKeys?.grok || process.env.XAI_API_KEY;
      if (!apiKey) {
        sendChunk("⚠️ XAI_API_KEY is not configured. Please open Settings in the top bar and enter your key.");
        return sendEnd();
      }

      const grokClient = new OpenAI({
        apiKey,
        baseURL: 'https://api.x.ai/v1',
      });

      const currentMessages: any[] = messages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      }));

      const tools: any[] = [];
      if (isWebAllowed) tools.push(WEB_TOOL_OPENAI);
      if (isDocsAllowed) tools.push(DOCS_TOOL_OPENAI);
      if (isEmailAllowed) tools.push(EMAIL_TOOL_OPENAI);

      try {
        const initialResponse = await grokClient.chat.completions.create({
          model: MODELS.grok,
          messages: currentMessages,
          tools: tools.length > 0 ? tools : undefined,
        });

        const choice = initialResponse.choices[0];
        const toolCall: any = choice?.message?.tool_calls?.find(
          (tc: any) =>
            tc.function?.name === 'search_web' ||
            tc.function?.name === 'read_document' ||
            tc.function?.name === 'check_email'
        );

        if (toolCall) {
          let toolArgs = {};
          try {
            toolArgs = JSON.parse(toolCall.function?.arguments || '{}');
          } catch {
            toolArgs = {};
          }

          const toolResult = await executeToolCall(toolCall.function.name, toolArgs);

          currentMessages.push(choice.message);
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult,
          });

          const stream = await grokClient.chat.completions.create({
            model: MODELS.grok,
            messages: currentMessages,
            stream: true,
          });

          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content || '';
            if (text) sendChunk(text);
          }
          return sendEnd();
        }

        if (choice?.message?.content) {
          sendChunk(choice.message.content);
        }
        sendEnd();
      } catch (grokErr: any) {
        console.error('Grok API error:', grokErr?.message || grokErr);
        sendChunk(`⚠️ Grok Error: ${grokErr?.message || 'Unable to communicate with xAI Grok API.'}`);
        sendEnd();
      }
    }

    // PROVIDER 4: Gemini (gemini-2.5-flash)
    else if (provider === 'gemini') {
      const apiKey = clientKeys?.gemini || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        sendChunk("⚠️ GEMINI_API_KEY is not configured.");
        return sendEnd();
      }

      const ai = new GoogleGenAI({ apiKey });
      const lastMsg = messages[messages.length - 1]?.content || '';

      try {
        const functionDeclarations: any[] = [];
        if (isWebAllowed) {
          functionDeclarations.push({
            name: 'search_web',
            description: 'Search the web using Tavily for current news, facts, and live information.',
            parameters: {
              type: 'OBJECT' as any,
              properties: {
                query: { type: 'STRING' as any, description: 'Search query' },
              },
              required: ['query'],
            },
          });
        }
        if (isDocsAllowed) {
          functionDeclarations.push({
            name: 'read_document',
            description: 'Read and search relevant sections from the uploaded document to answer questions about its contents.',
            parameters: {
              type: 'OBJECT' as any,
              properties: {
                query: { type: 'STRING' as any, description: 'Query to search in the uploaded document' },
              },
              required: ['query'],
            },
          });
        }
        if (isEmailAllowed) {
          functionDeclarations.push({
            name: 'check_email',
            description: 'Fetch and read the 10 most recent emails from Gmail inbox read-only.',
            parameters: {
              type: 'OBJECT' as any,
              properties: {
                query: { type: 'STRING' as any, description: 'Optional keywords to filter emails' },
              },
            },
          });
        }

        const contents: any[] = messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

        if (functionDeclarations.length > 0) {
          const response = await ai.models.generateContent({
            model: MODELS.gemini,
            contents,
            config: {
              tools: [{ functionDeclarations }],
            },
          });

          const functionCalls = response.functionCalls;
          if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];
            const toolResult = await executeToolCall(call.name || '', call.args || {});

            const secondResponseStream = await ai.models.generateContentStream({
              model: MODELS.gemini,
              contents: [
                ...contents,
                { role: 'model', parts: [{ functionCall: call }] },
                {
                  role: 'user',
                  parts: [
                    {
                      functionResponse: {
                        name: call.name,
                        response: { content: toolResult },
                      },
                    },
                  ],
                },
              ],
            });

            for await (const chunk of secondResponseStream) {
              if (chunk.text) sendChunk(chunk.text);
            }
            return sendEnd();
          }

          if (response.text) {
            sendChunk(response.text);
          }
          return sendEnd();
        }

        const responseStream = await ai.models.generateContentStream({
          model: MODELS.gemini,
          contents: contents.length > 0 ? contents : lastMsg,
        });

        for await (const chunk of responseStream) {
          if (chunk.text) sendChunk(chunk.text);
        }
        sendEnd();
      } catch (geminiErr: any) {
        console.error('Gemini error:', geminiErr);
        sendChunk(`⚠️ Gemini Error: ${geminiErr?.message || 'Unable to generate response.'}`);
        sendEnd();
      }
    } else {
      sendChunk(`⚠️ Unknown provider: ${provider}`);
      sendEnd();
    }
  } catch (err: any) {
    console.error('Server error:', err);
    sendChunk(`⚠️ Service error: ${err?.message || 'Internal error'}`);
    sendEnd();
  }
});

async function startServer() {
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(process.cwd(), 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(process.cwd(), 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
