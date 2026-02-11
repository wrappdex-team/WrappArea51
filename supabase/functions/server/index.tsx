import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import * as kv from "./kv_store.tsx";
const app = new Hono();

// Enable logger
app.use('*', logger(console.log));

// Enable CORS for all routes and methods
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// Health check endpoint
app.get("/make-server-54299934/health", (c) => {
  return c.json({ status: "ok" });
});

// ── Spin Winner Routes ───────────────────────────────────────────────

const WINNERS_KEY = "spin_winners_log";
const MAX_WINNERS = 10;

interface WinnerRecord {
  accountId: string;
  ticketId: string;
  timestamp: number;
}

// GET /winners — return the last 10 winners
app.get("/make-server-54299934/winners", async (c) => {
  try {
    const winners: WinnerRecord[] = (await kv.get(WINNERS_KEY)) ?? [];
    return c.json({ winners });
  } catch (err) {
    console.log("Error fetching winners:", err);
    return c.json({ error: `Failed to fetch winners: ${err}` }, 500);
  }
});

// POST /winners — record a new winner
app.post("/make-server-54299934/winners", async (c) => {
  try {
    const body = await c.req.json();
    const { accountId, ticketId, timestamp } = body as WinnerRecord;

    // Basic validation
    if (!accountId || !ticketId || !timestamp) {
      return c.json(
        { error: "Missing required fields: accountId, ticketId, timestamp" },
        400,
      );
    }

    if (typeof accountId !== "string" || typeof ticketId !== "string" || typeof timestamp !== "number") {
      return c.json(
        { error: "Invalid field types: accountId (string), ticketId (string), timestamp (number)" },
        400,
      );
    }

    // Fetch existing winners, prepend new one, trim to MAX_WINNERS
    const existing: WinnerRecord[] = (await kv.get(WINNERS_KEY)) ?? [];
    const updated = [{ accountId, ticketId, timestamp }, ...existing].slice(0, MAX_WINNERS);
    await kv.set(WINNERS_KEY, updated);

    console.log(`Winner recorded: ${accountId} / ${ticketId}`);
    return c.json({ success: true, winners: updated });
  } catch (err) {
    console.log("Error recording winner:", err);
    return c.json({ error: `Failed to record winner: ${err}` }, 500);
  }
});

// DELETE /winners — clear all winner records (admin reset)
app.delete("/make-server-54299934/winners", async (c) => {
  try {
    await kv.set(WINNERS_KEY, []);
    console.log("Winner history cleared");
    return c.json({ success: true, winners: [] });
  } catch (err) {
    console.log("Error clearing winners:", err);
    return c.json({ error: `Failed to clear winners: ${err}` }, 500);
  }
});

Deno.serve(app.fetch);