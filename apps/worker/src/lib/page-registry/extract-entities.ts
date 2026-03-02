/**
 * extract-entities.ts
 *
 * Conservative heuristic entity extractor for deck/PDF pages.
 *
 * Rules:
 * - Never throws — returns [] on any error or empty input.
 * - Max 20 entities, deduped by normalized value.
 * - No generative LLM: uses capitalization heuristics + keyword signals.
 * - Conservative: avoids trash tokens via stopword list.
 *
 * Entity kinds:
 * - "company"     — lines/fragments with known brand/co patterns
 * - "product"     — SaaS/platform/API/tool names
 * - "customer"    — lines following "Customer:", "Client:" etc.
 * - "competitor"  — lines following "Competitor:", "vs." etc.
 * - "metric"      — ARR/MRR/CAC/LTV etc. mentions
 * - "technology"  — AI/LLM/ML/cloud/integration keywords
 * - "person"      — names following CEO/CTO/co-founder signals
 * - "other"       — capitalized noun phrases not fitting above
 */

import type { PageEntityV1, PageEntityKindV1 } from "@dealdecision/core";

// ─── Stopwords to strip from entity candidates ───────────────────────────────

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "this", "that", "these", "those", "our",
  "your", "their", "we", "us", "you", "it", "is", "are", "was", "were",
  "be", "been", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "can", "all", "more", "very", "also",
  "new", "one", "two", "three", "four", "five", "first", "last", "next",
  "per", "over", "under", "about", "than", "then", "when", "where", "how",
  "what", "who", "which", "not", "no", "yes", "if", "as", "so", "up",
  "out", "into", "just", "now", "here", "there", "such", "each", "any",
  "its", "via", "well", "both", "help", "use", "used", "using", "data",
]);

function isStopword(s: string): boolean {
  return STOPWORDS.has(s.toLowerCase());
}

// ─── Metric keywords ─────────────────────────────────────────────────────────

const METRIC_KEYWORDS = /\b(ARR|MRR|CAC|LTV|ARPU|NPS|DAU|MAU|WAU|GMV|NRR|GRR|ACV|TCV|EBITDA|CAGR|ROI|IRR|MOIC|runway|churn|retention|conversion|burn rate)\b/i;

// ─── Technology keywords ──────────────────────────────────────────────────────

const TECH_KEYWORDS = /\b(AI|LLM|GPT|ML|machine learning|deep learning|neural network|NLP|computer vision|RAG|embedding|API|SaaS|PaaS|IaaS|cloud|blockchain|IoT|mobile app|web app|platform|SDK|microservices|kubernetes|AWS|Azure|GCP|OpenAI|Anthropic|Hugging Face)\b/i;

// ─── Person/role patterns ─────────────────────────────────────────────────────

const ROLE_PREFIXES = /\b(CEO|CTO|COO|CFO|CPO|CMO|CRO|VP|founder|co-founder|cofounder|partner|director|head of|president|managing partner)\b[:\s,]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/gi;

// ─── Customer/competitor context lines ───────────────────────────────────────

const CUSTOMER_LINE = /^(?:customer|client|partner|user)[:\s]+(.+)/i;
const COMPETITOR_LINE = /^(?:competitor|competition|competing with|vs\.?\s+)(.+)/i;

// ─── Capitalized noun phrase heuristic ───────────────────────────────────────
// Matches 2–4 consecutive title-case words (potential proper nouns)

const TITLE_CASE_PHRASE = /\b([A-Z][a-z]{1,}(?:\s+[A-Z][a-z]{1,}){1,3})\b/g;

// ─── Main helpers ─────────────────────────────────────────────────────────────

function normalizeValue(v: string): string {
  return v.replace(/\s+/g, " ").trim().slice(0, 120);
}

function addEntity(
  entities: PageEntityV1[],
  seen: Set<string>,
  kind: PageEntityKindV1,
  rawValue: string,
): void {
  const value = normalizeValue(rawValue);
  if (!value) return;
  const key = `${kind}:${value.toLowerCase()}`;
  if (seen.has(key)) return;
  if (value.split(" ").every(isStopword)) return;
  seen.add(key);
  entities.push({ kind, value });
}

export function extractEntities(pageText: string): PageEntityV1[] {
  try {
    if (!pageText || !pageText.trim()) return [];

    const entities: PageEntityV1[] = [];
    const seen = new Set<string>();
    const lines = pageText.split(/\n|\r\n/).map((l) => l.trim()).filter(Boolean);

    for (const line of lines) {
      // Metric keywords in the line
      const metricMatches = line.match(new RegExp(METRIC_KEYWORDS.source, "gi"));
      if (metricMatches) {
        for (const m of metricMatches) {
          addEntity(entities, seen, "metric", m.toUpperCase());
        }
      }

      // Technology keywords
      const techMatches = line.match(new RegExp(TECH_KEYWORDS.source, "gi"));
      if (techMatches) {
        for (const m of techMatches) {
          addEntity(entities, seen, "technology", m);
        }
      }

      // Customer line: "Customer: Acme Corp"
      const custMatch = line.match(CUSTOMER_LINE);
      if (custMatch?.[1]) {
        const names = custMatch[1].split(/[,;]+/);
        for (const n of names) {
          const trimmed = n.trim();
          if (trimmed.length > 2 && trimmed.length < 80) addEntity(entities, seen, "customer", trimmed);
        }
        continue;
      }

      // Competitor line: "Competitors: Salesforce, HubSpot"
      const compMatch = line.match(COMPETITOR_LINE);
      if (compMatch?.[1]) {
        const names = compMatch[1].split(/[,;]+/);
        for (const n of names) {
          const trimmed = n.trim();
          if (trimmed.length > 2 && trimmed.length < 80) addEntity(entities, seen, "competitor", trimmed);
        }
        continue;
      }

      // Person pattern: "CEO: John Smith" / "Founder John Smith"
      ROLE_PREFIXES.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = ROLE_PREFIXES.exec(line)) !== null) {
        const name = m[2]?.trim();
        if (name && name.length > 3) addEntity(entities, seen, "person", name);
      }

      // Title-case noun phrases (company/product candidates)
      TITLE_CASE_PHRASE.lastIndex = 0;
      let tc: RegExpExecArray | null;
      while ((tc = TITLE_CASE_PHRASE.exec(line)) !== null) {
        const phrase = tc[1].trim();
        if (phrase.length < 3) continue;
        if (phrase.split(" ").every(isStopword)) continue;
        // Classify as company or other (conservative)
        const lc = phrase.toLowerCase();
        if (/\b(inc|llc|ltd|corp|co\.|group|labs|technologies|solutions|platform|systems)\b/i.test(phrase)) {
          addEntity(entities, seen, "company", phrase);
        } else if (/\b(app|platform|api|service|tool|suite|cloud|hub|ai)\b/i.test(lc)) {
          addEntity(entities, seen, "product", phrase);
        } else {
          addEntity(entities, seen, "other", phrase);
        }
      }

      if (entities.length >= 20) break;
    }

    return entities.slice(0, 20);
  } catch {
    return [];
  }
}
