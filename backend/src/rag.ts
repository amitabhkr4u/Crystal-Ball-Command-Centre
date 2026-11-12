/**
 * Minimal in-memory retrieval over the policy note (the "RAG surface").
 * 5 chunks do not justify a vector DB: keyword overlap with light stemming is
 * enough to show the pattern - retrieve, ground the prompt, cite the chunk id.
 */
export interface PolicyChunk {
  id: string;
  title: string;
  text: string;
}

export interface Retrieved {
  chunk: PolicyChunk;
  score: number;
}

const STOPWORDS = new Set([
  "the",
  "and",
  "are",
  "for",
  "you",
  "can",
  "how",
  "what",
  "when",
  "who",
  "why",
  "which",
  "with",
  "this",
  "that",
  "from",
  "have",
  "has",
  "not",
  "but",
  "all",
  "any",
  "one",
  "does",
  "should",
  "would",
  "could",
  "about",
  "into",
  "than",
  "then",
  "them",
  "they",
  "their",
  "there",
  "here",
  "your",
  "our",
  "out",
  "its",
  "was",
  "were",
  "will",
  "may",
  "must",
  "please",
  "tell",
  "need",
  "want",
  "get",
  "per",
  "approval",
  "item"
]);

export function chunkPolicy(markdown: string): PolicyChunk[] {
  return markdown
    .split(/^## /m)
    .slice(1)
    .map((part, index) => {
      const [titleLine, ...rest] = part.split("\n");
      return {
        id: `P${index + 1}`,
        title: titleLine.trim().replace(/^\d+\.\s*/, ""),
        text: rest.join("\n").trim()
      };
    });
}

function stem(word: string): string {
  let s = word;
  for (const suffix of ["ing", "ed", "s"]) {
    if (s.length > suffix.length + 2 && s.endsWith(suffix)) {
      s = s.slice(0, -suffix.length);
      break;
    }
  }
  return s.length > 3 && s.endsWith("e") ? s.slice(0, -1) : s;
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOPWORDS.has(w)).map(stem);
}

export function retrieve(chunks: PolicyChunk[], query: string, k = 2, minScore = 1): Retrieved[] {
  const queryTerms = [...new Set(tokenize(query))];
  return chunks
    .map((chunk) => {
      const body = tokenize(chunk.text);
      const title = new Set(tokenize(chunk.title));
      let score = 0;
      for (const term of queryTerms) {
        const tf = body.filter((w) => w === term).length;
        if (tf > 0) score += 1 + Math.log(tf);
        if (title.has(term)) score += 1.5;
      }
      return { chunk, score };
    })
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
