/**
 * Tests for sanitize utilities that prevent Postgres UTF-8 encoding errors
 */

import { sanitizeText, sanitizeDeep, sanitizeNullableText } from "../sanitize";

describe("sanitizeText", () => {
  it("should remove NUL bytes (\\u0000)", () => {
    const input = "Hello\u0000World\u0000Test";
    const result = sanitizeText(input);
    expect(result).toBe("HelloWorldTest");
    expect(result).not.toContain("\u0000");
  });

  it("should remove C0 control characters except tab/newline/CR", () => {
    // Test removal of 0x01-0x08, 0x0B-0x0C, 0x0E-0x1F, 0x7F
    const input = "Hello\u0001\u0002\u0003World\u0007\u0008Test\u007F";
    const result = sanitizeText(input);
    expect(result).not.toContain("\u0001");
    expect(result).not.toContain("\u0007");
    expect(result).not.toContain("\u007F");
  });

  it("should preserve tab, newline, and carriage return", () => {
    const input = "Line1\nLine2\tTabbed\rReturn";
    const result = sanitizeText(input);
    expect(result).toContain("\n");
    expect(result).toContain("\t");
    expect(result).toContain("\r");
  });

  it("should collapse excessive whitespace", () => {
    const input = "Hello    World   \n\n\n   Test";
    const result = sanitizeText(input);
    expect(result).toBe("Hello World\n\n\nTest");
  });

  it("should handle null and undefined", () => {
    expect(sanitizeText(null)).toBe("");
    expect(sanitizeText(undefined)).toBe("");
  });

  it("should handle numbers and booleans", () => {
    expect(sanitizeText(123)).toBe("123");
    expect(sanitizeText(true)).toBe("true");
  });

  it("should handle real-world PDF extraction errors", () => {
    // Simulates the actual error: invalid byte sequence for encoding "UTF8": 0x00
    const pdfExtract = "Financial Data\u0000Revenue: $1M\u0000\u0001\u0002Profit: $500K";
    const result = sanitizeText(pdfExtract);
    expect(result).not.toContain("\u0000");
    expect(result).toContain("Revenue");
    expect(result).toContain("Profit");
  });
});

describe("sanitizeDeep", () => {
  it("should sanitize strings in nested objects", () => {
    const input = {
      title: "Test\u0000Title",
      metadata: {
        author: "John\u0000Doe",
        tags: ["tag1\u0000", "tag2"],
      },
    };
    const result = sanitizeDeep(input);
    expect(result.title).toBe("TestTitle");
    expect(result.metadata.author).toBe("JohnDoe");
    expect(result.metadata.tags[0]).toBe("tag1");
  });

  it("should sanitize arrays", () => {
    const input = ["Hello\u0000", "World\u0001", "Test\u0002"];
    const result = sanitizeDeep(input);
    expect(result).toEqual(["Hello", "World", "Test"]);
  });

  it("should handle nested arrays and objects", () => {
    const input = {
      data: [
        { name: "Item\u00001", value: 100 },
        { name: "Item\u00002", value: 200 },
      ],
    };
    const result = sanitizeDeep(input);
    expect(result.data[0].name).toBe("Item1");
    expect(result.data[1].name).toBe("Item2");
    expect(result.data[0].value).toBe(100);
  });

  it("should preserve non-string types", () => {
    const input = {
      str: "text\u0000",
      num: 123,
      bool: true,
      nullVal: null,
      arr: [1, 2, "three\u0000"],
    };
    const result = sanitizeDeep(input);
    expect(result.str).toBe("text");
    expect(result.num).toBe(123);
    expect(result.bool).toBe(true);
    expect(result.nullVal).toBe(null);
    expect(result.arr).toEqual([1, 2, "three"]);
  });

  it("should handle real JSONB payload with NUL bytes", () => {
    // Simulates structured_data or extraction_metadata with embedded NULs
    const jsonbPayload = {
      keyMetrics: [
        { label: "Revenue\u0000", value: "$1M\u0000" },
        { label: "Profit\u0001Margin", value: "50%\u0002" },
      ],
      mainHeadings: ["Executive\u0000Summary", "Financial\u0001Data"],
      textSummary: "Company\u0000overview\u0001with\u0002details",
    };
    const result = sanitizeDeep(jsonbPayload);
    expect(result.keyMetrics[0].label).toBe("Revenue");
    expect(result.keyMetrics[0].value).toBe("$1M");
    expect(result.mainHeadings[0]).toBe("ExecutiveSummary");
    expect(result.textSummary).not.toContain("\u0000");
    expect(result.textSummary).not.toContain("\u0001");
  });
});

describe("sanitizeNullableText", () => {
  it("should return null for null input", () => {
    expect(sanitizeNullableText(null)).toBe(null);
    expect(sanitizeNullableText(undefined)).toBe(null);
  });

  it("should sanitize non-null strings", () => {
    const input = "Hello\u0000World";
    const result = sanitizeNullableText(input);
    expect(result).toBe("HelloWorld");
  });

  it("should return null for empty strings after sanitization", () => {
    const input = "\u0000\u0001\u0002";
    const result = sanitizeNullableText(input);
    // After removing all control chars and trimming, we get empty string
    // The function returns "" for empty, not null (based on implementation)
    expect(result).toBe(null);
  });
});

describe("Postgres integration simulation", () => {
  it("should sanitize all SQL parameters before DB write", () => {
    // Simulate what would be passed to pg pool.query()
    const documentId = "doc\u0000123";
    const dealId = "deal\u0000456";
    const title = "Financials\u0000-\u0001Magarian\u0002Fund";
    const fullText = "Document\u0000text\u0001with\u0002NUL\u0003bytes";
    const structuredData = {
      metrics: ["Revenue\u0000: $1M", "Profit\u0001: $500K"],
      headings: ["Executive\u0000Summary"],
    };

    // Sanitize all parameters
    const params = [
      sanitizeText(documentId),
      sanitizeText(dealId),
      sanitizeText(title),
      sanitizeText(fullText),
      sanitizeDeep(structuredData),
    ];

    // Verify no NUL bytes remain
    const paramsStr = JSON.stringify(params);
    expect(paramsStr).not.toContain("\\u0000");
    expect(paramsStr).not.toContain("\\u0001");
    expect(paramsStr).not.toContain("\\u0002");

    // Verify data integrity
    expect(params[0]).toBe("doc123");
    expect(params[2]).toBe("Financials- Magarian Fund");
    expect(params[4].metrics[0]).toContain("Revenue");
  });

  it("should prevent the exact error: invalid byte sequence for encoding UTF8: 0x00", () => {
    // This is the exact scenario that caused the failure
    const errorMessage = "Document extraction failed: invalid byte sequence for encoding \"UTF8\": 0x00";
    const sanitized = sanitizeText(errorMessage);
    
    // Even if the error message itself contains the string "0x00", it's text not a NUL byte
    expect(sanitized).toContain("UTF8");
    expect(sanitized).toContain("0x00"); // This is the TEXT "0x00", not the byte

    // But a real NUL byte would be removed
    const realNulByte = "Error\u0000message";
    expect(sanitizeText(realNulByte)).toBe("Errormessage");
  });
});
