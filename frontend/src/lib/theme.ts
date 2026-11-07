/** Shell theme metadata and application. Embedded pages keep their own design
 * systems; their light/dark preference is mapped by the main process. */

export type Theme = "system" | "light" | "dark" | "midnight" | "graphite" | "paper";

export interface ThemeOption {
  id: Theme;
  label: string;
  detail: string;
  swatches: [string, string, string] | "system";
}

export const THEMES: ThemeOption[] = [
  { id: "system", label: "System", detail: "Follow the desktop", swatches: "system" },
  { id: "light", label: "Light", detail: "Clean daylight", swatches: ["#f5f7fb", "#ffffff", "#4d6bfe"] },
  { id: "dark", label: "Dark", detail: "DeepSeek charcoal", swatches: ["#161619", "#1b1b1f", "#5f8bff"] },
  { id: "midnight", label: "Midnight", detail: "Navy and cyan", swatches: ["#0c1424", "#121d33", "#35b6ff"] },
  { id: "graphite", label: "Graphite", detail: "Warm steel", swatches: ["#151412", "#1e1c19", "#e0a94a"] },
  { id: "paper", label: "Paper", detail: "Warm paper", swatches: ["#f7f1e6", "#fffaf2", "#2f6f55"] },
];

export function themeOption(theme: Theme): ThemeOption {
  return THEMES.find(option => option.id === theme) || THEMES[0];
}

export function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
}

/** Whether the shell should currently render dark. */
export function isDarkTheme(theme: Theme, systemDark = systemPrefersDark()): boolean {
  if (theme === "system") return systemDark;
  return theme === "dark" || theme === "midnight" || theme === "graphite";
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  if (!reduced) {
    root.classList.add("dd-theme-transition");
    window.clearTimeout((window as unknown as { __ddThemeTimer?: number }).__ddThemeTimer);
    (window as unknown as { __ddThemeTimer?: number }).__ddThemeTimer = window.setTimeout(() => {
      root.classList.remove("dd-theme-transition");
    }, 280);
    // Commit the transition rules before changing the palette so the first
    // frame paints from the old colors and the theme crossfades instead of
    // snapping.
    void root.offsetHeight;
  }
  if (theme === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = theme;
}
