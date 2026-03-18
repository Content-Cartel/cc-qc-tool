export function buildDNAPrompt(clientName: string, scrapedData: string): string {
  return `You are a brand strategist and content intelligence analyst for a content production agency called Content Cartel. Your job is to create a comprehensive "Client DNA Profile" for a client based on all available data about them.

## CLIENT: ${clientName}

## AVAILABLE DATA:
${scrapedData}

---

## YOUR TASK:
Generate a complete Client DNA Profile in **markdown format**. This document will be used by video editors, production managers, and QC reviewers to ensure all content matches the client's brand.

The DNA profile MUST include these sections:

### 1. Brand Identity
- **Voice:** How does this brand speak? (e.g., authoritative, conversational, educational)
- **Tone:** What emotion/energy do they convey? (e.g., confident, warm, urgent)
- **Personality:** If this brand were a person, how would you describe them?

### 2. Content Pillars
List 3-5 core topics/themes this client's content revolves around. For each pillar, give a one-line description.

### 3. Target Audience
- **Demographics:** Age range, gender, profession, income level
- **Psychographics:** Values, interests, lifestyle
- **Pain Points:** What problems does this audience face that the client solves?

### 4. Key Messaging
- **Tagline/Mission:** The client's core message in one sentence
- **Value Propositions:** 3-5 key benefits they communicate
- **Differentiators:** What makes them unique vs competitors?

### 5. Visual & Production Notes
- **Colors:** Brand colors if identifiable
- **Style:** Production style (cinematic, talking head, animated, etc.)
- **Energy Level:** Fast-paced, calm, intense, conversational

### 6. Content Guidelines
- **DO:** 5-8 things editors should always do for this client
- **DON'T:** 5-8 things editors should avoid
- **Terminology:** Key terms, phrases, or jargon specific to this client

### 7. Platform-Specific Notes
- **Long-Form (YouTube):** Specific guidelines for long-form video content
- **Short-Form (Reels/Shorts/TikTok):** Specific guidelines for short-form clips

### 8. Reference Points
- **Similar Creators/Brands:** 2-3 comparable creators or brands for reference
- **Content Examples:** Describe 2-3 types of videos that would be ideal for this client

## FORMAT RULES:
- Write in clear, actionable language that editors can quickly reference
- Use bullet points liberally
- Be specific — avoid vague statements like "maintain brand consistency"
- If data is missing for a section, write "[NEEDS DATA - requires client input]" instead of guessing
- The entire document should be scannable in under 3 minutes`
}
