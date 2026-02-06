import { test } from "node:test";
import assert from "node:assert/strict";

import { isTerminalJobStatus, isSuccessJobStatus } from "../prove-run-analysis-parity";

test("job status helpers treat succeeded_with_warnings as terminal+success", () => {
  assert.equal(isTerminalJobStatus("succeeded_with_warnings"), true);
  assert.equal(isSuccessJobStatus("succeeded_with_warnings"), true);

  assert.equal(isTerminalJobStatus("succeeded"), true);
  assert.equal(isSuccessJobStatus("succeeded"), true);

  assert.equal(isTerminalJobStatus("failed"), true);
  assert.equal(isSuccessJobStatus("failed"), false);

  assert.equal(isTerminalJobStatus("running"), false);
  assert.equal(isTerminalJobStatus("queued"), false);
});
