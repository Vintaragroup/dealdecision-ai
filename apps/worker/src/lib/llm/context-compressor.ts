/**
 * Context Compression Utility
 * 
 * Reduces context window size by:
 * 1. Summarizing lengthy documents
 * 2. Removing redundant information
 * 3. Using relative references instead of full names
 * 4. Compressing whitespace and formatting
 * 
 * Target: 15-25% token reduction
 */

/**
 * Compression options
 */
export interface CompressionOptions {
  aggressive?: boolean; // More aggressive compression, may lose nuance
  preserveFormatting?: boolean; // Keep markdown/code formatting
  maxLengthChars?: number; // Cut off at this length
  summaryLength?: number; // Lines in summary (for aggressive mode)
}

/**
 * Compression result
 */
export interface CompressionResult {
  original: string;
  compressed: string;
  originalLength: number;
  compressedLength: number;
  reductionPercent: number;
  compressionType: string;
}

/**
 * Context Compressor
 */
export class ContextCompressor {
  /**
   * Compress a completion request context
   * Applies multiple compression strategies in sequence
   */
  static compress(text: string, options: CompressionOptions = {}): CompressionResult {
    const originalLength = text.length;
    let compressed = text;
    const compressionTypes: string[] = [];

    // 1. Remove excessive whitespace (always safe, 5-10% saving)
    const afterWhitespace = this.compressWhitespace(compressed);
    if (afterWhitespace !== compressed) {
      compressed = afterWhitespace;
      compressionTypes.push('whitespace');
    }

    // 2. Remove comments and explanatory text (5-15% saving)
    const afterComments = this.removeComments(compressed);
    if (afterComments !== compressed) {
      compressed = afterComments;
      compressionTypes.push('comments');
    }

    // 3. Compress repeated words (2-5% saving)
    const afterRepeat = this.compressRepeatedContent(compressed);
    if (afterRepeat !== compressed) {
      compressed = afterRepeat;
      compressionTypes.push('repeated-content');
    }

    // 4. Truncate if too long (only if max specified)
    if (options.maxLengthChars) {
      const afterTruncate = this.truncateContent(compressed, options.maxLengthChars);
      if (afterTruncate !== compressed) {
        compressed = afterTruncate;
        compressionTypes.push('truncation');
      }
    }

    // 5. Aggressive summarization (if requested)
    if (options.aggressive) {
      const afterSummary = this.aggressiveSummarize(
        compressed,
        options.summaryLength || 50
      );
      if (afterSummary !== compressed) {
        compressed = afterSummary;
        compressionTypes.push('aggressive-summary');
      }
    }

    const compressedLength = compressed.length;
    const reductionPercent = 100 - (compressedLength / originalLength) * 100;

    return {
      original: text,
      compressed,
      originalLength,
      compressedLength,
      reductionPercent,
      compressionType: compressionTypes.join('+'),
    };
  }

  /**
   * Compress document extraction context
   * Used for fact-extraction and classification tasks
   */
  static compressDocumentContext(
    document: string,
    instructions: string
  ): { document: string; instructions: string; reduction: number } {
    const originalLength = document.length + instructions.length;

    // Compress document more aggressively (we only need key facts)
    const compressedDoc = this.compress(document, {
      aggressive: true,
      summaryLength: 100,
      maxLengthChars: 5000,
    });

    // Compress instructions slightly (preserve clarity)
    const compressedInstructions = this.compress(instructions, {
      aggressive: false,
      preserveFormatting: true,
    });

    const newLength = compressedDoc.compressedLength + compressedInstructions.compressedLength;
    const reduction = 100 - (newLength / originalLength) * 100;

    return {
      document: compressedDoc.compressed,
      instructions: compressedInstructions.compressed,
      reduction,
    };
  }

  /**
   * Compress analysis request context
   * Used for hypothesis generation and synthesis tasks
   */
  static compressAnalysisContext(
    factTable: string,
    hypotheses: string,
    queries: string
  ): { factTable: string; hypotheses: string; queries: string; reduction: number } {
    const originalLength = factTable.length + hypotheses.length + queries.length;

    // Compress fact table (facts are already concise)
    const compressedFacts = this.compress(factTable, {
      aggressive: false,
      maxLengthChars: 8000,
    });

    // Keep hypotheses mostly intact (they guide thinking)
    const compressedHypotheses = this.compress(hypotheses, {
      aggressive: false,
      preserveFormatting: true,
    });

    // Compress queries (just the queries, not explanations)
    const compressedQueries = this.compress(queries, {
      aggressive: true,
      maxLengthChars: 4000,
    });

    const newLength =
      compressedFacts.compressedLength +
      compressedHypotheses.compressedLength +
      compressedQueries.compressedLength;
    const reduction = 100 - (newLength / originalLength) * 100;

    return {
      factTable: compressedFacts.compressed,
      hypotheses: compressedHypotheses.compressed,
      queries: compressedQueries.compressed,
      reduction,
    };
  }

  /**
   * Remove excessive whitespace
   * Safe: 5-10% reduction
   */
  private static compressWhitespace(text: string): string {
    const normalizedLines = text
      .split(/\r?\n/)
      .map((line) => {
        const collapsed = line.replace(/[ \t]+/g, ' ').trim();
        return collapsed;
      });

    const joined = normalizedLines.join('\n')
      // Remove runs of 3+ blank lines down to a single blank line
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return joined;
  }

  /**
   * Remove comments and explanatory text
   * Safe: 5-15% reduction
   */
  private static removeComments(text: string): string {
    let result = text;

    // Remove markdown comments
    result = result.replace(/<!--[\s\S]*?-->/g, '');

    // Remove C-style comments
    result = result.replace(/\/\*[\s\S]*?\*\//g, '');
    result = result.replace(/\/\/.*$/gm, '');

    // Remove SQL comments
    result = result.replace(/--.*$/gm, '');

    // Remove # comments (shell, python)
    // But be careful not to remove markdown headers
    // Only remove if not at line start followed by space
    result = result.replace(/^(?!#\s)#[^#].*$/gm, '');

    return result;
  }

  /**
   * Compress repeated content
   * Safe: 2-5% reduction
   */
  private static compressRepeatedContent(text: string): string {
    const words = text.split(/\s+/);
    const bigramFreq = new Map<string, number>();

    for (let i = 0; i < words.length - 1; i++) {
      const phrase = `${words[i]} ${words[i + 1]}`.trim();
      if (!phrase) continue;
      bigramFreq.set(phrase, (bigramFreq.get(phrase) || 0) + 1);
    }

    const candidate = Array.from(bigramFreq.entries()).reduce<{ phrase: string; count: number } | null>((best, curr) => {
      if (curr[1] >= 3 && curr[0].length >= 8) {
        if (!best || curr[1] > best.count) return { phrase: curr[0], count: curr[1] };
      }
      return best;
    }, null);

    if (!candidate) return text;

    const escaped = candidate.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const abbr = candidate.phrase
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase();

    let occurrence = 0;
    const result = text.replace(new RegExp(escaped, 'g'), (match) => {
      occurrence += 1;
      return occurrence === 1 ? match : abbr;
    });

    return result;
  }

  /**
   * Truncate content to max length
   * Safe: Preserves complete sentences
   */
  private static truncateContent(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    const sentences = text.match(/[^.!?\n]+[.!?]?/g) || [text];
    let truncated = '';

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (!trimmed) continue;
      const candidate = truncated ? `${truncated} ${trimmed}` : trimmed;
      if (candidate.length > maxLength) break;
      truncated = candidate;
    }

    if (!truncated) {
      truncated = text.slice(0, maxLength).trimEnd();
    }

    if (truncated.length < text.length) {
      const ellipsis = ' [...]';
      const budget = Math.max(0, maxLength - ellipsis.length);
      truncated = truncated.slice(0, budget).trimEnd() + ellipsis;
    }

    if (truncated.length > maxLength) {
      truncated = truncated.slice(0, maxLength);
    }

    return truncated;
  }

  /**
   * Aggressive summarization
   * Use only when you can afford to lose some detail
   */
  private static aggressiveSummarize(text: string, maxLines: number): string {
    const lines = text.split('\n');

    if (lines.length <= maxLines) {
      return text;
    }

    // Strategy: Keep first 20%, evenly sample middle 60%, keep last 20%
    const result: string[] = [];
    const lineCount = lines.length;
    const firstCount = Math.ceil(lineCount * 0.2);
    const lastCount = Math.ceil(lineCount * 0.2);
    const sampleCount = maxLines - firstCount - lastCount;

    // Add first 20%
    result.push(...lines.slice(0, firstCount));

    // Sample middle 60% evenly
    if (sampleCount > 0) {
      const middleStart = firstCount;
      const middleEnd = lineCount - lastCount;
      const middleLines = middleEnd - middleStart;
      const step = Math.max(1, Math.floor(middleLines / sampleCount));

      for (let i = 0; i < middleLines; i += step) {
        if (result.length < maxLines) {
          result.push(lines[middleStart + i]);
        }
      }
    }

    // Add last 20%
    result.push(...lines.slice(Math.max(firstCount + sampleCount, lineCount - lastCount)));
    // Always include first and last lines and trim from the middle if needed
    const firstLine = lines[0];
    const lastLine = lines[lines.length - 1];
    const deduped = Array.from(new Set(result));

    // Remove any existing first/last to avoid duplicates, then re-add in canonical positions
    const middle = deduped.filter((line) => line !== firstLine && line !== lastLine);
    const assembled = [firstLine, ...middle, lastLine];

    if (assembled.length > maxLines) {
      const budget = Math.max(0, maxLines - 2); // leave room for first/last
      const trimmedMiddle = middle.slice(0, budget);
      return [firstLine, ...trimmedMiddle, lastLine].join('\n');
    }

    return assembled.join('\n');
  }

  /**
   * Estimate compression potential before applying
   */
  static estimateCompression(text: string): {
    estimatedReduction: number;
    strategies: string[];
  } {
    const strategies: string[] = [];
    let estimatedReduction = 0;

    // Whitespace compression: 5-10%
    if (/\n\n\n|\s{2,}/.test(text)) {
      strategies.push('whitespace');
      estimatedReduction += 7;
    }

    // Comments: 5-15%
    if (/\/\*|\/\/|<!--|--.*/m.test(text)) {
      strategies.push('comments');
      estimatedReduction += 10;
    }

    // Repeated content: 2-5%
    const words = text.split(/\s+/);
    const wordCounts = new Map<string, number>();
    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }
    if (Array.from(wordCounts.values()).some((count) => count > 5)) {
      strategies.push('repeated-content');
      estimatedReduction += 3;
    }

    // Aggressive: 15-30%
    if (text.length > 5000) {
      strategies.push('aggressive-summary');
      estimatedReduction += 20;
    }

    return {
      estimatedReduction: Math.min(estimatedReduction, 40), // Cap at 40%
      strategies,
    };
  }
}

/**
 * Export factory functions
 */
export function createCompressor(): ContextCompressor {
  return ContextCompressor as any;
}

export { ContextCompressor as default };
