import { test } from "node:test";
import assert from "node:assert/strict";
import { extractOrgFromPayload } from "../src/plugins/clerk-auth";

test("extractOrgFromPayload accepts payload.o.id as orgId", () => {
  const payload = { o: { id: "org_123", rol: "admin", slg: "example" } };
  const extracted = extractOrgFromPayload(payload as any);
  assert.equal(extracted.orgId, "org_123");
});
