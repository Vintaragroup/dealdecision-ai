/**
 * Context Compressor Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { ContextCompressor } from '../context-compressor';

describe('ContextCompressor', () => {
  describe('Whitespace compression', () => {
    it('should remove excessive whitespace', () => {
      const text = 'Hello\n\n\n\nWorld';
      const result = ContextCompressor.compress(text);

      expect(result.compressed).not.toContain('\n\n\n');
      expect(result.reductionPercent).toBeGreaterThan(0);
    });

    it('should handle multiple spaces', () => {
      const text = 'Hello    world';
      const result = ContextCompressor.compress(text);

      expect(result.compressed).toBe('Hello world');
    });

    it('should preserve single blank lines', () => {
      const text = 'Section 1\n\nSection 2';
      const result = ContextCompressor.compress(text);

      expect(result.compressed).toContain('\n\n');
    });
  });

  describe('Comment removal', () => {
    it('should remove JavaScript comments', () => {
      const text = 'code // this is a comment\nmore code';
      const result = ContextCompressor.compress(text);

      expect(result.compressed).not.toContain('//');
    });

    it('should remove block comments', () => {
      const text = 'code /* comment block */ more code';
      const result = ContextCompressor.compress(text);

      expect(result.compressed).not.toContain('/*');
      expect(result.compressed).not.toContain('*/');
    });

    it('should remove HTML comments', () => {
      const text = 'content <!-- comment --> more';
      const result = ContextCompressor.compress(text);

      expect(result.compressed).not.toContain('<!--');
    });
  });

  describe('Repeated content compression', () => {
    it('should detect repeated phrases', () => {
      const text =
        'the company is strong the company is growing the company is profitable the company';
      const result = ContextCompressor.compress(text);

      // Should reduce size of repeated phrases
      expect(result.reductionPercent).toBeGreaterThan(0);
    });

    it('should only compress phrases appearing 3+ times', () => {
      const text = 'word1 word2 word3 word1 word2 word3 unique';
      const result = ContextCompressor.compress(text);

      // Result should be different from original
      expect(result.compressed.length).toBeLessThanOrEqual(text.length);
    });
  });

  describe('Truncation', () => {
    it('should truncate at max length', () => {
      const text = 'A'.repeat(5000);
      const result = ContextCompressor.compress(text, { maxLengthChars: 1000 });

      expect(result.compressed.length).toBeLessThanOrEqual(1000);
    });

    it('should not truncate if below max', () => {
      const text = 'short text';
      const result = ContextCompressor.compress(text, { maxLengthChars: 1000 });

      expect(result.compressed).toContain('short text');
    });

    it('should try to end at sentence boundary', () => {
      const text = 'First sentence. Second sentence. Third sentence.';
      const result = ContextCompressor.compress(text, { maxLengthChars: 30 });

      expect(result.compressed).toContain('First sentence.');
      expect(result.compressed).not.toContain('Second');
    });

    it('should add ellipsis when truncated', () => {
      const text = 'A'.repeat(5000);
      const result = ContextCompressor.compress(text, { maxLengthChars: 1000 });

      if (result.compressed !== text) {
        expect(result.compressed).toContain('...');
      }
    });
  });

  describe('Document context compression', () => {
    it('should compress document more than instructions', () => {
      const doc = 'This is a long document. '.repeat(100);
      const inst = 'Extract facts from the document.';

      const result = ContextCompressor.compressDocumentContext(doc, inst);

      expect(result.document.length).toBeLessThan(doc.length);
      expect(result.instructions).toContain('Extract facts');
    });

    it('should calculate total reduction', () => {
      const doc = 'Document content '.repeat(50);
      const inst = 'Instructions.';

      const result = ContextCompressor.compressDocumentContext(doc, inst);

      expect(result.reduction).toBeGreaterThan(0);
      expect(result.reduction).toBeLessThan(100);
    });
  });

  describe('Analysis context compression', () => {
    it('should compress analysis context', () => {
      const facts = 'Fact 1: '.repeat(100);
      const hypotheses = 'Hypothesis: '.repeat(50);
      const queries = 'Query: '.repeat(50);

      const result = ContextCompressor.compressAnalysisContext(facts, hypotheses, queries);

      expect(result.factTable.length).toBeLessThan(facts.length);
      expect(result.reduction).toBeGreaterThan(0);
    });

    it('should preserve hypothesis clarity', () => {
      const facts = 'fact';
      const hypotheses = 'This is a critical hypothesis\nthat must be true';
      const queries = 'query';

      const result = ContextCompressor.compressAnalysisContext(facts, hypotheses, queries);

      // Hypotheses should be mostly preserved (not aggressively compressed)
      expect(result.hypotheses).toContain('hypothesis');
    });
  });

  describe('Compression estimation', () => {
    it('should estimate compression potential', () => {
      const text = `
        long text with whitespace

        and /* comments */ more whitespace
      `;

      const estimate = ContextCompressor.estimateCompression(text);

      expect(estimate.estimatedReduction).toBeGreaterThan(0);
      expect(estimate.strategies.length).toBeGreaterThan(0);
    });

    it('should identify whitespace compression opportunity', () => {
      const text = 'line1\n\n\n\nline2';
      const estimate = ContextCompressor.estimateCompression(text);

      expect(estimate.strategies).toContain('whitespace');
    });

    it('should identify comment compression opportunity', () => {
      const text = 'code // comment\nmore';
      const estimate = ContextCompressor.estimateCompression(text);

      expect(estimate.strategies).toContain('comments');
    });

    it('should cap estimated reduction at 40%', () => {
      const veryBadText =
        `
      // comment\n\n\n
      code
      `.repeat(100);

      const estimate = ContextCompressor.estimateCompression(veryBadText);

      expect(estimate.estimatedReduction).toBeLessThanOrEqual(40);
    });
  });

  describe('Compression result structure', () => {
    it('should return proper result structure', () => {
      const result = ContextCompressor.compress('test');

      expect(result.original).toBe('test');
      expect(result.compressed).toBeDefined();
      expect(result.originalLength).toBeGreaterThan(0);
      expect(result.compressedLength).toBeGreaterThan(0);
      expect(result.reductionPercent).toBeDefined();
      expect(result.compressionType).toBeDefined();
    });

    it('should track compression type', () => {
      const text = '  hello  \n\n\n  world  \n\n  \n\n  ';
      const result = ContextCompressor.compress(text);

      expect(result.compressionType).toContain('whitespace');
    });

    it('should calculate reduction percentage correctly', () => {
      const text = 'A'.repeat(100);
      const result = ContextCompressor.compress(text, { maxLengthChars: 50 });

      if (result.compressed.length < text.length) {
        const expectedReduction = 100 - (result.compressedLength / result.originalLength) * 100;
        expect(result.reductionPercent).toBeCloseTo(expectedReduction, 1);
      }
    });
  });

  describe('Aggressive compression', () => {
    it('should apply aggressive summarization when requested', () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}: content`).join('\n');
      const result = ContextCompressor.compress(lines, {
        aggressive: true,
        summaryLength: 30,
      });

      expect(result.compressed.split('\n').length).toBeLessThanOrEqual(30);
      expect(result.compressionType).toContain('aggressive-summary');
    });

    it('should preserve first and last lines in summary', () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}`).join('\n');
      const result = ContextCompressor.compress(lines, {
        aggressive: true,
        summaryLength: 30,
      });

      expect(result.compressed).toContain('Line 0');
      expect(result.compressed).toContain('Line 99');
    });
  });
});
