import { Calculator, Clock, Coins, Info, TrendingDown, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartTooltip, EmptyState, ErrorState, LoadingState, Meter, Panel, StatCard } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { useApi } from "@/hooks/useApi";
import { useChartTheme } from "@/hooks/useChartTheme";
import { useAuth } from "@/contexts/AuthContext";
import { formatMoney, formatNumber, truncate } from "@/lib/format";

function HoursChart({ rows }) {
  const chart = useChartTheme();
  const data = rows
    .filter((row) => row.hours_per_month != null)
    .map((row) => ({
      name: truncate(row.process_name, 30),
      full: row.process_name,
      asis: row.hours_per_month,
      tobe: row.tobe_hours_per_month,
    }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 46)}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" stroke={chart.axis} fontSize={11} tickFormatter={(v) => `${v} ч`} />
        <YAxis type="category" dataKey="name" stroke={chart.axis} fontSize={11} width={200} />
        <Tooltip
          cursor={{ fill: chart.cursor }}
          content={<ChartTooltip formatter={(v) => (v == null ? "—" : `${formatNumber(v)} ч/мес`)} labelFormatter={(l, p) => p?.[0]?.payload?.full || l} />}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="asis" name="AS-IS" fill="#94a3b8" radius={[0, 4, 4, 0]} barSize={12} />
        <Bar dataKey="tobe" name="TO-BE" fill="#10b981" radius={[0, 4, 4, 0]} barSize={12} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export const EconomicsTab = ({ divisionId, onEditProcesses }) => {
  const { data, error, loading, reload } = useApi(`/divisions/${divisionId}/economics`);
  const { isAdmin } = useAuth();

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const { rows, totals, settings } = data;
  const currency = settings.currency;
  if (!rows.length) return <EmptyState icon={Calculator} title="Нет процессов для расчёта" />;

  return (
    <div className="space-y-5" data-testid="economics-tab">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Экономический эффект</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Трудозатраты по процессам до и после внедрения TO-BE. Расчёт прозрачный: модель оценивает только длительности шагов и объёмы.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          icon={Clock}
          label="Трудозатраты AS-IS"
          value={totals.hours_per_month != null ? `${formatNumber(totals.hours_per_month, 0)} ч/мес` : "—"}
          hint={totals.fte != null ? `≈ ${formatNumber(totals.fte, 1)} FTE` : undefined}
          accent="text-muted-foreground"
        />
        <StatCard
          icon={TrendingDown}
          label="Высвобождается"
          value={totals.saved_hours_month != null ? `${formatNumber(totals.saved_hours_month, 0)} ч/мес` : "—"}
          hint={
            totals.saved_hours_month != null && totals.hours_per_month
              ? `${Math.round((100 * totals.saved_hours_month) / totals.hours_per_month)}% трудозатрат`
              : undefined
          }
          accent="text-emerald-500"
        />
        <StatCard icon={Users} label="FTE" value={totals.saved_fte != null ? formatNumber(totals.saved_fte, 1) : "—"} hint="высвобождаемых сотрудников" accent="text-emerald-500" />
        <StatCard
          icon={Coins}
          label="Экономия в год"
          value={totals.saved_money_year != null ? formatMoney(totals.saved_money_year, currency) : "—"}
          hint={settings.hourly_cost ? `при ${formatNumber(settings.hourly_cost, 0)} ${currency}/час` : isAdmin ? "задайте стоимость часа в админ-панели" : "стоимость часа не задана"}
          accent="text-amber-500"
        />
      </div>

      {totals.processes_with_data < totals.processes_total && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p>
            Данные есть по {totals.processes_with_data} из {totals.processes_total} процессов. Для остальных укажите длительности шагов и
            объём в месяц в{" "}
            <button type="button" className="font-medium text-primary hover:underline" onClick={onEditProcesses}>
              редакторе процессов
            </button>
            .
          </p>
        </div>
      )}

      <Panel title="Трудозатраты по процессам, ч/мес" description="Серым — сейчас, зелёным — после внедрения TO-BE" icon={Clock}>
        {rows.some((row) => row.hours_per_month != null) ? (
          <HoursChart rows={rows} />
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">Недостаточно данных о длительностях шагов и объёмах</p>
        )}
      </Panel>

      <Panel title="Расчёт по процессам" icon={Calculator}>
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-2 py-2 font-medium">Процесс</th>
                <th className="px-2 py-2 text-right font-medium">Экз./мес</th>
                <th className="px-2 py-2 text-right font-medium">Мин./экз.</th>
                <th className="px-2 py-2 text-right font-medium">Ч/мес</th>
                <th className="px-2 py-2 font-medium w-36">Сокращение</th>
                <th className="px-2 py-2 text-right font-medium">Высвоб. ч/мес</th>
                <th className="px-2 py-2 text-right font-medium">FTE</th>
                <th className="px-2 py-2 text-right font-medium">В год</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.process_id} className="border-t border-border">
                  <td className="px-2 py-2.5 text-foreground">{row.process_name}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">
                    {row.volume_per_month != null ? formatNumber(row.volume_per_month, 0) : "—"}
                    {row.volume_source === "frequency" && (
                      <Badge variant="outline" className="ml-1 px-1 py-0 text-[10px]" title="Оценено по частоте выполнения">
                        ≈
                      </Badge>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">
                    {row.minutes_per_case != null ? formatNumber(row.minutes_per_case, 0) : "—"}
                    {row.tobe_minutes_per_case != null && <span className="text-emerald-500"> → {formatNumber(row.tobe_minutes_per_case, 0)}</span>}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-foreground">
                    {row.hours_per_month != null ? formatNumber(row.hours_per_month, 0) : "—"}
                    {row.tobe_hours_per_month != null && <span className="text-emerald-500"> → {formatNumber(row.tobe_hours_per_month, 0)}</span>}
                  </td>
                  <td className="px-2 py-2.5">
                    {row.reduction_percent != null ? (
                      <Meter value={row.reduction_percent} color="#10b981" label={`${row.reduction_percent}%`} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-emerald-500">
                    {row.saved_hours_month != null ? formatNumber(row.saved_hours_month, 0) : "—"}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-foreground">{row.saved_fte != null ? formatNumber(row.saved_fte, 2) : "—"}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-foreground">
                    {row.saved_money_year != null ? formatMoney(row.saved_money_year, currency) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Мин./экз. — сумма длительностей ручных шагов на один экземпляр процесса; ч/мес = мин./экз. × экз./мес / 60; FTE = ч/мес /{" "}
          {formatNumber(settings.fte_hours_month, 0)} рабочих часов. «≈» — объём оценён по частоте выполнения.
        </p>
      </Panel>
    </div>
  );
};
