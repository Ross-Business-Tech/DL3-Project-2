# DL3 Investor CRM

A shared tool for the DL3 team to find, research, score and track investors for multifamily deals in Chicago.

## Where to see the app

**Live site (Render):** https://dl3-investor-crm.onrender.com/

The live site runs from the branch `claude/keen-wozniak-gy535k`. On the free plan it goes to sleep when nobody uses it, so the first visit can take up to a minute to load.

## What it does

- One shared investor list, saved in a database, that everyone on the team sees
- Import firms from a PDF, a website or a CSV
- AI research that fills in empty details with sources; a person always confirms the result
- Scoring with weights the team can change, plus custom criteria
- Outreach tracking with approvals

## How it is built

- `backend/`: a small Node server that shows the page and stores investors in a Postgres database. See [backend/README.md](backend/README.md) for setup and settings.
- `sites/investor-crm/`: the CRM page itself.
- `render.yaml`: tells Render how to create the web service and the database.

Passwords and API keys are never stored in this repository. They are set in Render, on the service's **Environment** tab.
