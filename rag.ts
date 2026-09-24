// @ts-ignore
import * as pdfParseModule from 'pdf-parse';

const pdfParse: any = (pdfParseModule as any).default || pdfParseModule;

export interface DocumentChunk {
  id: number;
  text: string;
}

export interface StoredDocument {
  filename: string;
  filesize: number;
  chunks: DocumentChunk[];
  totalChars: number;
  uploadedAt: number;
}

// Session in-memory document store (single document cap per brief)
let activeDocument: StoredDocument | null = null;

const MAX_DOC_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_DOC_CHARS = 120_000; // ~50 pages equivalent

/**
 * Clean and chunk text into ~600 character pieces with overlap
 */
function chunkText(text: string, chunkSize = 600, overlap = 100): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const clean = text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
  
  if (!clean) return [];

  let start = 0;
  let id = 1;

  while (start < clean.length) {
    let end = start + chunkSize;
    if (end < clean.length) {
      // Try to break on a sentence or word boundary
      const lastPeriod = clean.lastIndexOf('.', end);
      const lastSpace = clean.lastIndexOf(' ', end);
      if (lastPeriod > start + chunkSize * 0.7) {
        end = lastPeriod + 1;
      } else if (lastSpace > start + chunkSize * 0.7) {
        end = lastSpace;
      }
    }

    const chunkContent = clean.slice(start, end).trim();
    if (chunkContent.length > 20) {
      chunks.push({ id: id++, text: chunkContent });
    }

    start = Math.max(start + 1, end - overlap);
  }

  return chunks;
}

/**
 * Process and store uploaded file buffer in memory
 */
export async function storeDocument(filename: string, buffer: Buffer): Promise<{ success: boolean; chunkCount: number; message: string }> {
  if (buffer.length > MAX_DOC_BYTES) {
    return { success: false, chunkCount: 0, message: 'Document exceeds 10 MB limit' };
  }

  let extractedText = '';

  try {
    const isPdf = filename.toLowerCase().endsWith('.pdf') || buffer.slice(0, 4).toString() === '%PDF';
    
    if (isPdf) {
      const pdfData = await pdfParse(buffer, {
        max: 50, // Cap at 50 pages
      });
      extractedText = pdfData.text || '';
    } else {
      extractedText = buffer.toString('utf-8');
    }

    // Truncate beyond ~50 pages / 120,000 chars
    if (extractedText.length > MAX_DOC_CHARS) {
      extractedText = extractedText.slice(0, MAX_DOC_CHARS) + '\n\n[Document truncated at 50 pages]';
    }

    const chunks = chunkText(extractedText);

    activeDocument = {
      filename,
      filesize: buffer.length,
      chunks,
      totalChars: extractedText.length,
      uploadedAt: Date.now(),
    };

    return {
      success: true,
      chunkCount: chunks.length,
      message: `Document "${filename}" loaded (${chunks.length} chunks indexed in memory).`,
    };
  } catch (err: any) {
    console.error('Document extraction error:', err);
    return {
      success: false,
      chunkCount: 0,
      message: `Failed to extract text: ${err?.message || 'Invalid format'}`,
    };
  }
}

/**
 * Clears the active document from session memory
 */
export function clearDocument(): void {
  activeDocument = null;
}

/**
 * Returns current document metadata
 */
export function getActiveDocumentInfo() {
  if (!activeDocument) return null;
  return {
    filename: activeDocument.filename,
    filesize: activeDocument.filesize,
    chunkCount: activeDocument.chunks.length,
    totalChars: activeDocument.totalChars,
    uploadedAt: activeDocument.uploadedAt,
  };
}

/**
 * In-memory keyword relevance match (No vector DB required per spec)
 */
export function queryDocument(query: string, maxChunks = 4): { chunks: string[]; filename: string | null } {
  if (!activeDocument || activeDocument.chunks.length === 0) {
    return { chunks: [], filename: null };
  }

  const queryTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  if (queryTerms.length === 0) {
    // Return first chunks as overview if query is empty or too generic
    return {
      filename: activeDocument.filename,
      chunks: activeDocument.chunks.slice(0, maxChunks).map((c) => c.text),
    };
  }

  // Score each chunk by term frequencies and exact phrase bonuses
  const scored = activeDocument.chunks.map((chunk) => {
    const chunkLower = chunk.text.toLowerCase();
    let score = 0;

    for (const term of queryTerms) {
      const occurrences = (chunkLower.match(new RegExp(`\\b${term}\\b`, 'g')) || []).length;
      score += occurrences * 3;
      if (chunkLower.includes(term)) {
        score += 1;
      }
    }

    // Exact query phrase bonus
    if (query.length > 4 && chunkLower.includes(query.toLowerCase())) {
      score += 15;
    }

    return { chunk, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Return top matches
  const topChunks = scored
    .slice(0, maxChunks)
    .filter((s) => s.score > 0 || scored[0].score === 0)
    .map((s) => s.chunk.text);

  return {
    filename: activeDocument.filename,
    chunks: topChunks.length > 0 ? topChunks : activeDocument.chunks.slice(0, maxChunks).map((c) => c.text),
  };
}
