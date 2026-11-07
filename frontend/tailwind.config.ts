import type { Config } from "tailwindcss";

/**
 * DeepDeck shell tokens. The embedded DeepSeek and harness pages keep their
 * own design systems; this palette exists only for app chrome and Settings.
 */
const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Semantic aliases used by the shell; the product pages keep their own
        // design systems, so these names intentionally mirror CSS variables.
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        popover: "hsl(var(--popover))",
        muted: "hsl(var(--muted))",
        bg: "hsl(var(--background))",
        surface: "hsl(var(--card))",
        "surface-raised": "hsl(var(--popover))",
        "surface-muted": "hsl(var(--muted))",
        border: "hsl(var(--border))",
        "border-strong": "hsl(var(--input))",
        text: "hsl(var(--foreground))",
        "text-muted": "hsl(var(--muted-foreground))",
        "text-faint": "hsl(var(--text-faint))",
        primary: "hsl(var(--primary))",
        "primary-foreground": "hsl(var(--primary-foreground))",
        accent: "hsl(var(--accent))",
        danger: "hsl(var(--danger))",
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        info: "hsl(var(--info))",
        bar: "hsl(var(--bar))",
        "bar-border": "hsl(var(--bar-border))",
        // Official DeepSeek blue, used only for the DeepSeek mark.
        brand: "#4D6BFE",
      },
      fontFamily: {
        sans: ["system-ui", "Inter", "Segoe UI", "sans-serif"],
        mono: ["ui-monospace", "JetBrains Mono", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        md: "6px",
        lg: "8px",
        xl: "10px",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 120ms ease-out",
        "slide-up": "slide-up 140ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
