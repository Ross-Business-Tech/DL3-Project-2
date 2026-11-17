# DL3 investor CRM backend

A small Node server. It shows the CRM page at `/` and keeps the investor list in a Postgres
database through `/api/investors`. The page and the API share one address, so no extra
settings are needed.

## Put it on Render (clicks)

1. In Render, choose **New > Blueprint** and pick this GitHub repository and branch.
2. Render reads `render.yaml`, creates the web service and the database, and connects them.
3. When the first deploy is **Live**, open the service address. If the list is empty, press
   **Load research investors** once.

Never paste passwords or API keys into the code or the chat. Keys go in Render's
**Environment** tab for the service.

## Automatic research (AI)

On an investor that is **Pending review**, the **Run AI research** button (or **Add and research**)
asks the AI to search the web for the firm and report facts (strategy, check size, deals, contact) with the pages it used. People do the scoring.

What it does and does not do:
- It only fills empty fields and never overwrites what a person typed. Confirmed investors are never changed.
- It keeps a source only if the web search really returned that page. It does **not** score: people score each investor, and until they do the investor shows "Not scored yet". Everything it could not find is listed as **Still to check or fill in**.
- It proposes one point of contact (a name and role, with an email or LinkedIn link) only when a search result shows it. An email must be on the firm's own website domain, and the AI is told never to guess or construct one. A contact a person already entered is never replaced.
- A person always reviews the result and presses **Confirm record**.

Setup (in Render, service > **Environment**):
- `OPENAI_API_KEY`: the U-M GPT Toolkit key from your instructor (an OpenAI-compatible key). Without a key the buttons stay off.
  `OPENAI_BASE_URL` defaults to `https://api.toolkit.umgpt.umich.edu/v1` and `AI_MODEL` to `gpt-5.6-terra`.
  Alternatively set `ANTHROPIC_API_KEY` (a real Anthropic key) to use Claude. If both are set, `OPENAI_API_KEY` wins unless `AI_PROVIDER=anthropic`.
  With the Toolkit, automatic research needs the service to allow web search; PDF import needs it to accept PDF files. The page-reading import is done by this server, which fetches the page and gives the AI its text.
- `AI_CHECK_RANGE`: DL3's overall equity check range. The default is `$5M to $250M`; each project has its own target inside it.
- `AI_DAILY_LIMIT`: the most research runs in 24 hours (default 40). Each run costs money, and anyone with the
  page address can start one, so keep this low.
- `AI_MODEL`: optional. The default is `gpt-5.6-terra` (Toolkit) or the low-cost `claude-haiku-5-5` (Anthropic).

The search tool must also be allowed for the organization that owns the key (Claude Console settings).

## Import from a PDF or a website

The **Import** tab reads a PDF (up to 10 MB) or a web page and adds each firm it lists to the review queue.
- Only firms are added. Individual people are skipped and counted, except a named point of contact (with an email or LinkedIn link) the document states for a firm, which is saved as that firm's contact.
- Details come only from the document and are marked unchecked. Nothing is scored at this step, so imported firms
  rank low until they are researched.
- Firms already in the list are skipped. One import adds at most 50 firms; run it again for more.
- After an import, **Research these N now** runs the research step on each new firm, one at a time. Each run
  costs money and counts toward `AI_DAILY_LIMIT` (an import also counts as one run).
- A web page is read by Anthropic's web fetch tool, not by this server. Only plain `https://` addresses are accepted.
- `IMPORT_HOURLY_LIMIT` (default 6) caps import requests per person per hour.

## Export

**Download CSV** (Import tab, or the **Export CSV** button on Prospects) reads the whole list from the database and
saves it as a CSV file with scores, fit, confidence, sources, review status and notes. Text that starts with `=`,
`+`, `-` or `@` is neutralised so a spreadsheet cannot run it as a formula.

## Outreach tracker

The **Outreach** tab (designed and written by a teammate) logs every email, call, meeting and reply with
the DL3 project it was for, gauges each investor's interest per project, suggests follow-up dates, and shows how much
each project has soft-circled against its target. Logging outreach also updates the investor's last contact,
next follow-up and pipeline stage. The tab is called **Outreach**. At its top, **Waiting for approval** lists confirmed investors; someone types their
name in the box at the top of the page and presses **Approve for outreach** before DL3 can log outreach to an investor.
Replies from investors can always be logged.

The data is in two more tables, `outreach` and `projects`, served at `/api/outreach` and `/api/projects` with the same
checks as the investor list: unknown fields are refused, dates must look like `2026-11-10`, and interest, channel and
direction must come from fixed lists. On a here.now test link there is no shared data, so the tab shows made-up sample
projects and saves nothing.

## Team password

Set `TEAM_PASSWORD` in Render (service > **Environment**) and redeploy. Everyone then signs in with that one password
before they can see the page or any data; a **Sign out** button appears at the top. Sessions last 30 days, and
changing the password signs everyone out. After 10 wrong tries from one place, sign-in waits 15 minutes.
Without `TEAM_PASSWORD` the tool is open to anyone with the address, and the page says so at the top. Never put the
password in the code, in GitHub, or in a chat.

## Removing an investor

An investor's page has **Remove from the database**. It needs a ticked box confirming the investor asked to be removed
and a final yes, and it is limited to 10 removals an hour from one place. It permanently deletes the investor and every
outreach entry logged for them, and records the name typed at the top of the page in the server log. It cannot be undone,
and importing the same PDF or website again would add the firm back as a new investor. With no team password, anyone
with the tool's address could remove an investor, so turn the password on before sharing the address widely.

## Connecting to Agora

Agora's API is not publicly documented, and its Zapier connection only creates new contacts. What works today is a file:
**Download contacts for Agora** (Import tab) gives one row per contact (company, name, title, email, LinkedIn, firm
details). Use Agora's contacts import and match the columns. Investors who asked to be removed are left out.

## The four tabs

- **Investors:** the home page. Four numbers (to confirm, to fix, follow-ups due, ready to contact), search, views,
  the list (cards on a phone), and "Browse by group". Opening an investor shows its page: what to fix, contact, facts,
  and collapsible Sources, Introduction paths, Edit scores and details, and History.
- **Outreach:** who is waiting for approval, follow-ups to push, the log form, and interest by project.
- **Import:** PDF and website import, and the CSV download.
- **About:** how the tool and the score work, the requirements check, and what is still to confirm with DL3.

The person using the page types their name at the top. It is kept in their browser and recorded on approvals and
changes. There is no sign-in yet, so anyone with the address can use the tool.

## Websites and points of contact

Every investor should have a company website and a point of contact (an email, a LinkedIn link, or both):
- The **Add investor** form takes both. Mistakes show inside the form and keep what was typed.
- Anything missing shows as a flag, **No website yet** or **No contact yet**, each with a **Fix** button. An individual with no
  website can be marked so. "Contact to confirm" placeholders count as no contact.
- The list shows each investor's website and contact (or what is missing), and both come through in the CSV and contacts files.
- Imports and AI research fill them in when the document or a search result shows them.
- For the research list, **Fill in N websites** on the Investors page adds the websites found by web search (`KNOWN_SITES` in
  `sites/investor-crm/index.html`). They were checked against the firms' own pages or press releases but should be verified.

## Groups and flag fixes

Every group in the tool is clickable: a flag, a pipeline stage, an investor type or a confidence level (on the
Dashboard, in the Groups card, the stage chips and the tiles, and on the flag chips in any table). A group opens a page
with a plain-language summary (how many investors, average fit, confidence and flag mix) and the investors in it.
Each flag has a **Fix** button that opens a small form for exactly that problem, for example adding a contact, a
source date, a deal, an introduction path or a new follow-up date. Fixes are saved to the database, and the investor
leaves the group when its flag is gone. The same flags and Fix buttons appear on each investor's own page. A contact
needs a name and an email or a LinkedIn link (a `linkedin.com` address only); contacts show as links on the investor's page. The list of flags and their fixes lives in `sites/investor-crm/groups.js`.

## Run it on a computer with Postgres

```bash
cd backend
npm ci
DATABASE_URL=postgres://user@localhost:5432/dl3 node server.js
```

## Tests

```bash
TEST_DATABASE_URL=postgres://user@localhost:5432/dl3_test npm test
```

The tests skip the database checks when `TEST_DATABASE_URL` is not set.

## Notes

- Who can see and edit is not restricted yet: anyone with the address can use the page. Adding
  a sign-in step is a separate piece of work.
- There is no delete. Editing and the review step are the way to fix a record.
