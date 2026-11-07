import * as React from "react";
import { Check } from "lucide-react";
import { THEMES, type Theme, type ThemeOption } from "@/lib/theme";
import { cn } from "./ui";

export function ThemeSwatches({ option, className }: { option: ThemeOption; className?: string }) {
  if (option.swatches === "system") {
    return (
      <span aria-hidden="true" className={cn("inline-flex overflow-hidden rounded-full border border-border", className)}>
        <span className="h-full w-1/2 bg-[#f5f7fb]" />
        <span className="h-full w-1/2 bg-[#161619]" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={cn("inline-flex overflow-hidden rounded-full border border-border", className)}>
      {option.swatches.map((color, index) => (
        <span key={index} className="h-full w-1/3" style={{ backgroundColor: color }} />
      ))}
    </span>
  );
}

export function ThemePicker({
  value, onChange, disabled,
}: {
  value: Theme;
  onChange: (theme: Theme) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Theme" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {THEMES.map((option, index) => {
        const selected = option.id === value;
        const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
          if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
          event.preventDefault();
          const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
          const next = (index + direction + THEMES.length) % THEMES.length;
          onChange(THEMES[next].id);
          const group = event.currentTarget.parentElement;
          requestAnimationFrame(() => {
            group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
          });
        };
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            onKeyDown={onKeyDown}
            className={cn(
              "group flex min-h-[54px] items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55",
              selected ? "border-primary/55 bg-primary/[0.07]" : "border-border bg-card hover:border-border-strong hover:bg-muted/45",
              disabled && "opacity-50",
            )}
          >
            <ThemeSwatches option={option} className="h-6 w-6 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-text">{option.label}</span>
              <span className="block truncate text-[10px] text-text-faint">{option.detail}</span>
            </span>
            <span
              className={cn(
                "grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-colors",
                selected ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent",
              )}
              aria-hidden="true"
            >
              <Check size={10} strokeWidth={3} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
