import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "icon";
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", type = "button", ...props }, ref) => {
    const variants: Record<string, string> = {
      primary: "bg-primary text-primary-foreground hover:brightness-105 active:brightness-95",
      secondary: "bg-muted text-text hover:bg-surface-raised",
      outline: "border border-border bg-transparent text-text hover:bg-muted",
      ghost: "text-text-muted hover:text-text hover:bg-muted",
      danger: "border border-danger/30 bg-danger/10 text-danger hover:bg-danger/15",
    };
    const sizes: Record<string, string> = {
      sm: "h-7 px-2.5 text-xs rounded-md gap-1.5",
      md: "h-8 px-3 text-xs rounded-md gap-1.5",
      icon: "h-8 w-8 rounded-md grid place-items-center",
    };
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium transition-colors",
          "disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70",
          variants[variant], sizes[size], className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-8 w-full rounded-md border border-border bg-card px-2.5 text-xs text-text",
        "placeholder:text-text-faint focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
        "disabled:opacity-50",
        className,
      )}
      spellCheck={false}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-md border border-border bg-card px-2.5 py-2 text-xs text-text",
        "placeholder:text-text-faint focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
        "disabled:opacity-50 resize-y",
        className,
      )}
      spellCheck={false}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export function Select({
  className, options, ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  options: Array<{ value: string; label: string; disabled?: boolean }>;
}) {
  return (
    <select
      className={cn(
        "h-8 w-full rounded-md border border-border bg-card px-2 text-xs text-text",
        "focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
        className,
      )}
      {...props}
    >
      {options.map(option => (
        <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
      ))}
    </select>
  );
}

export function Field({
  label, hint, htmlFor, children, className,
}: {
  label: string;
  hint?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[11px] font-medium text-text-muted">{label}</label>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-text-faint">{hint}</p>}
    </div>
  );
}

export function Badge({
  children, tone = "muted", className,
}: {
  children: React.ReactNode;
  tone?: "muted" | "primary" | "success" | "warning" | "danger";
  className?: string;
}) {
  const tones: Record<string, string> = {
    muted: "bg-muted text-text-muted border-border",
    primary: "bg-primary/10 text-primary border-primary/25",
    success: "bg-success/10 text-success border-success/25",
    warning: "bg-warning/10 text-warning border-warning/25",
    danger: "bg-danger/10 text-danger border-danger/25",
  };
  return (
    <span className={cn("inline-flex h-5 items-center rounded border px-1.5 text-[10px] font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" aria-label={label} className="inline-flex items-center gap-2 text-xs text-text-muted">
      <span className="dd-spinner" aria-hidden="true" />{label}
    </span>
  );
}

export function Switch({
  checked, onChange, disabled, label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
        checked ? "border-primary bg-primary" : "border-border bg-muted",
        disabled && "opacity-45",
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-[17px]" : "translate-x-[3px]",
        )}
      />
    </button>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-xs text-danger">
      <span className="min-w-0 flex-1 break-words">{message}</span>
      {onRetry && <Button variant="ghost" size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function EmptyState({
  title, detail, action,
}: {
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-8 text-center">
      <p className="text-sm font-medium text-text">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-text-muted">{detail}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function SectionHeader({
  title, detail, actions,
}: {
  title: string;
  detail?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        {detail && <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">{detail}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Dialog({
  open, onClose, title, description, children, footer, size = "md", closable = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  closable?: boolean;
}) {
  const panel = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  React.useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && closable) { event.stopPropagation(); onClose(); }
    };
    document.addEventListener("keydown", onKey);
    // Prefer a real field when the dialog is a form. Otherwise focus the panel
    // itself instead of the close button, which otherwise opens with a focus
    // ring on the destructive-looking X.
    const first = panel.current?.querySelector<HTMLElement>(
      "input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
    );
    (first || panel.current)?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, onClose, closable]);
  if (!open) return null;
  const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" };
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4 dd-enter" onMouseDown={event => {
      if (closable && event.target === event.currentTarget) onClose();
    }}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn("w-full overflow-hidden rounded-lg border border-border bg-popover shadow-xl outline-none dd-rise", widths[size])}
      >
        <div className="flex items-start gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-sm font-semibold text-text">{title}</h2>
            {description && <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{description}</p>}
          </div>
          {closable && <Button variant="ghost" size="icon" aria-label="Close dialog" onClick={onClose}><X size={15} /></Button>}
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-3.5">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 px-4 py-2.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-sans text-[10px] text-text-muted">{children}</kbd>;
}
