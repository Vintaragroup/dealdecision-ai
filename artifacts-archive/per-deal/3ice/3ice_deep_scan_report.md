# 3ICE — Deep Scan Visuals Report (Post-run)

Date: 2026-01-18  
Deal id: `2bd8864c-b35d-4982-a9e1-83df13385bb1`

## What changed (measured now)

From the API after your deep scan run:

- Visual assets: 40
- Missing slide titles: 0
- Missing effective segments: 0
- Vision-understanding payload present: 32 / 40
- Titles sourced from vision: 3
- Segments sourced from vision: 0

Segment audit (lineage):
- Total nodes audited: 40
- `unknown` segments: 4
- Eligible `unknown` (LOW_SIGNAL / NO_TEXT): 4

## Notes

- Deep scan appears to have **filled in titles and segments for UI/API consumption** (0 missing titles; 0 missing effective segments).
- There are still 4 nodes with `unknown` segment in the lineage audit; those look like the classic low/no-signal cases (eligible_for_fill=4).
- The slide-title audit reports `picked_title_garbled_warnings: 26` which means we’re often suppressing “garbled” candidates and choosing a safer title (expected behavior, but it may still indicate OCR text noise).

## Artifacts

- Post-deep-scan metrics JSON: `artifacts/3ice_deep_scan_metrics.json`
- Post-deep-scan titles export: `artifacts/3ice_slide_titles_post_deep_scan.md`

## Next step if you want further improvement

If the remaining issues are primarily **NO_TEXT / LOW_SIGNAL** pages:
- A stronger OCR engine will only help if there *is actually readable text* on the slide/page but Tesseract is failing.

If the issues are truly **no text** (logos, photos, diagrams), OCR won’t help much — we’d instead need richer vision understanding (captioning/VLM) or more domain-specific heuristics.

If you want, I can pull the 4 `unknown` lineage items (doc/page) into a short list so we can decide if OCR is the bottleneck or not.
