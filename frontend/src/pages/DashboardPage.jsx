import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  Clock,
  FileSpreadsheet,
  Gauge,
  GitBranch,
  Lightbulb,
  ListChecks,
  Loader2,
  Plus,
  Rocket,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartTooltip,
  EmptyState,
  ErrorState,
  LoadingState,
  Meter,
  PageHeader,
  Panel,
  StatCard,
  StatusBadge,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import { useApi } from "@/hooks/useApi";
import { useChartTheme } from "@/hooks/useChartTheme";
import { downloadFile, errorMessage } from "@/lib/api";
import { CATEGORIES, INITIATIVE_STATUSES, SCORE_FIELDS, potentialColor } from "@/lib/constants";
import { formatMoney, formatNumber, plural, truncate } from "@/lib/format";

const STATUS_COLORS = { completed: "#10b981", in_progress: "#f59e0b", error: "#ef4444", not_started: "#64748b" };
const STATUS_LABELS = { completed: "Завершён", in_progress: "В процессе", error: "Ошибка", not_started: "Не начат" };

function TopProcessesChart({ data }) {
  const chart = useChartTheme();
  const rows = data.map((p) => ({
    ...p,
    label: truncate(p.process_name, 34),
    color: potentialColor(p.automation_potential),
  }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, rows.length * 34)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} horizontal={false} />
        <XAxis type="number" domain={[0, 100]} stroke={chart.axis} fontSize={11} tickFormatter={(v) => `${v}%`} />
        <YAxis type="category" dataKey="label" stroke={chart.axis} fontSize={11} width={210} />
        <Tooltip
          cursor={{ fill: chart.cursor }}
          content={
            <ChartTooltip
              formatter={(value) => `${value}%`}
              labelFormatter={(label, payload) => `${payload?.[0]?.payload?.process_name} · ${payload?.[0]?.payload?.division_name}`}
            />
          }
        />
        <Bar dataKey="automation_potential" name="Потенциал" radius={[0, 4, 4, 0]} barSize={18}>
          {rows.map((row) => (
            <Cell key={`${row.division_id}-${row.process_name}`} fill={row.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function StatusDonut({ counts }) {
  const data = Object.entries(counts)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => ({ name: STATUS_LABELS[key], value, color: STATUS_COLORS[key] }));
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={62} outerRadius={88} paddingAngle={3} stroke="none">
            {data.map((item) => (
              <Cell key={item.name} fill={item.color} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-foreground">{total}</span>
        <span className="text-xs text-muted-foreground">{plural(total, ["подразделение", "подразделения", "подразделений"])}</span>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
        {data.map((item) => (
          <span key={item.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} /> {item.name}: {item.value}
          </span>
        ))}
      </div>
    </div>
  );
}

function ScoresRadar({ scores }) {
  const chart = useChartTheme();
  const shortLabels = Object.fromEntries(SCORE_FIELDS.map((f) => [f.key, f.short]));
  const data = scores.map((score) => ({ ...score, short: shortLabels[score.key] || score.label }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <RadarChart data={data} outerRadius="68%">
        <PolarGrid stroke={chart.grid} />
        <PolarAngleAxis dataKey="short" stroke={chart.axis} fontSize={11} />
        <PolarRadiusAxis domain={[0, 10]} tick={false} axisLine={false} />
        <Radar dataKey="value" name="Средняя оценка" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.25} strokeWidth={2} />
        <Tooltip content={<ChartTooltip formatter={(v) => `${v} / 10`} labelFormatter={(l, p) => p?.[0]?.payload?.label || l} />} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

function CategoryChart({ data }) {
  const chart = useChartTheme();
  const rows = data.map((item) => ({ ...item, name: CATEGORIES[item.category]?.short || item.label, color: CATEGORIES[item.category]?.color }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
        <XAxis dataKey="name" stroke={chart.axis} fontSize={10} interval={0} />
        <YAxis yAxisId="count" stroke={chart.axis} fontSize={11} allowDecimals={false} />
        <YAxis yAxisId="fte" orientation="right" stroke={chart.axis} fontSize={11} />
        <Tooltip cursor={{ fill: chart.cursor }} content={<ChartTooltip />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar yAxisId="count" dataKey="count" name="Рекомендаций" radius={[4, 4, 0, 0]}>
          {rows.map((row) => (
            <Cell key={row.category} fill={row.color} />
          ))}
        </Bar>
        <Bar yAxisId="fte" dataKey="fte" name="Экономия, FTE" fill={chart.muted} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function PotentialHistogram({ data }) {
  const chart = useChartTheme();
  const colors = ["#64748b", "#94a3b8", "#f59e0b", "#10b981"];
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
        <XAxis dataKey="range" stroke={chart.axis} fontSize={11} tickFormatter={(v) => `${v}%`} />
        <YAxis stroke={chart.axis} fontSize={11} allowDecimals={false} />
        <Tooltip cursor={{ fill: chart.cursor }} content={<ChartTooltip labelFormatter={(v) => `Потенциал ${v}%`} />} />
        <Bar dataKey="count" name="Процессов" radius={[4, 4, 0, 0]}>
          {data.map((row, index) => (
            <Cell key={row.range} fill={colors[index]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function DivisionsComparison({ divisions }) {
  const chart = useChartTheme();
  const rows = divisions
    .filter((d) => d.processes_count > 0)
    .slice(0, 12)
    .map((d) => ({
      name: truncate(d.name, 16),
      fullName: d.name,
      processes: d.processes_count || 0,
      recommendations: d.recommendations_count || 0,
      workflows: d.n8n_workflows_count || 0,
    }));
  if (!rows.length) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Появится после первого завершённого анализа</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
        <XAxis dataKey="name" stroke={chart.axis} fontSize={11} interval={0} />
        <YAxis stroke={chart.axis} fontSize={11} allowDecimals={false} />
        <Tooltip cursor={{ fill: chart.cursor }} content={<ChartTooltip labelFormatter={(l, p) => p?.[0]?.payload?.fullName || l} />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="processes" name="Процессы" fill="#3b82f6" radius={[4, 4, 0, 0]} />
        <Bar dataKey="recommendations" name="Рекомендации" fill="#10b981" radius={[4, 4, 0, 0]} />
        <Bar dataKey="workflows" name="n8n workflows" fill="#a855f7" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function InitiativesPipeline({ data }) {
  const rows = (data || []).map((item) => ({ ...item, ...(INITIATIVE_STATUSES[item.status] || INITIATIVE_STATUSES.new) }));
  const total = rows.reduce((sum, item) => sum + item.count, 0);
  if (!total) return <p className="py-16 text-center text-sm text-muted-foreground">Инициатив пока нет</p>;
  const active = rows.filter((r) => ["accepted", "in_progress", "done"].includes(r.status)).reduce((sum, r) => sum + r.count, 0);
  return (
    <div className="space-y-4" data-testid="initiatives-pipeline">
      <div className="flex h-3 overflow-hidden rounded-full bg-secondary">
        {rows
          .filter((r) => r.count > 0)
          .map((r) => (
            <div key={r.status} style={{ width: `${(r.count / total) * 100}%`, background: r.color }} title={`${r.label}: ${r.count}`} />
          ))}
      </div>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.status} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} /> {r.label}
            </span>
            <span className="flex items-baseline gap-3 tabular-nums">
              {r.fte > 0 && <span className="text-xs text-muted-foreground">{formatNumber(r.fte, 1)} FTE</span>}
              <span className="w-8 text-right font-semibold text-foreground">{r.count}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        В портфеле (принято, в работе, внедрено): {active} из {total} · {Math.round((active / total) * 100)}%
      </p>
    </div>
  );
}

function SavingsByDivision({ divisions, currency }) {
  const chart = useChartTheme();
  const rows = divisions
    .filter((d) => d.saved_hours_month > 0)
    .sort((a, b) => b.saved_hours_month - a.saved_hours_month)
    .slice(0, 10)
    .map((d) => ({
      name: truncate(d.name, 22),
      fullName: d.name,
      hours: d.saved_hours_month,
      money: d.saved_money_year,
      fte: d.saved_fte,
    }));
  if (!rows.length) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Появится, когда у процессов будут объёмы и длительность шагов — их можно уточнить в редакторе процессов
      </p>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, rows.length * 34)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} horizontal={false} />
        <XAxis type="number" stroke={chart.axis} fontSize={11} tickFormatter={(v) => formatNumber(v, 0)} />
        <YAxis type="category" dataKey="name" stroke={chart.axis} fontSize={11} width={170} />
        <Tooltip
          cursor={{ fill: chart.cursor }}
          content={
            <ChartTooltip
              formatter={(value, name, item) => {
                const row = item?.payload || {};
                const extra = [row.fte != null && `${formatNumber(row.fte, 1)} FTE`, row.money != null && `${formatMoney(row.money, currency)}/год`]
                  .filter(Boolean)
                  .join(" · ");
                return `${formatNumber(value, 0)} ч/мес${extra ? ` (${extra})` : ""}`;
              }}
              labelFormatter={(l, p) => p?.[0]?.payload?.fullName || l}
            />
          }
        />
        <Bar dataKey="hours" name="Высвобождается" fill="#10b981" radius={[0, 4, 4, 0]} barSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function PortfolioExportButton() {
  const [busy, setBusy] = useState(false);
  const exportPortfolio = async () => {
    setBusy(true);
    try {
      const name = await downloadFile("/dashboard/export/xlsx", "portfolio.xlsx");
      toast.success(`Выгрузка скачана: ${name}`);
    } catch (err) {
      toast.error(errorMessage(err, "Не удалось выгрузить портфель"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="outline" onClick={exportPortfolio} disabled={busy} data-testid="portfolio-export-btn">
      {busy ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} Excel
    </Button>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi("/dashboard");

  const anyRunning = data?.status_counts?.in_progress > 0;
  useEffect(() => {
    if (!anyRunning) return undefined;
    const timer = setInterval(() => reload({ silent: true }), 10000);
    return () => clearInterval(timer);
  }, [anyRunning, reload]);

  if (loading) return <LoadingState className="h-[70vh]" />;
  if (error) {
    return (
      <div className="p-6 md:p-8">
        <ErrorState message={error} onRetry={reload} />
      </div>
    );
  }

  const divisions = data.divisions || [];
  const hasAnalytics = (data.top_processes || []).length > 0;
  const economics = data.economics || {};
  const currency = economics.currency || "₸";
  const statusCounts = Object.fromEntries((data.initiatives_by_status || []).map((item) => [item.status, item.count]));
  const createButton = (
    <Button onClick={() => navigate("/divisions?create=1")} data-testid="create-division-from-dashboard-btn">
      <Plus /> Новое подразделение
    </Button>
  );

  return (
    <div className="space-y-6 p-6 md:p-8" data-testid="dashboard-page">
      <PageHeader
        title="Дашборд"
        description="Портфельный обзор анализа и потенциала автоматизации"
        actions={
          <>
            {hasAnalytics && <PortfolioExportButton />}
            {createButton}
          </>
        }
      />

      {divisions.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Пока нет подразделений"
          description="Создайте подразделение, заполните анкету и загрузите документы — после анализа здесь появится аналитика по всему портфелю."
          action={createButton}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard icon={Building2} label="Подразделения" value={data.total_divisions} hint={`${data.analyzed_divisions} проанализировано`} />
            <StatCard icon={GitBranch} label="Процессы" value={data.total_processes} hint={`n8n workflows: ${data.total_workflows || 0}`} accent="text-blue-500" />
            <StatCard icon={Gauge} label="Потенциал" value={data.avg_automation_potential != null ? `${data.avg_automation_potential}%` : "—"} hint="средний индекс" accent="text-amber-500" />
            <StatCard
              icon={Lightbulb}
              label="Рекомендации"
              value={data.total_recommendations}
              hint={`в работе ${statusCounts.in_progress || 0} · внедрено ${statusCounts.done || 0}`}
              accent="text-emerald-500"
            />
            <StatCard
              icon={Clock}
              label="Высвобождается"
              value={economics.saved_hours_month != null ? `${formatNumber(economics.saved_hours_month, 0)} ч/мес` : "—"}
              hint={economics.saved_fte != null ? `≈ ${formatNumber(economics.saved_fte, 1)} FTE по расчёту` : "нет данных об объёмах"}
              accent="text-emerald-500"
            />
            {economics.saved_money_year != null ? (
              <StatCard icon={Wallet} label="Эффект в год" value={formatMoney(economics.saved_money_year, currency)} hint={`при ${formatNumber(economics.hourly_cost, 0)} ${currency}/ч`} accent="text-emerald-500" />
            ) : (
              <StatCard icon={Users} label="Экономия" value={`${formatNumber(data.total_fte_savings)} FTE`} hint="оценка модели" accent="text-emerald-500" />
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <Panel
              className="xl:col-span-8"
              title="Процессы с наибольшим потенциалом автоматизации"
              description="Индекс 0–100%: ручной труд, готовность, фрагментация систем, согласования и пригодность для AI"
              icon={TrendingUp}
            >
              {hasAnalytics ? (
                <TopProcessesChart data={data.top_processes} />
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">Появится после первого завершённого анализа</p>
              )}
            </Panel>
            <Panel className="xl:col-span-4" title="Статус анализа" icon={Gauge}>
              <StatusDonut counts={data.status_counts} />
            </Panel>
          </div>

          {hasAnalytics && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Panel title="Профиль процессов" description="Средние оценки по 6 измерениям (1–10)">
                <ScoresRadar scores={data.avg_scores} />
              </Panel>
              <Panel title="Рекомендации по категориям" description="Количество и оценка экономии FTE">
                <CategoryChart data={data.recommendations_by_category} />
              </Panel>
              <Panel title="Распределение потенциала" description="Сколько процессов в каждом диапазоне">
                <PotentialHistogram data={data.potential_distribution} />
              </Panel>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <Panel className="xl:col-span-8" title="Сравнение подразделений" icon={Building2}>
              <DivisionsComparison divisions={divisions} />
            </Panel>
            <Panel className="xl:col-span-4" title="Быстрые победы" description="Простые рекомендации с высоким приоритетом" icon={Rocket}>
              {(data.quick_wins || []).length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Нет простых рекомендаций</p>
              ) : (
                <ul className="space-y-2">
                  {data.quick_wins.map((win) => (
                    <li key={`${win.division_id}-${win.title}`}>
                      <Link
                        to={`/divisions/${win.division_id}?tab=recommendations`}
                        className="block rounded-lg border border-border p-3 transition-colors hover:border-primary/40 hover:bg-secondary/40"
                      >
                        <p className="text-sm font-medium text-foreground">{win.title}</p>
                        <p className="mt-0.5 flex items-center justify-between text-xs text-muted-foreground">
                          <span className="truncate">{win.division_name}</span>
                          {win.estimated_fte_savings > 0 && <span className="shrink-0 text-emerald-500">−{win.estimated_fte_savings} FTE</span>}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          {hasAnalytics && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
              <Panel
                className="xl:col-span-7"
                title="Высвобождение рабочего времени"
                description="Разница трудозатрат AS-IS и TO-BE, часов в месяц"
                icon={Clock}
              >
                <SavingsByDivision divisions={divisions} currency={currency} />
              </Panel>
              <Panel className="xl:col-span-5" title="Портфель инициатив" description="Статусы рекомендаций по всем подразделениям" icon={ListChecks}>
                <InitiativesPipeline data={data.initiatives_by_status} />
              </Panel>
            </div>
          )}

          <Panel title="Подразделения" icon={Building2} actions={<Button variant="ghost" size="sm" onClick={() => navigate("/divisions")}>Все <ArrowRight /></Button>}>
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-2 py-2 font-medium">Подразделение</th>
                    <th className="px-2 py-2 font-medium">Статус</th>
                    <th className="px-2 py-2 font-medium w-40">Анкета</th>
                    <th className="px-2 py-2 font-medium text-right">Документы</th>
                    <th className="px-2 py-2 font-medium text-right">Процессы</th>
                    <th className="px-2 py-2 font-medium text-right">Высвобождение</th>
                    <th className="px-2 py-2 font-medium w-40">Потенциал</th>
                  </tr>
                </thead>
                <tbody>
                  {divisions.map((division, index) => (
                    <tr
                      key={division.id}
                      onClick={() => navigate(`/divisions/${division.id}`)}
                      className="cursor-pointer border-t border-border transition-colors hover:bg-secondary/40"
                      data-testid={`division-row-${index}`}
                    >
                      <td className="px-2 py-3">
                        <p className="font-medium text-foreground">{division.name}</p>
                        <p className="text-xs text-muted-foreground">{division.head_name || division.owner_name || "—"}</p>
                      </td>
                      <td className="px-2 py-3">
                        <StatusBadge status={division.analysis_status} />
                      </td>
                      <td className="px-2 py-3">
                        <Meter value={division.questionnaire_completion?.percent || 0} label={`${division.questionnaire_completion?.percent || 0}%`} />
                      </td>
                      <td className="px-2 py-3 text-right tabular-nums text-muted-foreground">{division.documents_count}</td>
                      <td className="px-2 py-3 text-right tabular-nums text-foreground">{division.processes_count || 0}</td>
                      <td className="px-2 py-3 text-right tabular-nums text-emerald-500">
                        {division.saved_hours_month ? (
                          <>
                            {formatNumber(division.saved_hours_month, 0)} ч/мес
                            {division.saved_fte != null && <span className="block text-xs text-muted-foreground">{formatNumber(division.saved_fte, 1)} FTE</span>}
                          </>
                        ) : division.fte_savings_total ? (
                          `${formatNumber(division.fte_savings_total)} FTE`
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-2 py-3">
                        {division.avg_automation_potential != null ? (
                          <Meter
                            value={division.avg_automation_potential}
                            color={potentialColor(division.avg_automation_potential)}
                            label={`${division.avg_automation_potential}%`}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
