import { useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  Circle,
  ClipboardList,
  Cpu,
  FileText,
  Gauge,
  GitBranch,
  Lightbulb,
  Loader2,
  Timer,
  Users,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartTooltip, Panel, StatCard } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/hooks/useApi";
import { useChartTheme } from "@/hooks/useChartTheme";
import api, { errorMessage } from "@/lib/api";
import { CATEGORIES, potentialColor } from "@/lib/constants";
import { formatDate, formatDateTime, formatDuration, formatNumber, truncate } from "@/lib/format";
import { cn } from "@/lib/utils";

function ChecklistItem({ done, title, hint, action }) {
  return (
    <li className="flex items-start gap-3 py-2">
      {done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground/50" />}
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium", done ? "text-foreground" : "text-muted-foreground")}>{title}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </li>
  );
}

function KnowledgePanel({ divisionId, canEdit }) {
  const { data: items } = useApi("/knowledge", { initial: [] });
  const { data: selection, setData: setSelection } = useApi(`/divisions/${divisionId}/knowledge-selection`);
  const [saving, setSaving] = useState(false);

  const save = async (next) => {
    setSelection(next);
    setSaving(true);
    try {
      await api.post(`/divisions/${divisionId}/knowledge-selection`, {
        use_global: next.use_global,
        selected_ids: next.selected_ids,
      });
    } catch (err) {
      toast.error(errorMessage(err, "Не удалось сохранить выбор"));
    } finally {
      setSaving(false);
    }
  };

  if (!selection) return null;
  const globalItems = (items || []).filter((item) => item.is_global);
  const optionalItems = (items || []).filter((item) => !item.is_global);

  return (
    <Panel
      title="Контекст из базы знаний"
      description="Регламенты и стандарты, которые модель учитывает при анализе"
      icon={BookOpen}
      actions={saving ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
    >
      {(items || []).length === 0 ? (
        <p className="text-sm text-muted-foreground">База знаний пуста — администратор может добавить материалы в админ-панели.</p>
      ) : (
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Общие материалы ({globalItems.length})</p>
              <p className="text-xs text-muted-foreground">{globalItems.map((i) => i.title).join(", ") || "нет"}</p>
            </div>
            <Switch
              checked={selection.use_global}
              disabled={!canEdit}
              onCheckedChange={(value) => save({ ...selection, use_global: value })}
            />
          </label>
          {optionalItems.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Дополнительно</p>
              {optionalItems.map((item) => (
                <label key={item.id} className="flex items-center gap-2 text-sm text-foreground">
                  <Checkbox
                    checked={selection.selected_ids.includes(item.id)}
                    disabled={!canEdit}
                    onCheckedChange={(checked) =>
                      save({
                        ...selection,
                        selected_ids: checked ? [...selection.selected_ids, item.id] : selection.selected_ids.filter((x) => x !== item.id),
                      })
                    }
                  />
                  {item.title}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function ResultsSummary({ divisionId, division }) {
  const chart = useChartTheme();
  const { data: scoring } = useApi(`/divisions/${divisionId}/scoring`, { initial: [] });
  const { data: recommendations } = useApi(`/divisions/${divisionId}/recommendations`, { initial: [] });

  const potentials = (scoring || []).map((s) => ({
    name: truncate(s.process_name, 28),
    fullName: s.process_name,
    value: s.automation_potential,
    color: potentialColor(s.automation_potential),
  }));
  const categories = Object.entries(CATEGORIES)
    .map(([key, config]) => ({
      name: config.label,
      value: (recommendations || []).filter((r) => r.category === key).length,
      color: config.color,
    }))
    .filter((item) => item.value > 0);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={GitBranch} label="Процессы" value={division.processes_count || 0} />
        <StatCard
          icon={Gauge}
          label="Потенциал"
          value={division.avg_automation_potential != null ? `${division.avg_automation_potential}%` : "—"}
          accent="text-amber-500"
        />
        <StatCard icon={Lightbulb} label="Рекомендации" value={division.recommendations_count || 0} accent="text-emerald-500" />
        <StatCard icon={Users} label="Экономия" value={`${formatNumber(division.fte_savings_total || 0)} FTE`} accent="text-emerald-500" />
        <StatCard icon={Workflow} label="n8n" value={division.n8n_workflows_count || 0} accent="text-purple-500" />
        <StatCard
          icon={Timer}
          label="Анализ"
          value={formatDuration(division.analysis_duration_sec)}
          hint={formatDateTime(division.analysis_completed_at)}
          accent="text-muted-foreground"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Panel className="lg:col-span-3" title="Потенциал автоматизации процессов" icon={Gauge}>
          {potentials.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Скоринг недоступен</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, potentials.length * 32)}>
              <BarChart data={potentials} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} horizontal={false} />
                <XAxis type="number" domain={[0, 100]} stroke={chart.axis} fontSize={11} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="name" stroke={chart.axis} fontSize={11} width={190} />
                <Tooltip
                  cursor={{ fill: chart.cursor }}
                  content={<ChartTooltip formatter={(v) => `${v}%`} labelFormatter={(l, p) => p?.[0]?.payload?.fullName || l} />}
                />
                <Bar dataKey="value" name="Потенциал" radius={[0, 4, 4, 0]} barSize={16}>
                  {potentials.map((row) => (
                    <Cell key={row.fullName} fill={row.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
        <Panel className="lg:col-span-2" title="Рекомендации по категориям" icon={Lightbulb}>
          {categories.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Рекомендаций нет</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={categories} dataKey="value" nameKey="name" innerRadius={50} outerRadius={78} paddingAngle={3} stroke="none">
                    {categories.map((item) => (
                      <Cell key={item.name} fill={item.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1">
                {categories.map((item) => (
                  <p key={item.name} className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} /> {item.name}
                    </span>
                    <span className="font-semibold text-foreground">{item.value}</span>
                  </p>
                ))}
              </div>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}

export function OverviewTab({ division, onNavigate }) {
  const { data: llm } = useApi("/settings");
  const completion = division.questionnaire_completion || {};
  const hasResults = (division.processes_count || 0) > 0;
  const canEdit = Boolean(division.access);

  return (
    <div className="space-y-5" data-testid="overview-tab">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Готовность к анализу" icon={ClipboardList} className="lg:col-span-1">
          <ul className="divide-y divide-border">
            <ChecklistItem
              done={(completion.required_percent || 0) >= 100}
              title={`Анкета: ${completion.required_done || 0} из ${completion.required_total || 0} обязательных`}
              hint={`Заполнено ${completion.percent || 0}% вопросов`}
              action={
                <Button size="sm" variant="ghost" onClick={() => onNavigate("questionnaire")}>
                  Открыть
                </Button>
              }
            />
            <ChecklistItem
              done={division.documents_count > 0}
              title={`Документы: ${division.documents_count}`}
              hint="Регламенты, инструкции, шаблоны — повышают точность"
              action={
                <Button size="sm" variant="ghost" onClick={() => onNavigate("documents")}>
                  Загрузить
                </Button>
              }
            />
            <ChecklistItem
              done={Boolean(llm?.configured)}
              title={llm?.configured ? `Модель: ${llm.model_name}` : "AI-модель не настроена"}
              hint={llm?.configured ? "Подключение настроено администратором" : "Обратитесь к администратору платформы"}
            />
          </ul>
        </Panel>

        <Panel title="Подразделение" icon={Cpu} className="lg:col-span-2">
          <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Руководитель</dt>
              <dd className="mt-1 font-medium text-foreground">{division.head_name || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Сотрудников</dt>
              <dd className="mt-1 font-medium text-foreground">{division.employees_count || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Создано</dt>
              <dd className="mt-1 font-medium text-foreground">{formatDate(division.created_at)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Совместный доступ</dt>
              <dd className="mt-1 font-medium text-foreground">
                {(division.shared_users || []).map((u) => u.name || u.email).join(", ") || "—"}
              </dd>
            </div>
          </dl>
          {division.description && <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{division.description}</p>}
          {!hasResults && (
            <div className="mt-4 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              Заполните анкету и загрузите документы, затем нажмите «Запустить анализ». Модель выявит процессы, построит
              BPMN-схемы, оценит потенциал автоматизации и подготовит рекомендации и n8n workflows.
            </div>
          )}
        </Panel>
      </div>

      {hasResults && <ResultsSummary divisionId={division.id} division={division} />}

      <KnowledgePanel divisionId={division.id} canEdit={canEdit} />
    </div>
  );
}
