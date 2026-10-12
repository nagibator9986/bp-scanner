import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { STATUS, normalizeStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions, children }) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">{title}</h1>
        {description && <p className="text-muted-foreground mt-1">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function Panel({ title, description, icon: Icon, actions, className, bodyClassName, children, ...props }) {
  return (
    <section className={cn("rounded-xl border border-border bg-card/70 backdrop-blur-sm", className)} {...props}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
          <div className="min-w-0">
            {title && (
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                {Icon && <Icon className="w-4 h-4 text-primary shrink-0" strokeWidth={1.75} />}
                <span className="truncate">{title}</span>
              </h3>
            )}
            {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cn("px-5 pb-5", !title && !actions && "pt-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function StatCard({ icon: Icon, label, value, hint, accent = "text-primary", className }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card/70 p-4 transition-colors hover:border-primary/30", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        {Icon && <Icon className={cn("w-4 h-4 shrink-0", accent)} strokeWidth={1.75} />}
      </div>
      <p className="mt-2 text-2xl font-bold text-foreground tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function StatusBadge({ status, className }) {
  const config = STATUS[normalizeStatus(status)];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", config.text, className)}>
      <span className={cn("w-2 h-2 rounded-full", config.dot)} />
      {config.label}
    </span>
  );
}

export function LoadingState({ label = "Загрузка…", className }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground", className)}>
      <Loader2 className="w-7 h-7 animate-spin text-primary" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry, className }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border border-red-500/30 bg-red-500/5 py-12 px-6 text-center", className)}>
      <AlertTriangle className="w-8 h-8 text-red-500" />
      <p className="text-sm text-foreground">{message || "Не удалось загрузить данные"}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={() => onRetry()}>
          <RefreshCw className="w-4 h-4" /> Повторить
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-14 px-6 text-center", className)}>
      {Icon && <Icon className="w-11 h-11 text-muted-foreground/50 mb-3" strokeWidth={1.25} />}
      <p className="font-medium text-foreground">{title}</p>
      {description && <p className="text-sm text-muted-foreground mt-1 max-w-md">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Горизонтальная шкала значения (по умолчанию 0–100). */
export function Meter({ value, max = 100, color = "hsl(var(--primary))", className, label }) {
  const percent = Math.max(0, Math.min(100, ((Number(value) || 0) / max) * 100));
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${percent}%`, background: color }} />
      </div>
      {label !== undefined && <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{label}</span>}
    </div>
  );
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Удалить", onConfirm, destructive = true, busy }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-card border-border">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            className={destructive ? "bg-red-600 text-white hover:bg-red-500" : undefined}
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Подсказка Recharts в стиле приложения. */
export function ChartTooltip({ active, payload, label, formatter, labelFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-xl">
      {label !== undefined && label !== "" && (
        <p className="mb-1 font-medium text-foreground">{labelFormatter ? labelFormatter(label, payload) : label}</p>
      )}
      {payload.map((entry) => (
        <div key={entry.dataKey || entry.name} className="flex items-center gap-2 text-muted-foreground">
          <span className="w-2 h-2 rounded-full" style={{ background: entry.color || entry.payload?.color || entry.fill }} />
          <span>{entry.name}:</span>
          <span className="font-semibold text-foreground tabular-nums">
            {formatter ? formatter(entry.value, entry.name, entry) : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}
