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
