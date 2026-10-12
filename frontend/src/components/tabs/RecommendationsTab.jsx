import { useMemo, useState } from "react";
import { CalendarClock, Columns3, Filter, LayoutGrid, Layers, Lightbulb, Search, Settings2, Target, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { ChartTooltip, EmptyState, ErrorState, LoadingState, Panel, StatCard } from "@/components/common";
import { InitiativeBoard, InitiativeDialog, InitiativeMeta, StatusSelect } from "@/components/Initiatives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApi } from "@/hooks/useApi";
import { useChartTheme } from "@/hooks/useChartTheme";
import api, { errorMessage } from "@/lib/api";
import { CATEGORIES, COMPLEXITY, INITIATIVE_STATUSES } from "@/lib/constants";
import { formatNumber, truncate } from "@/lib/format";
import { cn } from "@/lib/utils";

const SORTS = {
  priority: { label: "По приоритету", fn: (a, b) => (a.priority || 5) - (b.priority || 5) },
  fte: { label: "По экономии FTE", fn: (a, b) => (b.estimated_fte_savings || 0) - (a.estimated_fte_savings || 0) },
  complexity: { label: "Сначала простые", fn: (a, b) => (COMPLEXITY[a.complexity]?.value || 2) - (COMPLEXITY[b.complexity]?.value || 2) },
  weeks: { label: "Сначала быстрые", fn: (a, b) => (a.implementation_weeks || 99) - (b.implementation_weeks || 99) },
};

function RecommendationCard({ rec, index, onStatusChange, onOpen }) {
  const category = CATEGORIES[rec.category] || CATEGORIES.simple_automation;
  const complexity = COMPLEXITY[rec.complexity] || COMPLEXITY.medium;
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card/70" data-testid={`rec-card-${index}`}>
      <div className="h-1" style={{ background: category.color }} />
      <div className="flex flex-1 flex-col p-5">
        <div className="mb-3 flex items-start justify-between gap-2">
          <Badge variant="outline" className={cn("gap-1", category.text, category.border, category.bg)}>
            <category.icon className="h-3 w-3" /> {category.label}
          </Badge>
          <div className="flex shrink-0 items-center gap-2 text-xs">
            <span className="rounded bg-secondary px-1.5 py-0.5 font-semibold text-foreground" title="Приоритет: 1 — наивысший">
              P{rec.priority || "–"}
            </span>
            <span className={complexity.text}>{complexity.label}</span>
          </div>
        </div>
        <h3 className="text-sm font-semibold text-foreground">{rec.title}</h3>
        {rec.description && <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{rec.description}</p>}
        {rec.effect && (
          <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-emerald-500">Эффект</p>
            <p className="mt-0.5 text-xs text-foreground">{rec.effect}</p>
          </div>
        )}
        {rec.kpi && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Target className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {rec.kpi}
          </p>
        )}
        <div className="mt-auto pt-3">
          {rec.related_processes?.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {rec.related_processes.map((process) => (
                <Badge key={process} variant="outline" className="text-muted-foreground">
                  {process}
                </Badge>
              ))}
            </div>
          )}
          <InitiativeMeta rec={rec} />
          <div className="mt-2 flex items-center justify-between gap-2">
            <StatusSelect value={rec.status} onChange={(value) => onStatusChange(rec, value)} />
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onOpen(rec)} data-testid={`open-initiative-${index}`}>
              <Settings2 /> Управление
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-xs">
            {rec.implementation_stack ? <span className="font-mono text-muted-foreground">{rec.implementation_stack}</span> : <span />}
            <div className="flex items-center gap-3">
              {rec.implementation_weeks && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <CalendarClock className="h-3.5 w-3.5" /> {rec.implementation_weeks} нед.
                </span>
              )}
              {rec.estimated_fte_savings > 0 && (
                <span className="flex items-center gap-1 font-medium text-emerald-500">
                  <TrendingUp className="h-3.5 w-3.5" /> −{formatNumber(rec.estimated_fte_savings, 2)} FTE
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImpactMatrix({ recommendations }) {
  const chart = useChartTheme();
  // Небольшой разброс по X, чтобы точки одной сложности не сливались
  const data = recommendations.map((rec, index) => ({
    x: (COMPLEXITY[rec.complexity]?.value || 2) + ((index % 5) - 2) * 0.07,
    y: rec.estimated_fte_savings || 0,
    z: 6 - (rec.priority || 3),
    title: rec.title,
    fill: CATEGORIES[rec.category]?.color || "#64748b",
  }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ScatterChart margin={{ top: 10, right: 16, bottom: 14, left: -12 }}>
        <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="x"
          domain={[0.5, 3.5]}
          ticks={[1, 2, 3]}
          tickFormatter={(v) => ({ 1: "Низкая", 2: "Средняя", 3: "Высокая" })[v]}
          stroke={chart.axis}
          fontSize={11}
          label={{ value: "Сложность внедрения", position: "insideBottom", offset: -8, fill: chart.axis, fontSize: 11 }}
        />
        <YAxis type="number" dataKey="y" stroke={chart.axis} fontSize={11} label={{ value: "FTE", angle: -90, position: "insideLeft", offset: 24, fill: chart.axis, fontSize: 11 }} />
        <ZAxis type="number" dataKey="z" range={[60, 360]} />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <div className="max-w-xs rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-xl">
                <p className="font-medium text-foreground">{payload[0].payload.title}</p>
                <p className="text-muted-foreground">Экономия: {formatNumber(payload[0].payload.y, 2)} FTE</p>
              </div>
            ) : null
          }
        />
        <Scatter data={data} fillOpacity={0.85}>
          {data.map((point) => (
            <Cell key={point.title} fill={point.fill} />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function Roadmap({ recommendations }) {
  const chart = useChartTheme();
  const data = [...recommendations]
    .filter((rec) => rec.implementation_weeks)
    .sort(SORTS.priority.fn)
    .slice(0, 12)
    .map((rec) => ({
      name: truncate(rec.title, 32),
      title: rec.title,
      weeks: rec.implementation_weeks,
      color: CATEGORIES[rec.category]?.color || "#64748b",
    }));
  if (!data.length) return <p className="py-10 text-center text-sm text-muted-foreground">Модель не указала сроки внедрения</p>;
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 28)}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
        <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" stroke={chart.axis} fontSize={11} tickFormatter={(v) => `${v} нед`} />
        <YAxis type="category" dataKey="name" stroke={chart.axis} fontSize={11} width={200} />
        <Tooltip
          cursor={{ fill: chart.cursor }}
          content={<ChartTooltip formatter={(v) => `${v} нед.`} labelFormatter={(l, p) => p?.[0]?.payload?.title || l} />}
        />
        <Bar dataKey="weeks" name="Срок" radius={[0, 4, 4, 0]} barSize={14}>
          {data.map((row) => (
            <Cell key={row.title} fill={row.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export const RecommendationsTab = ({ divisionId }) => {
  const { data, error, loading, reload, setData } = useApi(`/divisions/${divisionId}/recommendations`, { initial: [] });
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [view, setView] = useState("cards");
  const [opened, setOpened] = useState(null);
  const [complexity, setComplexity] = useState("all");
  const [sort, setSort] = useState("priority");
  const [query, setQuery] = useState("");

  const recommendations = useMemo(() => data || [], [data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recommendations
      .filter((rec) => category === "all" || rec.category === category)
      .filter((rec) => status === "all" || (rec.status || "new") === status)
      .filter((rec) => complexity === "all" || rec.complexity === complexity)
      .filter((rec) => !q || `${rec.title} ${rec.description} ${(rec.related_processes || []).join(" ")}`.toLowerCase().includes(q))
      .sort(SORTS[sort].fn);
  }, [recommendations, category, status, complexity, sort, query]);

  const updateInitiative = async (rec, patch) => {
    const previous = data;
    setData((items) => items.map((item) => (item.id === rec.id ? { ...item, ...patch } : item)));
    try {
      const { data: saved } = await api.patch(`/divisions/${divisionId}/recommendations/${rec.id}`, patch);
      setData((items) => items.map((item) => (item.id === rec.id ? saved : item)));
      return true;
    } catch (err) {
      setData(previous);
      toast.error(errorMessage(err, "Не удалось сохранить"));
      return false;
    }
  };
  const changeStatus = (rec, value) => updateInitiative(rec, { status: value });

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!recommendations.length) {
    return <EmptyState icon={Lightbulb} title="Рекомендации не сформированы" description="Запустите анализ, чтобы получить рекомендации по автоматизации" />;
  }

  const totals = Object.fromEntries(
    Object.keys(CATEGORIES).map((key) => {
      const items = recommendations.filter((rec) => rec.category === key);
      return [key, { count: items.length, fte: items.reduce((sum, rec) => sum + (rec.estimated_fte_savings || 0), 0) }];
    })
  );
  const totalFte = recommendations.reduce((sum, rec) => sum + (rec.estimated_fte_savings || 0), 0);
  const committed = recommendations.filter((rec) => ["accepted", "in_progress", "done"].includes(rec.status));
  const committedFte = committed.reduce((sum, rec) => sum + (rec.estimated_fte_savings || 0), 0);

  return (
    <div className="space-y-5" data-testid="recommendations-tab">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Рекомендации по оптимизации</h2>
        <p className="mt-1 text-sm text-muted-foreground">{recommendations.length} инициатив · оценки эффекта и сроков даны моделью и требуют экспертной проверки</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard icon={TrendingUp} label="Экономия всего" value={`${formatNumber(totalFte)} FTE`} accent="text-emerald-500" />
        <StatCard
          icon={Target}
          label="В портфеле"
          value={`${committed.length} из ${recommendations.length}`}
          hint={`${formatNumber(committedFte)} FTE принято или в работе`}
          accent="text-blue-500"
        />
        {Object.entries(CATEGORIES).map(([key, config]) => (
          <StatCard
            key={key}
            icon={config.icon}
            label={config.short}
            value={totals[key].count}
            hint={`${formatNumber(totals[key].fte)} FTE`}
            accent={config.text}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Матрица «сложность — эффект»" description="Цвет — категория, размер — приоритет. Левый верхний угол — быстрые победы" icon={Layers}>
          <ImpactMatrix recommendations={recommendations} />
        </Panel>
        <Panel title="Сроки внедрения" description="Длительность проектов в порядке приоритета" icon={CalendarClock}>
          <Roadmap recommendations={recommendations} />
        </Panel>
      </div>

      <div className="flex flex-col gap-2 lg:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по рекомендациям и процессам…" className="pl-9" />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="lg:w-56" data-testid="category-filter">
            <Filter className="mr-1 h-3.5 w-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все категории ({recommendations.length})</SelectItem>
            {Object.entries(CATEGORIES).map(([key, config]) => (
              <SelectItem key={key} value={key}>
                {config.label} ({totals[key].count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="lg:w-44" data-testid="status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Любой статус</SelectItem>
            {Object.entries(INITIATIVE_STATUSES).map(([key, config]) => (
              <SelectItem key={key} value={key}>
                {config.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={complexity} onValueChange={setComplexity}>
          <SelectTrigger className="lg:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Любая сложность</SelectItem>
            {Object.entries(COMPLEXITY).map(([key, config]) => (
              <SelectItem key={key} value={key}>
                {config.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="lg:w-48" data-testid="sort-btn">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(SORTS).map(([key, config]) => (
              <SelectItem key={key} value={key}>
                {config.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Найдено: {filtered.length}</p>
        <Tabs value={view} onValueChange={setView}>
          <TabsList>
            <TabsTrigger value="cards" className="gap-1.5" data-testid="view-cards">
              <LayoutGrid className="h-3.5 w-3.5" /> Карточки
            </TabsTrigger>
            <TabsTrigger value="board" className="gap-1.5" data-testid="view-board">
              <Columns3 className="h-3.5 w-3.5" /> Канбан
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Search} title="Нет рекомендаций по выбранным условиям" />
      ) : view === "board" ? (
        <InitiativeBoard recommendations={filtered} onStatusChange={changeStatus} onOpen={setOpened} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((rec, index) => (
            <RecommendationCard key={rec.id || rec.title} rec={rec} index={index} onStatusChange={changeStatus} onOpen={setOpened} />
          ))}
        </div>
      )}

      <InitiativeDialog rec={opened} onOpenChange={(open) => !open && setOpened(null)} onSave={updateInitiative} />
    </div>
  );
};
