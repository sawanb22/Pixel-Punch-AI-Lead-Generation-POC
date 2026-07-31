<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# what can you do Let's say, uh, I have. To build a lead generation system— A. With the help of, like, let's say, my tech stack—is that I am building a dashboard whereas behind the scene a separate backend. Let's say it is built on. Type. Of something, I don't know the tech stack now, but for the agent I am using Hermes Agent inside the system. So the my— Current. Process is— Like this: let me share with you. --"LeadRadar Complete Pipeline Flow

This document outlines the step-by-step journey of a single project, from your initial input to a fully scored list of leads with contact information.

1. Project Input \& Initialization (The Starting Point)
User Action: You input the Project Name, ICP (Ideal Customer Profile), Description, and Target Geography into the UI.
System Action: The system saves this to the database (projects table). This data becomes the core context for all AI decisions down the line.
2. Strategic Planning (The "Hermes Brain")
Trigger: The system begins processing the project.
System Action: The system calls planner.ts (Hermes).
Process:
Hermes reads your ICP and geography.
It searches the Apify MCP to find the best scraper for your specific niche (e.g., it might pick a Google Maps scraper for local businesses, or a LinkedIn scraper for B2B SaaS).
Hermes generates a StrategicPayload. This is a strict plan that defines exactly which Apify actorId to run and what the search queries should be (e.g., "Plumbers in Austin, TX").
3. Lead Discovery (Execution)
Trigger: The system takes the StrategicPayload plan and executes it.
System Action: The apify.ts service triggers the selected Apify actors.
Process:
The system waits for the Apify scraping run to finish.
It downloads the raw dataset.
It standardizes the raw data (which looks different depending on the scraper used) into a clean format.
These standardized records are saved into the leads table.
At this point, we only have basic info: Domain, Company Name, and maybe a Phone Number/Address.
4. Company Enrichment (Building the Knowledge Base)
This stage is about filling in the blanks (company description, social links, generic emails).
Tier 1 (Direct Jina Crawl):
Action: The system attempts to directly read the lead's website using jina.ai.
Process: It extracts the page title, meta description, visible emails, and social media links (LinkedIn, Twitter).
Result: Data is saved to company_profiles.
Tier 2 (Apify Contact Info Scraper Fallback):
Trigger: If Tier 1 fails, yields low confidence (< 0.6), or misses crucial info like the LinkedIn URL.
Action: The system batches these "weak" leads and sends them to the heavy-duty apify/contact-info-scraper.
Process: This scraper deeply navigates the site, bypassing simple blocks to find contact pages and socials.
Result: The newly discovered data is merged into company_profiles, boosting the lead's "Enrichment Confidence" score.
5. Contact Discovery (Finding the Decision Makers)
Now that we understand the company, we need to find the people who work there.
Tier 1 (Broad Search):
Action: The system searches Google (via Apify Google Search) for broad queries like "CEO" OR "Founder" site:<company_domain>.
Tier 2 (Targeted Social/Location Search):
Trigger: If Tier 1 finds no relevant people.
Action: The system uses the LinkedIn company URL or location hints (discovered during enrichment) to run a highly targeted search: e.g., "Company Name" "Austin" "Founder" site:linkedin.com/in.
Result: Parses search snippets to extract names, roles, and LinkedIn profiles. Saves to contacts.
Tier 3 (Email Fallback):
Trigger: If absolutely no specific people can be found.
Action: The system looks at the emailCandidates array (generic emails like [info@company.com](mailto:info@company.com) found during Enrichment).
Result: It creates generic "Contact" entries so you at least have an outreach vector, though they are scored lower.
6. Scoring and Ranking (The "Selection")
Trigger: After all enrichment and contact discovery is complete for a lead.
System Action: The scorer.ts (Hermes Scorer) evaluates the entire package.
Process:
Company Evaluation: Does it have a good description? Does the industry match your original ICP?
Contact Evaluation: Do we have a decision-maker (e.g., CEO vs. Intern)? Do we have a direct email or just a generic one? Is there a LinkedIn profile?
Calculates a final score (0-100).
Updates the leads table with this final score so the best leads bubble to the top of your UI."-- So now, can you. Evaluate this, uh, the. Method and. Let's. See if—how can we improve it, or is it perfect? Like, is it the most output-friendly thing I just. Built, or something is problem in that? We

Your **LeadRadar pipeline is well-structured overall**, but there are several meaningful improvements across reliability, efficiency, and output quality. Here's a clear audit:

***

## What's Working Well

- **Tiered fallback logic** (Jina → Apify, Broad search → Targeted → Generic email) is a solid defensive pattern — it avoids single-point-of-failure scraping.
- **Hermes as planner + scorer** is architecturally clean — separating *strategy* from *execution* from *evaluation* is correct.
- **Standardizing raw Apify data** before saving is critical and you're doing it right.

***

## Key Weaknesses \& Fixes

### 1. No Deduplication Layer

The pipeline has no mention of deduplication. Running the same ICP twice, or multiple Apify actors returning overlapping domains, will pollute your `leads` table. **Fix:** Add a `domain` uniqueness constraint + a merge step before saving to `leads`.

### 2. Enrichment Confidence Score is Undefined

You mention a `< 0.6` threshold for Tier 2 fallback, but the scoring logic for enrichment confidence isn't specified. **Fix:** Explicitly define what inputs drive this score (e.g., does it have a description? LinkedIn URL? Email?) so it's reproducible and debuggable.

### 3. Contact Discovery Relies Too Heavily on Google Snippets

Parsing names/roles from Google search snippets is fragile — snippets change format constantly. **Fix:** Where LinkedIn URLs are available, use a targeted scraper (e.g., Apify LinkedIn profile scraper) to extract structured data instead of relying on snippet parsing.

### 4. Scoring Happens After Full Completion Only

If enrichment fails midway, the lead is never scored. **Fix:** Add a **partial scoring fallback** — score what you have, flag it as `enrichment_incomplete`, and let it still surface in the UI at a lower confidence tier.

### 5. No Rate Limiting / Retry Strategy Mentioned

Apify actor calls and Jina crawls can fail under load. There's no mention of exponential backoff or retry logic. **Fix:** Wrap all external calls in a retry wrapper (3 attempts, exponential backoff) and log failures to a `pipeline_errors` table.

### 6. Sequential Enrichment is a Bottleneck

Currently, Tier 1 runs → waits → Tier 2 runs. For large lead lists, this is slow. **Fix:** Batch all Tier 1 calls in parallel using `Promise.allSettled()`, then batch Tier 2 only for failures.

### 7. Scorer Lacks Weighting Transparency

"0-100 score" with no visible weight breakdown makes the score a black box to users. **Fix:** Expose sub-scores in the UI (`Company Fit: 40/50 | Contact Quality: 30/50`) so users can act on the breakdown, not just sort by total.

***

## Minor Improvements

| Area | Current | Better |
| :-- | :-- | :-- |
| Generic contact ranking | Scored lower | Flag as `type: generic_email` separately in UI |
| `emailCandidates` | Used as last resort | Also run pattern-based email guessing (`first.last@domain.com`) using discovered names |
| Pipeline status | Not mentioned | Add real-time status per lead in the UI (enriching / scoring / done) |
| Actor selection by Hermes | Picks one actor | Consider multi-actor fan-out for high-value ICPs |


***

## Bottom Line

The architecture is **production-viable** but not yet **production-hardened**. The biggest risks are data duplication, silent enrichment failures, and slow sequential processing at scale. The tiered fallback logic is genuinely good — most teams don't build that robustly. Fix the retry strategy, parallelization, and scoring transparency and this pipeline will be very strong.

