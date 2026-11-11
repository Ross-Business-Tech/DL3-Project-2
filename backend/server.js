// Starts the DL3 investor CRM server. Render supplies PORT and DATABASE_URL.
import pg from "pg";
import { createApp, migrate } from "./app.js";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add the database connection in Render (see render.yaml).");
  process.exit(1);
}
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
  max: 5
});
pool.on("error", e => console.error("database connection error:", e.message));

await migrate(pool);
const port = Number(process.env.PORT) || 3000;
createApp(pool).listen(port, "0.0.0.0", () => console.log(`DL3 investor CRM listening on port ${port}`));
