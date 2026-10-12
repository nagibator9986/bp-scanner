import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Play, Loader2, Building2, FileText, ClipboardList, GitBranch, BarChart3, Lightbulb, Workflow, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { QuestionnaireTab } from "@/components/tabs/QuestionnaireTab";
import { DocumentsTab } from "@/components/tabs/DocumentsTab";
import { ProcessesTab } from "@/components/tabs/ProcessesTab";
import { BpmnTab } from "@/components/tabs/BpmnTab";
import { RecommendationsTab } from "@/components/tabs/RecommendationsTab";
import { N8nTab } from "@/components/tabs/N8nTab";
import { ExportReportButton } from "@/components/ExportReportButton";

const STATUS_CONFIG = {
  not_started: { label: "Не начат", color: "bg-slate-600", text: "text-slate-400" },
  in_progress: { label: "Анализ...", color: "bg-amber-500", text: "text-amber-400" },
  extracting_processes: { label: "Извлечение процессов", color: "bg-amber-500", text: "text-amber-400" },
  generating_bpmn: { label: "Генерация BPMN", color: "bg-amber-500", text: "text-amber-400" },
  scoring: { label: "Скоринг процессов", color: "bg-amber-500", text: "text-amber-400" },
  generating_recommendations: { label: "Рекомендации", color: "bg-amber-500", text: "text-amber-400" },
  generating_tobe: { label: "Генерация TO-BE", color: "bg-amber-500", text: "text-amber-400" },
  generating_n8n: { label: "Генерация N8N", color: "bg-amber-500", text: "text-amber-400" },
  completed: { label: "Завершён", color: "bg-emerald-500", text: "text-emerald-400" },
  error: { label: "Ошибка", color: "bg-red-500", text: "text-red-400" },
};

export default function DivisionDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [division, setDivision] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [tab, setTab] = useState("overview");

  const loadDivision = useCallback(() => {
    api.get(`/divisions/${id}`).then((r) => setDivision(r.data)).catch(() => navigate("/divisions")).finally(() => setLoading(false));
  }, [id, navigate]);

  useEffect(() => { loadDivision(); }, [loadDivision]);

  useEffect(() => {
    if (!division) return;
    const inProgress = ["in_progress", "extracting_processes", "generating_bpmn", "scoring", "generating_recommendations", "generating_tobe", "generating_n8n"];
    if (!inProgress.includes(division.analysis_status)) {
      setAnalyzing(false);
      return;
    }
    setAnalyzing(true);
    const interval = setInterval(async () => {
      try {
        const { data } = await api.get(`/divisions/${id}/analysis-status`);
        setDivision((prev) => prev ? { 
          ...prev, 
          analysis_status: data.status, 
          analysis_progress: data.progress, 
          analysis_error: data.error,
          analysis_current_step: data.current_step,
          analysis_failed_step: data.failed_step
        } : prev);
        if (data.status === "completed") {
          toast.success("Анализ завершён успешно!");
          setAnalyzing(false);
          loadDivision();
          clearInterval(interval);
        } else if (data.status === "error") {
          toast.error("Ошибка анализа");
          setAnalyzing(false);
          clearInterval(interval);
        }
      } catch (e) { console.error(e); }
    }, 2000);
    return () => clearInterval(interval);
  }, [division?.analysis_status, id, loadDivision]);

  const startAnalysis = async () => {
    try {
      setAnalyzing(true);
      await api.post(`/divisions/${id}/analyze`);
      toast.info("Анализ запущен. Это может занять 2-3 минуты.");
      setDivision((prev) => prev ? { ...prev, analysis_status: "in_progress", analysis_progress: 5 } : prev);
    } catch (err) {
      toast.error("Ошибка запуска анализа");
      setAnalyzing(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 text-blue-500 animate-spin" /></div>;
  }

  if (!division) return null;
  const st = STATUS_CONFIG[division.analysis_status] || STATUS_CONFIG.not_started;
  const isCompleted = division.analysis_status === "completed";

  const tabs = [
    { value: "overview", icon: Building2, label: "Обзор" },
    { value: "questionnaire", icon: ClipboardList, label: "Анкета" },
    { value: "documents", icon: FileText, label: "Документы" },
    { value: "processes", icon: GitBranch, label: "Процессы", disabled: !isCompleted },
    { value: "bpmn", icon: Workflow, label: "BPMN", disabled: !isCompleted },
    { value: "recommendations", icon: Lightbulb, label: "Рекомендации", disabled: !isCompleted },
    { value: "n8n", icon: BarChart3, label: "N8N", disabled: !isCompleted },
  ];

  return (
    <div className="p-6 md:p-8 lg:p-10 space-y-6" data-testid="division-detail-page">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/divisions")} className="text-slate-400 hover:text-white" data-testid="back-btn">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white tracking-tight">{division.name}</h1>
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${st.color}`} />
              <span className={`text-xs font-medium ${st.text}`}>{st.label}</span>
            </div>
          </div>
          {division.description && <p className="text-sm text-slate-400 mt-0.5">{division.description}</p>}
        </div>
        <div className="flex items-center gap-3">
          {division.analysis_status === "completed" && (
            <ExportReportButton divisionId={id} divisionName={division.name} />
          )}
          <Button
            data-testid="start-analysis-btn"
            onClick={startAnalysis}
            disabled={analyzing}
            className="bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_15px_rgba(59,130,246,0.4)] disabled:opacity-50"
          >
            {analyzing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            {analyzing ? "Анализ..." : "Запустить анализ"}
          </Button>
        </div>
      </div>

      {analyzing && (
        <div className="glass-card rounded-xl p-5 animate-pulse-glow" data-testid="analysis-progress">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
              <span className="text-sm font-medium text-blue-400">{st.label}</span>
            </div>
            <span className="text-sm text-slate-400">{division.analysis_progress || 0}%</span>
          </div>
          <Progress value={division.analysis_progress || 0} className="h-2 bg-slate-800 [&>div]:bg-blue-500" />
          <div className="mt-3 space-y-1">
            {division.analysis_current_step && (
              <p className="text-xs text-slate-300">{division.analysis_current_step}</p>
            )}
            <p className="text-xs text-slate-500">AI анализирует данные подразделения. Обычно это занимает 2-3 минуты.</p>
          </div>
        </div>
      )}

      {division.analysis_status === "error" && (
        <div className="glass-card rounded-xl p-5 border border-red-500/30" data-testid="analysis-error">
          <div className="flex items-center gap-2 text-red-400 mb-3">
            <AlertCircle className="w-5 h-5" />
            <span className="font-medium">Ошибка анализа</span>
          </div>
          <div className="space-y-2">
            {division.analysis_failed_step && (
              <p className="text-sm text-slate-300">
                <span className="text-slate-500">Этап:</span> {division.analysis_failed_step}
              </p>
            )}
            <p className="text-sm text-slate-400 bg-slate-900/50 rounded p-3 font-mono text-xs">
              {division.analysis_error || "Произошла неизвестная ошибка"}
            </p>
            <p className="text-xs text-slate-500 mt-2">
              Попробуйте запустить анализ повторно. Если ошибка повторяется, проверьте данные анкеты.
            </p>
          </div>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="bg-slate-900/60 border border-slate-800 p-1 h-auto flex-wrap" data-testid="division-tabs">
          {tabs.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              disabled={t.disabled}
              className="data-[state=active]:bg-blue-600/15 data-[state=active]:text-blue-400 data-[state=active]:border data-[state=active]:border-blue-500/20 text-slate-400 disabled:opacity-30 gap-2 text-sm px-4 py-2"
              data-testid={`tab-${t.value}`}
            >
              <t.icon className="w-4 h-4" strokeWidth={1.5} />
              <span className="hidden sm:inline">{t.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="glass-card rounded-xl p-5">
              <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">Руководитель</p>
              <p className="text-white font-medium">{division.head_name || "Не указан"}</p>
            </div>
            <div className="glass-card rounded-xl p-5">
              <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">Сотрудники</p>
              <p className="text-white font-medium text-2xl">{division.employees_count || 0}</p>
            </div>
            <div className="glass-card rounded-xl p-5">
              <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">Создано</p>
              <p className="text-white font-medium">{new Date(division.created_at).toLocaleDateString("ru-RU")}</p>
            </div>
          </div>
          {isCompleted && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div className="glass-card rounded-xl p-5">
                <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-1">Выявлено процессов</p>
                <p className="text-3xl font-bold text-blue-400">{division.processes_count || 0}</p>
              </div>
              <div className="glass-card rounded-xl p-5">
                <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-1">Рекомендаций</p>
                <p className="text-3xl font-bold text-emerald-400">{division.recommendations_count || 0}</p>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="questionnaire">
          <QuestionnaireTab divisionId={id} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsTab divisionId={id} />
        </TabsContent>
        <TabsContent value="processes">
          <ProcessesTab divisionId={id} />
        </TabsContent>
        <TabsContent value="bpmn">
          <BpmnTab divisionId={id} />
        </TabsContent>
        <TabsContent value="recommendations">
          <RecommendationsTab divisionId={id} />
        </TabsContent>
        <TabsContent value="n8n">
          <N8nTab divisionId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
