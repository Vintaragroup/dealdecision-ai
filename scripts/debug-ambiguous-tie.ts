export {};

// Debug helper: prints items where computed segment is unknown due to AMBIGUOUS_TIE.

import fs from "node:fs";
import path from "node:path";

async function main() {
  const dealId = process.argv[2] ?? "086866a6-f329-45bf-abcb-e67b0326b149";
  const apiBase = process.argv[3] ?? "http://localhost:9000";
  const url = `${apiBase.replace(/\/$/, "")}/api/v1/deals/${dealId}/lineage?debug_segments=1&segment_audit=1&group_pptx=1`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }

  const j: any = await res.json();
  const docs: any[] = j?.segment_audit_report?.documents ?? [];

  const hits: any[] = [];
  for (const d of docs) {
    for (const it of d?.items ?? []) {
      const seg = String(it?.computed_segment ?? it?.segment ?? "unknown");
      const reason = String(it?.computed_reason?.unknown_reason_code ?? it?.reason?.unknown_reason_code ?? "");
      if (seg === "unknown" && reason === "AMBIGUOUS_TIE") {
        const rr = it?.reason ?? {};
        hits.push({
          doc_title: d?.title ?? null,
          document_id: d?.document_id ?? null,
          page_label: it?.page_label ?? null,
          page_index: it?.page_index ?? null,
          segment_source: it?.segment_source ?? null,
          visual_asset_id: it?.visual_asset_id ?? null,
          title_text_snippet: rr?.title_text_snippet ?? null,
          snippet: it?.snippet ?? null,
          best_score: rr?.best_score ?? null,
          runner_up_score: rr?.runner_up_score ?? null,
          threshold: rr?.threshold ?? null,
          unknown_reason_code: rr?.unknown_reason_code ?? null,
          top_scores: rr?.top_scores ?? null,
        });

        // Keep output small: we mainly need to know what debug fields are present.
        if (hits.length >= 1) break;
      }
    }
    if (hits.length >= 1) break;
  }

  const out = { deal_id: dealId, found: hits.length, first: hits[0] ?? null };

  const outPath = path.resolve(process.cwd(), "artifacts/tmp_ambiguous_tie_debug.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log(JSON.stringify({ wrote: outPath, ...out }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
