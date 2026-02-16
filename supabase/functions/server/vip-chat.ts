// ═══════════════════════════════════════════════════════════════════════
// VIP CHAT — Token-gated chat for 100M+ HBAR.ħ holders
// ═══════════════════════════════════════════════════════════════════════
//
// Authenticated via session token. VIP eligibility verified server-side
// against Mirror Node. 2-min cooldown, 25-word limit, 50-msg FIFO cap.
// Admin ops (delete/ban) require SUPABASE_SERVICE_ROLE_KEY.
// ═══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import * as kv from "./kv_store.tsx";
import {
  getClientIp, isRateLimited, sanitizeString, isValidHederaAccountId,
  isAdminAuthorized, withKvLock, POOL_LOCK_RETRY_INTERVAL_MS,
} from "./shared.ts";
import type { KvLockConfig } from "./shared.ts";
import { validateSession } from "./auth.ts";
import { verifyVipEligibilityFull } from "./vip.ts";

// ── Constants ───────────────────────────────────────────────────────

const VIP_CHAT_MSGS_KEY = "vip_chat_messages";
const VIP_CHAT_CD_PREFIX = "vip_chat_cd_";
const VIP_CHAT_BANS_KEY = "vip_chat_bans";
const VIP_CHAT_COOLDOWN_MS = 2 * 60 * 1000;

// Lock for all VIP chat mutations (send, delete, ban, clear).
// Serializes read-mutate-write on VIP_CHAT_MSGS_KEY / VIP_CHAT_BANS_KEY
// to prevent concurrent messages overwriting each other.
const VIP_CHAT_LOCK_CONFIG: KvLockConfig = {
  key: "vip_chat_lock",
  ttlMs: 5_000,
  waitMs: 3_000,
  retryMs: POOL_LOCK_RETRY_INTERVAL_MS,
};
const VIP_CHAT_MAX_MSGS = 50;
const VIP_CHAT_MAX_WORDS = 25;
const VIP_CHAT_MAX_CHARS = 200;

// ── Types ───────────────────────────────────────────────────────────

interface VipChatMessage {
  id: string;
  accountId: string;
  text: string;
  timestamp: number;
}

// ── Helpers ─────────────────────────────────────────────────────────

function generateChatMsgId(): string {
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Route Registration ──────────────────────────────────────────────

export function registerVipChatRoutes(app: Hono): void {

  app.get("/make-server-54299934/vip-chat/messages", async (c) => {
    try {
      const msgs: VipChatMessage[] = (await kv.get(VIP_CHAT_MSGS_KEY)) ?? [];
      return c.json({ messages: msgs });
    } catch (err) {
      console.log(`[VIP-CHAT] Error fetching messages: ${err}`);
      return c.json({ messages: [], error: "Failed to fetch messages" }, 500);
    }
  });

  app.post("/make-server-54299934/vip-chat/messages", async (c) => {
    try {
      const session = await validateSession(c);
      if (!session) return c.json({ error: "Authentication required — sign in with HashPack" }, 401);
      const { accountId } = session;
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Too many requests" }, 429);

      // Pre-lock validation (no KV mutations — safe to do outside lock)
      const bans: string[] = (await kv.get(VIP_CHAT_BANS_KEY)) ?? [];
      if (bans.includes(accountId)) return c.json({ error: "Account suspended" }, 403);
      const cdKey = VIP_CHAT_CD_PREFIX + accountId;
      const lastSent: number | null = await kv.get(cdKey);
      if (lastSent && (Date.now() - lastSent) < VIP_CHAT_COOLDOWN_MS) {
        return c.json({ error: "Cooldown active", cooldownMs: VIP_CHAT_COOLDOWN_MS - (Date.now() - lastSent) }, 429);
      }
      const vipCheck = await verifyVipEligibilityFull(accountId);
      if (!vipCheck.eligible) return c.json({ error: "VIP access requires 100M+ HBAR.ħ tokens or a VIP NFT" }, 403);
      const body = await c.req.json();
      const text = sanitizeString(typeof body.text === "string" ? body.text : "", VIP_CHAT_MAX_CHARS);
      if (!text) return c.json({ error: "Message cannot be empty" }, 400);
      const wc = text.split(/\s+/).filter(Boolean).length;
      if (wc > VIP_CHAT_MAX_WORDS) return c.json({ error: `Exceeds ${VIP_CHAT_MAX_WORDS} word limit` }, 400);

      // Lock-protected read-mutate-write on the shared message array
      const msg: VipChatMessage = { id: generateChatMsgId(), accountId, text, timestamp: Date.now() };
      const result = await withKvLock(VIP_CHAT_LOCK_CONFIG, async () => {
        const msgs: VipChatMessage[] = (await kv.get(VIP_CHAT_MSGS_KEY)) ?? [];
        msgs.push(msg);
        while (msgs.length > VIP_CHAT_MAX_MSGS) msgs.shift();
        await kv.set(VIP_CHAT_MSGS_KEY, msgs);
        await kv.set(cdKey, Date.now());
        return msg;
      });
      console.log(`[VIP-CHAT] ${accountId}: "${text}" (${wc}w)`);
      return c.json({ message: result });
    } catch (err: any) {
      if (err?.code === "LOCK_TIMEOUT") return c.json({ error: "Chat is busy — please retry in a moment", code: "CHAT_BUSY" }, 503);
      console.log(`[VIP-CHAT] Send error: ${err}`);
      return c.json({ error: "Failed to send message" }, 500);
    }
  });

  app.delete("/make-server-54299934/vip-chat/messages/:id", async (c) => {
    if (!isAdminAuthorized(c)) return c.json({ error: "Admin access required" }, 403);
    try {
      const id = c.req.param("id");
      const result = await withKvLock(VIP_CHAT_LOCK_CONFIG, async () => {
        const msgs: VipChatMessage[] = (await kv.get(VIP_CHAT_MSGS_KEY)) ?? [];
        const filtered = msgs.filter(m => m.id !== id);
        if (filtered.length === msgs.length) return null; // not found
        await kv.set(VIP_CHAT_MSGS_KEY, filtered);
        return id;
      });
      if (!result) return c.json({ error: "Not found" }, 404);
      console.log(`[VIP-CHAT][ADMIN] Deleted ${result}`);
      return c.json({ ok: true });
    } catch (err: any) {
      if (err?.code === "LOCK_TIMEOUT") return c.json({ error: "Chat is busy — retry shortly" }, 503);
      return c.json({ error: "Delete failed" }, 500);
    }
  });

  app.post("/make-server-54299934/vip-chat/ban", async (c) => {
    if (!isAdminAuthorized(c)) return c.json({ error: "Admin access required" }, 403);
    try {
      const { accountId, action } = await c.req.json();
      if (!accountId || !isValidHederaAccountId(accountId)) return c.json({ error: "Invalid account" }, 400);

      // Lock-protected: ban mutates both BANS_KEY and MSGS_KEY
      const bans = await withKvLock(VIP_CHAT_LOCK_CONFIG, async () => {
        const bans: string[] = (await kv.get(VIP_CHAT_BANS_KEY)) ?? [];
        if (action === "ban" && !bans.includes(accountId)) {
          bans.push(accountId);
          const msgs: VipChatMessage[] = (await kv.get(VIP_CHAT_MSGS_KEY)) ?? [];
          await kv.set(VIP_CHAT_MSGS_KEY, msgs.filter(m => m.accountId !== accountId));
        } else if (action === "unban") {
          const idx = bans.indexOf(accountId);
          if (idx !== -1) bans.splice(idx, 1);
        }
        await kv.set(VIP_CHAT_BANS_KEY, bans);
        return bans;
      });
      console.log(`[VIP-CHAT][ADMIN] ${action} ${accountId}`);
      return c.json({ ok: true, bans });
    } catch (err: any) {
      if (err?.code === "LOCK_TIMEOUT") return c.json({ error: "Chat is busy — retry shortly" }, 503);
      return c.json({ error: "Ban operation failed" }, 500);
    }
  });

  app.delete("/make-server-54299934/vip-chat/messages", async (c) => {
    if (!isAdminAuthorized(c)) return c.json({ error: "Admin access required" }, 403);
    try {
      await kv.set(VIP_CHAT_MSGS_KEY, []);
      console.log("[VIP-CHAT][ADMIN] Cleared all messages");
      return c.json({ ok: true });
    } catch { return c.json({ error: "Clear failed" }, 500); }
  });
}
