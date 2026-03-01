/**
 * Print-optimized HTML renderer for due-diligence PDF export.
 *
 * Pure function: takes OrchestratorReportV1 + ReportExportConfig, returns an HTML string.
 * No browser APIs; safe to run in a Node.js worker.
 *
 * Layout: A4/Letter page, Inter-style stack, no sticky headers, no app chrome.
 * Each section starts on its own page via `page-break-before: always`.
 */

import type { OrchestratorReportV1, DecisionLabel } from "@dealdecision/core";

type Segs = OrchestratorReportV1["segments"];
import type { ReportExportConfig, ReportExportSectionKey } from "@dealdecision/contracts";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function esc(value: unknown): string {
	const s = value == null ? "" : String(value);
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmt(value: unknown, fallback = "—"): string {
	if (value == null || value === "" || value === 0) return fallback;
	return esc(String(value));
}

function pct(n: number | null | undefined): string {
	if (n == null || !Number.isFinite(n)) return "—";
	return `${Math.round(n)}%`;
}

function scoreBar(score: number): string {
	const pctVal = Math.min(100, Math.max(0, Math.round(score)));
	const color = pctVal >= 70 ? "#22c55e" : pctVal >= 40 ? "#f59e0b" : "#ef4444";
	return `
    <div style="display:flex;align-items:center;gap:8px;margin:4px 0">
      <div style="flex:1;height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden">
        <div style="width:${pctVal}%;height:100%;background:${color};border-radius:3px"></div>
      </div>
      <span style="width:36px;text-align:right;font-weight:600;color:${color}">${pctVal}</span>
    </div>`;
}

function decisionColor(d: DecisionLabel | string): string {
	if (d === "GO") return "#22c55e";
	if (d === "NO_GO") return "#ef4444";
	return "#f59e0b";
}

function sectionTitle(title: string): string {
	return `<h2 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 16px;padding-bottom:8px;border-bottom:2px solid #e5e7eb">${esc(title)}</h2>`;
}

function kv(label: string, value: unknown, fallback = "—"): string {
	return `
    <div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid #f3f4f6">
      <span style="min-width:200px;max-width:240px;color:#6b7280;font-size:13px">${esc(label)}</span>
      <span style="flex:1;font-size:13px;color:#111827;font-weight:500">${fmt(value, fallback)}</span>
    </div>`;
}

function listItems(items: Array<string | null | undefined> | null | undefined): string {
	if (!Array.isArray(items) || items.length === 0) return "<p>—</p>";
	return `<ul style="margin:4px 0 0 16px;padding:0;color:#374151;font-size:13px">${items.filter(Boolean).map((i) => `<li style="margin:3px 0">${esc(i)}</li>`).join("")}</ul>`;
}

function textBlock(text: string | null | undefined): string {
	if (!text) return '<p style="color:#9ca3af;font-style:italic">No data available.</p>';
	return `<p style="color:#374151;font-size:14px;line-height:1.65;margin:0">${esc(text)}</p>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cover page
// ─────────────────────────────────────────────────────────────────────────────

function renderCoverPage(report: OrchestratorReportV1, dealName?: string): string {
	const decision = report.decision.label;
	const dColor = decisionColor(decision);
	const score = report.scores.overall_recommendation_score ?? 0;
	const stage = report.stage_context?.stage ?? "Unknown";
	const raise = report.stage_context?.raise_amount ?? null;
	const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

	return `
  <div style="page-break-after:always;min-height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:60px 40px;text-align:center">
    <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;margin-bottom:12px">Confidential Due Diligence Report</div>
    <h1 style="font-size:42px;font-weight:800;color:#111827;margin:0 0 8px;line-height:1.1">${esc(dealName ?? "Deal Report")}</h1>
    <p style="font-size:16px;color:#6b7280;margin:0 0 40px">${esc(date)}</p>
    <div style="display:inline-flex;align-items:center;gap:12px;background:${dColor}1a;border:2px solid ${dColor};border-radius:12px;padding:16px 32px;margin-bottom:40px">
      <span style="font-size:28px;font-weight:900;color:${dColor}">${esc(decision.replace("_", "-"))}</span>
      <span style="width:1px;height:32px;background:${dColor};opacity:.4"></span>
      <div style="text-align:left">
        <div style="font-size:13px;color:#6b7280">Overall Score</div>
        <div style="font-size:24px;font-weight:800;color:${dColor}">${pct(score)}</div>
      </div>
    </div>
    <div style="display:flex;gap:24px;font-size:13px;color:#6b7280">
      <span><strong style="color:#111827">Stage:</strong> ${esc(stage)}</span>
      ${raise ? `<span><strong style="color:#111827">Raise:</strong> ${esc(raise)}</span>` : ""}
    </div>
    <div style="position:absolute;bottom:32px;font-size:11px;color:#9ca3af">Generated by DealDecision AI · Confidential</div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Decision overlay
// ─────────────────────────────────────────────────────────────────────────────

function renderDecisionOverlay(report: OrchestratorReportV1): string {
	const { decision, scores } = report;
	const dColor = decisionColor(decision.label);
	const rationaleItems = Array.isArray(decision.rationale_bullets) ? decision.rationale_bullets : [];

	return `
  <div>
    ${sectionTitle("Go / No‑Go Decision")}
    <div style="display:flex;gap:16px;margin-bottom:24px">
      <div style="padding:16px 24px;border-radius:12px;background:${dColor}1a;border:2px solid ${dColor};min-width:140px;text-align:center">
        <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.08em">Recommendation</div>
        <div style="font-size:28px;font-weight:900;color:${dColor};margin-top:4px">${esc(decision.label.replace("_", "-"))}</div>
      </div>
      <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:12px">
        ${[
					["Overall Score", pct(scores.overall_recommendation_score)],
					["Risk Severity", pct(scores.risk_severity_score)],
					["Market Score", pct(scores.market_score?.raw)],
					["DCI Band", report.document_confidence?.band ?? "—"],
				]
					.map(([label, value]) => `<div style="background:#f9fafb;border-radius:8px;padding:12px"><div style="font-size:11px;color:#6b7280">${esc(label)}</div><div style="font-size:18px;font-weight:700;color:#111827;margin-top:2px">${esc(value)}</div></div>`)
					.join("")}
      </div>
    </div>
    ${
			rationaleItems.length > 0
				? `<div style="margin-bottom:16px"><h3 style="font-size:14px;font-weight:600;color:#374151;margin:0 0 8px">Rationale</h3>${listItems(rationaleItems)}</div>`
				: ""
		}
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Executive Summary
// ─────────────────────────────────────────────────────────────────────────────

function renderExecutiveSummary(segs: Segs): string {
	const s = segs?.executive_summary;
	if (!s) return `<div>${sectionTitle("Executive Summary")}<p style="color:#9ca3af">No data.</p></div>`;

	const paragraphs = Array.isArray(s.summary_paragraphs) ? s.summary_paragraphs : [];
	const strengths = Array.isArray(s.strengths) ? s.strengths : [];
	const risks = Array.isArray(s.risks) ? s.risks : [];
	const openQs = Array.isArray(s.open_questions) ? s.open_questions : [];

	return `
  <div>
    ${sectionTitle("Executive Summary")}
    ${s.headline ? `<p style="font-size:16px;font-weight:600;color:#111827;margin:0 0 12px">${esc(s.headline)}</p>` : ""}
    ${paragraphs.length > 0 ? paragraphs.map((p) => textBlock(p)).join("") : ""}
    ${
			strengths.length > 0
				? `<div style="margin-top:16px"><h3 style="font-size:13px;font-weight:600;color:#374151;margin:0 0 6px">Strengths</h3>${listItems(strengths)}</div>`
				: ""
		}
    ${
			risks.length > 0
				? `<div style="margin-top:12px"><h3 style="font-size:13px;font-weight:600;color:#ef4444;margin:0 0 6px">Risks</h3>${listItems(risks)}</div>`
				: ""
		}
    ${
			openQs.length > 0
				? `<div style="margin-top:12px"><h3 style="font-size:13px;font-weight:600;color:#f59e0b;margin:0 0 6px">Open Questions</h3>${listItems(openQs)}</div>`
				: ""
		}
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deal Terms
// ─────────────────────────────────────────────────────────────────────────────

function renderDealTerms(report: OrchestratorReportV1): string {
	const s = report.segments?.deal_terms;
	const st = report.stage_context;
	const missingTerms = Array.isArray(s?.missing_terms) ? s.missing_terms : [];
	const canonicalFields = Array.isArray(s?.canonical_fields_snapshot) ? s.canonical_fields_snapshot : [];

	return `
  <div>
    ${sectionTitle("Deal Terms")}
    ${st ? `
      <div style="margin-bottom:16px">
        ${kv("Stage", st.stage)}
        ${kv("Raise Amount", st.raise_amount)}
        ${kv("Instrument", st.instrument)}
        ${kv("Pre-money Valuation", st.valuation_pre)}
        ${kv("Post-money Valuation", st.valuation_post)}
      </div>
    ` : ""}
    ${s?.narrative ? `<div style="margin-bottom:16px">${textBlock(s.narrative)}</div>` : ""}
    ${missingTerms.length > 0
			? `<div style="margin-bottom:16px"><h3 style="font-size:13px;font-weight:600;color:#f59e0b;margin:0 0 6px">Missing Terms</h3>${listItems(missingTerms)}</div>`
			: ""}
    ${canonicalFields.length > 0 ? `
      <div>
        <h3 style="font-size:13px;font-weight:600;color:#374151;margin:0 0 6px">Key Fields</h3>
        ${canonicalFields.map((cf) => kv(cf.field, cf.value)).join("")}
      </div>` : ""}
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Market Analysis
// ─────────────────────────────────────────────────────────────────────────────

function renderMarketAnalysis(segs: Segs): string {
	const s = segs?.market;
	if (!s) return `<div>${sectionTitle("Market Analysis")}<p>—</p></div>`;

	const strengths = Array.isArray(s.strengths) ? s.strengths : [];
	const concerns = Array.isArray(s.concerns) ? s.concerns : [];
	const kpis = Array.isArray(s.kpis) ? s.kpis : [];

	return `
  <div>
    ${sectionTitle("Market Analysis")}
    ${s.narrative ? `<div style="margin-bottom:20px">${textBlock(s.narrative)}</div>` : ""}
    ${s.score != null ? `<div style="margin-bottom:16px"><div style="font-size:12px;color:#6b7280;margin-bottom:2px">Market Score</div>${scoreBar(s.score)}</div>` : ""}
    ${kpis.length > 0 ? `
      <div style="margin-bottom:16px">
        <h3 style="font-size:13px;font-weight:600;color:#374151;margin:0 0 6px">KPIs</h3>
        ${kpis.map((k) => kv(k.label, k.value)).join("")}
      </div>` : ""}
    ${strengths.length > 0 ? `<div style="margin-bottom:12px"><h3 style="font-size:13px;font-weight:600;color:#22c55e;margin:0 0 6px">Strengths</h3>${listItems(strengths)}</div>` : ""}
    ${concerns.length > 0 ? `<div><h3 style="font-size:13px;font-weight:600;color:#ef4444;margin:0 0 6px">Concerns</h3>${listItems(concerns)}</div>` : ""}
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Financial Analysis
// ─────────────────────────────────────────────────────────────────────────────

function renderFinancialAnalysis(
	segs: Segs,
	scores: OrchestratorReportV1["scores"]
): string {
	const s = segs?.financial;
	const fh = scores?.financial_health_score;
	const benchmarks = Array.isArray(s?.benchmarks) ? s.benchmarks : [];
	const strengths = Array.isArray(s?.strengths) ? s.strengths : [];
	const considerations = Array.isArray(s?.considerations) ? s.considerations : [];
	const narrativeParagraphs = Array.isArray(s?.narrative_paragraphs) ? s.narrative_paragraphs : [];

	return `
  <div>
    ${sectionTitle("Financial Analysis")}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
      ${[
				["Financial Health Score", pct(fh?.score ?? null)],
				["Health Status", fh?.status ?? "—"],
				["Reconciliation Confidence", pct(s?.reconciliation?.confidence_score ?? null)],
				["Coverage Pct", pct(null)],
			]
				.map(([label, value]) => `<div style="background:#f9fafb;border-radius:8px;padding:12px"><div style="font-size:11px;color:#6b7280">${esc(label)}</div><div style="font-size:16px;font-weight:700;color:#111827;margin-top:2px">${esc(value)}</div></div>`)
				.join("")}
    </div>
    ${narrativeParagraphs.length > 0 ? `<div style="margin-bottom:16px">${narrativeParagraphs.map(textBlock).join("")}</div>` : ""}
    ${benchmarks.length > 0 ? `
      <div style="margin-bottom:16px">
        <h3 style="font-size:13px;font-weight:600;color:#374151;margin:0 0 6px">Benchmarks</h3>
        ${benchmarks.map((b) => kv(b.label, b.value)).join("")}
      </div>` : ""}
    ${strengths.length > 0 ? `<div style="margin-bottom:12px"><h3 style="font-size:13px;font-weight:600;color:#22c55e;margin:0 0 6px">Strengths</h3>${listItems(strengths)}</div>` : ""}
    ${considerations.length > 0 ? `<div><h3 style="font-size:13px;font-weight:600;color:#f59e0b;margin:0 0 6px">Considerations</h3>${listItems(considerations)}</div>` : ""}
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk & Verification
// ─────────────────────────────────────────────────────────────────────────────

function renderRiskVerification(segs: Segs): string {
	const s = segs?.risk_verification;

	const topRisks = Array.isArray(s?.top_risks) ? s.top_risks : [];
	const vrRequests = Array.isArray(s?.verification_requests) ? s.verification_requests : [];
	const dataIssuesMissing = Array.isArray(s?.data_issues?.missing_critical_terms) ? s.data_issues.missing_critical_terms : [];

	const severityColor = (sev: string): string => {
		if (sev === "Critical") return "#b91c1c";
		if (sev === "High") return "#ef4444";
		if (sev === "Medium") return "#f59e0b";
		return "#6b7280";
	};

	return `
  <div>
    ${sectionTitle("Risk & Verification")}
    ${
			topRisks.length > 0
				? `<div style="margin-bottom:20px">
          <h3 style="font-size:13px;font-weight:600;color:#374151;margin:0 0 8px">Top Risks</h3>
          ${topRisks
						.map(
							(r: any) => `
            <div style="background:#fef2f2;border-left:3px solid ${severityColor(r.severity ?? "")};border-radius:0 6px 6px 0;padding:10px 12px;margin-bottom:8px">
              <div style="display:flex;justify-content:space-between;align-items:baseline">
                <span style="font-weight:600;font-size:13px;color:#111827">${esc(r.risk ?? "")}</span>
                <span style="font-size:11px;font-weight:700;color:${severityColor(r.severity ?? "")};text-transform:uppercase">${esc(r.severity ?? "")}</span>
              </div>
              ${Array.isArray(r.drivers) && r.drivers.length > 0 ? `<p style="margin:4px 0 0;font-size:12px;color:#6b7280">${esc(r.drivers.join(" · "))}</p>` : ""}
            </div>`
						)
						.join("")}
          </div>`
				: ""
		}
    ${
			vrRequests.length > 0
				? `<div style="margin-bottom:16px">
          <h3 style="font-size:13px;font-weight:600;color:#374151;margin:0 0 8px">Verification Requests</h3>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="background:#f9fafb">
              <th style="text-align:left;padding:6px 8px;color:#6b7280;font-weight:600">Field</th>
              <th style="text-align:left;padding:6px 8px;color:#6b7280;font-weight:600">Priority</th>
              <th style="text-align:left;padding:6px 8px;color:#6b7280;font-weight:600">Reason</th>
            </tr></thead>
            <tbody>
              ${vrRequests
								.map(
									(vr: any) => `<tr style="border-top:1px solid #f3f4f6">
                  <td style="padding:6px 8px;color:#111827;font-weight:500">${esc(vr.field ?? "")}</td>
                  <td style="padding:6px 8px;color:#f59e0b;font-weight:600">${esc(vr.priority ?? "")}</td>
                  <td style="padding:6px 8px;color:#6b7280">${esc(vr.reason ?? "")}</td>
                </tr>`
								)
								.join("")}
            </tbody>
          </table>
          </div>`
				: ""
		}
    ${dataIssuesMissing.length > 0 ? `<div><h3 style="font-size:13px;font-weight:600;color:#ef4444;margin:0 0 6px">Missing Critical Terms</h3>${listItems(dataIssuesMissing)}</div>` : ""}
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidence Appendix
// ─────────────────────────────────────────────────────────────────────────────

function renderEvidenceAppendix(report: OrchestratorReportV1): string {
	const registry = report.evidence_registry;
	const items = Array.isArray(registry?.items) ? registry.items : [];

	return `
  <div>
    ${sectionTitle("Evidence Appendix")}
    <p style="font-size:12px;color:#6b7280;margin:0 0 12px">${items.length} evidence item${items.length !== 1 ? "s" : ""} collected.</p>
    ${
			items.length > 0
				? `<table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#f9fafb">
            <th style="text-align:left;padding:6px 8px;color:#6b7280;font-weight:600">Field</th>
            <th style="text-align:left;padding:6px 8px;color:#6b7280;font-weight:600">Value</th>
            <th style="text-align:left;padding:6px 8px;color:#6b7280;font-weight:600">Source</th>
            <th style="text-align:left;padding:6px 8px;color:#6b7280;font-weight:600">Confidence</th>
          </tr></thead>
          <tbody>
            ${items
							.slice(0, 80) // Cap to avoid enormous PDFs
							.map(
								(item: any) => `<tr style="border-top:1px solid #f3f4f6">
                <td style="padding:5px 8px;color:#111827;font-weight:500">${esc(item.field ?? item.key ?? "")}</td>
                <td style="padding:5px 8px;color:#374151;max-width:200px;word-break:break-word">${esc(item.value ?? "")}</td>
                <td style="padding:5px 8px;color:#6b7280">${esc(item.source_type ?? "")}</td>
                <td style="padding:5px 8px;color:#6b7280">${pct((item.confidence ?? 0) * 100)}</td>
              </tr>`
							)
							.join("")}
          </tbody>
        </table>`
				: '<p style="color:#9ca3af;font-style:italic">No evidence items recorded.</p>'
		}
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export interface RenderHtmlOptions {
	report: OrchestratorReportV1;
	config: ReportExportConfig;
	dealName?: string | null;
}

export function renderReportHtml(opts: RenderHtmlOptions): string {
	const { report, config, dealName } = opts;
	const segs = report.segments;
	const sectionMap: Record<ReportExportSectionKey, () => string> = {
		decision_overlay: () => renderDecisionOverlay(report),
		executive_summary: () => renderExecutiveSummary(segs),
		deal_terms: () => renderDealTerms(report),
		market_analysis: () => renderMarketAnalysis(segs),
		financial_analysis: () => renderFinancialAnalysis(segs, report.scores),
		risk_verification: () => renderRiskVerification(segs),
		evidence_appendix: () => renderEvidenceAppendix(report),
	};

	const ordered: ReportExportSectionKey[] = [
		"decision_overlay",
		"executive_summary",
		"deal_terms",
		"market_analysis",
		"financial_analysis",
		"risk_verification",
		"evidence_appendix",
	];

	const selected = ordered.filter((k) => config.sections.includes(k));

	const coverHtml = config.includeCoverPage !== false ? renderCoverPage(report, dealName ?? undefined) : "";

	const sectionHtmlParts = selected.map((key, i) => {
		const content = sectionMap[key]?.() ?? "";
		const pageBreak = i > 0 ? 'style="page-break-before:always"' : "";
		return `<div ${pageBreak} class="section section-${key}">${content}</div>`;
	});

	// 4-value shorthand: top right bottom left.
	// Bottom is 22mm (numbers on) to give visual clearance above the 10px footer.
	// This is the ONLY margin source — page.pdf() does not set margin.
	const pageNumbers = config.includePageNumbers !== false
		? `<style>@page { margin: 20mm 18mm 22mm 18mm; }</style>`
		: `<style>@page { margin: 20mm 18mm 20mm 18mm; }</style>`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(dealName ?? "Due Diligence Report")}</title>
  ${pageNumbers}
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, Arial, sans-serif; font-size: 14px; color: #111827; background: #fff; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .section { padding: 32px 0; }
    .section + .section { padding-top: 0; }
    h1, h2, h3, h4 { margin: 0; font-weight: 700; }
    ul, ol { margin: 0; padding: 0 0 0 20px; }
    li { margin: 3px 0; line-height: 1.5; }
    table { border-collapse: collapse; }
    @media print {
      /* modern syntax first, legacy fallback second (both are read by Chromium) */
      .section { break-inside: avoid; page-break-inside: avoid; }
      /* keep headings with their following content — prevents orphan titles */
      h2, h3 { break-after: avoid; page-break-after: avoid; }
    }
  </style>
</head>
<body>
  ${coverHtml}
  <div style="max-width:800px;margin:0 auto;padding:0">
    ${sectionHtmlParts.join("\n")}
  </div>
  ${config.includePageNumbers !== false ? `
  <script>
    // Footer page numbers are injected by Playwright's headerTemplate/footerTemplate
  </script>` : ""}
</body>
</html>`;
}
