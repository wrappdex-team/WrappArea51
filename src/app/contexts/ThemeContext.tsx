import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { playThemeWhistle } from "../utils/sounds";

type Theme = "dark" | "light";
type Accent = "sky" | "pink";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  isDark: boolean;
  accent: Accent;
  toggleAccent: () => void;
  isSky: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Default fallback for when useTheme is called outside ThemeProvider (e.g. preview/HMR)
const DEFAULT_THEME: ThemeContextType = {
  theme: "light",
  toggleTheme: () => {},
  isDark: false,
  accent: "sky",
  toggleAccent: () => {},
  isSky: true,
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("hbarh-theme");
      return (saved as Theme) || "light";
    }
    return "light";
  });

  const [accent, setAccent] = useState<Accent>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("hbarh-accent");
      return (saved as Accent) || "sky";
    }
    return "sky";
  });

  useEffect(() => {
    localStorage.setItem("hbarh-theme", theme);
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.add("light-mode");
      root.classList.remove("dark");
    } else {
      root.classList.add("dark");
      root.classList.remove("light-mode");
    }
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("hbarh-accent", accent);
    const root = document.documentElement;
    if (accent === "sky") {
      root.classList.add("accent-sky");
      root.classList.remove("accent-pink");
    } else {
      root.classList.add("accent-pink");
      root.classList.remove("accent-sky");
    }
  }, [accent]);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      playThemeWhistle(next === "light" ? "up" : "down");
      return next;
    });
  };

  const toggleAccent = () => {
    setAccent((prev) => (prev === "sky" ? "pink" : "sky"));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, isDark: theme === "dark", accent, toggleAccent, isSky: accent === "sky" }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    return DEFAULT_THEME;
  }
  return context;
}