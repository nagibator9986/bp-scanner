import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  Inbox,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { ChartTooltip, ConfirmDialog, EmptyState, ErrorState, LoadingState, Panel } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApi } from "@/hooks/useApi";
import { useChartTheme } from "@/hooks/useChartTheme";
import api, { errorMessage } from "@/lib/api";
import { ANALYSIS_STEPS } from "@/lib/constants";
import { formatDateTime, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;
const UNRESOLVED_COLOR = "#ef4444";
const STEP_TITLES = Object.fromEntries(ANALYSIS_STEPS.map((step) => [step.key, step.title]));
const stepTitle = (step) => (step ? STEP_TITLES[step] || step : "Без этапа");

function IconAction({ label, onClick, disabled, className, children, testId }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("h-8 w-8", className)}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      data-testid={testId}
    >
      {children}
    </Button>
  );
}

function CodeBlock({ title, text, wrap = false, testId }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Скопировано в буфер обмена");
    } catch {
      toast.error("Не удалось скопировать");
    }
  };
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h4>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={copy}>
          <Copy /> Копировать
        </Button>
      </div>
      <pre
        className={cn(
          "max-h-72 overflow-auto rounded-lg border border-border bg-background/60 p-3 font-mono text-xs leading-relaxed text-foreground",
          wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
        )}
        data-testid={testId}
      >
        {text}
      </pre>
    </div>
  );
}

function ErrorsByStepChart({ byStep }) {
  const theme = useChartTheme();
  const rows = byStep.map((item) => ({
    step: stepTitle(item._id),
    unresolved: item.unresolved || 0,
    resolved: Math.max(0, (item.count || 0) - (item.unresolved || 0)),
  }));
  const height = Math.max(140, rows.length * 34 + 30);

  return (
    <div data-testid="errors-by-step-chart">
      <div className="mb-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: UNRESOLVED_COLOR }} /> Нерешённые
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: theme.muted }} /> Решённые
        </span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap={8}>
          <CartesianGrid horizontal={false} stroke={theme.grid} strokeDasharray="3 3" />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fontSize: 11, fill: theme.axis }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="step"
            width={160}
            tick={{ fontSize: 11, fill: theme.axis }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip cursor={{ fill: theme.cursor }} content={<ChartTooltip />} />
          <Bar dataKey="unresolved" name="Нерешённые" stackId="errors" fill={UNRESOLVED_COLOR} maxBarSize={18} />
          <Bar dataKey="resolved" name="Решённые" stackId="errors" fill={theme.muted} radius={[0, 4, 4, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function SummaryRow({ label, value, className }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-semibold tabular-nums text-foreground", className)}>{value}</span>
    </div>
  );
}

export function ErrorLogsTab({ onChanged }) {
  const [page, setPage] = useState(1);
  const [stepFilter, setStepFilter] = useState("all");
  const [resolvedFilter, setResolvedFilter] = useState("unresolved");

  const listPath = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (stepFilter !== "all") params.set("step", stepFilter);
    if (resolvedFilter !== "all") params.set("resolved", resolvedFilter === "resolved" ? "true" : "false");
    return `/admin/errors?${params}`;
  }, [page, stepFilter, resolvedFilter]);

  const { data: list, error: listError, loading: listLoading, reload: reloadList } = useApi(listPath);
  const { data: stats, error: statsError, loading: statsLoading, reload: reloadStats } = useApi("/admin/errors/stats");

  const [selected, setSelected] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [resolveAllOpen, setResolveAllOpen] = useState(false);
  const [resolvingAll, setResolvingAll] = useState(false);

  const errors = list?.errors || [];
  const total = list?.total || 0;
  const pages = list?.pages || 0;
  const byStep = useMemo(() => stats?.by_step || [], [stats]);
  const stepOptions = useMemo(() => byStep.filter((item) => item._id), [byStep]);

  // После удаления последней записи на странице — вернуться на существующую страницу
  useEffect(() => {
    if (pages > 0 && page > pages) setPage(pages);
  }, [page, pages]);

  const refresh = useCallback(() => {
    reloadList({ silent: true });
    reloadStats({ silent: true });
    onChanged?.();
  }, [reloadList, reloadStats, onChanged]);

  const openDetail = (item) => {
    setSelected(item);
    setDetailOpen(true);
  };

  const setResolved = async (item, resolved) => {
    setBusyId(item.id);
    try {
      await api.patch(`/admin/errors/${item.id}`, null, { params: { resolved } });
      toast.success(resolved ? "Ошибка отмечена как решённая" : "Ошибка возвращена в нерешённые");
      setSelected((prev) => (prev?.id === item.id ? { ...prev, resolved, resolved_at: resolved ? new Date().toISOString() : null } : prev));
      refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Не удалось обновить запись"));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/admin/errors/${toDelete.id}`);
      toast.success("Запись удалена");
      if (selected?.id === toDelete.id) setDetailOpen(false);
      setToDelete(null);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Не удалось удалить запись"));
    } finally {
      setDeleting(false);
    }
  };

  const resolveAll = async () => {
    setResolvingAll(true);
    try {
      const { data } = await api.post("/admin/errors/resolve-all");
      const count = data?.count ?? 0;
      toast.success(count ? `Отмечено решёнными: ${count}` : "Нерешённых ошибок не было");
      setResolveAllOpen(false);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Не удалось обновить записи"));
    } finally {
      setResolvingAll(false);
    }
  };

  const changeStep = (value) => {
    setStepFilter(value);
    setPage(1);
  };
  const changeResolved = (value) => {
    setResolvedFilter(value);
    setPage(1);
  };

  const unresolvedTotal = stats?.unresolved || 0;

  let listBody;
  if (listLoading) {
    listBody = <LoadingState label="Загрузка журнала…" />;
  } else if (listError) {
    listBody = <ErrorState message={listError} onRetry={reloadList} />;
  } else if (!errors.length) {
    const filtered = stepFilter !== "all" || resolvedFilter !== "all";
    listBody = (
      <EmptyState
        icon={resolvedFilter === "unresolved" ? CheckCircle2 : Inbox}
        title={resolvedFilter === "unresolved" ? "Нерешённых ошибок нет" : "Записей не найдено"}
        description={filtered ? "Попробуйте изменить фильтры." : "Журнал ошибок пуст — анализы проходят без сбоев."}
        action={
          filtered && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                changeStep("all");
                changeResolved("all");
              }}
            >
              Показать все записи
            </Button>
          )
        }
      />
    );
  } else {
    listBody = (
      <ul className="space-y-2" data-testid="error-list">
        {errors.map((item) => (
          <li
            key={item.id}
            className={cn(
              "flex items-start gap-3 rounded-lg border border-border bg-background/40 p-3 transition-colors hover:border-primary/30",
              item.resolved && "opacity-70"
            )}
            data-testid={`error-row-${item.id}`}
          >
            <div
              className={cn(
                "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                item.resolved ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
              )}
            >
              {item.resolved ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            </div>
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openDetail(item)}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <Badge variant="outline" className="font-normal">
                  {stepTitle(item.step)}
                </Badge>
                {item.division_name && <span className="font-medium text-foreground">{item.division_name}</span>}
                <span className="text-muted-foreground">{formatDateTime(item.created_at)}</span>
                {item.resolved && <span className="text-emerald-500">решено</span>}
              </div>
              <p className="mt-1 line-clamp-2 break-words text-sm text-foreground">{item.error_message}</p>
              {item.error_detail && (
                <p className="mt-0.5 line-clamp-1 break-all text-xs text-muted-foreground">{item.error_detail}</p>
              )}
            </button>
            <div className="flex shrink-0 items-center gap-0.5">
              <IconAction label="Подробнее" onClick={() => openDetail(item)} testId={`error-view-${item.id}`}>
                <Eye className="text-muted-foreground" />
              </IconAction>
              <IconAction
                label={item.resolved ? "Вернуть в нерешённые" : "Отметить решённой"}
                onClick={() => setResolved(item, !item.resolved)}
                disabled={busyId === item.id}
                testId={`error-resolve-${item.id}`}
              >
                {item.resolved ? (
                  <RotateCcw className="text-muted-foreground" />
                ) : (
                  <CheckCircle2 className="text-emerald-500" />
                )}
              </IconAction>
              <IconAction label="Удалить" onClick={() => setToDelete(item)} testId={`error-delete-${item.id}`}>
                <Trash2 className="text-red-500" />
              </IconAction>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-4" data-testid="error-logs-tab">
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Сводка" icon={AlertTriangle} description="По всему журналу ошибок">
          {statsLoading && !stats ? (
            <LoadingState className="py-8" />
          ) : statsError && !stats ? (
            <ErrorState className="py-8" message={statsError} onRetry={reloadStats} />
          ) : (
            <div className="space-y-4">
              <div className="divide-y divide-border">
                <SummaryRow label="Всего записей" value={stats?.total ?? 0} />
                <SummaryRow
                  label="Нерешённых"
                  value={unresolvedTotal}
                  className={unresolvedTotal > 0 ? "text-red-500" : "text-emerald-500"}
                />
                <SummaryRow label="Решённых" value={Math.max(0, (stats?.total || 0) - unresolvedTotal)} />
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setResolveAllOpen(true)}
                disabled={!unresolvedTotal}
                data-testid="resolve-all-btn"
              >
                <CheckCheck /> Отметить все решёнными
              </Button>
            </div>
          )}
        </Panel>

        <Panel title="Ошибки по этапам" description="Нерешённые и решённые записи" className="lg:col-span-2">
          {statsLoading && !stats ? (
            <LoadingState className="py-8" />
          ) : statsError && !stats ? (
            <ErrorState className="py-8" message={statsError} onRetry={reloadStats} />
          ) : byStep.length ? (
            <ErrorsByStepChart byStep={byStep} />
          ) : (
            <EmptyState icon={CheckCircle2} title="Ошибок не зафиксировано" className="py-10" />
          )}
        </Panel>
      </div>

      <Panel
        title="Журнал ошибок"
        description={list ? `${total} ${plural(total, ["запись", "записи", "записей"])}` : undefined}
        actions={
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              reloadList();
              reloadStats({ silent: true });
            }}
            title="Обновить"
            aria-label="Обновить"
            data-testid="errors-refresh-btn"
          >
            <RefreshCw className={cn(listLoading && "animate-spin")} />
          </Button>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Select value={stepFilter} onValueChange={changeStep}>
            <SelectTrigger className="w-full sm:w-[230px]" data-testid="step-filter">
              <SelectValue placeholder="Этап" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все этапы</SelectItem>
              {stepOptions.map((item) => (
                <SelectItem key={item._id} value={item._id}>
                  {stepTitle(item._id)} ({item.count})
                </SelectItem>
              ))}
              {stepFilter !== "all" && !stepOptions.some((item) => item._id === stepFilter) && (
                <SelectItem value={stepFilter}>{stepTitle(stepFilter)}</SelectItem>
              )}
            </SelectContent>
          </Select>
          <Select value={resolvedFilter} onValueChange={changeResolved}>
            <SelectTrigger className="w-full sm:w-[180px]" data-testid="resolved-filter">
              <SelectValue placeholder="Статус" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unresolved">Нерешённые</SelectItem>
              <SelectItem value="resolved">Решённые</SelectItem>
              <SelectItem value="all">Все</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {listBody}

        {pages > 1 && !listLoading && !listError && (
          <div className="mt-4 flex items-center justify-between gap-2" data-testid="errors-pagination">
            <span className="text-xs text-muted-foreground">
              Страница {page} из {pages}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                data-testid="errors-prev-page"
              >
                <ChevronLeft /> Назад
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page >= pages}
                data-testid="errors-next-page"
              >
                Вперёд <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </Panel>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto border-border bg-card" data-testid="error-detail-dialog">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 pr-6">
                  {selected.resolved ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-red-500" />
                  )}
                  Детали ошибки
                </DialogTitle>
                <DialogDescription>
                  {stepTitle(selected.step)} · {formatDateTime(selected.created_at)}
                </DialogDescription>
              </DialogHeader>

              <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 text-sm sm:grid-cols-4">
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Подразделение</dt>
                  <dd className="truncate font-medium text-foreground">{selected.division_name || "—"}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Этап</dt>
                  <dd className="truncate font-medium text-foreground">{stepTitle(selected.step)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Статус</dt>
                  <dd className={cn("font-medium", selected.resolved ? "text-emerald-500" : "text-red-500")}>
                    {selected.resolved ? "Решена" : "Не решена"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Решена</dt>
                  <dd className="font-medium text-foreground">{selected.resolved ? formatDateTime(selected.resolved_at) : "—"}</dd>
                </div>
              </dl>

              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Сообщение</h4>
                <p className="break-words rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-foreground">
                  {selected.error_message}
                </p>
              </div>
              {selected.error_detail && (
                <CodeBlock title="Подробности" text={selected.error_detail} wrap testId="error-detail-text" />
              )}
              {selected.stack_trace && <CodeBlock title="Stack trace" text={selected.stack_trace} testId="error-stack-trace" />}
              {selected.input_data_summary && (
                <CodeBlock title="Входные данные" text={selected.input_data_summary} wrap />
              )}
              {selected.admin_notes && (
                <div>
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Заметки</h4>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{selected.admin_notes}</p>
                </div>
              )}

              <DialogFooter className="gap-2 sm:justify-between sm:space-x-0">
                {selected.division_id ? (
                  <Button variant="ghost" asChild>
                    <Link to={`/divisions/${selected.division_id}`} data-testid="error-open-division">
                      <ExternalLink /> Открыть подразделение
                    </Link>
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button variant="outline" onClick={() => setToDelete(selected)} data-testid="error-detail-delete">
                    <Trash2 className="text-red-500" /> Удалить
                  </Button>
                  <Button
                    variant={selected.resolved ? "outline" : "default"}
                    onClick={() => setResolved(selected, !selected.resolved)}
                    disabled={busyId === selected.id}
                    data-testid="error-detail-resolve"
                  >
                    {selected.resolved ? <RotateCcw /> : <CheckCircle2 />}
                    {selected.resolved ? "Вернуть в нерешённые" : "Отметить решённой"}
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(open) => !open && !deleting && setToDelete(null)}
        title="Удалить запись об ошибке?"
        description={toDelete ? `«${toDelete.error_message?.slice(0, 120) || "Ошибка"}» будет удалена из журнала без возможности восстановления.` : undefined}
        onConfirm={confirmDelete}
        busy={deleting}
      />

      <ConfirmDialog
        open={resolveAllOpen}
        onOpenChange={(open) => !resolvingAll && setResolveAllOpen(open)}
        title="Отметить все ошибки решёнными?"
        description={`${unresolvedTotal} ${plural(unresolvedTotal, ["запись будет отмечена", "записи будут отмечены", "записей будут отмечены"])} как решённые. Записи останутся в журнале.`}
        confirmLabel="Отметить все"
        destructive={false}
        onConfirm={resolveAll}
        busy={resolvingAll}
      />
    </div>
  );
}
