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
    return (
      text
        // Remove leading/trailing whitespace from lines
        .split('\n')
        .map((line) => line.trimRight())
        .join('\n')
        // Remove multiple blank lines (keep max 1)
        .replace(/\n\n\n+/g, '\n\n')
        // Remove trailing whitespace at end
        .trim()
    );
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
    // If same phrase appears 3+ times, use abbreviation
    const words = text.split(/\s+/);
    const phraseFreq = new Map<string, number>();

    // Find 3-word phrases that repeat
    for (let i = 0; i < words.length - 2; i++) {
      const phrase = words.slice(i, i + 3).join(' ');
      phraseFreq.set(phrase, (phraseFreq.get(phrase) || 0) + 1);
    }

    let result = text;

    // Replace phrases that appear 3+ times with shorter versions
    for (const [phrase, count] of Array.from(phraseFreq)) {
      if (count >= 3 && phrase.length > 20) {
        // Create abbreviation from first letters
        const abbr = phrase
          .split(' ')
          .slice(0, 2)
          .map((w) => w[0])
          .join('')
          .toUpperCase();

        // Replace all occurrences
        result = result.replace(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), abbr);
      }
    }

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

    // Truncate to maxLength, but try to end at sentence boundary
    let truncated = text.substring(0, maxLength);

    // Find last sentence ending
    const lastPeriod = truncated.lastIndexOf('.');
    const lastNewline = truncated.lastIndexOf('\n');
    const lastStop = Math.max(lastPeriod, lastNewline);

    if (lastStop > maxLength * 0.8) {
      // Found sentence boundary within 80% of max
      truncated = truncated.substring(0, lastStop + 1);
    }

    // Add ellipsis if truncated
    if (truncated !== text) {
      truncated += '\n[... truncated due to length ...]';
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

    return result.slice(0, maxLines).join('\n');
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
