/**
 * Minimal modal dialog (no extra dependency). A fixed overlay + centered panel; closes on
 * Escape or backdrop click and locks body scroll while open. Sufficient for the console's
 * create-endpoint flow; can be swapped for `@radix-ui/react-dialog` later without API churn.
 */
import { useEffect, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Footer actions (right-aligned). */
  footer?: ReactNode;
  className?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={cn(
          "relative z-10 w-full max-w-lg rounded-lg border border-border bg-card text-card-foreground shadow-lg",
          className,
        )}
      >
        {(title || description) && (
          <div className="space-y-1 border-b border-border p-4">
            {title && <h2 className="text-base font-semibold tracking-tight">{title}</h2>}
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
        )}
        <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-border p-4">{footer}</div>
        )}
      </div>
    </div>
  );
}
