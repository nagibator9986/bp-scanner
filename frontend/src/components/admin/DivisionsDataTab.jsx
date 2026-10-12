import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, FileText, ClipboardList, Search, Eye, ChevronRight, File, Calendar, User, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

export function DivisionsDataTab() {
  const [divisions, setDivisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedDivision, setSelectedDivision] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [divisionData, setDivisionData] = useState(null);
  const [detailTab, setDetailTab] = useState("questionnaire");

  useEffect(() => {
    loadDivisions();
  }, [statusFilter]);

  const loadDivisions = async () => {
    try {
      setLoading(true);
      const { data } = await api.get("/admin/divisions");
      setDivisions(data);
    } catch (err) {
      toast.error("Ошибка загрузки подразделений");
    } finally {
      setLoading(false);
    }
  };

  const loadDivisionDetails = async (division) => {
    setSelectedDivision(division);
    setDetailsOpen(true);
    setDetailsLoading(true);
    setDetailTab("questionnaire");
    
    try {
      const [questionnaireRes, documentsRes] = await Promise.all([
        api.get(`/admin/divisions/${division.id}/questionnaire`),
        api.get(`/admin/divisions/${division.id}/documents`)
      ]);
      
      setDivisionData({
        questionnaire: questionnaireRes.data,
        documents: documentsRes.data
      });
    } catch (err) {
      toast.error("Ошибка загрузки данных подразделения");
    } finally {
      setDetailsLoading(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "Н/Д";
    return new Date(dateStr).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const questionLabels = {
    dept_function: "Основные функции подразделения",
    employees_roles: "Роли сотрудников",
    top_processes: "Ключевые процессы",
    process_frequency: "Частота выполнения процессов",
    has_approvals: "Требуются согласования",
    systems_list: "Используемые системы",
    manual_operations: "Ручные операции",
    bottlenecks: "Узкие места",
    pain_points: "Проблемные точки",
    org_structure: "Организационная структура",
    it_landscape: "IT ландшафт",
    automation_wishes: "Пожелания по автоматизации"
  };

  const statusConfig = {
    not_started: { label: "Не начат", color: "bg-slate-600" },
    in_progress: { label: "В процессе", color: "bg-amber-500" },
    completed: { label: "Завершён", color: "bg-emerald-500" },
    error: { label: "Ошибка", color: "bg-red-500" }
  };

  const filteredDivisions = divisions.filter(d => {
    const matchesSearch = searchQuery === "" || 
      d.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || d.analysis_status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-4" data-testid="divisions-data-tab">
      {/* Фильтры */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск по названию..."
            className="pl-9 bg-slate-900 border-slate-700"
          />
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px] bg-slate-900 border-slate-700">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="completed">Завершённые</SelectItem>
            <SelectItem value="in_progress">В процессе</SelectItem>
            <SelectItem value="not_started">Не начаты</SelectItem>
            <SelectItem value="error">С ошибками</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Список подразделений */}
      <div className="space-y-3">
        {loading ? (
          <div className="text-center py-8 text-slate-500">Загрузка...</div>
        ) : filteredDivisions.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            {searchQuery ? "Ничего не найдено" : "Подразделения отсутствуют"}
          </div>
        ) : (
          filteredDivisions.map((division) => {
            const status = statusConfig[division.analysis_status] || statusConfig.not_started;
            return (
              <Card 
                key={division.id} 
                className="glass-card border-slate-800 hover:border-slate-700 transition-colors cursor-pointer"
                onClick={() => loadDivisionDetails(division)}
              >
                <CardContent className="py-4 px-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-blue-600/10 flex items-center justify-center">
                        <Building2 className="w-5 h-5 text-blue-400" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-white">{division.name}</h3>
                        <div className="flex items-center gap-3 mt-1">
                          <div className="flex items-center gap-1.5">
                            <div className={`w-2 h-2 rounded-full ${status.color}`} />
                            <span className="text-xs text-slate-400">{status.label}</span>
                          </div>
                          <span className="text-xs text-slate-500">
                            Создано: {formatDate(division.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right text-xs text-slate-500">
                        <div>{division.processes_count || 0} процессов</div>
                        <div>{division.recommendations_count || 0} рекомендаций</div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Модальное окно деталей */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] bg-slate-900 border-slate-800 overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Building2 className="w-5 h-5 text-blue-400" />
              {selectedDivision?.name}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Просмотр анкеты и загруженных документов
            </DialogDescription>
          </DialogHeader>
          
          {detailsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
            </div>
          ) : divisionData && (
            <Tabs value={detailTab} onValueChange={setDetailTab} className="flex-1 overflow-hidden flex flex-col">
              <TabsList className="bg-slate-800 mb-3">
                <TabsTrigger value="questionnaire" className="gap-2">
                  <ClipboardList className="w-4 h-4" />
                  Анкета
                </TabsTrigger>
                <TabsTrigger value="documents" className="gap-2">
                  <FileText className="w-4 h-4" />
                  Документы ({divisionData.documents?.length || 0})
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="questionnaire" className="flex-1 overflow-y-auto mt-0">
                {divisionData.questionnaire?.answers ? (
                  <div className="space-y-4">
                    {Object.entries(divisionData.questionnaire.answers).map(([key, value]) => (
                      <div key={key} className="bg-slate-800/50 rounded-lg p-4">
                        <h4 className="text-sm font-medium text-slate-300 mb-2">
                          {questionLabels[key] || key}
                        </h4>
                        <p className="text-sm text-white whitespace-pre-wrap">
                          {typeof value === 'boolean' ? (value ? 'Да' : 'Нет') : (value || 'Не заполнено')}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    Анкета не заполнена
                  </div>
                )}
              </TabsContent>
              
              <TabsContent value="documents" className="flex-1 overflow-y-auto mt-0">
                {divisionData.documents?.length > 0 ? (
                  <div className="space-y-3">
                    {divisionData.documents.map((doc, i) => (
                      <div key={doc.id || i} className="bg-slate-800/50 rounded-lg p-4 flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center">
                          <File className="w-5 h-5 text-slate-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{doc.filename}</p>
                          <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {formatDate(doc.uploaded_at)}
                            </span>
                            {doc.file_size && (
                              <span>{Math.round(doc.file_size / 1024)} KB</span>
                            )}
                          </div>
                        </div>
                        {doc.extracted_text_preview && (
                          <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-xs">
                            Текст извлечён
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    Документы не загружены
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
