# Fixture Verification Report

Generated: 2026-02-08T00:00:26.193Z

## Summary

| fixture | vertical | red_flag_count | top flags |
| --- | --- | ---: | --- |
| product/pd-palm-capital-raise-070425-v2 | product | 2 | kpis.revenue.value_raw is null, kpi source.slide_title is null |
| product/pd-verse | product | 7 | archetype_key === "unknown", citations.total_sources === 0, deal_summary tiers contain placeholder phrasing |
| real_estate/cross-nobis-pref-equity-opportunity-deal-summary | real_estate | 7 | archetype_key === "unknown", citations.total_sources === 0, deal_summary tiers contain placeholder phrasing |
| real_estate/little-rock-ar-nobis-pref-equity-opportunity | real_estate | 7 | archetype_key === "unknown", citations.total_sources === 0, deal_summary tiers contain placeholder phrasing |
| real_estate/pd-webmax-investor-deck-2026-v2-edits | real_estate | 6 | archetype_key === "unknown", deal_summary tiers contain placeholder phrasing, kpis.revenue.value_raw is null |
| services/black-horse-cim | services | 7 | archetype_key === "unknown", citations.total_sources === 0, deal_summary tiers contain placeholder phrasing |
| services/pd-brandpoint-services-pcc-vf | services | 7 | archetype_key === "unknown", citations.total_sources === 0, deal_summary tiers contain placeholder phrasing |
| technology/pd-cino-deck-2025-series-a | technology | 7 | archetype_key === "unknown", citations.total_sources === 0, deal_summary tiers contain placeholder phrasing |
| technology/pd-qredible-future-of-compliance-v6-v2 | technology | 7 | archetype_key === "unknown", citations.total_sources === 0, deal_summary tiers contain placeholder phrasing |

## product/pd-palm-capital-raise-070425-v2

- Deck archetype: consumer_apparel_dtc (confidence: 0.8857142857142858)
- Citations: total_sources=11, unique_pages=5

**Deal summary tiers**

- hero (57 chars): This is a consumer brand in golf apparel and accessories.
- overview (228 chars): This is a consumer brand in golf apparel and accessories. Product: Palm enables the lifestyle of golf. Market: Participation in the sport has seen double digit growth over the last 5 years with over 36 million players in the US.
- deep (652 chars): This is a consumer brand in golf apparel and accessories. Product details: Palm enables the lifestyle of golf. Our apparel and accessories are rooted in the game of golf but are worn by lovers of fun on and off the course. Market / ICP: Participation in the sport has seen double digit growth over the last 5 years with over 36 million players in the US. Largest Segment is 18–34-year-old male, with 6.2M participants in 2022. Participation in the sport has seen double digit growth over the last 5 years with over 36 million players in the US. Largest Segment is 18–34-year-old male, with 6.2M participants in 2022. Palm enables the lifestyle of golf.

**KPIs**

| kpi | value_raw | scope_label | selection_reason | source page | source title |
| --- | --- | --- | --- | ---: | --- |
| raise | $1.5MM | — | — | 20 | Capital Raise. |
| revenue | — | — | not_extracted_yet | — | — |
| customers | 46 | Wholesale | — | 23 | Strategic Hires & Wholesale Build Out |
| growth | Forecast: $4.5M (2026) | Forecast | — | 17 | Growth Forecast. |

**Red flags**

- kpis.revenue.value_raw is null
- kpi source.slide_title is null

**Vertical Contract Compliance**

- Errors: 0, Warns: 0

- —

## product/pd-verse

- Deck archetype: unknown (confidence: 0)
- Citations: total_sources=0, unique_pages=0

**Deal summary tiers**

- hero (29 chars): This is a company in product.
- overview (79 chars): This is a company in product. Key details are pending from extracted materials.
- deep (120 chars): This is a company in product. Key details are pending from extracted materials. Notes: limited extracted signals so far.

**KPIs**

| kpi | value_raw | scope_label | selection_reason | source page | source title |
| --- | --- | --- | --- | ---: | --- |
| raise | $2M SEED | — | — | — | — |
| revenue | — | — | not_extracted_yet | — | — |
| customers | — | — | — | — | — |
| growth | — | — | — | — | — |

**Red flags**

- archetype_key === "unknown"
- citations.total_sources === 0
- deal_summary tiers contain placeholder phrasing
- kpis.revenue.value_raw is null
- kpis.customers.value_raw is null
- kpis.growth.value_raw is null
- kpi source.slide_title is null

**Vertical Contract Compliance**

- Errors: 0, Warns: 1

- [warn] product_definition.missing @ product_summary.product_definition: product_definition is required for vertical product but is missing (low-signal excerpt). evidence={"citations_total_sources":0,"hero":"This is a company in product."}

## real_estate/cross-nobis-pref-equity-opportunity-deal-summary

- Deck archetype: unknown (confidence: 0)
- Citations: total_sources=0, unique_pages=0

**Deal summary tiers**

- hero (29 chars): This is a company in product.
- overview (79 chars): This is a company in product. Key details are pending from extracted materials.
- deep (120 chars): This is a company in product. Key details are pending from extracted materials. Notes: limited extracted signals so far.

**KPIs**

| kpi | value_raw | scope_label | selection_reason | source page | source title |
| --- | --- | --- | --- | ---: | --- |
| raise | Unknown | — | — | — | — |
| revenue | — | — | not_extracted_yet | — | — |
| customers | — | — | — | — | — |
| growth | — | — | — | — | — |

**Red flags**

- archetype_key === "unknown"
- citations.total_sources === 0
- deal_summary tiers contain placeholder phrasing
- kpis.revenue.value_raw is null
- kpis.customers.value_raw is null
- kpis.growth.value_raw is null
- kpi source.slide_title is null

**Vertical Contract Compliance**

- Errors: 0, Warns: 0

- —

## real_estate/little-rock-ar-nobis-pref-equity-opportunity

- Deck archetype: unknown (confidence: 0)
- Citations: total_sources=0, unique_pages=0

**Deal summary tiers**

- hero (29 chars): This is a company in product.
- overview (79 chars): This is a company in product. Key details are pending from extracted materials.
- deep (120 chars): This is a company in product. Key details are pending from extracted materials. Notes: limited extracted signals so far.

**KPIs**

| kpi | value_raw | scope_label | selection_reason | source page | source title |
| --- | --- | --- | --- | ---: | --- |
| raise | Raise $5.7M | — | — | — | — |
| revenue | — | — | not_extracted_yet | — | — |
| customers | — | — | — | — | — |
| growth | — | — | — | — | — |

**Red flags**

- archetype_key === "unknown"
- citations.total_sources === 0
- deal_summary tiers contain placeholder phrasing
- kpis.revenue.value_raw is null
- kpis.customers.value_raw is null
- kpis.growth.value_raw is null
- kpi source.slide_title is null

**Vertical Contract Compliance**

- Errors: 0, Warns: 1

- [warn] diligence.min_open_items @ score_explanation.understanding_v1.diligence_open_items.count: Diligence open items count (0) is below contract minimum (2) for vertical real_estate. evidence={"count":0,"min":2,"auto_generate_if_missing":true}

## real_estate/pd-webmax-investor-deck-2026-v2-edits

- Deck archetype: unknown (confidence: 0.31000000000000005)
- Citations: total_sources=1, unique_pages=1

**Deal summary tiers**

- hero (29 chars): This is a company in product.
- overview (79 chars): This is a company in product. Key details are pending from extracted materials.
- deep (120 chars): This is a company in product. Key details are pending from extracted materials. Notes: limited extracted signals so far.

**KPIs**

| kpi | value_raw | scope_label | selection_reason | source page | source title |
| --- | --- | --- | --- | ---: | --- |
| raise | $2M | — | — | 11 | — |
| revenue | — | — | not_extracted_yet | — | — |
| customers | — | — | — | — | — |
| growth | — | — | — | — | — |

**Red flags**

- archetype_key === "unknown"
- deal_summary tiers contain placeholder phrasing
- kpis.revenue.value_raw is null
- kpis.customers.value_raw is null
- kpis.growth.value_raw is null
- kpi source.slide_title is null

**Vertical Contract Compliance**

- Errors: 0, Warns: 0

- —

## services/black-horse-cim

- Deck archetype: unknown (confidence: 0)
- Citations: total_sources=0, unique_pages=0

**Deal summary tiers**

- hero (29 chars): This is a company in product.
- overview (79 chars): This is a company in product. Key details are pending from extracted materials.
- deep (120 chars): This is a company in product. Key details are pending from extracted materials. Notes: limited extracted signals so far.

**KPIs**

| kpi | value_raw | scope_label | selection_reason | source page | source title |
| --- | --- | --- | --- | ---: | --- |
| raise | Unknown | — | — | — | — |
| revenue | — | — | not_extracted_yet | — | — |
| customers | — | — | — | — | — |
| growth | — | — | — | — | — |

**Red flags**

- archetype_key === "unknown"
- citations.total_sources === 0
- deal_summary tiers contain placeholder phrasing
- kpis.revenue.value_raw is null
- kpis.customers.value_raw is null
- kpis.growth.value_raw is null
- kpi source.slide_title is null

**Vertical Contract Compliance**

- Errors: 0, Warns: 0

- —

## services/pd-brandpoint-services-pcc-vf

- Deck archetype: unknown (confidence: 0)
- Citations: total_sources=0, unique_pages=0

**Deal summary tiers**

- hero (29 chars): This is a company in product.
- overview (79 chars): This is a company in product. Key details are pending from extracted materials.
- deep (120 chars): This is a company in product. Key details are pending from extracted materials. Notes: limited extracted signals so far.

**KPIs**

| kpi | value_raw | scope_label | selection_reason | source page | source title |
| --- | --- | --- | --- | ---: | --- |
| raise | Unknown | — | — | — | — |
| revenue | — | — | not_extracted_yet | — | — |
| customers | — | — | — | — | — |
| growth | — | — | — | — | — |

**Red flags**

- archetype_key === "unknown"
- citations.total_sources === 0
- deal_summary tiers contain placeholder phrasing
- kpis.revenue.value_raw is null
- kpis.customers.value_raw is null
- kpis.growth.value_raw is null
- kpi source.slide_title is null

**Vertical Contract Compliance**

- Errors: 0, Warns: 0

- —

## technology/pd-cino-deck-2025-series-a

- Deck archetype: unknown (confidence: 0)
- Citations: total_sources=0, unique_pages=0

**Deal summary tiers**

- hero (29 chars): This is a company in product.
- overview (79 chars): This is a company in product. Key details are pending from extracted materials.
- deep (120 chars): This is a company in product. Key details are pending from extracted materials. Notes: limited extracted signals so far.

**KPIs**

| kpi | value_raw | scope_label | selection_reason | source page | source title |
| --- | --- | --- | --- | ---: | --- |
| raise | Unknown | — | — | — | — |
| revenue | — | — | not_extracted_yet | — | — |
| customers | — | — | — | — | — |
| growth | — | — | — | — | — |

**Red flags**

- archetype_key === "unknown"
- citations.total_sources === 0
- deal_summary tiers contain placeholder phrasing
- kpis.revenue.value_raw is null
- kpis.customers.value_raw is null
- kpis.growth.value_raw is null
- kpi source.slide_title is null

**Vertical Contract Compliance**

- Errors: 0, Warns: 1

- [warn] product_definition.missing @ product_summary.product_definition: product_definition is required for vertical technology but is missing (low-signal excerpt). evidence={"citations_total_sources":0,"hero":"This is a company in product."}

## technology/pd-qredible-future-of-compliance-v6-v2

- Deck archetype: unknown (confidence: 0)
- Citations: total_sources=0, unique_pages=0

**Deal summary tiers**

- hero (29 chars): This is a company in product.
- overview (79 chars): This is a company in product. Key details are pending from extracted materials.
- deep (120 chars): This is a company in product. Key details are pending from extracted materials. Notes: limited extracted signals so far.

**KPIs**

| kpi | value_raw | scope_label | selection_reason | source page | source title |
| --- | --- | --- | --- | ---: | --- |
| raise | Seeking $3M | — | — | — | — |
| revenue | — | — | not_extracted_yet | — | — |
| customers | — | — | — | — | — |
| growth | — | — | — | — | — |

**Red flags**

- archetype_key === "unknown"
- citations.total_sources === 0
- deal_summary tiers contain placeholder phrasing
- kpis.revenue.value_raw is null
- kpis.customers.value_raw is null
- kpis.growth.value_raw is null
- kpi source.slide_title is null

**Vertical Contract Compliance**

- Errors: 0, Warns: 1

- [warn] product_definition.missing @ product_summary.product_definition: product_definition is required for vertical technology but is missing (low-signal excerpt). evidence={"citations_total_sources":0,"hero":"This is a company in product."}
