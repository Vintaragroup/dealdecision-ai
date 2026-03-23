/**
 * extraction/xlsx/dependency-graph.ts
 *
 * Lightweight workbook dependency graph builder for Excel financial models.
 *
 * Constructs a directed dependency graph from formula strings across all
 * worksheets, detects circular references, and computes formula depth from
 * literal leaf cells.
 *
 * Scope of this phase:
 *   ✓  Direct single-cell same-sheet references (e.g. C5, $D$12)
 *   ✓  Direct single-cell cross-sheet references (e.g. =Inputs!C5)
 *   ✓  Simple circular reference detection (DFS-based)
 *   ✓  Formula depth from literal leaf cells (iterative relaxation)
 *   ✗  Range expansion: SUM(C3:C17) — range endpoints not expanded
 *   ✗  Named range resolution
 *   ✗  External workbook references: [Book2]Sheet1!A1
 *   ✗  Full formula evaluation / recalculation
 *
 * Design rules:
 *   - Pure functions: same inputs → same outputs.
 *   - Never throws.
 *   - Fails open: unrecognized patterns produce no edges.
 *   - All outputs are JSON-serializable (no Map/Set in the return payload).
 */

import { parseDirectCrossSheetRefs } from "./cross-tab-resolver.js";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * A direct cell dependency extracted from an Excel formula.
 *
 * Represents a single-cell reference (not a range) to a specific cell,
 * either on the same worksheet or a different one.
 *
 * Matches the `CellDependency` interface exported from `@dealdecision/core`.
 */
export interface CellDependency {
  /** Worksheet name. For same-sheet refs this is the current sheet name. */
  sheet: string;
  /** Cell address, uppercase, $ stripped. e.g. "C5", "D12". */
  cell: string;
}

/**
 * JSON-serializable workbook dependency graph payload.
 *
 * Stored per-sheet in the DPU page payload as `workbook_graph`.
 * Consumed by table-detector.ts → financial-model-interpreter.ts to enrich
 * TypedMetric with `formula_dependencies`, `dependency_depth`, and
 * `circular_reference_detected`.
 */
export interface WorkbookGraphPayload {
  /**
   * Cell keys in format "SheetName!CellAddr" that are part of circular
   * reference chains detected in the workbook.
   *
   * A formula whose dependencies include any of these cells should have
   * `circular_reference_detected: true`.  Empty when no circular references
   * exist in the workbook.
   */
  circular_cells: string[];

  /**
   * Depth of each formula cell from its literal (non-formula) leaf inputs.
   *
   * Key:   "SheetName!CellAddr" (formula-bearing cells only).
   * Value: depth from literal leaves. Depth 1 = formula depends only on
   *        literal cells. Depth 2 = depends on depth-1 formula cells. etc.
   *
   * Cells in `circular_cells` are excluded (depth undefined / not in map).
   * Cells not present are treated as literals with implicit depth 0.
   */
  cell_depths: Record<string, number>;
}

// ─── Cell address normalizer ──────────────────────────────────────────────────

/** Uppercase the column letters and strip all $ prefix characters. e.g. "$c$5" → "C5" */
function normalizeCellAddr(raw: string): string {
  return raw.replace(/\$/g, "").toUpperCase();
}

// ─── Same-sheet cell reference parser ────────────────────────────────────────

/**
 * Parse direct single-cell same-sheet references from an Excel formula.
 *
 * Extracts direct cell references that are NOT:
 *   - Part of a cross-tab reference (SheetName!COL:ROW — handled separately)
 *   - Part of a range (C3:C17 — both range endpoints are excluded)
 *   - Inside a string literal ("Revenue 2024")
 *   - Part of a longer identifier (e.g. EBITDA12 → no match)
 *   - A number in scientific notation (e.g. 1E5 → no match for E5)
 *
 * Returns normalized cell addresses (uppercase, $ stripped), deduplicated.
 *
 * @param formula  Raw formula string (with or without leading "=").
 * @returns        Array of same-sheet cell addresses; empty when none.
 */
export function parseSameSheetCellRefs(formula: string): string[] {
  if (!formula || typeof formula !== "string") return [];

  let s = formula;

  // Step 1: Remove string literals to avoid matching fake refs inside strings.
  s = s.replace(/"[^"]*"/g, '""');

  // Step 2: Remove quoted cross-tab ref patterns (preserves range coverage).
  // Handles: 'Sheet Name'!$C$5  and  'Sheet Name'!C3:D10
  s = s.replace(/'[^']*'!\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?/g, "");

  // Step 3: Remove unquoted cross-tab ref patterns.
  // Handles: SheetName!$C$5  and  SheetName!C3:D10
  s = s.replace(/\b[A-Za-z_][A-Za-z0-9_.]*!\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?/g, "");

  // Step 4: Match single-cell addresses.
  //
  // Negative lookbehind: not preceded by a letter, digit, underscore, or $ —
  // this prevents matching inside longer identifiers (e.g. EBITDA12) or
  // scientific notation (1E5 where E is preceded by digit 1).
  //
  // Negative lookahead: not followed by ":" — excludes range left endpoints.
  //
  // Negative lookbehind for ":": not preceded by ":" — excludes range right endpoints.
  // (e.g. C3:C17 → C3 is followed by ":", C17 is preceded by ":")
  const cellRe = /(?<![A-Za-z_$\d:])\$?([A-Za-z]{1,3})\$?(\d+)(?!:)/g;
  const results: string[] = [];
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(s)) !== null) {
    const cell = `${m[1]!.toUpperCase()}${m[2]!}`;
    if (!seen.has(cell)) {
      seen.add(cell);
      results.push(cell);
    }
  }

  return results;
}

// ─── Dependency parser ────────────────────────────────────────────────────────

/**
 * Parse all direct single-cell dependencies from an Excel formula.
 *
 * Combines:
 *   - Same-sheet direct cell refs (from `parseSameSheetCellRefs`)
 *   - Cross-sheet direct cell refs (from `parseDirectCrossSheetRefs`)
 *
 * Deduplicates by "sheet!cell" composite key.
 *
 * Range references (SUM(Inputs!C3:C10)) are NOT expanded — only direct
 * single-cell refs like `=Inputs!C5` or `=D12` produce dependency entries.
 *
 * @param formula       Raw formula string (with or without leading "=").
 * @param currentSheet  Worksheet name owning this formula (for same-sheet refs).
 * @returns             Deduped list of direct cell dependencies; empty when none.
 */
export function parseAllDirectCellDeps(
  formula: string,
  currentSheet: string,
): CellDependency[] {
  if (!formula || typeof formula !== "string") return [];
  if (!currentSheet || typeof currentSheet !== "string") return [];

  const deps: CellDependency[] = [];
  const seen = new Set<string>();

  const add = (sheet: string, cell: string): void => {
    const key = `${sheet}!${cell}`;
    if (!seen.has(key)) {
      seen.add(key);
      deps.push({ sheet, cell });
    }
  };

  // Cross-sheet direct single-cell refs (quoted and unquoted sheet names).
  for (const ref of parseDirectCrossSheetRefs(formula)) {
    add(ref.sheet, ref.cell);
  }

  // Same-sheet direct refs (after cross-tab patterns have been stripped
  // inside parseSameSheetCellRefs so they are not double-counted).
  for (const cell of parseSameSheetCellRefs(formula)) {
    add(currentSheet, cell);
  }

  return deps;
}

// ─── Workbook graph builder ───────────────────────────────────────────────────

/**
 * Build a lightweight dependency graph from all sheets' formula data.
 *
 * Constructs a directed graph where:
 *   - Nodes are cell keys ("SheetName!CellAddr")
 *   - Edges point from a formula cell to each directly referenced cell
 *
 * Then:
 *   1. Detects circular references using DFS with 3-color node states.
 *   2. Computes formula depth via iterative relaxation (acyclic subgraph only).
 *
 * @param sheetData  Per-sheet formula data: { sheet, cells: [{ addr, formula }] }
 * @returns          JSON-serializable workbook graph payload.
 */
export function buildWorkbookGraph(
  sheetData: ReadonlyArray<{
    sheet: string;
    cells: ReadonlyArray<{ addr: string; formula: string }>;
  }>,
): WorkbookGraphPayload {
  // adjacency: formulaCellKey → [depCellKey, ...]
  const adjacency = new Map<string, string[]>();

  for (const { sheet, cells } of sheetData) {
    for (const { addr, formula } of cells) {
      if (!addr || !formula) continue;
      const nodeKey = `${sheet}!${normalizeCellAddr(addr)}`;
      const depKeys = parseAllDirectCellDeps(formula, sheet).map(
        (d) => `${d.sheet}!${d.cell}`,
      );
      if (depKeys.length > 0) {
        adjacency.set(nodeKey, depKeys);
      }
    }
  }

  // Cycle detection
  const circularSet = detectCycles(adjacency);
  const circular_cells = [...circularSet].sort();

  // Depth computation (skips circular nodes)
  const depthsMap = computeDepths(adjacency, circularSet);
  const cell_depths: Record<string, number> = Object.fromEntries(depthsMap);

  return { circular_cells, cell_depths };
}

// ─── Cycle detection (DFS, 3-color) ──────────────────────────────────────────

/**
 * Detect all cells involved in circular reference chains using DFS.
 *
 * Uses 3-color node states:
 *   "unvisited"   — not yet reached in any DFS
 *   "in-progress" — on the current DFS path (gray node)
 *   "done"        — fully explored
 *
 * When a gray node is encountered during DFS, all nodes on the path from
 * that node to the current node form a cycle and are marked circular.
 */
function detectCycles(adjacency: Map<string, string[]>): Set<string> {
  type State = "in-progress" | "done";
  const state = new Map<string, State>();
  const circular = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): void {
    const s = state.get(node);
    if (s === "done") return;
    if (s === "in-progress") {
      // Back edge — cycle found. Mark all nodes in path from this node onward.
      const idx = path.lastIndexOf(node);
      if (idx !== -1) {
        for (let i = idx; i < path.length; i++) circular.add(path[i]!);
      }
      circular.add(node);
      return;
    }
    // Unvisited node
    state.set(node, "in-progress");
    path.push(node);
    for (const dep of adjacency.get(node) ?? []) {
      dfs(dep);
    }
    path.pop();
    state.set(node, "done");
  }

  for (const node of adjacency.keys()) {
    if (!state.has(node)) dfs(node);
  }

  return circular;
}

// ─── Depth computation (iterative relaxation) ─────────────────────────────────

/**
 * Compute formula depth for each non-circular formula cell.
 *
 * Depth semantics:
 *   - Literal (non-formula) cells have implicit depth 0 (not in the map).
 *   - A formula cell that depends only on literal cells has depth 1.
 *   - A formula cell that depends on depth-k formula cells has depth k+1.
 *
 * Uses iterative relaxation (repeats until stable) — O(N²) but correct for
 * acyclic subgraphs. Circular nodes are excluded from the result.
 */
function computeDepths(
  adjacency: Map<string, string[]>,
  circular: Set<string>,
): Map<string, number> {
  const depths = new Map<string, number>();

  let changed = true;
  while (changed) {
    changed = false;
    for (const [node, deps] of adjacency) {
      if (circular.has(node)) continue;   // Skip circular nodes
      if (depths.has(node)) continue;     // Already resolved

      const nonCircularDeps = deps.filter((d) => !circular.has(d));

      // A dep not in adjacency is a literal cell (implicit depth 0) — always resolved.
      const allResolved = nonCircularDeps.every(
        (d) => !adjacency.has(d) || depths.has(d),
      );
      if (!allResolved) continue;

      const maxDepth =
        nonCircularDeps.length > 0
          ? Math.max(
              ...nonCircularDeps.map((d) =>
                adjacency.has(d) ? (depths.get(d) ?? 0) : 0,
              ),
            )
          : 0;

      depths.set(node, maxDepth + 1);
      changed = true;
    }
  }

  return depths;
}
