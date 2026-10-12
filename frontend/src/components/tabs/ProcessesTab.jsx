import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  FileInput,
  FileOutput,
  GitBranch,
  Hand,
  Monitor,
  Pencil,
  Plus,
  Search,
  Split,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  CartesianGrid,
  Cell,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { ConfirmDialog, EmptyState, ErrorState, LoadingState, Meter, Panel } from "@/components/common";
import { ProcessEditorDialog } from "@/components/ProcessEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApi } from "@/hooks/useApi";
import { useChartTheme } from "@/hooks/useChartTheme";
import api, { errorMessage } from "@/lib/api";
import { SCORE_FIELDS, potentialColor, scoreColor } from "@/lib/constants";
import { formatNumber, truncate } from "@/lib/format";
import { cn } from "@/lib/utils";

function Chips({ icon: Icon, label, items, tone = "default" }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <Badge key={item} variant="outline" className={tone === "primary" ? "border-primary/30 text-primary" : "text-muted-foreground"}>
            {item}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function StepsTimeline({ steps }) {
  return (
    <ol className="relative space-y-2 border-l border-border pl-5">
      {steps.map((step, index) => (
        <li key={`${step.name}-${index}`} className="relative">
          <span
            className={cn(
              "absolute -left-[27px] top-1 flex h-4 w-4 items-center justify-center rounded-full border text-[9px] font-semibold",
              step.type === "decision" ? "rotate-45 rounded-sm border-amber-500 bg-amber-500/15 text-amber-500" : "border-primary/40 bg-card text-primary"
            )}
          >
            <span className={step.type === "decision" ? "-rotate-45" : ""}>{index + 1}</span>
          </span>
          <p className="text-sm text-foreground">{step.name}</p>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {step.role && (
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" /> {step.role}
              </span>
            )}
            {step.system && (
              <span className="flex items-center gap-1">
                <Monitor className="h-3 w-3" /> {step.system}
              </span>
            )}
            {step.type === "decision" && (
              <span className="flex items-center gap-1 text-amber-500">
                <Split className="h-3 w-3" /> решение
              </span>
            )}
            {step.manual && step.type !== "decision" && (
              <span className="flex items-center gap-1">
                <Hand className="h-3 w-3" /> вручную
              </span>
            )}
            {step.duration_min ? (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> {formatNumber(step.duration_min)} мин
              </span>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function ProcessCard({ process, score, expanded, selected, onToggle, index, onEdit, onDelete }) {
  const metrics = process.metrics || {};
  const steps = process.steps_detail?.length ? process.steps_detail : (process.steps || []).map((name) => ({ name }));
  return (
    <div
      className={cn("overflow-hidden rounded-xl border bg-card/70 transition-colors", selected ? "border-primary/40" : "border-border")}
      data-testid={`process-card-${index}`}
    >
      <button type="button" className="flex w-full items-center gap-3 p-4 text-left hover:bg-secondary/30" onClick={onToggle}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <GitBranch className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-sm font-medium text-foreground">
            <span className="truncate">{process.name}</span>
            {process.edited && (
              <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] text-primary">
                изменён вручную
              </Badge>
            )}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {[
              `${metrics.steps_count ?? steps.length} шагов`,
              metrics.decisions_count ? `${metrics.decisions_count} решений` : null,
              metrics.roles_count ? `${metrics.roles_count} ролей` : null,
              process.frequency,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {score && (
          <div className="hidden w-32 shrink-0 sm:block">
            <p className="mb-1 text-right text-[10px] uppercase tracking-wider text-muted-foreground">Потенциал</p>
            <Meter value={score.automation_potential} color={potentialColor(score.automation_potential)} label={`${score.automation_potential}%`} />
          </div>
        )}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-border p-4">
          {process.description && <p className="text-sm leading-relaxed text-muted-foreground">{process.description}</p>}
          <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            {[
              ["Владелец", process.owner],
              ["Триггер", process.trigger],
              ["Частота", process.frequency],
              ["SLA", process.sla],
            ]
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs uppercase tracking-wider text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 text-foreground">{value}</dd>
                </div>
              ))}
          </dl>
          {steps.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Шаги процесса</p>
              <StepsTimeline steps={steps} />
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Chips icon={Users} label="Роли" items={process.roles} />
            <Chips icon={Monitor} label="Системы" items={process.systems} tone="primary" />
            <Chips icon={FileInput} label="Входные документы" items={process.input_documents} />
            <Chips icon={FileOutput} label="Выходные документы" items={process.output_documents} />
          </div>
          {(process.pain_points?.length > 0 || score?.bottlenecks?.length > 0) && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-red-500">
                <AlertTriangle className="h-3.5 w-3.5" /> Проблемы и узкие места
              </p>
              <ul className="space-y-1 pl-4 text-sm text-foreground">
                {[...new Set([...(process.pain_points || []), ...(score?.bottlenecks || [])])].map((item) => (
                  <li key={item} className="list-disc">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {score?.rationale && <p className="text-xs italic text-muted-foreground">Обоснование оценки: {score.rationale}</p>}
          <div className="flex gap-2 border-t border-border pt-3">
            <Button size="sm" variant="outline" onClick={() => onEdit(process)} data-testid={`edit-process-${index}`}>
              <Pencil /> Изменить шаги и параметры
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-red-500" onClick={() => onDelete(process)}>
              <Trash2 /> Удалить
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreRadar({ score, average }) {
  const chart = useChartTheme();
  const data = SCORE_FIELDS.map((field) => ({
    label: field.short,
    full: field.label,
    value: score?.[field.key] || 0,
    average: average[field.key] || 0,
  }));
  return (
    <ResponsiveContainer width="100%" height={270}>
      <RadarChart data={data} outerRadius="70%">
        <PolarGrid stroke={chart.grid} />
        <PolarAngleAxis dataKey="label" stroke={chart.axis} fontSize={11} />
        <PolarRadiusAxis domain={[0, 10]} tick={false} axisLine={false} />
        <Radar dataKey="average" name="Среднее" stroke={chart.axis} fill={chart.axis} fillOpacity={0.08} strokeDasharray="4 3" />
        <Radar dataKey="value" name="Процесс" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.25} strokeWidth={2} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Tooltip contentStyle={chart.tooltip} labelFormatter={(label, payload) => payload?.[0]?.payload?.full || label} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

function PriorityMatrix({ scoring, onSelect }) {
  const chart = useChartTheme();
  const data = scoring.map((s) => ({
    x: s.automation_readiness,
    y: s.manual_effort,
    z: s.complexity,
    name: s.process_name,
    potential: s.automation_potential,
    fill: potentialColor(s.automation_potential),
  }));
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ScatterChart margin={{ top: 10, right: 16, bottom: 18, left: -8 }}>
        <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
        <ReferenceArea x1={5.5} x2={10.5} y1={5.5} y2={10.5} fill="#10b981" fillOpacity={0.07} label={{ value: "Автоматизировать в первую очередь", fill: "#10b981", fontSize: 10, position: "insideTopRight" }} />
        <XAxis type="number" dataKey="x" domain={[0.5, 10.5]} ticks={[1, 3, 5, 7, 9]} stroke={chart.axis} fontSize={11} label={{ value: "Готовность к автоматизации", position: "insideBottom", offset: -10, fill: chart.axis, fontSize: 11 }} />
        <YAxis type="number" dataKey="y" domain={[0.5, 10.5]} ticks={[1, 3, 5, 7, 9]} stroke={chart.axis} fontSize={11} label={{ value: "Ручной труд", angle: -90, position: "insideLeft", offset: 20, fill: chart.axis, fontSize: 11 }} />
        <ZAxis type="number" dataKey="z" range={[80, 420]} />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-xl">
                <p className="mb-1 font-medium text-foreground">{payload[0].payload.name}</p>
                <p className="text-muted-foreground">Готовность: {payload[0].payload.x} · Ручной труд: {payload[0].payload.y}</p>
                <p className="text-muted-foreground">Сложность: {payload[0].payload.z} · Потенциал: {payload[0].payload.potential}%</p>
              </div>
            ) : null
          }
        />
        <Scatter data={data} onClick={(point) => onSelect(point?.name)} fillOpacity={0.85} className="cursor-pointer">
          {data.map((point) => (
            <Cell key={point.name} fill={point.fill} />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function ScoreHeatmap({ scoring, onSelect, selectedName }) {
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[640px] text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="px-2 py-2 text-left font-medium">Процесс</th>
            {SCORE_FIELDS.map((field) => (
              <th key={field.key} className="px-1 py-2 text-center font-medium" title={field.label}>
                {field.short}
              </th>
            ))}
            <th className="px-2 py-2 text-right font-medium">Потенциал</th>
          </tr>
        </thead>
        <tbody>
          {scoring.map((score) => (
            <tr
              key={score.id || score.process_name}
              onClick={() => onSelect(score.process_name)}
              className={cn("cursor-pointer border-t border-border hover:bg-secondary/40", selectedName === score.process_name && "bg-primary/5")}
            >
              <td className="max-w-[220px] truncate px-2 py-1.5 text-foreground" title={score.process_name}>
                {score.process_name}
              </td>
              {SCORE_FIELDS.map((field) => (
                <td key={field.key} className="px-1 py-1.5">
                  <div
                    className="mx-auto flex h-7 w-9 items-center justify-center rounded font-semibold text-white"
                    style={{ background: scoreColor(score[field.key]) }}
                    title={`${field.label}: ${score[field.key]}`}
                  >
                    {score[field.key]}
                  </div>
                </td>
              ))}
              <td className="px-2 py-1.5 text-right font-semibold tabular-nums" style={{ color: potentialColor(score.automation_potential) }}>
                {score.automation_potential}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const ProcessesTab = ({ divisionId, onChanged }) => {
  const processesApi = useApi(`/divisions/${divisionId}/processes`, { initial: [] });
  const scoringApi = useApi(`/divisions/${divisionId}/scoring`, { initial: [] });
  const [expanded, setExpanded] = useState(null);
  const [selectedName, setSelectedName] = useState(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null); // null — закрыт, {} — новый процесс, объект — редактирование
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const afterChange = () => {
    processesApi.reload({ silent: true });
    scoringApi.reload({ silent: true });
    onChanged?.();
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await api.delete(`/divisions/${divisionId}/processes/${deleting.id}`);
      toast.success("Процесс удалён");
      setDeleting(null);
      afterChange();
    } catch (err) {
      toast.error(errorMessage(err, "Не удалось удалить процесс"));
    } finally {
      setBusy(false);
    }
  };

  const processes = processesApi.data || [];
  const scoring = useMemo(() => scoringApi.data || [], [scoringApi.data]);
  const scoreByProcess = useMemo(() => {
    const map = {};
    scoring.forEach((s) => {
      map[s.process_id || s.process_name] = s;
      map[s.process_name] = s;
    });
    return map;
  }, [scoring]);
  const average = useMemo(() => {
    const result = {};
    SCORE_FIELDS.forEach((field) => {
      const values = scoring.map((s) => s[field.key]).filter((v) => typeof v === "number");
      result[field.key] = values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : 0;
    });
    return result;
  }, [scoring]);

  if (processesApi.loading || scoringApi.loading) return <LoadingState />;
  if (processesApi.error) return <ErrorState message={processesApi.error} onRetry={processesApi.reload} />;
  if (!processes.length) {
    return <EmptyState icon={GitBranch} title="Процессы не выявлены" description="Запустите анализ, чтобы модель выявила процессы подразделения" />;
  }

  const filtered = processes.filter((p) => !query || p.name.toLowerCase().includes(query.toLowerCase()));
  const selectedScore = scoreByProcess[selectedName] || scoring[0];

  const select = (name) => {
    if (!name) return;
    setSelectedName(name);
    const process = processes.find((p) => p.name === name);
    if (process) setExpanded(process.id);
  };

  return (
    <div className="space-y-5" data-testid="processes-tab">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Реестр процессов</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {processes.length} процессов · нажмите на процесс, точку на матрице или строку тепловой карты
          </p>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1 sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск процесса…" className="pl-9" />
          </div>
          <Button variant="outline" onClick={() => setEditing({})} data-testid="add-process-btn">
            <Plus /> Процесс
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="space-y-3 xl:col-span-7">
          {filtered.map((process, index) => {
            const score = scoreByProcess[process.id] || scoreByProcess[process.name];
            return (
              <ProcessCard
                key={process.id}
                index={index}
                process={process}
                score={score}
                expanded={expanded === process.id}
                selected={selectedScore?.process_name === process.name}
                onToggle={() => {
                  setExpanded(expanded === process.id ? null : process.id);
                  setSelectedName(process.name);
                }}
                onEdit={setEditing}
                onDelete={setDeleting}
              />
            );
          })}
        </div>

        <div className="space-y-4 xl:col-span-5">
          {scoring.length > 0 ? (
            <>
              <Panel title={`Профиль: ${truncate(selectedScore?.process_name, 38)}`} description="Оценки 1–10 в сравнении со средним по подразделению">
                <ScoreRadar score={selectedScore} average={average} />
              </Panel>
              <Panel title="Матрица приоритизации" description="Размер точки — сложность процесса; цвет — потенциал автоматизации">
                <PriorityMatrix scoring={scoring} onSelect={select} />
              </Panel>
            </>
          ) : (
            <Panel title="Скоринг">
              <p className="py-8 text-center text-sm text-muted-foreground">Скоринг недоступен для этого анализа</p>
            </Panel>
          )}
        </div>
      </div>

      {scoring.length > 0 && (
        <Panel title="Тепловая карта скоринга" description="Чем краснее ячейка, тем выше значение показателя">
          <ScoreHeatmap scoring={scoring} onSelect={select} selectedName={selectedScore?.process_name} />
        </Panel>
      )}

      <ProcessEditorDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        divisionId={divisionId}
        process={editing?.id ? editing : null}
        onSaved={afterChange}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Удалить процесс «${deleting?.name}»?`}
        description="Будут удалены его BPMN-схемы, скоринг и TO-BE модель."
        onConfirm={confirmDelete}
        busy={busy}
      />
    </div>
  );
};
