import { useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Circle, Loader2, MinusCircle, Recycle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ANALYSIS_STEPS } from "@/lib/constants";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATE_ICON = {
  done: { icon: CheckCircle2, className: "text-emerald-500" },
  running: { icon: Loader2, className: "text-primary animate-spin" },
  error: { icon: AlertCircle, className: "text-red-500" },
  skipped: { icon: MinusCircle, className: "text-amber-500" },
  pending: { icon: Circle, className: "text-muted-foreground/40" },
  reused: { icon: Recycle, className: "text-muted-foreground" },
};

function useElapsed(startedAt, active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  if (!startedAt) return null;
  const started = new Date(startedAt).getTime();
  return Number.isNaN(started) ? null : Math.max(0, Math.round((now - started) / 1000));
}

export function AnalysisSteps({ steps }) {
  const states = Object.fromEntries((steps || []).map((s) => [s.key, s.state]));
  return (
    <ol className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
      {ANALYSIS_STEPS.map((step) => {
        const state = states[step.key] || "pending";
        const { icon: Icon, className } = STATE_ICON[state] || STATE_ICON.pending;
        return (
          <li key={step.key} className="flex items-center gap-2 text-xs">
            <Icon className={cn("h-4 w-4 shrink-0", className)} />
            <span
              className={cn(state === "pending" || state === "reused" ? "text-muted-foreground" : "text-foreground", state === "running" && "font-semibold")}
              title={state === "reused" ? "Используются текущие результаты" : undefined}
            >
              {step.title}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function AnalysisRunning({ status }) {
  const elapsed = useElapsed(status?.started_at, true);
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-5" data-testid="analysis-progress">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm font-medium text-foreground">{status?.current_step || "Анализ выполняется"}</span>
        </div>
        <span className="text-sm tabular-nums text-muted-foreground">
          {status?.progress || 0}%{elapsed != null && ` · ${formatDuration(elapsed)}`}
        </span>
      </div>
      <Progress value={status?.progress || 0} className="mb-4 h-2" />
      <AnalysisSteps steps={status?.steps} />
      <p className="mt-3 text-xs text-muted-foreground">
        Модель анализирует анкету и документы. В зависимости от объёма данных и скорости модели это занимает от пары минут
        до получаса — страницу можно закрыть, анализ продолжится на сервере.
      </p>
    </div>
  );
}

export function AnalysisError({ status, onRetry, canRun }) {
  const [open, setOpen] = useState(false);
  const failed = ANALYSIS_STEPS.find((step) => step.key === status?.failed_step);
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-5" data-testid="analysis-error">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
          <div>
            <p className="font-medium text-foreground">Анализ завершился ошибкой{failed ? ` на этапе «${failed.title}»` : ""}</p>
            <p className="mt-1 text-sm text-muted-foreground">{status?.error || "Неизвестная ошибка"}</p>
          </div>
        </div>
        {canRun && (
          <Button size="sm" variant="outline" onClick={onRetry} className="shrink-0">
            <RotateCcw /> Повторить
          </Button>
        )}
      </div>
      {status?.steps?.some((s) => s.state !== "pending") && (
        <div className="mt-4">
          <AnalysisSteps steps={status.steps} />
        </div>
      )}
      {status?.error_detail && (
        <div className="mt-3">
          <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} /> Технические детали
          </button>
          {open && (
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-secondary/60 p-3 text-xs text-muted-foreground">
              {status.error_detail}
            </pre>
          )}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Результаты предыдущего успешного анализа (если был) сохранены.</p>
    </div>
  );
}

export function AnalysisWarnings({ warnings }) {
  if (!warnings?.length) return null;
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4" data-testid="analysis-warnings">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <AlertTriangle className="h-4 w-4 text-amber-500" /> Анализ завершён с предупреждениями
      </p>
      <ul className="mt-2 space-y-1 pl-6 text-sm text-muted-foreground">
        {warnings.map((warning) => (
          <li key={warning} className="list-disc">
            {warning}
          </li>
        ))}
      </ul>
    </div>
  );
}
