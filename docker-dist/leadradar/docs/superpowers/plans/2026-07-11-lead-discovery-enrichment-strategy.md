# LeadRadar Discovery and Enrichment Strategy

Date: 2026-07-11
Status: Research report and implementation plan

## Executive decision

LeadRadar should not become "one big scraper." It should become a project-scoped lead intelligence engine:

1. A project profile creates search hypotheses from the business, ICP, geography, technology, buyer roles, and trigger events.
2. Source adapters collect candidate companies from many cheap/public sources.
3. A focused crawler enriches each company from its own website and trusted public pages.
4. A contact resolver finds responsible people using website evidence first, then low-cost external APIs only when needed.
5. Deterministic validation and dedupe happen before Hermes.
6. Hermes scores only filtered, evidence-rich leads and learns from feedback.
7. The system records source evidence, failures, costs, and feedback so it can heal and improve its own queries.

The best production-grade strategy is a layered "free-first, paid-fallback" pipeline. Free sources create volume; paid APIs are used only for contact confirmation and email discovery on high-fit accounts.

## Current project reality

The repo already has the right skeleton:

- Multi-project model in SQLite.
- Source adapter pattern in `src/sources`.
- Existing adapters: CSV, Product Hunt, Jina search, Google CSE.
- Aggregate validation, dedupe, MX email check, and quality gate.
- Hermes scoring and feedback/RAG loop.
- Dashboard endpoint for "Find leads."

The gap is not the scoring layer. The gap is acquisition and enrichment:

- `CanonicalLead` is too thin: company, website, email, votes, source.
- No separate person/contact model.
- No evidence/provenance model beyond `sources[]`.
- Website enrichment only checks homepage `mailto:`.
- No crawl queue, retry policy, source health, query expansion, or cost accounting.
- No systematic strategy for discovering leads across niches.

## Target architecture

### 1. Project intelligence profile

Every project should have a generated and editable `LeadStrategy` derived from project website, description, and ICP.

Fields:

- `niche`: e.g. "B2B SaaS analytics", "local restaurants needing WhatsApp automation".
- `target_segments`: industries, company sizes, countries, business models.
- `buyer_roles`: founder, owner, CEO, head of marketing, operations manager, CTO.
- `negative_segments`: companies to exclude.
- `signals`: hiring, funding, launching, using a technology, complaints, slow website, poor SEO, recent product launch.
- `source_mix`: enabled source families and budgets.
- `query_templates`: reusable search patterns per source.
- `enrichment_policy`: crawl depth, contact roles, paid fallback thresholds.

Hermes can generate the first draft strategy, but code should store and execute it deterministically.

### 2. Company-first data model

Split the current single `leads` concept into company, contact, evidence, and run state.

Recommended tables:

- `lead_runs`: project_id, status, started_at, finished_at, config_hash, cost counters.
- `companies`: project_id, name, domain, website, description, industry, country, size_hint, confidence, created_at.
- `company_sources`: company_id, source, source_url, query, raw_payload_json, discovered_at.
- `company_evidence`: company_id, evidence_type, url, title, text_excerpt, confidence, fetched_at.
- `contacts`: company_id, full_name, role_title, department, seniority, email, linkedin_url, source, confidence.
- `contact_evidence`: contact_id, source_url, evidence_type, text_excerpt, confidence.
- `enrichment_jobs`: entity_type, entity_id, stage, status, attempts, next_run_at, error.
- `source_stats`: source, project_id, fetched, kept, rejected, cost, errors, last_success_at.

The existing `leads` table can remain as the outward-facing approved prospect view, but production discovery needs these normalized internals.

### 3. Source adapter families

Use adapters grouped by intent instead of a few hard-coded sources.

#### A. Search index sources

Purpose: broad company discovery from query templates.

Free/cheap options:

- Existing Jina Search adapter.
- Self-hosted SearXNG as a metasearch layer. SearXNG is free, self-hostable, privacy-oriented, and aggregates many search services.
- Brave Search API or Tavily as paid/controlled fallback if Jina/SearXNG quality drops.
- Existing Google CSE only for legacy keys because the repo docs already note it is not ideal for new setup.

Query examples:

- `"{{industry}}" "powered by" "{{technology}}"`
- `"{{pain}}" "case study" "{{region}}"`
- `"{{niche}}" "pricing" "contact"`
- `"{{buyer_role}}" "{{industry}}" "{{city}}"`
- `site:{{directory_domain}} "{{niche}}"`

#### B. Launch and startup sources

Purpose: fresh companies with active builders.

Sources:

- Product Hunt official GraphQL API.
- Hacker News Algolia search for "Show HN", "Launch HN", and niche keywords.
- GitHub search for product repositories, org websites, and maintainers where the ICP is developer/SaaS/tooling.
- YC company directory and other accelerator directories through polite page crawls where allowed.
- Indie Hackers, BetaList, AlternativeTo, SaaSHub, Uneed, Futurepedia, app marketplaces when relevant.

Best use:

- Very good for SaaS, AI tools, developer tools, agencies, startups.
- Often weak for traditional local businesses.

#### C. Registry and public data sources

Purpose: verified company existence and officers.

Sources:

- SEC EDGAR APIs for public companies; no auth or API key needed, JSON APIs, nightly bulk files.
- OpenCorporates API for legal entity lookup and officers where available.
- Country/state registries, Companies House for UK, MCA/India where accessible.
- Government procurement portals and award databases for companies buying services.

Best use:

- B2B, government vendors, finance, public-company targeting.
- Not good as the first source for small lead volume unless the ICP is registry-friendly.

#### D. Technology and website signal sources

Purpose: find companies by stack and detect pain.

Sources:

- Wappalyzer/BuiltWith APIs as paid fallback.
- Self-hosted website scanner using HTTP headers, script tags, DNS, sitemap, robots, Lighthouse-ish checks.
- GitHub Pages and package registries for developer-heavy ICPs.
- Chrome Web Store, Shopify App Store, WordPress plugin/theme directories, Atlassian/Slack/HubSpot marketplaces.

Signals:

- Uses competitor technology.
- Has broken analytics/chat/CRM pixels.
- Slow site, no tracking, no schema, missing forms, weak SEO, accessibility gaps.
- Job posts for tools/skills related to the product.

#### E. Community and intent sources

Purpose: find active pain and buyer intent.

Sources:

- Reddit official API where permitted and commercially acceptable.
- Hacker News comments.
- Stack Exchange for technical pain.
- Public forums and Discourse communities.
- Review sites and complaint pages via search snippets, not aggressive scraping.
- Job boards: Greenhouse, Lever, Workable pages, RemoteOK, Wellfound where allowed.

Best use:

- Generate account triggers and personalization, not bulk contact scraping.

#### F. Existing list import

CSV remains important. Production systems should support:

- CSV upload.
- Paste/import from Google Sheets later.
- Domain-only import.
- Competitor/customer list import.
- "Seed companies" to generate lookalikes.

## Discovery strategy: how to get many leads for any project

Use a repeating loop:

1. Strategy builder
   - Hermes reads project website and ICP.
   - Creates buyer roles, segments, negative filters, and source plan.

2. Query expansion
   - Generate 30 to 100 queries from templates.
   - Mix broad, exact, site-specific, trigger, and competitor queries.
   - Store every query and its yield.

3. Multi-source discovery
   - Run cheap APIs and public sources first.
   - Keep raw source payload and URL evidence.
   - Normalize company name/domain.

4. Focused crawling
   - Crawl only each candidate company's own domain and a few trusted external evidence pages.
   - Respect robots, timeout, depth, and per-domain rate limits.
   - Prefer sitemap, home, about, team, contact, pricing, careers, blog, press, privacy, LinkedIn link, schema.org JSON-LD.

5. Cheap qualification
   - Reject directories/listicles, missing domains, parked domains, duplicates, irrelevant countries, dead sites.
   - Extract keywords, business category, stack, social links, email patterns, people names.

6. Contact resolution
   - Website first: team/about/contact/author pages, JSON-LD, footer emails.
   - Public company docs second: SEC officers, OpenCorporates officers, press pages.
   - Role-based fallback: founder@, hello@, sales@, partnerships@ only when person-specific is unavailable.
   - Paid API last: Hunter/Apollo/People Data Labs only for companies above a fit threshold.

7. Verification and scoring
   - Verify domain, MX, disposable/role/catch-all signals.
   - Hermes scores company fit and contact relevance after evidence exists.

8. Feedback learning
   - Approved/rejected leads update project RAG.
   - Source/query yields update weights.
   - Bad patterns become negative query terms and domain blocklists.

## Enrichment strategy

### Company enrichment

Minimum production fields:

- Canonical domain.
- Homepage final URL after redirects.
- One-line description.
- Category/industry.
- Country/region when detectable.
- Employee size hint from site text, LinkedIn link text, job pages, or third-party data.
- Technology stack signals.
- Social links.
- Recent activity: blog date, launch date, funding/news, hiring.
- Pain signals related to the project.

Implementation:

- Use Crawlee with PlaywrightCrawler for dynamic pages and Cheerio/HTTP crawler for static pages.
- Start with HTTP fetch; escalate to browser only when static extraction fails.
- Limit crawl depth to 1 or 2 and max pages per domain to 10 initially.
- Cache every fetched URL by content hash and TTL.
- Store extraction confidence and raw evidence snippets.

### Contact/person enrichment

Target role logic should depend on project:

- SaaS product for founders: Founder, CEO, Co-founder.
- Marketing product: CMO, Head of Marketing, Growth, Demand Gen.
- Developer tool: CTO, VP Engineering, Developer Relations, Founder.
- Operations product: COO, Operations Manager, Head of Ops.
- Local business: Owner, General Manager, Location Manager.

Extraction order:

1. Website team/about pages.
2. Blog authors and press contacts.
3. Contact page named emails.
4. Public filings/officers.
5. GitHub org owners/maintainers for developer companies.
6. Product Hunt makers.
7. External paid enrichment if the account score is high.

Email discovery:

- Prefer published email addresses.
- If no email, infer pattern only when we have a real person plus a verified domain.
- Generate a small set of patterns: first@, first.last@, firstlast@, f.last@.
- Validate MX and known disposable domains.
- Avoid aggressive SMTP callback verification by default because it can cause blocklisting and false positives.
- Mark inferred emails as `unverified` until verified by a provider or successful delivery later.

## Self-hosted/free tooling

Recommended additions:

- Crawlee: best fit for this Node/TypeScript repo. Free/open-source, supports browser crawls, queues, datasets, proxy integration.
- Playwright: browser fallback for JS-heavy pages.
- SearXNG: self-hosted metasearch to diversify search result sources.
- Scrapy: strong Python option for high-throughput static crawling, but it adds a second language/runtime.
- Browserless/self-hosted Chrome pool: useful later if browser crawling becomes heavy.
- Common Crawl: useful for offline discovery at scale, but not first because processing cost/complexity is high.

Preferred v1:

- Crawlee + existing Node stack.
- SearXNG adapter.
- Strong HTTP-first website crawler.
- Paid APIs behind strict thresholds.

## Paid fallback options

Use paid systems surgically, not as primary lead generation.

- Hunter: good domain search, email finder, verifier; current pricing page shows a free tier with 50 credits/month and paid plans. Good first paid fallback.
- People Data Labs: strong person/company enrichment, usually better for scale but needs careful cost controls.
- Apollo: strong B2B/person database, but more of a platform and may be less ideal as an automated backend unless API access and terms are clear.
- Wappalyzer/BuiltWith: useful for technology-triggered prospecting.
- Apify actors: useful for one-off source adapters or hosted scraping where building our own is slower, but not free at scale.

Policy:

- Never call paid enrichment before deterministic company fit score passes a threshold.
- Spend credits on contacts for accounts likely to be emailed, not on raw candidates.
- Cache paid results permanently with provider/source metadata.

## Legal and deliverability guardrails

Do not build the system around LinkedIn scraping. LinkedIn's User Agreement, effective 2025-11-03, explicitly prohibits using software, scripts, robots, crawlers, browser plugins or similar processes to scrape/copy profiles and other service data. Use LinkedIn only as a manually reviewable URL or through approved products/APIs.

Guardrails:

- Prefer official APIs, public open data, company-owned websites, and explicit contact pages.
- Respect robots.txt and per-domain rate limits.
- Identify the crawler with a real user agent and contact URL/email.
- Store evidence and source URLs for every contact.
- Track consent/legal basis fields if targeting GDPR/EEA markets.
- Do not harvest sensitive personal data.
- Unsubscribe, suppression lists, bounce tracking, and domain warmup belong before email automation is scaled.

## Cost control

Use a tiered budget per run:

1. Free search/API queries.
2. Static HTTP fetch.
3. Browser fetch only for failed/valuable pages.
4. Hermes only after deterministic filtering.
5. Paid enrichment only after Hermes/company pre-score or deterministic fit score.

Add run budget fields:

- max source queries.
- max candidates.
- max pages per domain.
- max browser pages.
- max Hermes calls.
- max paid credits.
- max cost in USD.

Add caches:

- URL fetch cache.
- Domain enrichment cache.
- Search query result cache.
- Paid provider result cache.
- Hermes score cache keyed by project strategy hash + company evidence hash.

## Self-healing and learning loop

Track these metrics per project/source/query:

- fetched count.
- normalized company count.
- quality gate pass rate.
- duplicate rate.
- enrichment success rate.
- contact found rate.
- Hermes average score.
- approval rate.
- email/reply outcome later.
- cost per approved lead.

Then automatically:

- Increase weight for sources and query templates producing approved leads.
- Reduce or pause sources producing duplicates/noise.
- Add negative terms from rejected clusters.
- Expand from approved leads: similar domains, same tech, same directories, same keywords, same communities.
- Detect broken adapters when error rate rises.
- Run small canary crawls before large crawls.

Hermes should help interpret why a source is failing, generate new query templates, and summarize patterns from approved/rejected leads. Deterministic code should still own scheduling, budgets, and writes.

## Implementation roadmap

### Phase 1: Data model and source evidence

- Add `lead_runs`, `company_sources`, `company_evidence`, `contacts`, and `enrichment_jobs`.
- Keep current `leads` output for compatibility.
- Add source result provenance to current adapters.
- Store raw payload snippets safely.

### Phase 2: Strategy builder

- Add `lead_strategy` JSON to projects or a separate table.
- Build Hermes-assisted strategy generation from ICP.
- Generate query templates per project.
- Let dashboard edit strategy and budgets.

### Phase 3: Source expansion

- Add SearXNG adapter.
- Add Hacker News adapter.
- Add GitHub adapter for developer-tool ICPs.
- Add OpenCorporates and SEC adapters for relevant projects.
- Keep Product Hunt, Jina, CSV.

### Phase 4: Website crawler enrichment

- Replace `website-enricher.ts` with a crawl service:
  - static fetch first.
  - sitemap/contact/about/team discovery.
  - email/social/person extraction.
  - structured data extraction.
  - page cache and job retry.
- Use Crawlee + Playwright fallback.

### Phase 5: Contact resolver

- Add role-targeted contact extraction.
- Add confidence scoring.
- Add email pattern inference with verification state.
- Add Hunter as optional paid fallback after account threshold.

### Phase 6: Source learning

- Add source/query stats.
- Add feedback-driven query reweighting.
- Add "find more like approved leads."
- Add source health dashboard.

### Phase 7: Outreach readiness

- Only after discovery/enrichment is stable:
  - suppression lists.
  - unsubscribe handling.
  - bounce/reply tracking.
  - sending provider abstraction.
  - deliverability checks.

## Recommended first build slice

Build a production-grade v1 around:

1. `LeadStrategy` table/JSON.
2. SearXNG + HN + GitHub adapters.
3. Crawlee website enrichment.
4. `contacts` table.
5. Hunter optional fallback with 50 free credits/month.
6. Cost budgets and source stats.

This gives volume, keeps cost low, avoids risky LinkedIn scraping, and creates the foundation for self-learning lead generation.

## Key sources used

- Crawlee official docs: https://crawlee.dev/
- Apify Actors docs: https://docs.apify.com/actors
- Scrapy official docs: https://docs.scrapy.org/en/latest/intro/overview.html
- Playwright official docs: https://playwright.dev/docs/intro
- SearXNG official docs: https://docs.searxng.org/
- Tavily API docs: https://docs.tavily.com/documentation/api-reference/endpoint/search
- Hunter pricing/API docs: https://hunter.io/pricing and https://hunter.io/api-documentation/v2
- SEC EDGAR APIs: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- OpenCorporates API docs: https://api.opencorporates.com/documentation/API-Reference
- Reddit API docs: https://developers.reddit.com/docs/api
- Product Hunt API docs: https://api.producthunt.com/v2/docs
- LinkedIn User Agreement: https://www.linkedin.com/legal/user-agreement
