export interface NormalizationResult {
  normalized_text: string;
  normalization_flags: string[];
}

export function normalizeText(raw: string): NormalizationResult {
  const normalization_flags: string[] = [];

  // 1) Unicode normalize to NFKC
  let text = raw.normalize("NFKC");

  // 2) De-hyphenate line breaks
  text = text.replace(/([A-Za-z])-\n([A-Za-z])/g, "$1$2");

  // 3) Join wrapped lines
  // Condition:
  // - current line ends with [A-Za-z0-9,]
  // - current line does NOT end with punctuation .?!:;
  // - next line starts with lowercase letter or digit
  const lines = text.split("\n");
  const joined: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const current = joined.length > 0 ? joined[joined.length - 1] : undefined;
    const line = current === undefined ? lines[i] : current;

    if (current !== undefined) {
      // We've already placed this line in `joined` as the last element.
      // So advance `i` has already happened (we set line=current), and we'll attempt to merge with `lines[i]` next.
    }

    if (current === undefined) {
      joined.push(lines[i]);
      continue;
    }

    // Attempt to merge `line` (last in joined) with `lines[i]`.
    const nextLine = lines[i];
    const leftTrimmed = line.replace(/[ \t]+$/g, "");
    const rightTrimmed = nextLine.replace(/^[ \t]+/g, "");

    const leftEndChar = leftTrimmed.length > 0 ? leftTrimmed[leftTrimmed.length - 1] : "";
    const leftEndsWithAllowed = /[A-Za-z0-9,]/.test(leftEndChar);
    const leftEndsWithPunct = /[.?!:;]/.test(leftEndChar);
    const rightStartChar = rightTrimmed.length > 0 ? rightTrimmed[0] : "";
    const rightStartsLowerOrDigit = /[a-z0-9]/.test(rightStartChar);

    if (leftEndsWithAllowed && !leftEndsWithPunct && rightStartsLowerOrDigit) {
      joined[joined.length - 1] = `${leftTrimmed} ${rightTrimmed}`;
    } else {
      joined.push(nextLine);
    }
  }
  text = joined.join("\n");

  // 4) Collapse whitespace
  text = text.replace(/[ \t]{2,}/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");

  // 5) OCR confusion fixes (conservative)
  // - S -> $ only when near digits and no alpha nearby
  // - O -> 0 only when token is mostly digits
  // Log every applied transform in normalization_flags.

  // 5a) S -> $
  {
    const chars = [...text];
    for (let idx = 0; idx < chars.length; idx++) {
      if (chars[idx] !== "S") continue;

      // Must be near a digit (allow whitespace between)
      let hasNearbyDigit = false;
      for (let j = idx + 1; j < Math.min(chars.length, idx + 6); j++) {
        const c = chars[j];
        if (c === " " || c === "\t") continue;
        if (/[0-9]/.test(c)) hasNearbyDigit = true;
        break;
      }
      if (!hasNearbyDigit) continue;

      // Must not have alpha nearby (excluding this S) within +/-2 characters.
      let hasNearbyAlpha = false;
      for (let j = Math.max(0, idx - 2); j <= Math.min(chars.length - 1, idx + 2); j++) {
        if (j === idx) continue;
        if (/[A-Za-z]/.test(chars[j])) {
          hasNearbyAlpha = true;
          break;
        }
      }
      if (hasNearbyAlpha) continue;

      // Also require previous non-space is not alphabetic.
      let prevNonSpace: string | null = null;
      for (let j = idx - 1; j >= 0; j--) {
        const c = chars[j];
        if (c === " " || c === "\t") continue;
        prevNonSpace = c;
        break;
      }
      if (prevNonSpace && /[A-Za-z]/.test(prevNonSpace)) continue;

      chars[idx] = "$";
      normalization_flags.push("ocr_fix:S_to_$");
    }
    text = chars.join("");
  }

  // 5b) O -> 0 within tokens that are mostly digits
  {
    const tokenRegex = /[A-Za-z0-9]+/g;
    let match: RegExpExecArray | null;
    const replacements: Array<{ start: number; end: number; value: string }> = [];

    while ((match = tokenRegex.exec(text)) !== null) {
      const token = match[0];
      if (!token.includes("O")) continue;

      const digits = (token.match(/[0-9]/g) ?? []).length;
      const len = token.length;
      const digitRatio = len > 0 ? digits / len : 0;
      if (digits < 2) continue;
      if (digitRatio < 0.6) continue;

      const replaced = token.replace(/O/g, "0");
      if (replaced !== token) {
        replacements.push({ start: match.index, end: match.index + token.length, value: replaced });
        normalization_flags.push("ocr_fix:O_to_0");
      }
    }

    if (replacements.length > 0) {
      let out = "";
      let cursor = 0;
      for (const r of replacements) {
        out += text.slice(cursor, r.start);
        out += r.value;
        cursor = r.end;
      }
      out += text.slice(cursor);
      text = out;
    }
  }

  return {
    normalized_text: text,
    normalization_flags,
  };
}
