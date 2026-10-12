import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  Cog,
  Copy,
  Download,
  FileArchive,
  GitBranch,
  Info,
  Loader2,
  Play,
  Shuffle,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState, ErrorState, LoadingState, Panel } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useApi } from "@/hooks/useApi";
import api, { downloadFile, errorMessage } from "@/lib/api";
import { COMPLEXITY } from "@/lib/constants";
import { cn } from "@/lib/utils";

const NODE_TYPES = {
  trigger: { label: "Триггер", icon: Play, color: "#10b981" },
  action: { label: "Действие", icon: Cog, color: "#3b82f6" },
  condition: { label: "Условие", icon: GitBranch, color: "#f59e0b" },
  transform: { label: "Обработка", icon: Shuffle, color: "#a855f7" },
  output: { label: "Результат", icon: CheckCircle2, color: "#ec4899" },
};

const NODE_W = 176;
const NODE_H = 66;
const GAP_X = 70;
const GAP_Y = 28;

/** Раскладка графа слева направо: колонка — длина самого длинного пути до ноды. */
function layoutGraph(nodes, connections) {
  const depth = Object.fromEntries(nodes.map((n) => [n.id, 0]));
  for (let i = 0; i < nodes.length; i += 1) {
    let changed = false;
    connections.forEach((c) => {
      const candidate = (depth[c.from] ?? 0) + 1;
      if (candidate < nodes.length && depth[c.to] !== undefined && depth[c.to] < candidate) {
        depth[c.to] = candidate;
        changed = true;
      }
    });
    if (!changed) break;
  }
  const columns = {};
  nodes.forEach((n) => {
    (columns[depth[n.id]] = columns[depth[n.id]] || []).push(n.id);
  });
  const maxRows = Math.max(...Object.values(columns).map((c) => c.length));
  const height = maxRows * NODE_H + (maxRows - 1) * GAP_Y + 40;
  const positions = {};
  Object.entries(columns).forEach(([column, ids]) => {
    const total = ids.length * NODE_H + (ids.length - 1) * GAP_Y;
    ids.forEach((id, row) => {
      positions[id] = { x: 20 + Number(column) * (NODE_W + GAP_X), y: (height - total) / 2 + row * (NODE_H + GAP_Y) };
    });
  });
  const width = 40 + (Math.max(...Object.keys(columns).map(Number)) + 1) * (NODE_W + GAP_X) - GAP_X;
  return { positions, width, height };
}

function WorkflowGraph({ workflow }) {
  const nodes = useMemo(() => workflow.nodes || [], [workflow.nodes]);
  const connections = useMemo(() => workflow.connections || [], [workflow.connections]);
  const { positions, width, height } = useMemo(() => layoutGraph(nodes, connections), [nodes, connections]);
  const branchIndex = {};

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-secondary/20">
      <svg width={width} height={height} className="block" role="img" aria-label={`Схема workflow ${workflow.name}`}>
        <defs>
          <marker id={`arrow-${workflow.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground" />
          </marker>
        </defs>
        {connections.map((connection) => {
          const from = positions[connection.from];
          const to = positions[connection.to];
          if (!from || !to) return null;
          const source = nodes.find((n) => n.id === connection.from);
          const isBranch = (source?.n8n_node || "").toLowerCase() === "if";
          const index = (branchIndex[connection.from] = (branchIndex[connection.from] ?? -1) + 1);
          const x1 = from.x + NODE_W;
          const y1 = from.y + NODE_H / 2;
          const x2 = to.x;
          const y2 = to.y + NODE_H / 2;
          const mid = (x1 + x2) / 2;
          return (
            <g key={`${connection.from}-${connection.to}`}>
              <path
                d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2 - 2} ${y2}`}
                fill="none"
                strokeWidth="1.6"
                className="stroke-muted-foreground/60"
                markerEnd={`url(#arrow-${workflow.id})`}
              />
              {isBranch && (
                <text x={mid} y={(y1 + y2) / 2 - 5} fontSize="10" textAnchor="middle" className={index === 0 ? "fill-emerald-500" : "fill-red-500"}>
                  {index === 0 ? "да" : "нет"}
                </text>
              )}
            </g>
          );
        })}
        {nodes.map((node) => {
          const position = positions[node.id];
          const type = NODE_TYPES[node.type] || NODE_TYPES.action;
          return (
            <foreignObject key={node.id} x={position.x} y={position.y} width={NODE_W} height={NODE_H}>
              <div
                className="flex h-full flex-col justify-center rounded-lg border-l-4 border border-border bg-card px-2.5 py-1.5 shadow-sm"
                style={{ borderLeftColor: type.color }}
                title={node.description || node.name}
              >
                <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: type.color }}>
                  <type.icon className="h-3 w-3" /> {node.n8n_node || type.label}
                </div>
                <p className="line-clamp-2 text-xs font-medium leading-tight text-foreground">{node.name}</p>
              </div>
            </foreignObject>
          );
        })}
      </svg>
    </div>
  );
}

function WorkflowCard({ workflow, index, divisionId, expanded, onToggle }) {
  const [copying, setCopying] = useState(false);
  const complexity = COMPLEXITY[workflow.complexity];

  const exportUrl = `/divisions/${divisionId}/n8n/${workflow.id}/export`;

  const download = async () => {
    try {
      await downloadFile(exportUrl, "workflow.json");
      toast.success("Файл для импорта в n8n скачан");
    } catch (err) {
      toast.error(errorMessage(err, "Ошибка выгрузки"));
    }
  };

  const copy = async () => {
    setCopying(true);
    try {
      const { data } = await api.get(exportUrl);
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      toast.success("JSON скопирован — вставьте его в редактор n8n (Ctrl+V)");
    } catch (err) {
      toast.error(errorMessage(err, "Не удалось скопировать"));
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card/70" data-testid={`n8n-workflow-${index}`}>
      <button type="button" className="flex w-full items-start gap-3 p-4 text-left hover:bg-secondary/30" onClick={onToggle}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Workflow className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{workflow.name}</p>
          {workflow.description && <p className="mt-0.5 text-sm text-muted-foreground">{workflow.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-muted-foreground">
              {workflow.nodes?.length || 0} нод
            </Badge>
            {complexity && (
              <Badge variant="outline" className={complexity.text}>
                сложность: {complexity.label.toLowerCase()}
              </Badge>
            )}
            {(workflow.integration_points || []).map((point) => (
              <Badge key={point} variant="outline" className="border-primary/30 text-primary">
                {point}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {workflow.estimated_time_savings && (
            <span className="hidden items-center gap-1 text-xs font-medium text-emerald-500 md:flex">
              <Clock className="h-3.5 w-3.5" /> {workflow.estimated_time_savings}
            </span>
          )}
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
        </div>
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-border p-4">
          {(workflow.use_case || workflow.related_recommendation) && (
            <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
              {workflow.use_case && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Сценарий</p>
                  <p className="mt-0.5 text-foreground">{workflow.use_case}</p>
                </div>
              )}
              {workflow.related_recommendation && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Рекомендация</p>
                  <p className="mt-0.5 text-foreground">{workflow.related_recommendation}</p>
                </div>
              )}
            </div>
          )}
          <WorkflowGraph workflow={workflow} />
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {(workflow.nodes || [])
              .filter((node) => node.description)
              .map((node) => {
                const type = NODE_TYPES[node.type] || NODE_TYPES.action;
                return (
                  <div key={node.id} className="flex items-start gap-2 text-xs">
                    <type.icon className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: type.color }} />
                    <span>
                      <span className="font-medium text-foreground">{node.name}:</span>{" "}
                      <span className="text-muted-foreground">{node.description}</span>
                    </span>
                  </div>
                );
              })}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={download} data-testid={`download-n8n-${index}`}>
              <Download /> Скачать для импорта в n8n
            </Button>
            <Button size="sm" variant="outline" onClick={copy} disabled={copying} data-testid={`copy-n8n-${index}`}>
              {copying ? <Loader2 className="animate-spin" /> : <Copy />} Копировать JSON
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export const N8nTab = ({ divisionId }) => {
  const { data, error, loading, reload } = useApi(`/divisions/${divisionId}/n8n`, { initial: [] });
  const [expanded, setExpanded] = useState(undefined);
  const [zipping, setZipping] = useState(false);
  const workflows = data || [];
  const openId = expanded === undefined ? workflows[0]?.id : expanded;

  const downloadAll = async () => {
    setZipping(true);
    try {
      await downloadFile(`/divisions/${divisionId}/n8n/export`, "n8n_workflows.zip");
      toast.success(`Скачан архив: ${workflows.length} workflows`);
    } catch (err) {
      toast.error(errorMessage(err, "Ошибка выгрузки"));
    } finally {
      setZipping(false);
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!workflows.length) {
    return <EmptyState icon={Workflow} title="Workflows не сгенерированы" description="Они появятся после анализа, если модель предложит рекомендации по автоматизации" />;
  }

  return (
    <div className="space-y-5" data-testid="n8n-tab">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">n8n workflows</h2>
          <p className="mt-1 text-sm text-muted-foreground">Каркасы автоматизаций, готовые к импорту в n8n</p>
        </div>
        <Button variant="outline" onClick={downloadAll} disabled={zipping} data-testid="download-all-n8n">
          {zipping ? <Loader2 className="animate-spin" /> : <FileArchive />} Скачать все (.zip)
        </Button>
      </div>

      <Panel>
        <div className="flex items-start gap-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            Импорт: в n8n откройте <span className="font-medium text-foreground">Workflows → Import from File</span> и выберите
            скачанный JSON (или вставьте скопированный JSON на холст через Ctrl+V). Затем подключите учётные данные (СЭД, почта,
            Telegram, БД) и уточните параметры нод — описание каждой ноды сохранено в её заметках.
          </p>
        </div>
      </Panel>

      <div className="space-y-3">
        {workflows.map((workflow, index) => (
          <WorkflowCard
            key={workflow.id}
            workflow={workflow}
            index={index}
            divisionId={divisionId}
            expanded={openId === workflow.id}
            onToggle={() => setExpanded(openId === workflow.id ? null : workflow.id)}
          />
        ))}
      </div>
    </div>
  );
};
