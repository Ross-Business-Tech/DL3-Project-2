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
asks Claude to search the web for the firm and propose the six scores, with the pages it used.

What it does and does not do:
- It only fills empty fields and never overwrites what a person typed. Confirmed investors are never changed.
- It keeps a source only if the web search really returned that page. A score of 3 or more needs a source, and
  "evidence of deals" is 0 without a sourced deal. Everything it could not find is listed as **Still to check or fill in**.
- It researches firms only. Decision-makers are not collected.
- A person always reviews the result and presses **Confirm record**.

Setup (in Render, service > **Environment**):
- `ANTHROPIC_API_KEY`: the key from your instructor. Without it the button stays off.
- `AI_CHECK_RANGE`: DL3's target equity check, for example `$2M to $10M`. Without it, check-size scores stay low.
- `AI_DAILY_LIMIT`: the most research runs in 24 hours (default 40). Each run costs money, and anyone with the
  page address can start one, so keep this low.
- `AI_MODEL`: optional. The default is the small, low-cost `claude-haiku-5-5`. A more capable (and more expensive) model can be set here.

The search tool must also be allowed for the organization that owns the key (Claude Console settings).

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
