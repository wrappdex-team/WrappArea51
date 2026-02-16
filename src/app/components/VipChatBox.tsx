/**
 * VipChatBox — Emerald glass-morphism VIP-only chat
 *
 * Gate: 100M+ HBAR.ħ tokens (server-verified via Mirror Node on every send)
 * Rules: 25 words max, 2-min cooldown, wallet-connected + Mirror Node verified
 * Design: Minimalist, no text bloat — just UX with bleeps and ticks
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Crown, Send, Check, AlertCircle, Loader2, MessageSquare, ChevronUp, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { playTokenHover, playVipConfirm } from "../utils/sounds";
import { log } from "../utils/logger";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-54299934`;
const MAX_WORDS = 25;
const COOLDOWN_MS = 2 * 60 * 1000;
const POLL_MS = 10_000;

interface ChatMsg {
  id: string;
  accountId: string;
  text: string;
  timestamp: number;
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function shortId(id: string): string {
  // 0.0.12345 → ··12345
  const parts = id.split(".");
  return `··${parts[parts.length - 1]}`;
}

export function VipChatBox({
  isDark,
  accountId,
}: {
  isDark: boolean;
  accountId: string;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [cooldownEnd, setCooldownEnd] = useState(0);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMsgCountRef = useRef(0);

  const wordCount = useMemo(() => input.trim().split(/\s+/).filter(Boolean).length, [input]);
  const overLimit = wordCount > MAX_WORDS;

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`${API}/vip-chat/messages`, {
        headers: { Authorization: `Bearer ${publicAnonKey}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.messages)) {
        setMessages(data.messages);
        // Play tick if new messages arrived (not initial load)
        if (lastMsgCountRef.current > 0 && data.messages.length > lastMsgCountRef.current) {
          playTokenHover();
        }
        lastMsgCountRef.current = data.messages.length;
      }
    } catch { /* silent */ }
  }, []);

  // Poll
  useEffect(() => {
    fetchMessages();
    const iv = setInterval(fetchMessages, POLL_MS);
    return () => clearInterval(iv);
  }, [fetchMessages]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Cooldown timer
  useEffect(() => {
    if (cooldownEnd <= 0) return;
    const iv = setInterval(() => {
      const left = cooldownEnd - Date.now();
      if (left <= 0) {
        setCooldownLeft(0);
        setCooldownEnd(0);
      } else {
        setCooldownLeft(left);
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [cooldownEnd]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || overLimit || sending || cooldownLeft > 0) return;

    if (!accountId) {
      setError("Connect your wallet first");
      setTimeout(() => setError(""), 3000);
      return;
    }

    setSending(true);
    setError("");

    try {
      const res = await fetch(`${API}/vip-chat/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${publicAnonKey}`,
        },
        body: JSON.stringify({ accountId, text }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.cooldownMs) {
          setCooldownEnd(Date.now() + data.cooldownMs);
          setCooldownLeft(data.cooldownMs);
        }
        setError(data.error || "Failed");
        setTimeout(() => setError(""), 4000);
      } else {
        setInput("");
        setSent(true);
        setCooldownEnd(Date.now() + COOLDOWN_MS);
        setCooldownLeft(COOLDOWN_MS);
        playVipConfirm();
        setTimeout(() => setSent(false), 2000);
        fetchMessages();
      }
    } catch (err) {
      setError("Network error");
      setTimeout(() => setError(""), 3000);
      log.error("VipChat", "Send error", err);
    } finally {
      setSending(false);
    }
  }, [input, overLimit, sending, cooldownLeft, accountId, fetchMessages]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const cooldownSec = Math.ceil(cooldownLeft / 1000);
  const cooldownMin = Math.floor(cooldownSec / 60);
  const cooldownRemSec = cooldownSec % 60;

  return (
    <div className="relative">
      {/* Emerald glow border */}
      {isDark && (
        <motion.div
          className="absolute -inset-[1px] rounded-xl pointer-events-none opacity-40"
          style={{
            background: "linear-gradient(135deg, rgba(16,185,129,0.3), rgba(6,182,212,0.12), rgba(16,185,129,0.3))",
            backgroundSize: "200% 200%",
          }}
          animate={{ backgroundPosition: ["0% 0%", "100% 100%", "0% 0%"] }}
          transition={{ duration: 5, repeat: 9999, ease: "linear" }}
        />
      )}

      <div
        className={`relative rounded-xl overflow-hidden ${
          isDark
            ? "bg-slate-900/60 border border-emerald-500/15 backdrop-blur-sm"
            : "bg-white/90 border border-emerald-200 shadow-sm"
        }`}
      >
        {/* Header */}
        <button
          onClick={() => setExpanded(!expanded)}
          className={`w-full flex items-center justify-between px-3 py-2 transition-colors ${
            isDark ? "hover:bg-emerald-500/[0.04]" : "hover:bg-emerald-50"
          }`}
        >
          <div className="flex items-center gap-2">
            <motion.div
              animate={{ borderColor: ["rgba(16,185,129,0.2)", "rgba(16,185,129,0.5)", "rgba(16,185,129,0.2)"] }}
              transition={{ duration: 2.5, repeat: 9999 }}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20"
            >
              <Crown className="w-3 h-3 text-emerald-400" />
              <MessageSquare className="w-3 h-3 text-emerald-400/60" />
            </motion.div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400/70">
              VIP
            </span>
            {messages.length > 0 && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400/50 font-mono">
                {messages.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Live indicator */}
            <motion.span
              className="w-1 h-1 rounded-full bg-emerald-400"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 2, repeat: 9999 }}
            />
            {expanded ? (
              <ChevronUp className="w-3 h-3 text-emerald-400/40" />
            ) : (
              <ChevronDown className="w-3 h-3 text-emerald-400/40" />
            )}
          </div>
        </button>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              {/* Messages */}
              <div
                ref={scrollRef}
                className={`px-3 space-y-1 overflow-y-auto`}
                style={{ maxHeight: 180, minHeight: 60 }}
              >
                {messages.length === 0 ? (
                  <div className={`text-center py-4 text-[10px] ${isDark ? "text-emerald-500/30" : "text-emerald-400/40"}`}>
                    No messages yet
                  </div>
                ) : (
                  messages.map((msg, i) => {
                    const isOwn = msg.accountId === accountId;
                    return (
                      <motion.div
                        key={msg.id}
                        initial={i >= messages.length - 3 ? { opacity: 0, y: 6 } : false}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2 }}
                        className={`flex gap-1.5 py-1 ${isOwn ? "flex-row-reverse" : ""}`}
                      >
                        <div
                          className={`max-w-[85%] px-2 py-1 rounded-lg text-[11px] leading-snug ${
                            isOwn
                              ? isDark
                                ? "bg-emerald-500/15 text-emerald-200"
                                : "bg-emerald-100 text-emerald-800"
                              : isDark
                                ? "bg-white/[0.04] text-slate-300"
                                : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span
                              className={`text-[9px] font-mono font-bold ${
                                isOwn
                                  ? "text-emerald-400/70"
                                  : isDark
                                    ? "text-slate-500"
                                    : "text-gray-400"
                              }`}
                            >
                              {shortId(msg.accountId)}
                            </span>
                            <span
                              className={`text-[8px] ${
                                isDark ? "text-slate-600" : "text-gray-400"
                              }`}
                            >
                              {timeAgo(msg.timestamp)}
                            </span>
                          </div>
                          {msg.text}
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>

              {/* Divider */}
              <div className={`mx-3 border-t ${isDark ? "border-emerald-500/8" : "border-emerald-100"}`} />

              {/* Input area */}
              <div className="px-3 py-2">
                {/* Error / sent indicator */}
                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="flex items-center gap-1 mb-1.5"
                    >
                      <AlertCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
                      <span className="text-[10px] text-red-400 truncate">{error}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex items-end gap-1.5">
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      disabled={sending || cooldownLeft > 0}
                      placeholder={cooldownLeft > 0 ? `${cooldownMin}:${cooldownRemSec.toString().padStart(2, "0")}` : "Message..."}
                      maxLength={200}
                      className={`w-full text-[11px] pl-2.5 pr-8 py-1.5 rounded-lg outline-none transition-colors ${
                        isDark
                          ? "bg-black/25 border border-emerald-500/10 placeholder:text-slate-700 text-slate-200 focus:border-emerald-500/30"
                          : "bg-gray-50 border border-emerald-200 placeholder:text-gray-400 text-gray-700 focus:border-emerald-400"
                      } ${cooldownLeft > 0 ? "opacity-50 cursor-not-allowed" : ""}`}
                    />
                    {/* Word counter */}
                    {input.length > 0 && (
                      <span
                        className={`absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-mono ${
                          overLimit ? "text-red-400" : "text-emerald-400/40"
                        }`}
                      >
                        {wordCount}/{MAX_WORDS}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || overLimit || sending || cooldownLeft > 0}
                    className={`p-1.5 rounded-lg transition-all flex-shrink-0 ${
                      !input.trim() || overLimit || sending || cooldownLeft > 0
                        ? isDark
                          ? "text-slate-700 cursor-not-allowed"
                          : "text-gray-300 cursor-not-allowed"
                        : isDark
                          ? "text-emerald-400 hover:bg-emerald-500/15 hover:shadow-[0_0_8px_rgba(16,185,129,0.15)]"
                          : "text-emerald-600 hover:bg-emerald-50"
                    }`}
                  >
                    {sending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : sent ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                {/* Cooldown bar */}
                {cooldownLeft > 0 && (
                  <div className="mt-1.5">
                    <div className={`h-0.5 rounded-full overflow-hidden ${isDark ? "bg-white/[0.03]" : "bg-gray-100"}`}>
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500/40 to-teal-500/40"
                        initial={{ width: "100%" }}
                        animate={{ width: "0%" }}
                        transition={{ duration: cooldownLeft / 1000, ease: "linear" }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}