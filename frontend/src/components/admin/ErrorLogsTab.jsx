import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertTriangle, Check, Trash2, Search, RefreshCw, ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

const STEPS = [
  { value: "all", label: "Все этапы" },
  { value: "extracting_processes", label: "Извлечение процессов" },
  { value: "generating_bpmn", label: "Генерация BPMN" },
  { value: "scoring", label: "Скоринг" },
  { value: "generating_recommendations", label: "Рекомендации" },
  { value: "generating_tobe", label: "TO-BE модели" },
  { value: "generating_n8n", label: "N8N Workflows" },
];

export function ErrorLogsTab() {
  const [errors, setErrors] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [stepFilter, setStepFilter] = useState("all");
  const [resolvedFilter, setResolvedFilter] = useState("unresolved");
  const [selectedError, setSelectedError] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    loadErrors();
    loadStats();
  }, [page, stepFilter, resolvedFilter]);

  const loadErrors = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ page: page.toString(), limit: "20" });
      if (stepFilter !== "all") params.append("step", stepFilter);
      if (resolvedFilter !== "all") params.append("resolved", resolvedFilter === "resolved" ? "true" : "false");
      
      const { data } = await api.get(`/admin/errors?${params}`);
      setErrors(data.errors);
      setTotalPages(data.pages);
    } catch (err) {
      toast.error("Ошибка загрузки логов");
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const { data } = await api.get("/admin/errors/stats");
      setStats(data);
    } catch (err) {
      console.error("Failed to load stats:", err);
    }
  };

  const markResolved = async (errorId, resolved) => {
    try {
      await api.patch(`/admin/errors/${errorId}`, null, { params: { resolved } });
      toast.success(resolved ? "Ошибка помечена как решённая" : "Ошибка возвращена в нерешённые");
      loadErrors();
      loadStats();
    } catch (err) {
      toast.error("Ошибка обновления");
    }
  };

  const deleteError = async (errorId) => {
    if (!confirm("Удалить запись об ошибке?")) return;
    try {
      await api.delete(`/admin/errors/${errorId}`);
      toast.success("Запись удалена");
      loadErrors();
      loadStats();
    } catch (err) {
      toast.error("Ошибка удаления");
    }
  };

  const viewDetails = async (errorId) => {
    try {
      const { data } = await api.get(`/admin/errors/${errorId}`);
      setSelectedError(data);
      setDetailsOpen(true);
    } catch (err) {
      toast.error("Ошибка загрузки деталей");
    }
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  return (
    <div className="space-y-4" data-testid="error-logs-tab">
      {/* Статистика */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="glass-card border-slate-800">
            <CardContent className="pt-4 pb-3">
              <div className="text-2xl font-bold text-white">{stats.total}</div>
              <div className="text-xs text-slate-500">Всего ошибок</div>
            </CardContent>
          </Card>
          <Card className="glass-card border-slate-800">
            <CardContent className="pt-4 pb-3">
              <div className="text-2xl font-bold text-red-400">{stats.unresolved}</div>
              <div className="text-xs text-slate-500">Нерешённых</div>
            </CardContent>
          </Card>
          {stats.by_step?.slice(0, 2).map((s) => (
            <Card key={s._id} className="glass-card border-slate-800">
              <CardContent className="pt-4 pb-3">
                <div className="text-2xl font-bold text-amber-400">{s.count}</div>
                <div className="text-xs text-slate-500 truncate">{s._id}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Фильтры */}
      <div className="flex flex-wrap gap-3 items-center">
        <Select value={stepFilter} onValueChange={(v) => { setStepFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[200px] bg-slate-900 border-slate-700" data-testid="step-filter">
            <SelectValue placeholder="Этап" />
          </SelectTrigger>
          <SelectContent>
            {STEPS.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={resolvedFilter} onValueChange={(v) => { setResolvedFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[160px] bg-slate-900 border-slate-700" data-testid="resolved-filter">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="unresolved">Нерешённые</SelectItem>
            <SelectItem value="resolved">Решённые</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" size="icon" onClick={loadErrors} className="border-slate-700">
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {/* Список ошибок */}
      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-8 text-slate-500">Загрузка...</div>
        ) : errors.length === 0 ? (
          <div className="text-center py-8 text-slate-500">Ошибок не найдено</div>
        ) : (
          errors.map((error) => (
            <Card key={error.id} className={`glass-card border-slate-800 ${error.resolved ? 'opacity-60' : ''}`}>
              <CardContent className="py-3 px-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${error.resolved ? 'text-slate-500' : 'text-red-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">
                        {error.step}
                      </Badge>
                      <span className="text-xs text-slate-500">{formatDate(error.created_at)}</span>
                      {error.resolved && (
                        <Badge className="bg-emerald-500/20 text-emerald-400 text-xs">Решено</Badge>
                      )}
                    </div>
                    <p className="text-sm text-slate-300 line-clamp-2">{error.error_message}</p>
                    {error.error_detail && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-1">{error.error_detail}</p>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => viewDetails(error.id)} className="h-8 w-8">
                      <Eye className="w-4 h-4 text-slate-400" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => markResolved(error.id, !error.resolved)}
                      className="h-8 w-8"
                    >
                      <Check className={`w-4 h-4 ${error.resolved ? 'text-slate-500' : 'text-emerald-400'}`} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteError(error.id)} className="h-8 w-8">
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Пагинация */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="border-slate-700"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm text-slate-400">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="border-slate-700"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Модальное окно деталей */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-2xl bg-slate-900 border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-white">Детали ошибки</DialogTitle>
            <DialogDescription className="text-slate-400">
              {selectedError?.step} • {selectedError && formatDate(selectedError.created_at)}
            </DialogDescription>
          </DialogHeader>
          {selectedError && (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              <div>
                <h4 className="text-sm font-medium text-slate-400 mb-1">Сообщение</h4>
                <p className="text-sm text-white bg-slate-800 p-3 rounded">{selectedError.error_message}</p>
              </div>
              {selectedError.error_detail && (
                <div>
                  <h4 className="text-sm font-medium text-slate-400 mb-1">Детали</h4>
                  <p className="text-xs text-slate-300 bg-slate-800 p-3 rounded font-mono whitespace-pre-wrap">
                    {selectedError.error_detail}
                  </p>
                </div>
              )}
              {selectedError.stack_trace && (
                <div>
                  <h4 className="text-sm font-medium text-slate-400 mb-1">Stack Trace</h4>
                  <pre className="text-xs text-slate-400 bg-slate-950 p-3 rounded overflow-x-auto">
                    {selectedError.stack_trace}
                  </pre>
                </div>
              )}
              {selectedError.input_data_summary && (
                <div>
                  <h4 className="text-sm font-medium text-slate-400 mb-1">Входные данные</h4>
                  <pre className="text-xs text-slate-400 bg-slate-950 p-3 rounded overflow-x-auto">
                    {selectedError.input_data_summary}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
