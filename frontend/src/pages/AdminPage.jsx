import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, BookOpen, Bot, Building2, Calculator, CheckCircle2, FileCode, FileText, RefreshCw, Users } from "lucide-react";

import { DivisionsDataTab } from "@/components/admin/DivisionsDataTab";
import { ErrorLogsTab } from "@/components/admin/ErrorLogsTab";
import { KnowledgeTab } from "@/components/admin/KnowledgeTab";
import { PromptsTab } from "@/components/admin/PromptsTab";
import { UsersTab } from "@/components/admin/UsersTab";
import { ErrorState, PageHeader, Panel, StatCard } from "@/components/common";
import { EconomicsSettingsForm } from "@/components/EconomicsSettings";
import { LlmSettingsForm } from "@/components/LlmSettings";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApi } from "@/hooks/useApi";
import { cn } from "@/lib/utils";

const TABS = [
  { value: "errors", label: "Ошибки", icon: AlertTriangle },
  { value: "prompts", label: "Промпты", icon: FileCode },
  { value: "knowledge", label: "База знаний", icon: BookOpen },
  { value: "users", label: "Пользователи", icon: Users },
  { value: "divisions", label: "Подразделения", icon: Building2 },
  { value: "llm", label: "AI-модель", icon: Bot },
  { value: "economics", label: "Экономика", icon: Calculator },
];
const DEFAULT_TAB = TABS[0].value;

function KpiRow({ stats, loading, error, onRetry, onSelectTab }) {
  if (loading && !stats) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="admin-kpi-loading">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-[92px] rounded-xl" />
        ))}
      </div>
    );
  }
  if (error && !stats) {
    return <ErrorState className="py-8" message={error} onRetry={onRetry} />;
  }
  if (!stats) return null;

  const unresolved = stats.unresolved_errors || 0;
  const cards = [
    { key: "users", tab: "users", icon: Users, label: "Пользователи", value: stats.users },
    { key: "divisions", tab: "divisions", icon: Building2, label: "Подразделения", value: stats.divisions },
    {
      key: "completed",
      tab: "divisions",
      icon: CheckCircle2,
      label: "Анализов завершено",
      value: stats.completed_analyses,
      accent: "text-emerald-500",
    },
    {
      key: "errors",
      tab: "errors",
      icon: AlertTriangle,
      label: "Нерешённых ошибок",
      value: unresolved,
      accent: unresolved > 0 ? "text-red-500" : "text-emerald-500",
      hint: unresolved > 0 ? "требуют внимания" : "всё в порядке",
    },
    {
      key: "knowledge",
      tab: "knowledge",
      icon: BookOpen,
      label: "База знаний",
      value: stats.knowledge_items,
      hint: "активных материалов",
    },
    { key: "documents", tab: "divisions", icon: FileText, label: "Документы", value: stats.documents, hint: "загружено в подразделения" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {cards.map((card) => (
        <button
          key={card.key}
          type="button"
          onClick={() => onSelectTab(card.tab)}
          className="rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid={`admin-kpi-${card.key}`}
        >
          <StatCard
            icon={card.icon}
            label={card.label}
            value={card.value ?? 0}
            hint={card.hint}
            accent={card.accent}
            className="h-full"
          />
        </button>
      ))}
    </div>
  );
}

export default function AdminPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const tab = TABS.some((t) => t.value === requestedTab) ? requestedTab : DEFAULT_TAB;

  const setTab = useCallback(
    (value) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tab", value);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const { data: stats, error: statsError, loading: statsLoading, reload: reloadStats } = useApi("/admin/stats");
  // Тихое обновление KPI после действий во вкладках (без мигания скелетона)
  const refreshStats = useCallback(() => reloadStats({ silent: true }), [reloadStats]);

  const llmConfigured = stats?.llm_configured;

  return (
    <div className="p-6 md:p-8 lg:p-10 space-y-6" data-testid="admin-page">
      <PageHeader
        title="Панель администратора"
        description="Журнал ошибок, промпты, база знаний, пользователи и подключение AI-модели"
        actions={
          <>
            {stats && (
              <button
                type="button"
                onClick={() => setTab("llm")}
                className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-card/70 px-3 py-1.5 text-sm transition-colors hover:border-primary/40"
                title="Настройки AI-модели"
                data-testid="admin-llm-chip"
              >
                <span className={cn("h-2 w-2 shrink-0 rounded-full", llmConfigured ? "bg-emerald-500" : "bg-amber-500")} />
                <span className="text-muted-foreground">AI-модель:</span>
                <span className="max-w-[220px] truncate font-medium text-foreground">
                  {llmConfigured ? stats.llm_model || "настроена" : "не настроена"}
                </span>
              </button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => reloadStats()}
              disabled={statsLoading}
              data-testid="admin-refresh-stats-btn"
            >
              <RefreshCw className={cn(statsLoading && "animate-spin")} />
              Обновить
            </Button>
          </>
        }
      />

      <KpiRow stats={stats} loading={statsLoading} error={statsError} onRetry={reloadStats} onSelectTab={setTab} />

      {stats && !llmConfigured && (
        <div
          className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between"
          data-testid="llm-not-configured-banner"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div>
              <p className="font-medium text-foreground">AI-модель не настроена</p>
              <p className="text-sm text-muted-foreground">
                Пока не указано подключение к модели, анализ подразделений и тестирование промптов работать не будут.
              </p>
            </div>
          </div>
          {tab !== "llm" && (
            <Button size="sm" onClick={() => setTab("llm")} className="shrink-0" data-testid="configure-llm-btn">
              <Bot /> Настроить модель
            </Button>
          )}
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList
            className="h-auto w-max justify-start gap-1 border border-border bg-secondary/50 p-1 sm:w-auto sm:flex-wrap"
            data-testid="admin-tabs"
          >
            {TABS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value} className="gap-2 px-3 py-1.5" data-testid={`admin-tab-${value}`}>
                <Icon className="h-4 w-4" strokeWidth={1.75} />
                {label}
                {value === "errors" && stats?.unresolved_errors > 0 && (
                  <span className="rounded-full bg-red-500/15 px-1.5 text-[10px] font-semibold tabular-nums text-red-500">
                    {stats.unresolved_errors}
                  </span>
                )}
                {value === "llm" && stats && !llmConfigured && (
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-label="не настроена" />
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="errors" className="mt-0">
          <ErrorLogsTab onChanged={refreshStats} />
        </TabsContent>
        <TabsContent value="prompts" className="mt-0">
          <PromptsTab />
        </TabsContent>
        <TabsContent value="knowledge" className="mt-0">
          <KnowledgeTab onChanged={refreshStats} />
        </TabsContent>
        <TabsContent value="users" className="mt-0">
          <UsersTab onChanged={refreshStats} />
        </TabsContent>
        <TabsContent value="divisions" className="mt-0">
          <DivisionsDataTab />
        </TabsContent>
        <TabsContent value="llm" className="mt-0">
          <Panel
            title="Подключение AI-модели"
            icon={Bot}
            description="Модель выполняет все этапы анализа и тестирование промптов. Настройки общие для всех пользователей."
            data-testid="admin-llm-panel"
          >
            <div className="max-w-2xl pt-2">
              <LlmSettingsForm onSaved={refreshStats} />
            </div>
          </Panel>
        </TabsContent>
        <TabsContent value="economics" className="mt-0">
          <Panel title="Параметры расчёта экономического эффекта" icon={Calculator} description="Используются в аналитике, отчётах и выгрузках Excel">
            <div className="max-w-3xl pt-2">
              <EconomicsSettingsForm />
            </div>
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
