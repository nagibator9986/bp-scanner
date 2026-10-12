import { useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Columns2,
  FileCode2,
  Image,
  Maximize,
  Minimize,
  Minus,
  Plus,
  ScanSearch,
  ShieldAlert,
  Trash2,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";

import { BpmnViewer } from "@/components/BpmnViewer";
import { EmptyState, ErrorState, LoadingState, Panel } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useApi } from "@/hooks/useApi";
import { downloadFile, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

const LEGEND = [
  { label: "Задача сотрудника (значок человека — в системе, руки — вручную)", sample: "h-3.5 w-5 rounded-sm border-2 border-current" },
  { label: "Автоматический шаг (шестерёнка)", sample: "h-3.5 w-5 rounded-sm border-2 border-emerald-500" },
  { label: "Решение: «Да» — дальше, «Нет» — возврат на доработку", sample: "h-3 w-3 rotate-45 border-2 border-amber-500" },
];

function ToolbarButton({ label, onClick, children }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClick} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function DiagramPanel({ model, divisionId, title, badge, height }) {
  const viewer = useRef(null);
  const wrapper = useRef(null);
  const [fullscreen, setFullscreen] = useState(false);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await wrapper.current.requestFullscreen();
        setFullscreen(true);
      } else {
        await document.exitFullscreen();
        setFullscreen(false);
      }
      setTimeout(() => viewer.current?.fit(), 150);
    } catch {
      toast.error("Полноэкранный режим недоступен");
    }
  };

  const downloadSvg = async () => {
    const svg = await viewer.current?.saveSVG();
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(model.process_name || "process").replace(/[^\wа-яё-]+/gi, "_")}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadBpmn = async () => {
    try {
      await downloadFile(`/divisions/${divisionId}/bpmn/${model.id}/download`, "process.bpmn");
    } catch (err) {
      toast.error(errorMessage(err, "Не удалось скачать схему"));
    }
  };

  return (
    <div ref={wrapper} className={cn("overflow-hidden rounded-xl border border-border bg-card/70", fullscreen && "bg-background")}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Workflow className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
          {badge}
        </div>
        <div className="flex items-center">
          <ToolbarButton label="Уменьшить" onClick={() => viewer.current?.zoomOut()}>
            <Minus />
          </ToolbarButton>
          <ToolbarButton label="Увеличить" onClick={() => viewer.current?.zoomIn()}>
            <Plus />
          </ToolbarButton>
          <ToolbarButton label="Вписать в окно" onClick={() => viewer.current?.fit()}>
            <ScanSearch />
          </ToolbarButton>
          <ToolbarButton label={fullscreen ? "Выйти из полноэкранного режима" : "На весь экран"} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize /> : <Maximize />}
          </ToolbarButton>
          <ToolbarButton label="Скачать SVG" onClick={downloadSvg}>
            <Image />
          </ToolbarButton>
          <ToolbarButton label="Скачать .bpmn (Camunda, bpmn.io, ARIS)" onClick={downloadBpmn}>
            <FileCode2 />
          </ToolbarButton>
        </div>
      </div>
      <BpmnViewer ref={viewer} xml={model.xml} height={fullscreen ? window.innerHeight - 52 : height} />
    </div>
  );
}

function ToBeChanges({ tobe }) {
  const metrics = tobe.metrics || {};
  const lists = [
    { key: "improvements", title: "Улучшения", icon: CheckCircle2, tone: "text-emerald-500" },
    { key: "automated_steps", title: "Автоматизируется", icon: Bot, tone: "text-blue-500" },
    { key: "removed_steps", title: "Исключается", icon: Trash2, tone: "text-red-500", strike: true },
    { key: "merged_steps", title: "Объединяется", icon: Columns2, tone: "text-purple-500" },
    { key: "risks", title: "Риски", icon: ShieldAlert, tone: "text-amber-500" },
  ].filter((list) => tobe[list.key]?.length);

  return (
    <Panel title="Что меняется в TO-BE" icon={ArrowRight}>
      {metrics.steps_before != null && (
        <div className="mb-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-secondary/50 p-2">
            <p className="text-lg font-bold text-foreground">
              {metrics.steps_before} → {metrics.steps_after}
            </p>
            <p className="text-[11px] text-muted-foreground">шагов</p>
          </div>
          <div className="rounded-lg bg-secondary/50 p-2">
            <p className="text-lg font-bold text-blue-500">{metrics.automated_count}</p>
            <p className="text-[11px] text-muted-foreground">автоматических</p>
          </div>
          <div className="rounded-lg bg-secondary/50 p-2">
            <p className="text-lg font-bold text-emerald-500">{tobe.time_reduction_percent != null ? `−${tobe.time_reduction_percent}%` : "—"}</p>
            <p className="text-[11px] text-muted-foreground">время процесса</p>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {lists.map((list) => (
          <div key={list.key}>
            <p className={cn("mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider", list.tone)}>
              <list.icon className="h-3.5 w-3.5" /> {list.title}
            </p>
            <ul className="space-y-1 pl-4 text-sm text-foreground">
              {tobe[list.key].map((item) => (
                <li key={item} className={cn("list-disc", list.strike && "text-muted-foreground line-through")}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {tobe.expected_effect && (
        <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
          <p className="text-xs font-medium uppercase tracking-wider text-emerald-500">Ожидаемый эффект</p>
          <p className="mt-1 text-sm text-foreground">{tobe.expected_effect}</p>
        </div>
      )}
    </Panel>
  );
}

export const BpmnTab = ({ divisionId }) => {
  const bpmnApi = useApi(`/divisions/${divisionId}/bpmn`, { initial: [] });
  const processesApi = useApi(`/divisions/${divisionId}/processes`, { initial: [] });
  const tobeApi = useApi(`/divisions/${divisionId}/tobe`, { initial: [] });
  const [processId, setProcessId] = useState(null);
  const [view, setView] = useState("as_is");

  const processes = processesApi.data || [];
  const models = useMemo(() => bpmnApi.data || [], [bpmnApi.data]);
  const current = processes.find((p) => p.id === processId) || processes[0];

  const { asIs, toBe, tobeModel } = useMemo(() => {
    if (!current) return {};
    const match = (model) => model.process_id === current.id || (!model.process_id && model.process_name === current.name);
    const tobeItem = (tobeApi.data || []).find((t) => t.process_id === current.id || t.process_name === current.name);
    return {
      asIs: models.find((m) => m.type === "as_is" && match(m)),
      toBe: models.find((m) => m.type === "to_be" && (match(m) || (tobeItem && m.tobe_id === tobeItem.id))),
      tobeModel: tobeItem,
    };
  }, [current, models, tobeApi.data]);

  if (bpmnApi.loading || processesApi.loading) return <LoadingState />;
  if (bpmnApi.error) return <ErrorState message={bpmnApi.error} onRetry={bpmnApi.reload} />;
  if (!processes.length) {
    return <EmptyState icon={Workflow} title="Схемы не построены" description="Запустите анализ для построения BPMN-моделей" />;
  }

  const hasToBe = Boolean(toBe);
  const effectiveView = !hasToBe && view !== "as_is" ? "as_is" : view;

  return (
    <div className="space-y-5" data-testid="bpmn-tab">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">BPMN-модели процессов</h2>
          <p className="mt-1 text-sm text-muted-foreground">Дорожки по ролям, развилки и циклы доработки. Схемы открываются в Camunda Modeler и bpmn.io.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={current?.id} onValueChange={setProcessId}>
            <SelectTrigger className="w-full sm:w-80" data-testid="bpmn-process-select">
              <SelectValue placeholder="Выберите процесс" />
            </SelectTrigger>
            <SelectContent>
              {processes.map((process) => (
                <SelectItem key={process.id} value={process.id}>
                  {process.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Tabs value={effectiveView} onValueChange={setView}>
            <TabsList>
              <TabsTrigger value="as_is" data-testid="bpmn-asis-toggle">
                AS-IS
              </TabsTrigger>
              <TabsTrigger value="to_be" disabled={!hasToBe} data-testid="bpmn-tobe-toggle">
                TO-BE
              </TabsTrigger>
              <TabsTrigger value="compare" disabled={!hasToBe} data-testid="bpmn-compare-toggle">
                <Columns2 className="mr-1 h-3.5 w-3.5" /> Сравнение
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {effectiveView !== "to_be" &&
        (asIs ? (
          <DiagramPanel
            model={asIs}
            divisionId={divisionId}
            title={current.name}
            badge={<Badge variant="outline">AS-IS</Badge>}
            height={effectiveView === "compare" ? 360 : 480}
          />
        ) : (
          <EmptyState icon={Workflow} title="Для процесса нет AS-IS схемы" />
        ))}
      {effectiveView !== "as_is" && toBe && (
        <DiagramPanel
          model={toBe}
          divisionId={divisionId}
          title={tobeModel?.new_process?.name || current.name}
          badge={<Badge className="border-primary/30 bg-primary/10 text-primary">TO-BE</Badge>}
          height={effectiveView === "compare" ? 360 : 480}
        />
      )}

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
        {LEGEND.map((item) => (
          <span key={item.label} className="flex items-center gap-2">
            <span className={cn("inline-block", item.sample)} /> {item.label}
          </span>
        ))}
      </div>

      {effectiveView !== "as_is" && tobeModel && <ToBeChanges tobe={tobeModel} />}
      {!hasToBe && <p className="text-sm text-muted-foreground">Для этого процесса TO-BE модель не сформирована.</p>}
    </div>
  );
};
