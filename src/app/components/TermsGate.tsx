import { useState, useEffect } from "react";
import { motion } from "motion/react";

const KEY = "wrappdex_tos_v1";

export function TermsGate({ children }: { children: React.ReactNode }) {
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    setOk(localStorage.getItem(KEY) === "1");
  }, []);

  // Always allow the institutional landing page through without gating
  const isLandingPage = typeof window !== "undefined" && window.location.pathname === "/";

  if (ok === null) return null;
  if (ok || isLandingPage) return <>{children}</>;

  return (
    <motion.div
      className="fixed inset-0 z-[99999] flex flex-col items-center justify-center px-5"
      style={{ background: "#060810" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Wordmark */}
      <h1 className="text-[22px] font-extrabold tracking-tight text-white mb-12 select-none">
        WRAP<span className="text-[#1D63ED]">p</span>
        <span className="text-slate-500">DEX</span>
      </h1>

      {/* Consent line + links */}
      <p className="text-[12px] text-slate-500 mb-8 text-center leading-relaxed">
        By continuing you agree to the{" "}
        <a
          href="/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-300 underline underline-offset-2 hover:text-white transition-colors"
        >
          Terms of Service
        </a>{" "}
        and{" "}
        <a
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-300 underline underline-offset-2 hover:text-white transition-colors"
        >
          Privacy Policy
        </a>
        .
      </p>

      {/* Button */}
      <button
        onClick={() => {
          localStorage.setItem(KEY, "1");
          setOk(true);
        }}
        className="rounded-lg px-10 py-2.5 text-[13px] font-medium text-white cursor-pointer transition-opacity hover:opacity-90 active:opacity-80"
        style={{ background: "#1D63ED" }}
      >
        Agree &amp; Continue
      </button>
    </motion.div>
  );
}