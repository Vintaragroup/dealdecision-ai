import test from "node:test";
import assert from "node:assert/strict";

import { QUEUE_NAMES } from "@dealdecision/core";
import { getQueueNameForJobType } from "../services/jobs";

test("job type -> queue name mapping uses shared QUEUE_NAMES (includes populate_document_page_understanding)", () => {
  assert.equal(
    getQueueNameForJobType("populate_document_page_understanding"),
    QUEUE_NAMES.populate_document_page_understanding
  );

  // A few representative aliases that historically drifted.
  assert.equal(getQueueNameForJobType("extract_visuals_deal"), QUEUE_NAMES.extract_visuals);
  assert.equal(getQueueNameForJobType("generate_report"), QUEUE_NAMES.analyze_deal);
  assert.equal(getQueueNameForJobType("classify_document"), QUEUE_NAMES.ingest_documents);
});
