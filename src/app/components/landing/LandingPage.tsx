import { useEffect } from "react";
import { motion, useScroll, useSpring } from "motion/react";
import { LandingNavbar } from "./LandingNavbar";
import { LandingHero } from "./LandingHero";
import { LandingCards } from "./LandingCards";
import { LandingNetwork } from "./LandingNetwork";
import { LandingRoadmap } from "./LandingRoadmap";
import { LandingPartners } from "./LandingPartners";
import { LandingTeam } from "./LandingTeam";
import { LandingCTA } from "./LandingCTA";
import { LandingFooter } from "./LandingFooter";

const BLUE = "#1D63ED";

export function LandingPage() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001,
  });

  // Force light mode for landing page — strip any DEX dark mode classes
  useEffect(() => {
    const html = document.documentElement;
    const prevClasses = {
      dark: html.classList.contains("dark"),
      lightMode: html.classList.contains("light-mode"),
    };

    // Landing page is always white / light
    html.classList.remove("dark");
    html.classList.add("light-mode");
    html.style.backgroundColor = "#ffffff";
    document.body.style.backgroundColor = "#ffffff";
    document.body.style.color = "#0f172a";

    return () => {
      // Restore previous state when leaving landing page
      html.classList.remove("light-mode");
      if (prevClasses.dark) html.classList.add("dark");
      html.style.backgroundColor = "";
      document.body.style.backgroundColor = "";
      document.body.style.color = "";
    };
  }, []);

  // Scroll to anchor on mount if hash present
  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const el = document.querySelector(hash);
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: "smooth" }), 100);
      }
    } else {
      window.scrollTo({ top: 0, left: 0 });
    }
  }, []);

  return (
    <div
      className="min-h-screen text-slate-900 relative overflow-hidden"
      style={{
        fontFamily: "'Inter', sans-serif",
        backgroundColor: "#ffffff",
        color: "#0f172a",
      }}
    >
      {/* Scroll Progress Bar */}
      <motion.div
        className="fixed top-0 left-0 right-0 h-1 z-[60] origin-left"
        style={{ scaleX, backgroundColor: BLUE }}
      />

      <LandingNavbar />

      <main className="pt-24 md:pt-32">
        <LandingHero />
        <LandingCards />
        <LandingNetwork />
        <LandingRoadmap />
        <LandingPartners />
        <LandingTeam />
        <LandingCTA />
      </main>

      <LandingFooter />
    </div>
  );
}
