# Client DNA System — Developer Integration Guide

**Owner:** Moises (Layer 2 — DNA)
**Last Updated:** March 18, 2026
**Live at:** qc.contentcartel.net/dna

---

## What Is This

The Client DNA is a structured knowledge base for each client that captures their voice, content strategy, visual identity, and production rules. It's **Layer 2 of the Content Intelligence Engine** — every other layer reads from it.

Every DNA profile has **10 sections:**

| # | Section | What It Contains | Who Uses It |
|---|---------|-----------------|-------------|
| 1 | Business Overview | Company, founder, ICP, differentiator | Strategists, PMs |
| 2 | Voice Fingerprint ⭐ | Formality, energy, phrases, do/don't examples | Editors, OCI, copywriters |
| 3 | Content Frameworks | Pillars, structures, hook formulas | Strategists, Layer 1 |
| 4 | Platform Rules | What works per platform, cadence, format | Layer 4 (Distribution) |
| 5 | Proof Point Library | Metrics, credentials, quotes — tagged by topic | Copywriters, production |
| 6 | Visual Identity Specs | Colors, fonts, style, template direction | Editors, Harvey |
| 7 | CTA Map | Active CTAs per platform, funnel links | Layer 4, Growth Ops |
| 8 | Off-Limits | Topics/language to avoid, compliance | Everyone |
| 9 | CC Production Notes | Editing style, AI instructions, content queue | Editors, OCI, n8n |
| 10 | Data Gaps | What's missing, where to get it | PMs |

---

## API Reference

Base URL: `https://qc.contentcartel.net` (or `http://localhost:3000` locally)

### Get Full DNA

```
GET /api/dna/{clientId}
```

Returns the latest DNA markdown + health score + section summary.

**Response:**
```json
{
  "client_id": 13,
  "version": 3,
  "format": "markdown",
  "dna_markdown": "# CLIENT DNA PROFILE: Amazing Discoveries...",
  "health_score": 87,
  "sections_summary": [
    { "number": 1, "title": "Business Overview", "slug": "business-overview", "confidence": "high", "gap_count": 0 },
    { "number": 2, "title": "Voice Fingerprint", "slug": "voice-fingerprint", "confidence": "high", "gap_count": 0 }
  ],
  "sources": { ... },
  "generated_at": "2026-03-18T...",
  "website_url": "https://amazingdiscoveries.org/",
  "youtube_url": "https://youtube.com/@AmazingDiscoveriesOfficial"
}
```

### Get OCI/Editing Brief (For n8n)

```
GET /api/dna/{clientId}?format=oci_brief
```

Returns Voice Fingerprint + Off-Limits + CTA Map + Production Notes formatted for AI editing instructions.

**This is the endpoint n8n should call when generating editing instructions for OCI.**

**Response:**
```json
{
  "client_id": 13,
  "version": 3,
  "format": "oci_brief",
  "content": "# AI EDITING INSTRUCTIONS\nSource: Client DNA Profile (Layer 2)\n\n## 2. VOICE FINGERPRINT\n...",
  "generated_at": "2026-03-18T..."
}
```

### Get Editor Brief

```
GET /api/dna/{clientId}?format=editor_brief
```

Condensed version with Voice Fingerprint + Off-Limits + Production Notes for human editors.

### Get Specific Sections

```
GET /api/dna/{clientId}?sections=voice_fingerprint,off_limits
```

Returns only the requested sections as structured data.

### Get Structured JSON

```
GET /api/dna/{clientId}?format=json
```

Returns the structured JSON representation (if available) for programmatic use.

### Get Specific Version

```
GET /api/dna/{clientId}?version=2
```

Returns a specific version instead of latest.

---

## How Each Layer Connects

### Layer 1 (Signal Detection) — Vedant

**Reads from DNA:**
- Section 3 (Content Frameworks → Content Pillars) to score topic relevance
- Section 4 (Platform Rules) to know which formats work on which platforms
- Section 9 (Production Notes → Starter Content Queue) for initial topic seeds

**How to use:**
```
# Get content pillars for topic scoring
GET /api/dna/{clientId}?sections=content_frameworks,platform_rules
```

Parse the pillars from the response and use them to weight your topic scoring model. A topic about "biblical prophecy" scores 10/10 for Amazing Discoveries but 0/10 for Monetary Metals.

---

### Layer 3 (Factory / Production) — Moises + Vedant

**Reads from DNA:**
- Section 2 (Voice Fingerprint) for AI editing instructions
- Section 7 (CTA Map) for which CTAs to embed in content
- Section 8 (Off-Limits) for content guardrails
- Section 9 (Production Notes) for editing style + AI instructions

**n8n Integration (the key connection):**

In your n8n workflow that generates editing instructions for OCI, add an HTTP Request node:

```
Method: GET
URL: https://qc.contentcartel.net/api/dna/{{ $json.client_id }}?format=oci_brief
```

The response `content` field contains the editing instructions. Inject this into your OCI prompt as context.

**Example OCI prompt with DNA:**
```
You are editing a video for [client name].

=== CLIENT VOICE PROFILE (from DNA) ===
{{ $json.dna_content }}

=== EDITING INSTRUCTIONS ===
Apply the voice profile above to all text overlays, captions, and script edits.
Follow the off-limits rules. Use the correct CTAs.
```

---

### Layer 4 (Distribution) — Vedant

**Reads from DNA:**
- Section 4 (Platform Rules) for posting cadence and format preferences
- Section 7 (CTA Map) for which CTAs to use per platform
- Section 9 (Production Notes → Content Intelligence Notes) for atomization opportunities

**How to use:**
```
# Get distribution rules for a client
GET /api/dna/{clientId}?sections=platform_rules,cta_map
```

Use Platform Rules to set posting schedule in Metricool. Use CTA Map to know which links to embed per platform.

For the Headline Swap Protocol: check Platform Rules for the client's baseline engagement rate to set the swap threshold.

---

### Layer 5 (Feedback / Immune System) — Steven

**Writes BACK to DNA:**
This is the feedback loop. When performance data shows patterns, Layer 5 updates the DNA.

**How it works:**
After 30 days of data, if LinkedIn formal posts outperform casual for a client:

1. Call the regenerate-section endpoint with the performance data as context:

```
POST /api/dna/regenerate-section
{
  "dna_id": "uuid-of-latest-dna",
  "section_number": 4,
  "additional_context": "Performance data (last 30 days): LinkedIn formal posts avg 2,400 views vs casual posts avg 800 views. Formal tone 3x better engagement."
}
```

2. Claude regenerates ONLY Section 4 (Platform Rules) with the new data.
3. A new version is created. Old version is preserved.

**Future automation:** n8n cron job (monthly) that:
1. Pulls last 30 days of Metricool data per client
2. Compares against DNA's current Platform Rules
3. If significant changes detected, calls regenerate-section
4. The DNA evolves automatically

---

## Manual Editing

PMs can edit any section directly in the DNA viewer (qc.contentcartel.net/dna/{clientId}):

1. Click **Edit Section** on any section card
2. Edit the markdown directly in the editor
3. Click **Save Edit** — creates a new version (old version preserved)

Or via API:

```
POST /api/dna/edit
{
  "dna_id": "uuid-of-current-dna",
  "section_number": 2,
  "new_markdown": "## 2. VOICE FINGERPRINT\n\n### Quantitative Voice Metrics\n- **Formality:** 7/10...",
  "edited_by": "moises"
}
```

Every edit creates a new version. You can always go back to any previous version via the version selector in the viewer.

---

## Data Gap System

The DNA uses 3 types of gap markers:

| Marker | Meaning | Color | Action |
|--------|---------|-------|--------|
| `[NEEDS DATA — source: X]` | Data is completely missing | Red | Go get it from the specified source |
| `[NEEDS CONFIRMATION — ask client]` | Inferred but risky | Amber | Verify with client on next call |
| `[INFERRED — verify: reason]` | Educated guess | Blue | Review and confirm or correct |

**Health Score:** Each section gets a confidence rating (High/Partial/Needs Data) based on gap count. Overall DNA health is a weighted average.

---

## How DNA Evolves Over Time

```
Week 1:  DNA generated from website + YouTube + onboarding transcript
         → Good baseline, some gaps marked

Week 2:  PM fills gaps from client calls, edits sections manually
         → Gaps shrink, confidence goes up

Week 4:  Layer 5 has 3 weeks of performance data
         → Platform Rules auto-update based on what's working
         → Content Frameworks pillars re-ranked by engagement

Week 8:  Voice Fingerprint refined by QC feedback patterns
         → "Wrong tone" QC notes trigger Voice Fingerprint regen
         → DNA is now highly accurate

Week 12: DNA is self-maintaining
         → Monthly performance data auto-updates Platform Rules
         → New content pillars emerge from Layer 1 signals
         → The engine produces better content every cycle
```

---

## Quick Reference

| Action | Endpoint | Method |
|--------|----------|--------|
| Get latest DNA | `/api/dna/{clientId}` | GET |
| Get OCI brief for n8n | `/api/dna/{clientId}?format=oci_brief` | GET |
| Get editor brief | `/api/dna/{clientId}?format=editor_brief` | GET |
| Get specific sections | `/api/dna/{clientId}?sections=voice_fingerprint,off_limits` | GET |
| Get specific version | `/api/dna/{clientId}?version=2` | GET |
| Regenerate section with AI | `/api/dna/regenerate-section` | POST |
| Edit section manually | `/api/dna/edit` | POST |
| Generate new DNA | `/api/dna/generate` | POST (SSE stream) |

---

**Questions?** Ask Moises. This is Layer 2 — the DNA that makes every other layer smarter.
