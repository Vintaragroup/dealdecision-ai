# PDF Export — Layout Contract

> Canonical reference for print layout decisions in `export-report-pdf`.
> Update this file whenever the layout configuration changes.

---

## Paper size

- **Format**: US Letter (8.5 × 11 in), hardcoded via `page.pdf({ format: "Letter" })`.
- Legal and A4 are not supported without a `ReportExportConfig.paperSize` extension (future).

---

## Margins — single source of truth: CSS `@page`

Margins are set **only** via the `@page` CSS rule injected by `html-renderer.ts`.
`page.pdf()` does **not** pass a `margin` option.

> Rationale: When both `page.pdf({ margin })` and CSS `@page { margin }` are set,
> Chromium/Playwright stacks them additively, producing unpredictable results.
> CSS `@page` alone gives deterministic, version-stable behavior.

| Mode | `@page` margin (top / right / bottom / left) |
|---|---|
| Page numbers **ON** (default) | `20mm / 18mm / 22mm / 18mm` |
| Page numbers **OFF** | `20mm / 18mm / 20mm / 18mm` |

The 22mm bottom (numbers on) provides clearance above the 10px footer injected by Playwright.

---

## Page numbers

Controlled by `ReportExportConfig.includePageNumbers` (default: `true` when omitted).

| `includePageNumbers` value | Effect |
|---|---|
| `true` or `undefined` | Footer rendered; `displayHeaderFooter: true` |
| `false` | No footer; `displayHeaderFooter` not set |

### Footer template

```html
<div style="font-size:10px;color:#9ca3af;width:100%;text-align:center;padding:0 18mm">
  <span class="pageNumber"></span> of <span class="totalPages"></span>
</div>
```

- Horizontal padding `0 18mm` aligns to the same column as the body content.
- Font size 10px / color `#9ca3af` (neutral gray) — does not intrude on content.

### Header template

`headerTemplate` is always set to `<span></span>` (a no-op element) when
`displayHeaderFooter: true`. This is **required** to suppress Chromium's default
header (which renders page title, URL, and date).

---

## Page breaks

Print CSS in `html-renderer.ts`:

```css
@media print {
  /* prevent section containers from splitting across pages */
  .section { break-inside: avoid; page-break-inside: avoid; }
  /* keep headings attached to the content that follows */
  h2, h3 { break-after: avoid; page-break-after: avoid; }
}
```

- Modern syntax (`break-*`) listed first; legacy fallback (`page-break-*`) follows.
- Each major section also sets `page-break-before: always` via inline style.

---

## Chromium launch

```ts
chromium.launch({
  headless: true,   // explicit — do not rely on defaults
  args: [
    "--no-sandbox",           // required in Docker / non-root environments
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage", // prevents OOM in constrained containers
    "--disable-gpu",          // no GPU in headless container
  ],
})
```

`headless: true` is explicit because future Playwright versions and environment
flags (`PLAYWRIGHT_CHROMIUM_HEADLESS=0`) can override the default.
