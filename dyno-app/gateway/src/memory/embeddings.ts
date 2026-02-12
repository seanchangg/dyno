/**
 * Embedding generation for semantic memory search.
 *
 * Generates text embeddings via the user's API key (Anthropic or OpenAI).
 * Embeddings are cached locally to avoid redundant API calls.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface EmbeddingResult {
  vector: number[];
  model: string;
  cached: boolean;
}

// ── EmbeddingGenerator ───────────────────────────────────────────────────────

export class EmbeddingGenerator {
  private cache = new Map<string, number[]>();
  private provider: "openai" | "local";

  constructor(provider: "openai" | "local" = "local") {
    this.provider = provider;
  }

  /**
   * Generate an embedding for a text string.
   *
   * Currently uses a simple bag-of-words approach as a placeholder.
   * Will be replaced with real embedding API calls in production.
   */
  async generate(text: string, apiKey?: string): Promise<EmbeddingResult> {
    // Check cache
    const cacheKey = text.slice(0, 200);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { vector: cached, model: "cached", cached: true };
    }

    let vector: number[];

    if (this.provider === "openai" && apiKey) {
      vector = await this.generateOpenAI(text, apiKey);
    } else {
      // Local bag-of-words fallback (not great for semantic search,
      // but functional for Phase 5 scaffolding)
      vector = this.generateLocal(text);
    }

    this.cache.set(cacheKey, vector);
    return { vector, model: this.provider, cached: false };
  }

  /** Simple local embedding (hash-based bag of words). */
  private generateLocal(text: string): number[] {
    const dim = 128;
    const vector = new Array(dim).fill(0);
    const words = text.toLowerCase().split(/\s+/);

    for (const word of words) {
      // Hash word to dimension indices
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = (hash * 31 + word.charCodeAt(i)) & 0x7fffffff;
      }
      const idx = hash % dim;
      vector[idx] += 1;
    }

    // L2 normalize
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < dim; i++) {
        vector[i] /= norm;
      }
    }

    return vector;
  }

  /** Generate embedding via OpenAI API. */
  private async generateOpenAI(text: string, apiKey: string): Promise<number[]> {
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: text.slice(0, 8000),
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        console.warn(`[embeddings] OpenAI API error: ${res.status}`);
        return this.generateLocal(text);
      }

      const data = await res.json() as { data: { embedding: number[] }[] };
      return data.data[0].embedding;
    } catch (err) {
      console.warn(`[embeddings] OpenAI API error: ${err}`);
      return this.generateLocal(text);
    }
  }

  /** Compute cosine similarity between two vectors. */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }
}
