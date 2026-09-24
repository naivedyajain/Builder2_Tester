export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export interface WebSearchOutput {
  query: string;
  results: SearchResult[];
  error?: string;
}

/**
 * Searches the web via Tavily API.
 * Caps results at 5, returning snippets only.
 */
export async function searchWeb(query: string, apiKey?: string): Promise<WebSearchOutput> {
  const key = apiKey || process.env.TAVILY_API_KEY;
  if (!key) {
    return {
      query,
      results: [],
      error: 'TAVILY_API_KEY is not configured in environment or Settings.',
    };
  }

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: key,
        query,
        max_results: 5,
        search_depth: 'basic',
        include_answer: false,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        query,
        results: [],
        error: `Tavily API error (${res.status}): ${errText.slice(0, 150)}`,
      };
    }

    const data = await res.json();
    const rawResults = Array.isArray(data.results) ? data.results : [];
    
    // Cap 5 results, format snippets cleanly
    const results: SearchResult[] = rawResults.slice(0, 5).map((r: any) => ({
      title: r.title || 'Untitled',
      url: r.url || '',
      content: (r.content || '').slice(0, 500),
    }));

    return {
      query,
      results,
    };
  } catch (err: any) {
    return {
      query,
      results: [],
      error: `Network error reaching Tavily: ${err?.message || 'Search failed'}`,
    };
  }
}
