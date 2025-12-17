# Document Ingestion & Analysis System

## Overview

The DealDecision system now supports intelligent document ingestion and analysis for the following file formats:

- **PDF** (.pdf) - Pitch decks, whitepapers, financial reports
- **PowerPoint** (.pptx, .ppt) - Presentations, investor decks
- **Excel** (.xlsx, .xls) - Financial models, projections, analysis
- **Word** (.docx, .doc) - Proposals, writeups, specifications
- **Images** (.png, .jpg, .gif) - Logos, charts, diagrams (OCR support planned)

## How It Works

### 1. Upload Document

**Endpoint:** `POST /api/v1/deals/{dealId}/documents`

**Request:**
```bash
curl -X POST http://localhost:9000/api/v1/deals/{dealId}/documents \
  -F "file=@path/to/document.pdf" \
  -F "type=pitch_deck" \
  -F "title=Optional Title"
```

**Supported document types:**
- `pitch_deck` - Investor presentations
- `financials` - Financial statements & models
- `product` - Product documentation
- `legal` - Legal documents
- `team` - Team/people information
- `market` - Market research
- `other` - Default category

**Response:**
```json
{
  "document": {
    "document_id": "uuid",
    "deal_id": "uuid",
    "title": "Document title",
    "type": "pitch_deck",
    "status": "pending",
    "uploaded_at": "2025-12-17T00:15:00.000Z"
  },
  "job_status": "queued",
  "job_id": "job-uuid"
}
```

### 2. Automatic Processing

When a document is uploaded, an async job is queued to:

1. **Extract Content** - Parse document structure and text
2. **Analyze Structure** - Identify headings, sections, tables
3. **Extract Metrics** - Pull numerical values and financial data
4. **Generate Evidence** - Create structured evidence items
5. **Store Results** - Save analysis in database

### 3. Monitor Processing Status

**Endpoint:** `GET /api/v1/deals/{dealId}/jobs`

Returns job status including:
- `pending` - Waiting to process
- `running` - Currently processing
- `succeeded` - Successfully completed
- `failed` - Processing failed

### 4. Retrieve Extracted Data

**Evidence Endpoint:** `GET /api/v1/deals/{dealId}/evidence`

Returns all extracted evidence items including:
- Metrics and financial data
- Section headings and topics
- Key numbers and values
- Document summaries
- Confidence scores (0.0-1.0)

## File Type Processing Details

### PDF Processing

**Extracts:**
- Page-by-page text content
- Word positioning and coordinates
- Main headings (auto-detected)
- Numerical values with context ($M, %, K scale)
- Document metadata (title, author, creation date)

**Identifies:**
- Tables and structured layouts
- Key financial figures
- Document structure hierarchy

**Output Example:**
```json
{
  "metadata": {
    "title": "Acme Fund Investor Deck",
    "author": "John Smith",
    "pages": 23
  },
  "pages": [
    {
      "pageNumber": 1,
      "text": "Full page text...",
      "words": [
        {"text": "Acme", "x": 100, "y": 50, "width": 45, "height": 12}
      ],
      "tables": []
    }
  ],
  "summary": {
    "totalWords": 4200,
    "mainHeadings": ["Executive Summary", "Market Opportunity", "Team"],
    "keyNumbers": [
      {"value": "$250M", "context": "Total addressable market is estimated at $250M"},
      {"value": "45%", "context": "Projected CAGR of 45% over 5 years"}
    ]
  }
}
```

### Excel Processing

**Extracts:**
- All sheets and their names
- Headers and column definitions
- Data types (numeric, date, text)
- Formulas and calculations
- Statistical summaries (min, max, avg)

**Analyzes:**
- Numeric columns for financial metrics
- Date columns for timeline data
- Cell formulas for model logic
- Data relationships and dependencies

**Output Example:**
```json
{
  "metadata": {
    "sheetNames": ["P&L", "Balance Sheet", "Projections"],
    "totalSheets": 3
  },
  "sheets": [
    {
      "name": "P&L",
      "headers": ["Year", "Revenue", "COGS", "Gross Margin %"],
      "rows": [
        {"Year": 2024, "Revenue": 5000000, "COGS": 2500000, "Gross Margin %": 50},
        {"Year": 2025, "Revenue": 7500000, "COGS": 3375000, "Gross Margin %": 55}
      ],
      "formulas": [
        {"cell": "D2", "formula": "=C2/B2"}
      ],
      "summary": {
        "totalRows": 12,
        "numericColumns": ["Revenue", "COGS", "Gross Margin %"],
        "columnTypes": {
          "Year": "date",
          "Revenue": "numeric",
          "COGS": "numeric",
          "Gross Margin %": "numeric"
        }
      }
    }
  ],
  "summary": {
    "numericMetrics": [
      {
        "sheet": "P&L",
        "column": "Revenue",
        "min": 3000000,
        "max": 12000000,
        "avg": 7500000
      }
    ]
  }
}
```

### PowerPoint Processing

**Extracts:**
- Slide titles and main topics
- Bullet points and text content
- Speaker notes
- Image references and descriptions
- Slide count and structure

**Identifies:**
- Main themes and messaging
- Key messages per slide
- Visual elements count

**Output Example:**
```json
{
  "metadata": {
    "totalSlides": 15
  },
  "slides": [
    {
      "slideNumber": 1,
      "title": "Executive Summary",
      "text": "Full slide text content...",
      "bullets": [
        "Disruptive technology in B2B fintech",
        "Market opportunity of $50B+",
        "Experienced team from Series A exits"
      ],
      "images": []
    }
  ],
  "summary": {
    "mainTopics": ["Executive Summary", "Market Opportunity", "Product", "Team", "Financials"],
    "keyMessages": ["Fastest growing fintech segment", "Strong founding team"],
    "visualElements": 12,
    "totalText": "Complete presentation text..."
  }
}
```

### Word Document Processing

**Extracts:**
- Hierarchical heading structure
- Paragraph text and formatting
- Tables and their content
- Document sections
- Metadata (title, author)

**Identifies:**
- Main sections by heading level
- Table data and structure
- Key terms and entities

**Output Example:**
```json
{
  "metadata": {
    "title": "Investment Thesis"
  },
  "sections": [
    {
      "heading": "Market Opportunity",
      "level": 1,
      "text": "The TAM is estimated at...",
      "paragraphs": ["Full paragraph text..."]
    },
    {
      "heading": "Product Solution",
      "level": 1,
      "text": "Our solution provides..."
    }
  ],
  "summary": {
    "totalParagraphs": 45,
    "headings": ["Market Opportunity", "Product Solution", "Team", "Financial Projections"],
    "tables": 2
  }
}
```

## Structured Data Extraction

For all document types, the system generates standardized structured data:

```json
{
  "structuredData": {
    "keyFinancialMetrics": {
      "Revenue_2025": {"min": 5M, "max": 12M, "avg": 8.5M},
      "CAGR": 45,
      "Burn_Rate": 500000
    },
    "keyMetrics": [
      {"key": "Market_Size", "value": "$250M", "source": "Page 3"},
      {"key": "Growth_Rate", "value": "45%", "source": "Slide 5"}
    ],
    "mainHeadings": ["Executive Summary", "Market Opportunity", ...],
    "textSummary": "High-level summary of document content...",
    "entities": [
      {"type": "monetary", "value": "$250M"},
      {"type": "percentage", "value": "45%"}
    ]
  }
}
```

## Integration with Deal Analysis

Extracted data automatically feeds into:

1. **Evidence System** - Creates evidence items with confidence scores
2. **Deal Scoring** - Provides data points for AI confidence analysis
3. **Due Diligence** - Populates document checklist items
4. **Deal Workspace** - Displays extracted metrics and summaries

## Error Handling

If document processing fails, the document status becomes `failed` and includes:
- Error message
- Retry endpoint: `POST /api/v1/deals/{dealId}/documents/{documentId}/retry`
- Processing time and file size info

## Performance

- **PDF extraction:** ~200-500ms per document
- **Excel parsing:** ~100-300ms per workbook
- **PowerPoint extraction:** ~150-400ms per presentation
- **Word processing:** ~100-250ms per document
- **File size limit:** Depends on memory allocation (typically 500MB)

## Future Enhancements

- [ ] Image OCR (Tesseract integration)
- [ ] Advanced table detection in PDFs
- [ ] AI entity extraction (companies, people, locations)
- [ ] Automatic financial model analysis
- [ ] Change detection (PDF diff tracking)
- [ ] Multi-language support
- [ ] Embedded video/link extraction
