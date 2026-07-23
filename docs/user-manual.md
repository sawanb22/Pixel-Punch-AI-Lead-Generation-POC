# LeadRadar User Manual

Welcome to **LeadRadar**! This manual describes how to use the LeadRadar dashboard to manage your sales projects, run lead generation campaigns, enrich company information, locate contact persons, and evaluate prospects with AI.

---

## 📋 Table of Contents
1. [User Interface Overview](#-user-interface-overview)
2. [Project Management](#-project-management)
3. [Campaigns & Lead Lists](#-campaigns--lead-lists)
4. [Creating & Customizing Your Lead Plan](#-creating--customizing-your-lead-plan)
5. [Generating Leads & Scraper Execution](#-generating-leads--scraper-execution)
6. [Company Enrichment & Finding Contacts](#-company-enrichment--finding-contacts)
7. [Reviewing & Scoring Leads](#-reviewing--scoring-leads)
8. [Exporting & Importing Data](#-exporting--importing-data)
9. [Keyboard Shortcuts](#-keyboard-shortcuts)

---

## 🖥 User Interface Overview

The LeadRadar dashboard is divided into four main areas:
1. **Top Bar:** Displays your active project and theme toggle (Light/Dark mode ☾/☀).
2. **Left Sidebar:** Lists your campaigns (Lead Lists) under the current project, along with settings and deletion tools.
3. **Workspace Main (Top):**
   * **KPI Strip:** Real-time metrics showing Total Leads, New This Week, Approval Rate, and Reply Rate.
   * **Control Panel:** Buttons to trigger lead generation, company enrichment, contact finding, scoring, exports, and imports.
4. **Middle section:**
   * **Lead Plan Card (Left):** Displays the active search query plan, enabled sources, and feedback panels.
   * **Operations Console (Right):** Tracks running background tasks, system logs, and samples of kept or rejected candidates.
5. **Leads Table (Bottom):** Filters, searches, and displays all generated leads with quick action buttons (Approve/Reject).

---

## 📁 Project Management

Projects isolate your sales target niches, rules, and campaigns.

### Selecting or Creating Projects
* **Select a Project:** Click the **Project** dropdown select-box in the sub-header bar to switch between your target project scopes.
* **Create a Project:**
  1. Click **New Project** next to the selector.
  2. In the modal, fill in:
     * **Project Name:** The name of your sales product or company (e.g. *Pixel Punch AIOS*).
     * **Website:** Your company's website (used by the AI to understand what you sell).
     * **ICP (Ideal Customer Profile):** Describe who you sell to (e.g. *B2B software platforms, funded startup tech companies, local dental offices*).
     * **Geography Focus:** (e.g., *Austin, Texas* or *United States*).
     * **Target Volume:** The number of leads you wish to find.
  3. Click **Save**.

### Project Settings & Sources
Click **Project Settings** in the control panel to modify your ICP, geography, or volume, and to toggle which lead sources the AI is allowed to scrap:
* **Google Maps:** Recommended for local business lists (clinics, stores, restaurants).
* **Wellfound Startups:** Recommended for tech startups and companies looking for new hires.
* **LinkedIn Jobs:** Recommended for detecting companies hiring for specific roles.
* **Google Search:** Standard fallback web search.

---

## 🗂 Campaigns & Lead Lists

Each project can contain multiple lists (campaigns) to keep different outreach batches separate.

```text
Active Project (e.g., Pixel Punch)
  ├── Lead List 1: "Local Dentists" (111 leads)
  ├── Lead List 2: "SaaS Startups" (0 leads)
  └── Lead List 3: "Agencies" (0 leads)
```

### Managing Your Lists
* **Switch Active List:** Click any card listed under the **Lead lists** sidebar on the left. The metrics and lead plan card will automatically load that list's specific data.
* **Add a List:** Click **+ New** at the top of the sidebar, name your list, and click save.
* **Settings:** Click **Settings** in the sidebar footer to rename your list or add custom descriptions.
* **Clear List:** Click **Clear** to remove all leads, feedback, and logs from the current list without deleting the list itself.
* **Delete List:** Click **Delete** to permanently remove the list and all its content.

---

## 📝 Creating & Customizing Your Lead Plan

The **Lead Plan** card shows the scraping instructions drafted by the AI for your active campaign list.

### 1. Generating a Plan
Upon creating a list, LeadRadar drafts a default plan. If you want to change it:
* Click **Refresh from website** to re-analyze your company website.
* Click **Regenerate plan** to recreate a plan from your project settings.

### 2. Tailoring the Plan via Feedback
If the generated plan is not specific enough, you can redirect the AI:
1. Go to the **Feedback for this list's plan** box at the bottom of the plan card.
2. Type your guidance (e.g., *Exclude marketing agencies, only focus on SaaS software companies with pricing pages*).
3. Click **Apply feedback**. The plan will automatically regenerate matching your directions.

---

## ⚡ Generating Leads & Scraper Execution

Once your Lead Plan is ready, you can start gathering leads:

1. Click the primary **Find leads** button in the Control Panel.
2. Check the **Operations Console** on the right to see progress.
3. The console will display a live timeline of running scrapers.
4. If you want to overwrite a previously completed scrape run and start completely fresh, check the **Force replan** checkbox next to the button before clicking **Find leads**.

---

## 🌐 Company Enrichment & Finding Contacts

After gathering candidate companies, you can gather deeper context and specific people to contact:

* **Enrich Companies:** Click **Enrich companies**. The system visits each company website homepage, pricing page, and contact page to discover descriptions, categories, social profile links, and public company emails.
* **Find Contacts:** Click **Find contacts**. The system scans target networks to locate specific executives, directors, or employees matching your project targets.

---

## 🤖 Reviewing & Scoring Leads

The lead table displays all candidates. You can organize, filter, and score them:

### 1. AI Scoring
1. Click **Run scoring**.
2. The AI evaluates each company in the **gated** status against your ICP.
3. Once completed, leads receive:
   * **Score (0-100):** A color-coded badge. High scores (green) show strong matches; low scores (red/orange) represent poor matches.
   * **Reasons:** Click on a lead to read the specific criteria explanation.

### 2. Manual Review
Use the action buttons in the lead table to approve or reject leads:
* **Approve (Thumbs Up / Green check):** Moves the lead to the **Approved** tab.
* **Reject (Thumbs Down / Red cross):** Moves the lead to the **Rejected** tab.
* *Note: Rejecting a lead extracts key rejection terms and feeds them back into your negative list to prevent similar companies from appearing in future runs.*

### 3. Filtering and Searching
Use the filter bar above the table to narrow down your review list:
* **Status:** Toggle between `All`, `gated`, `provisional`, `scored`, `approved`, and `rejected`.
* **Min score:** Input a minimum threshold (e.g. *80*) to show only top-tier matches.
* **Search:** Type a company name to locate it instantly.

---

## 📥 Exporting & Importing Data

* **Export Emails:** Downloads a cleaned CSV spreadsheet containing only approved leads that have active public contact email addresses.
* **Export All:** Downloads a full CSV containing every company detail, status, and score.
* **Import CSV:** If you have an external list of prospects, click **Import CSV**, upload your file, and map the columns. They will import as Raw leads in your active list.

---

## ⌨ Keyboard Shortcuts

Press **?** or click the help button next to settings to view quick navigation commands:
* `J` / `K` — Move selection down / up the lead table.
* `A` — Approve the selected lead.
* `R` — Reject the selected lead.
* `S` — Toggle detail view panel.
