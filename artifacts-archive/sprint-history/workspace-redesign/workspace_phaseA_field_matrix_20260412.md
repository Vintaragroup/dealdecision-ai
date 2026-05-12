# Workspace Phase A Field Matrix (2026-04-12)

Legend for tables:
- **Before source** describes the live data path prior to Phase A.
- **After source** lists the exact structured selector or fallback order now powering the slot.
- **Trust state** reflects what the UI shows today for that deal (`structured`, `governed`, `interim extraction`, or `not extracted`).
- **Deterministic now?** answers whether the rendered value can only come from the deterministic chain (`structured_summary → deal_summary_v1 → deterministic slots → overlay → phase1`).

The seven tracked deals are: PAI, Climatic, Weavstra, Dropables, Nanochon, NerdWallet, and WeWork.

## Company Name
| Deal | Before source | After source | Trust state | Deterministic now? |
|---|---|---|---|---|
| PAI | `dealInfo.name` metadata | `report.structured_summary.company_name` → overlay canonical identity → `"Unnamed Deal"` placeholder | `not_extracted` (payload still null) | ✅ (placeholder emitted when structured missing) |
| Climatic | Same as above | Same chain | `not_extracted` | ✅ |
| Weavstra | Same as above | Same chain | `not_extracted` | ✅ |
| Dropables | Same as above | Same chain | `not_extracted` | ✅ |
| Nanochon | Same as above | Same chain | `not_extracted` | ✅ |
| NerdWallet | Same as above | Same chain | `not_extracted` | ✅ |
| WeWork | Same as above | Same chain | `not_extracted` | ✅ |

## Company Description (Overview paragraph)
| Deal | Before source | After source | Trust state | Deterministic now? |
|---|---|---|---|---|
| PAI | Governed overlay (`governedDealOneLiner`) | `report.investment_analysis_overview_v2.summary_medium` → canonical tier overview → overlay | `structured` (deterministic summary available) | ✅ |
| Climatic | Same | Same | `structured` | ✅ |
| Weavstra | Same | Same | `structured` | ✅ |
| Dropables | Same | Same | `structured` | ✅ |
| Nanochon | Same | Same | `structured` | ✅ |
| NerdWallet | Same | Same | `structured` | ✅ |
| WeWork | Same | Same | `structured` | ✅ |

## Product Key Fact
| Deal | Before source | After source | Trust state | Deterministic now? |
|---|---|---|---|---|
| PAI | Phase1 `overviewV2.product_solution` string | `structured_summary.product_summary_v1` → `deal_summary_v1.product` → deterministic slot → overlay → phase1 | `not_extracted` (structured still null) | ✅ |
| Climatic | Same | Same | `not_extracted` | ✅ |
| Weavstra | Same | Same | `not_extracted` | ✅ |
| Dropables | Same | Same | `not_extracted` | ✅ |
| Nanochon | Same | Same | `not_extracted` | ✅ |
| NerdWallet | Same | Same | `not_extracted` | ✅ |
| WeWork | Same | Same | `not_extracted` | ✅ |

## Market / ICP Key Fact
| Deal | Before source | After source | Trust state | Deterministic now? |
|---|---|---|---|---|
| PAI | Phase1 `overviewV2.market_icp` | `structured_summary.market_summary_v1` → `deal_summary_v1.market_target` → deterministic slot → overlay → phase1 | `not_extracted` | ✅ |
| Climatic | Structured already available → canonical overlay | Same chain | `structured` (structured summary populated) | ✅ |
| Weavstra | Phase1 text | Same chain | `not_extracted` | ✅ |
| Dropables | Phase1 text | Same chain | `not_extracted` | ✅ |
| Nanochon | Phase1 text | Same chain | `not_extracted` | ✅ |
| NerdWallet | Phase1 text | Same chain | `not_extracted` | ✅ |
| WeWork | Phase1 text | Same chain | `not_extracted` | ✅ |

## Business Model Key Fact
| Deal | Before source | After source | Trust state | Deterministic now? |
|---|---|---|---|---|
| PAI | Deterministic arbitration already in place (RaaS) | Same arbitration result displayed with badge | `structured` | ✅ |
| Climatic | Same | Same | `structured` | ✅ |
| Weavstra | Same | Same | `structured` | ✅ |
| Dropables | Same | Same | `structured` | ✅ |
| Nanochon | Same | Same | `structured` | ✅ |
| NerdWallet | Same | Same | `structured` | ✅ |
| WeWork | Same | Same | `structured` | ✅ |

## Raise / Terms Key Fact & KPI
| Deal | Before source | After source | Trust state | Deterministic now? |
|---|---|---|---|---|
| PAI | Fallback to `reportView.raise` even when structured missing | `structured_summary.raise` → `deal_summary_v1.raise` → deterministic slot → overlay → phase1 | `not_extracted` (no structured raise) | ✅ |
| Climatic | Structured raise already visible | Same chain | `structured` | ✅ |
| Weavstra | Structured raise already visible | Same chain | `structured` | ✅ |
| Dropables | Structured raise already visible | Same chain | `structured` | ✅ |
| Nanochon | Structured raise already visible | Same chain | `structured` | ✅ |
| NerdWallet | Structured raise already visible | Same chain | `structured` | ✅ |
| WeWork | `reportView.raise` fallback | Same deterministic chain (shows “Not disclosed”) | `not_extracted` | ✅ |

## Team Highlights (RC-S6)
| Deal | Before source | After source | Trust state | Deterministic now? |
|---|---|---|---|---|
| PAI | Not rendered (backend field ignored) | `report.structured_summary.team_highlights[]` with “Not extracted” fallback | `structured` when list exists; otherwise `not_extracted` | ✅ |
| Climatic | Same | Same | `structured` | ✅ |
| Weavstra | Same | Same | `structured` | ✅ |
| Dropables | Same | Same | `not_extracted` (payload empty) | ✅ |
| Nanochon | Same | Same | `not_extracted` | ✅ |
| NerdWallet | Same | Same | `not_extracted` | ✅ |
| WeWork | Same | Same | `not_extracted` | ✅ |

## Use of Funds Breakdown (RC-S6)
| Deal | Before source | After source | Trust state | Deterministic now? |
|---|---|---|---|---|
| PAI | Not rendered | `report.structured_summary.use_of_funds_breakdown[]` | `structured` | ✅ |
| Climatic | Not rendered | Same (falls back to “Not extracted” because deck lacks structured UOF) | `not_extracted` | ✅ |
| Weavstra | Not rendered | Same (not extracted) | `not_extracted` | ✅ |
| Dropables | Not rendered | Same | `not_extracted` | ✅ |
| Nanochon | Not rendered | Same | `not_extracted` | ✅ |
| NerdWallet | Not rendered | Same | `not_extracted` | ✅ |
| WeWork | Not rendered | Same | `not_extracted` | ✅ |

## Project Pipeline (RC-S6)
| Deal | Before source | After source | Trust state | Deterministic now? |
|---|---|---|---|---|
| PAI | Not rendered | `report.structured_summary.project_pipeline[]` | `structured` | ✅ |
| Climatic | Not rendered | Same (null list → “Not extracted”) | `not_extracted` | ✅ |
| Weavstra | Not rendered | Same (null list) | `not_extracted` | ✅ |
| Dropables | Not rendered | Same | `not_extracted` | ✅ |
| Nanochon | Not rendered | Same | `not_extracted` | ✅ |
| NerdWallet | Not rendered | Same | `not_extracted` | ✅ |
| WeWork | Not rendered | Same | `not_extracted` | ✅ |

## Revenue Model (RC-S6)
| Deal | Before source | After source | Trust state | Deterministic now? |
|---|---|---|---|---|
| PAI | Not rendered | `report.structured_summary.revenue_model` (type/unit economics/recurring) | `structured` | ✅ |
| Climatic | Not rendered | Same (structured object present) | `structured` | ✅ |
| Weavstra | Not rendered | Same (structured object present) | `structured` | ✅ |
| Dropables | Not rendered | Same (still null → “Not extracted”) | `not_extracted` | ✅ |
| Nanochon | Not rendered | Same (still null) | `not_extracted` | ✅ |
| NerdWallet | Not rendered | Same (still null) | `not_extracted` | ✅ |
| WeWork | Not rendered | Same (still null) | `not_extracted` | ✅ |
