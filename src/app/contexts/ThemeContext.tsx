import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { playThemeWhistle } from "../utils/sounds";

type Theme = "dark" | "light";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Default fallback for when useTheme is called outside ThemeProvider (e.g. preview/HMR)
const DEFAULT_THEME: ThemeContextType = {
  theme: "dark",
  toggleTheme: () => {},
  isDark: true,
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("hbarh-theme");
      return (saved as Theme) || "dark";
    }
    return "dark";
  });

  useEffect(() => {
    localStorage.setItem("hbarh-theme", theme);
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.add("light-mode");
      root.classList.remove("dark-mode");
    } else {
      root.classList.add("dark-mode");
      root.classList.remove("light-mode");
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      playThemeWhistle(next === "light" ? "up" : "down");
      return next;
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, isDark: theme === "dark" }}>
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