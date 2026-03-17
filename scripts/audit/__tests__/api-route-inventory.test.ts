/**
 * scripts/audit/__tests__/api-route-inventory.test.ts
 *
 * Snapshot-sync test: verifies that the committed JSON inventory stays in sync
 * with the actual route declarations in `apps/api/src/routes/`.
 *
 * If this test fails after you intentionally add/remove/rename a route, run:
 *
 *   pnpm audit:api-routes:update
 *
 * to regenerate the snapshot, then commit both the snapshot and the markdown.
 *
 * Runner: node:test (same as all API + scripts tests in this repo)
 *   pnpm test:api-routes
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { generateInventory } from "../api-route-inventory";
import type { RouteEntry, RouteInventory } from "../api-route-inventory";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SNAPSHOT_PATH = path.join(REPO_ROOT, "docs/audits/api-route-inventory.json");

// ── Helpers ───────────────────────────────────────────────────────────────────

function routeKey(r: RouteEntry): string {
  return `${r.method}:${r.path}:${r.source_file}:${r.source_line}`;
}

function routeLabel(r: RouteEntry): string {
  return `${r.method} ${r.path} (${r.source_file}:${r.source_line})`;
}

function sortedKeys(routes: RouteEntry[]): string[] {
  return routes.map(routeKey).sort();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("api-route-inventory: snapshot file exists", () => {
  assert.ok(
    fs.existsSync(SNAPSHOT_PATH),
    `Snapshot not found at ${SNAPSHOT_PATH}. Run: pnpm audit:api-routes:update`
  );
});

test("api-route-inventory: snapshot is valid JSON with required fields", () => {
  const raw = fs.readFileSync(SNAPSHOT_PATH, "utf8");
  const snap = JSON.parse(raw) as RouteInventory;

  assert.equal(snap.schema_version, "1", "schema_version must be '1'");
  assert.equal(snap.framework, "fastify", "framework must be 'fastify'");
  assert.ok(typeof snap.total_routes === "number" && snap.total_routes > 0, "total_routes must be > 0");
  assert.ok(Array.isArray(snap.routes), "routes must be an array");
  assert.equal(snap.routes.length, snap.total_routes, "routes.length must equal total_routes");
});

test("api-route-inventory: live scan matches committed snapshot", () => {
  const snapRaw = fs.readFileSync(SNAPSHOT_PATH, "utf8");
  const snap = JSON.parse(snapRaw) as RouteInventory;

  const live = generateInventory();

  // ── Check unregistered files ──────────────────────────────────────────────

  const snapUnreg = [...snap.unregistered_route_files].sort().join(",");
  const liveUnreg = [...live.unregistered_route_files].sort().join(",");

  if (snapUnreg !== liveUnreg) {
    assert.fail(
      `Unregistered route files have changed.\n` +
        `  Snapshot: [${snapUnreg}]\n` +
        `  Live:     [${liveUnreg}]\n\n` +
        `Run: pnpm audit:api-routes:update`
    );
  }

  // ── Check total route count ───────────────────────────────────────────────

  if (snap.total_routes !== live.total_routes) {
    assert.fail(
      `Route count changed: snapshot=${snap.total_routes}, live=${live.total_routes}.\n` +
        `Run: pnpm audit:api-routes:update`
    );
  }

  // ── Build key sets for diffing ────────────────────────────────────────────

  const snapKeys = new Set(sortedKeys(snap.routes));
  const liveKeys = new Set(sortedKeys(live.routes));

  const added = live.routes.filter((r) => !snapKeys.has(routeKey(r)));
  const removed = snap.routes.filter((r) => !liveKeys.has(routeKey(r)));

  if (added.length > 0 || removed.length > 0) {
    const addedLines = added.map((r) => `  + ${routeLabel(r)}`).join("\n");
    const removedLines = removed.map((r) => `  - ${routeLabel(r)}`).join("\n");

    assert.fail(
      `Route inventory is out of sync with committed snapshot.\n\n` +
        (removed.length > 0 ? `REMOVED (in snapshot, not in codebase):\n${removedLines}\n` : "") +
        (added.length > 0 ? `ADDED (in codebase, not in snapshot):\n${addedLines}\n` : "") +
        `\nTo update the snapshot, run:\n  pnpm audit:api-routes:update\n` +
        `Then commit the updated files in docs/audits/.`
    );
  }

  // Sanity: totals still match after diff check
  assert.equal(live.total_routes, snap.total_routes);
});

test("api-route-inventory: all routes have required fields", () => {
  const snapRaw = fs.readFileSync(SNAPSHOT_PATH, "utf8");
  const snap = JSON.parse(snapRaw) as RouteInventory;

  const VALID_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

  for (const r of snap.routes) {
    assert.ok(VALID_METHODS.has(r.method), `Invalid method '${r.method}' in route ${r.path}`);
    assert.ok(
      typeof r.path === "string" && r.path.startsWith("/"),
      `Route path must start with '/': ${JSON.stringify(r.path)}`
    );
    assert.ok(
      typeof r.source_file === "string" && r.source_file.length > 0,
      `source_file required for ${r.path}`
    );
    assert.ok(
      typeof r.source_line === "number" && r.source_line > 0,
      `source_line must be a positive number for ${r.path}`
    );
    assert.ok(Array.isArray(r.auth) && r.auth.length > 0, `auth must be non-empty for ${r.path}`);
  }
});

test("api-route-inventory: no duplicate method+path combinations", () => {
  const snapRaw = fs.readFileSync(SNAPSHOT_PATH, "utf8");
  const snap = JSON.parse(snapRaw) as RouteInventory;

  const seen = new Map<string, RouteEntry>();
  for (const r of snap.routes) {
    const key = `${r.method}:${r.path}`;
    if (seen.has(key)) {
      const prev = seen.get(key)!;
      assert.fail(
        `Duplicate route ${key} declared in both:\n` +
          `  ${prev.source_file}:${prev.source_line}\n` +
          `  ${r.source_file}:${r.source_line}`
      );
    }
    seen.set(key, r);
  }
});

test("api-route-inventory: all Clerk-protected routes start with /api/v1/", () => {
  const snapRaw = fs.readFileSync(SNAPSHOT_PATH, "utf8");
  const snap = JSON.parse(snapRaw) as RouteInventory;

  for (const r of snap.routes) {
    if (r.auth.includes("clerk_auth")) {
      assert.ok(
        r.path.startsWith("/api/v1/"),
        `Route ${r.method} ${r.path} has clerk_auth but does not start with /api/v1/`
      );
    }
  }
});
