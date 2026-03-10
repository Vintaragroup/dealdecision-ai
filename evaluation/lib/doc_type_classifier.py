"""
evaluation/lib/doc_type_classifier.py
=======================================

Document type classification for the Deal Understanding Benchmark.

Since all documents in the DB have type='other', classification is
inferred from file title, MIME type, page count, and deal-level document mix.

Document Type Discovery Map (benchmark set, 2026-03-09):
─────────────────────────────────────────────────────────
deal          | documents                                       | type
──────────────────────────────────────────────────────────────────────
3ICE          | PD - 3ICE.pdf (40p)                            | investor_deck
Bear          | Black-Horse-CIM.pdf (5p)                       | cim
Carmoola      | PD - Carmoola - Series B Teaser.pdf (21p)      | investor_deck
Cinco         | PD - Cino Deck 2025 Series A.pdf (17p)         | investor_deck
Complaint     | ComplYant - 4M - 2022.pdf (14p)                | investor_deck
Delphi        | DelphiPIV_I_OnePage_i.pdf (2p)                 | one_pager
Dephil Trade  | PD - Verse.pdf (17p)                           | investor_deck
Palm          | PD - Palm Capital Raise.pdf (31p)              | investor_deck
Palm3         | PD - Palm Capital Raise 070425 v2.pptx (31p)   | investor_deck
Probability AI| PD - Probility AI.pdf (13p) + .png + .docx     | mixed
Qredible      | PD - Qredible Future of Compliance V6.pdf (23p)| investor_deck
StackFactor   | Investor-Deck.pdf + CapTable.xlsx + FinancialModel.xlsx + P&L.pptx | mixed
StackOP       | same as StackFactor                            | mixed
WebMax        | Investor Deck.pdf + Financials.xlsx            | mixed
deal decision | PitchDeck.pdf + Income Statement.xlsx x2       | mixed
health        | PD - OFT_TOXYCREEN.pptx (32p)                  | investor_deck

Expectation mismatches in prior benchmark (before this feature):
- Delphi (one_pager, 2p): unfairly expected 17 product_profile slots
- Bear (CIM, 5p): insufficient text extraction → true_zero_expected
- health (investor_deck, 32p): product_profile absent → true_zero_expected
"""

from __future__ import annotations

import re


# ---------------------------------------------------------------------------
# Benchmark document type enum
# ---------------------------------------------------------------------------

class BenchmarkDocumentType:
    """String constants for benchmark-level deal document type."""
    INVESTOR_DECK    = "investor_deck"
    CIM              = "cim"
    ONE_PAGER        = "one_pager"
    DILIGENCE_REPORT = "diligence_report"
    FINANCIAL_PACK   = "financial_pack"
    MIXED            = "mixed"
    UNKNOWN          = "unknown"

    LABELS: dict = {
        "investor_deck":    "Investor Deck",
        "cim":              "CIM / Broker Report",
        "one_pager":        "One-Pager / Teaser",
        "diligence_report": "Diligence Report",
        "financial_pack":   "Financial Pack",
        "mixed":            "Mixed (Deck + Financials)",
        "unknown":          "Unknown",
    }

    @classmethod
    def label(cls, doc_type: str) -> str:
        return cls.LABELS.get(doc_type, doc_type)

    @classmethod
    def all_types(cls) -> list:
        return [cls.INVESTOR_DECK, cls.CIM, cls.ONE_PAGER,
                cls.DILIGENCE_REPORT, cls.FINANCIAL_PACK, cls.MIXED, cls.UNKNOWN]


# ---------------------------------------------------------------------------
# MIME type helpers
# ---------------------------------------------------------------------------

_MIME_DECK = {
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
}

_MIME_SPREADSHEET = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
}

_MIME_WORD = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
}

_MIME_IMAGE = {
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
}


def _is_spreadsheet_mime(mime: str) -> bool:
    return mime in _MIME_SPREADSHEET


def _is_deck_mime(mime: str) -> bool:
    return mime in _MIME_DECK


def _is_word_mime(mime: str) -> bool:
    return mime in _MIME_WORD


def _is_image_mime(mime: str) -> bool:
    return mime in _MIME_IMAGE


# ---------------------------------------------------------------------------
# Title signal scoring
# ---------------------------------------------------------------------------

_CIM_KEYWORDS = re.compile(
    r"\bcim\b|\bconfidential\s+information\s+memorandum\b|\bbroker\b",
    re.IGNORECASE,
)

_ONE_PAGER_KEYWORDS = re.compile(
    r"\bone.?pager?\b|\bone\s+page\b|\bteaser\b",
    re.IGNORECASE,
)

_DECK_KEYWORDS = re.compile(
    r"\bpitch\s*deck\b|\binvestor\s*deck\b|\bpitch\b|\bdeck\b|\bpd\s*[-–]|\bseries\s+[a-z]\b",
    re.IGNORECASE,
)

_FINANCIAL_KEYWORDS = re.compile(
    r"\bfinancial\s+model\b|\bincome\s+statement\b|\bbalance\s+sheet\b"
    r"|\bcash\s+flow\b|\bp&l\b|\bprofit\s*&?\s*loss\b|\bcap\s*table\b"
    r"|\bvaluation\b|\ballocation\b|\bproforma\b|\bforecasting\b",
    re.IGNORECASE,
)

_DILIGENCE_KEYWORDS = re.compile(
    r"\bdue\s+diligence\b|\bdiligence\s+report\b|\bassessment\b|\bquestionnaire\b"
    r"|\bdd\s+report\b",
    re.IGNORECASE,
)


def _title_signals(title: str) -> dict:
    """Return keyword match flags from a document title."""
    t = title or ""
    return {
        "cim":        bool(_CIM_KEYWORDS.search(t)),
        "one_pager":  bool(_ONE_PAGER_KEYWORDS.search(t)),
        "deck":       bool(_DECK_KEYWORDS.search(t)),
        "financial":  bool(_FINANCIAL_KEYWORDS.search(t)),
        "diligence":  bool(_DILIGENCE_KEYWORDS.search(t)),
    }


# ---------------------------------------------------------------------------
# Single-document classifier
# ---------------------------------------------------------------------------

def classify_document(
    title: str,
    mime_type: str,
    page_count: int | None,
) -> str:
    """
    Classify a single document into a BenchmarkDocumentType string.

    Priority chain:
      1. MIME type → spreadsheet → financial_pack
      2. MIME type → PPTX/deck → investor_deck (unless title says CIM / one_pager)
      3. MIME type → Word → diligence_report
      4. Title keyword: CIM     → cim
      5. Title keyword: teaser / one-pager OR ≤3 pages → one_pager
      6. Title keyword: deck/pitch/series → investor_deck
      7. Title keyword: financial → financial_pack
      8. Title keyword: diligence/assessment → diligence_report
      9. PDF/PPTX with >3 pages → investor_deck
     10. Unknown
    """
    mime = (mime_type or "").lower().strip()
    title = (title or "").strip()
    pc = page_count or 0
    sigs = _title_signals(title)

    # 1. Spreadsheet MIME → always financial_pack
    if _is_spreadsheet_mime(mime):
        return BenchmarkDocumentType.FINANCIAL_PACK

    # 2. PPTX MIME → investor_deck unless title overrides
    if _is_deck_mime(mime):
        if sigs["cim"]:
            return BenchmarkDocumentType.CIM
        if sigs["one_pager"] and pc <= 3:
            return BenchmarkDocumentType.ONE_PAGER
        return BenchmarkDocumentType.INVESTOR_DECK

    # 3. Word MIME → diligence_report
    if _is_word_mime(mime):
        return BenchmarkDocumentType.DILIGENCE_REPORT

    # 4 onward — title signals + page count (PDF or unknown MIME)

    if sigs["cim"]:
        return BenchmarkDocumentType.CIM

    if sigs["one_pager"]:
        return BenchmarkDocumentType.ONE_PAGER if pc <= 6 else BenchmarkDocumentType.INVESTOR_DECK

    if sigs["financial"] and not sigs["deck"]:
        return BenchmarkDocumentType.FINANCIAL_PACK

    if sigs["diligence"]:
        return BenchmarkDocumentType.DILIGENCE_REPORT

    if sigs["deck"]:
        return BenchmarkDocumentType.INVESTOR_DECK

    # Page count heuristics for PDF/image
    if pc == 0:
        return BenchmarkDocumentType.UNKNOWN
    if pc <= 3:
        return BenchmarkDocumentType.ONE_PAGER
    if mime == "application/pdf" or mime.startswith("image/"):
        return BenchmarkDocumentType.INVESTOR_DECK

    return BenchmarkDocumentType.UNKNOWN


# ---------------------------------------------------------------------------
# Deal-level classification
# ---------------------------------------------------------------------------

def classify_deal_documents(documents: list) -> dict:
    """
    Classify all documents for a deal and derive the deal-level benchmark type.

    Parameters
    ----------
    documents : list of dicts with keys: title, mime_type, page_count

    Returns
    -------
    dict with keys:
        deal_type           — BenchmarkDocumentType string for the deal overall
        doc_classifications — list of {doc_id, title, doc_type}
        has_deck            — bool: any investor_deck or one_pager in set
        has_financials      — bool: any financial_pack in set
        has_diligence       — bool: any diligence_report in set
        has_cim             — bool: any cim in set
        total_pages         — int: sum of page counts
        narrative_pages     — int: pages in non-financial docs
        signal_summary      — human-readable string
    """
    doc_classifications: list = []
    type_counts: dict = {t: 0 for t in BenchmarkDocumentType.all_types()}

    total_pages = 0
    narrative_pages = 0

    for doc in documents:
        doc_id    = str(doc.get("id") or doc.get("doc_id") or "")
        title     = str(doc.get("title") or "")
        mime      = str(doc.get("mime_type") or "")
        pc        = int(doc.get("page_count") or 0)
        doc_type  = classify_document(title, mime, pc)

        doc_classifications.append({
            "doc_id":   doc_id,
            "title":    title,
            "mime_type": mime,
            "page_count": pc,
            "doc_type": doc_type,
        })
        type_counts[doc_type] = type_counts.get(doc_type, 0) + 1
        total_pages += pc
        if doc_type != BenchmarkDocumentType.FINANCIAL_PACK:
            narrative_pages += pc

    has_deck       = type_counts[BenchmarkDocumentType.INVESTOR_DECK] > 0
    has_one_pager  = type_counts[BenchmarkDocumentType.ONE_PAGER] > 0
    has_financials = type_counts[BenchmarkDocumentType.FINANCIAL_PACK] > 0
    has_diligence  = type_counts[BenchmarkDocumentType.DILIGENCE_REPORT] > 0
    has_cim        = type_counts[BenchmarkDocumentType.CIM] > 0

    narrative_types = sum(
        type_counts.get(t, 0)
        for t in [BenchmarkDocumentType.INVESTOR_DECK,
                  BenchmarkDocumentType.CIM,
                  BenchmarkDocumentType.ONE_PAGER,
                  BenchmarkDocumentType.DILIGENCE_REPORT]
    )

    # Derive deal-level type
    if not documents:
        deal_type = BenchmarkDocumentType.UNKNOWN
    elif has_deck and has_financials:
        deal_type = BenchmarkDocumentType.MIXED
    elif has_deck and has_diligence:
        deal_type = BenchmarkDocumentType.MIXED
    elif has_deck:
        deal_type = BenchmarkDocumentType.INVESTOR_DECK
    elif has_one_pager and has_financials:
        deal_type = BenchmarkDocumentType.MIXED
    elif has_one_pager:
        deal_type = BenchmarkDocumentType.ONE_PAGER
    elif has_cim:
        if has_financials:
            deal_type = BenchmarkDocumentType.MIXED
        else:
            deal_type = BenchmarkDocumentType.CIM
    elif has_diligence:
        deal_type = BenchmarkDocumentType.DILIGENCE_REPORT
    elif has_financials:
        deal_type = BenchmarkDocumentType.FINANCIAL_PACK
    elif narrative_types == 0:
        deal_type = BenchmarkDocumentType.UNKNOWN
    else:
        deal_type = BenchmarkDocumentType.UNKNOWN

    # Signal summary
    parts = [f"{t}×{n}" for t, n in type_counts.items() if n > 0]
    signal_summary = " + ".join(parts)

    return {
        "deal_type":           deal_type,
        "doc_classifications": doc_classifications,
        "has_deck":            has_deck,
        "has_financials":      has_financials,
        "has_diligence":       has_diligence,
        "has_cim":             has_cim,
        "total_pages":         total_pages,
        "narrative_pages":     narrative_pages,
        "signal_summary":      signal_summary,
        "type_counts":         type_counts,
    }


# ---------------------------------------------------------------------------
# DB fetcher
# ---------------------------------------------------------------------------

def fetch_documents_for_classification(conn, deal_id: str) -> list:
    """
    Fetch document rows for deal type classification.

    Returns list of dicts with: id, title, mime_type, page_count.
    """
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, title, mime_type, page_count
                FROM documents
                WHERE deal_id = %s
                  AND deleted_at IS NULL
                ORDER BY title
                """,
                (deal_id,),
            )
            return [dict(r) for r in cur.fetchall()]
    except Exception:
        return []
