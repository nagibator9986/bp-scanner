import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  BarChart3,
  Building2,
  ClipboardList,
  FileText,
  GitBranch,
  Lightbulb,
  Loader2,
  Play,
  Workflow,
} from "lucide-react";

import { AnalysisError, AnalysisRunning, AnalysisWarnings } from "@/components/AnalysisProgress";
import { ErrorState, LoadingState, StatusBadge } from "@/components/common";
import { ExportReportButton } from "@/components/ExportReportButton";
import { BpmnTab } from "@/components/tabs/BpmnTab";
import { DocumentsTab } from "@/components/tabs/DocumentsTab";
import { N8nTab } from "@/components/tabs/N8nTab";
import { OverviewTab } from "@/components/tabs/OverviewTab";
import { ProcessesTab } from "@/components/tabs/ProcessesTab";
import { QuestionnaireTab } from "@/components/tabs/QuestionnaireTab";
import { RecommendationsTab } from "@/components/tabs/RecommendationsTab";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useApi } from "@/hooks/useApi";
import api, { errorMessage } from "@/lib/api";

const TABS = [
  { value: "overview", icon: Building2, label: "Обзор" },
  { value: "questionnaire", icon: ClipboardList, label: "Анкета" },
  { value: "documents", icon: FileText, label: "Документы" },
  { value: "processes", icon: GitBranch, label: "Процессы", results: true },
  { value: "bpmn", icon: Workflow, label: "BPMN", results: true },
  { value: "recommendations", icon: Lightbulb, label: "Рекомендации", results: true },
  { value: "n8n", icon: BarChart3, label: "n8n", results: true },
];

const POLL_MS = 2500;

export default function DivisionDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: division, error, loading, reload, setData: setDivision } = useApi(`/divisions/${id}`);
  const [status, setStatus] = useState(null);
  const [starting, setStarting] = useState(false);
  const [resultsVersion, setResultsVersion] = useState(0);
  const pollTimer = useRef(null);
  const statusRef = useRef(null);

  const tab = searchParams.get("tab") || "overview";
  const setTab = (value) => {
    const next = new URLSearchParams(searchParams);
    if (value === "overview") next.delete("tab");
    else next.set("tab", value);
    setSearchParams(next, { replace: true });
  };

  const hasResults = (division?.processes_count || 0) > 0;
  const running = status?.status === "in_progress";

  // Статус анализа: загружается при открытии, затем опрашивается, пока анализ идёт
  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await api.get(`/divisions/${id}/analysis-status`);
      const previous = statusRef.current;
      statusRef.current = data;
      setStatus(data);
      if (previous?.status === "in_progress" && data.status === "completed") {
        toast.success("Анализ завершён");
        setResultsVersion((v) => v + 1);
        reload({ silent: true });
      } else if (previous?.status === "in_progress" && data.status === "error") {
        toast.error("Анализ завершился ошибкой");
        reload({ silent: true });
      }
      return data;
    } catch {
      return null;
    }
  }, [id, reload]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (!running) return undefined;
    let cancelled = false;
    const tick = async () => {
      const data = await fetchStatus();
      if (!cancelled && (!data || data.status === "in_progress")) {
        pollTimer.current = setTimeout(tick, POLL_MS);
      }
    };
    pollTimer.current = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(pollTimer.current);
    };
  }, [running, fetchStatus]);

  const startAnalysis = async () => {
    setStarting(true);
    try {
      await api.post(`/divisions/${id}/analyze`);
      toast.info("Анализ запущен");
      await fetchStatus();
    } catch (err) {
      toast.error(errorMessage(err, "Не удалось запустить анализ"));
    } finally {
      setStarting(false);
    }
  };

  if (loading) return <LoadingState className="h-[70vh]" />;
  if (error || !division) {
    return (
      <div className="space-y-4 p-6 md:p-8">
        <Button variant="ghost" onClick={() => navigate("/divisions")}>
          <ArrowLeft /> К подразделениям
        </Button>
        <ErrorState message={error} onRetry={reload} />
      </div>
    );
  }

  const completion = division.questionnaire_completion || {};
  const hasInput = (completion.done || 0) > 0 || division.documents_count > 0;
  const runDisabledReason = !hasInput ? "Заполните анкету или загрузите документы" : null;
  const currentStatus = status?.status || division.analysis_status;

  const runButton = (
    <Button onClick={startAnalysis} disabled={running || starting || Boolean(runDisabledReason)} data-testid="start-analysis-btn">
      {running || starting ? <Loader2 className="animate-spin" /> : <Play />}
      {running ? "Анализ идёт…" : hasResults ? "Перезапустить анализ" : "Запустить анализ"}
    </Button>
  );

  return (
    <div className="space-y-5 p-6 md:p-8" data-testid="division-detail-page">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/divisions")} aria-label="Назад" data-testid="back-btn">
            <ArrowLeft />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="truncate text-2xl font-bold tracking-tight text-foreground">{division.name}</h1>
              <StatusBadge status={currentStatus} />
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {[division.head_name && `Руководитель: ${division.head_name}`, division.access !== "owner" && division.owner_name && `Владелец: ${division.owner_name}`]
                .filter(Boolean)
                .join(" · ") || division.description || "Описание не указано"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 pl-12 lg:pl-0">
          {hasResults && <ExportReportButton divisionId={id} />}
          {runDisabledReason ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>{runButton}</span>
              </TooltipTrigger>
              <TooltipContent>{runDisabledReason}</TooltipContent>
            </Tooltip>
          ) : (
            runButton
          )}
        </div>
      </div>

      {running && <AnalysisRunning status={status} />}
      {!running && currentStatus === "error" && status && (
        <AnalysisError status={status} onRetry={startAnalysis} canRun={!runDisabledReason} />
      )}
      {!running && currentStatus === "completed" && <AnalysisWarnings warnings={status?.warnings} />}

      <Tabs value={tab} onValueChange={setTab} className="space-y-5">
        <TabsList className="h-auto flex-wrap justify-start gap-1 bg-secondary/50 p-1" data-testid="division-tabs">
          {TABS.map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              disabled={item.results && !hasResults}
              className="gap-2 px-3 py-2 data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm"
              data-testid={`tab-${item.value}`}
            >
              <item.icon className="h-4 w-4" strokeWidth={1.6} />
              <span className="hidden sm:inline">{item.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab key={`overview-${resultsVersion}`} division={division} status={status} onNavigate={setTab} />
        </TabsContent>
        <TabsContent value="questionnaire">
          <QuestionnaireTab divisionId={id} onSaved={(completionInfo) => setDivision((prev) => ({ ...prev, questionnaire_completion: completionInfo }))} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsTab divisionId={id} onChange={(count) => setDivision((prev) => ({ ...prev, documents_count: count }))} />
        </TabsContent>
        <TabsContent value="processes">
          <ProcessesTab key={`processes-${resultsVersion}`} divisionId={id} />
        </TabsContent>
        <TabsContent value="bpmn">
          <BpmnTab key={`bpmn-${resultsVersion}`} divisionId={id} />
        </TabsContent>
        <TabsContent value="recommendations">
          <RecommendationsTab key={`recs-${resultsVersion}`} divisionId={id} />
        </TabsContent>
        <TabsContent value="n8n">
          <N8nTab key={`n8n-${resultsVersion}`} divisionId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
