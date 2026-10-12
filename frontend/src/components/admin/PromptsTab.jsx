import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileCode, Save, RotateCcw, Play, History, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

const STEP_LABELS = {
  extracting_processes: "Извлечение процессов",
  generating_bpmn: "Генерация BPMN",
  scoring: "Скоринг процессов",
  recommendations: "Рекомендации",
  tobe: "TO-BE модели",
  n8n: "N8N Workflows"
};

export function PromptsTab() {
  const [prompts, setPrompts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [editForm, setEditForm] = useState({ system_prompt: "", user_prompt_template: "", description: "" });
  const [testForm, setTestForm] = useState({ test_input: "" });
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPrompts();
  }, []);

  const loadPrompts = async () => {
    try {
      setLoading(true);
      const { data } = await api.get("/admin/prompts");
      setPrompts(data);
    } catch (err) {
      toast.error("Ошибка загрузки промптов");
    } finally {
      setLoading(false);
    }
  };

  const openEdit = (prompt) => {
    setSelectedPrompt(prompt);
    setEditForm({
      system_prompt: prompt.system_prompt,
      user_prompt_template: prompt.user_prompt_template,
      description: prompt.description || ""
    });
    setEditOpen(true);
  };

  const savePrompt = async () => {
    try {
      setSaving(true);
      await api.post("/admin/prompts", {
        step_name: selectedPrompt.step_name,
        system_prompt: editForm.system_prompt,
        user_prompt_template: editForm.user_prompt_template,
        description: editForm.description
      });
      toast.success("Промпт сохранён");
      setEditOpen(false);
      loadPrompts();
    } catch (err) {
      toast.error("Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = async (stepName) => {
    if (!confirm("Сбросить промпт к значениям по умолчанию?")) return;
    try {
      await api.post(`/admin/prompts/${stepName}/reset`);
      toast.success("Промпт сброшен к значениям по умолчанию");
      loadPrompts();
      setEditOpen(false);
    } catch (err) {
      toast.error("Ошибка сброса");
    }
  };

  const loadHistory = async (stepName) => {
    try {
      const { data } = await api.get(`/admin/prompts/${stepName}/history`);
      setHistory(data);
      setHistoryOpen(true);
    } catch (err) {
      toast.error("Ошибка загрузки истории");
    }
  };

  const restoreVersion = async (stepName, version) => {
    if (!confirm(`Восстановить версию ${version}?`)) return;
    try {
      await api.post(`/admin/prompts/${stepName}/restore/${version}`);
      toast.success("Версия восстановлена");
      setHistoryOpen(false);
      loadPrompts();
    } catch (err) {
      toast.error("Ошибка восстановления");
    }
  };

  const testPrompt = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      const { data } = await api.post("/admin/prompts/test", {
        system_prompt: editForm.system_prompt,
        user_prompt: editForm.user_prompt_template,
        test_input: testForm.test_input
      });
      setTestResult(data);
    } catch (err) {
      setTestResult({ success: false, error: "Ошибка тестирования" });
    } finally {
      setTesting(false);
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

  if (loading) {
    return <div className="text-center py-8 text-slate-500">Загрузка...</div>;
  }

  return (
    <div className="space-y-4" data-testid="prompts-tab">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {prompts.map((prompt) => (
          <Card key={prompt.step_name} className="glass-card border-slate-800 hover:border-slate-700 transition-colors">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base text-white flex items-center gap-2">
                    <FileCode className="w-4 h-4 text-blue-400" />
                    {STEP_LABELS[prompt.step_name] || prompt.step_name}
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500 mt-1">
                    {prompt.description || "Нет описания"}
                  </CardDescription>
                </div>
                {prompt.is_default ? (
                  <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">По умолчанию</Badge>
                ) : (
                  <Badge className="text-xs bg-blue-500/20 text-blue-400">v{prompt.version}</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              <p className="text-xs text-slate-400 line-clamp-3 mb-3 font-mono bg-slate-900/50 p-2 rounded">
                {prompt.system_prompt?.substring(0, 150)}...
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1 border-slate-700 text-xs" onClick={() => openEdit(prompt)}>
                  Редактировать
                </Button>
                {!prompt.is_default && (
                  <Button size="sm" variant="ghost" className="text-xs" onClick={() => loadHistory(prompt.step_name)}>
                    <History className="w-3 h-3" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Модальное окно редактирования */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] bg-slate-900 border-slate-800 overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-white">
              Редактирование промпта: {selectedPrompt && (STEP_LABELS[selectedPrompt.step_name] || selectedPrompt.step_name)}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Изменения будут применены к следующим анализам
            </DialogDescription>
          </DialogHeader>
          
          <Tabs defaultValue="edit" className="flex-1 overflow-hidden flex flex-col">
            <TabsList className="bg-slate-800 mb-3">
              <TabsTrigger value="edit">Редактирование</TabsTrigger>
              <TabsTrigger value="test">Тестирование</TabsTrigger>
            </TabsList>
            
            <TabsContent value="edit" className="flex-1 overflow-y-auto space-y-4 mt-0">
              <div>
                <Label className="text-slate-300 text-sm">Описание</Label>
                <Input
                  value={editForm.description}
                  onChange={(e) => setEditForm(f => ({ ...f, description: e.target.value }))}
                  className="bg-slate-800 border-slate-700 text-white mt-1"
                  placeholder="Краткое описание назначения промпта"
                />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">System Prompt</Label>
                <Textarea
                  value={editForm.system_prompt}
                  onChange={(e) => setEditForm(f => ({ ...f, system_prompt: e.target.value }))}
                  className="bg-slate-800 border-slate-700 text-white font-mono text-sm mt-1 min-h-[120px]"
                  placeholder="Системный промпт для AI..."
                />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">User Prompt Template</Label>
                <p className="text-xs text-slate-500 mb-1">
                  Используйте переменные: {"{division_name}"}, {"{questionnaire}"}, {"{documents}"}, {"{knowledge_context}"}, {"{processes}"}, {"{scoring}"}, {"{recommendations}"}
                </p>
                <Textarea
                  value={editForm.user_prompt_template}
                  onChange={(e) => setEditForm(f => ({ ...f, user_prompt_template: e.target.value }))}
                  className="bg-slate-800 border-slate-700 text-white font-mono text-sm mt-1 min-h-[200px]"
                  placeholder="Шаблон пользовательского промпта..."
                />
              </div>
            </TabsContent>
            
            <TabsContent value="test" className="flex-1 overflow-y-auto space-y-4 mt-0">
              <div>
                <Label className="text-slate-300 text-sm">Тестовые данные (необязательно)</Label>
                <Textarea
                  value={testForm.test_input}
                  onChange={(e) => setTestForm(f => ({ ...f, test_input: e.target.value }))}
                  className="bg-slate-800 border-slate-700 text-white font-mono text-sm mt-1 min-h-[100px]"
                  placeholder="Введите тестовые данные для подстановки в промпт..."
                />
              </div>
              <Button onClick={testPrompt} disabled={testing} className="bg-blue-600 hover:bg-blue-500">
                {testing ? "Тестирование..." : "Запустить тест"}
                <Play className="w-4 h-4 ml-2" />
              </Button>
              {testResult && (
                <div className={`p-4 rounded border ${testResult.success ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-red-500/30 bg-red-500/10'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    {testResult.success ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-400" />
                    )}
                    <span className={`text-sm font-medium ${testResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                      {testResult.success ? "Успешно" : "Ошибка"}
                    </span>
                  </div>
                  <pre className="text-xs text-slate-300 whitespace-pre-wrap overflow-x-auto max-h-[300px] overflow-y-auto">
                    {testResult.success ? testResult.response : testResult.error}
                  </pre>
                </div>
              )}
            </TabsContent>
          </Tabs>
          
          <DialogFooter className="flex-shrink-0 gap-2 pt-4 border-t border-slate-800">
            {selectedPrompt && !selectedPrompt.is_default && (
              <Button variant="outline" onClick={() => resetToDefault(selectedPrompt.step_name)} className="border-slate-700 text-slate-400">
                <RotateCcw className="w-4 h-4 mr-2" />
                Сбросить
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditOpen(false)} className="border-slate-700">
              Отмена
            </Button>
            <Button onClick={savePrompt} disabled={saving} className="bg-blue-600 hover:bg-blue-500">
              <Save className="w-4 h-4 mr-2" />
              {saving ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Модальное окно истории */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl bg-slate-900 border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-white">История изменений</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {history.length === 0 ? (
              <p className="text-slate-500 text-center py-4">История пуста</p>
            ) : (
              history.map((item) => (
                <Card key={item.id} className="bg-slate-800 border-slate-700">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center justify-between mb-2">
                      <Badge variant="outline" className="text-xs">Версия {item.version}</Badge>
                      <span className="text-xs text-slate-500">{formatDate(item.created_at)}</span>
                    </div>
                    <p className="text-xs text-slate-400 font-mono line-clamp-2">{item.system_prompt?.substring(0, 100)}...</p>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      className="mt-2 text-xs border-slate-600"
                      onClick={() => restoreVersion(item.step_name, item.version)}
                    >
                      Восстановить
                    </Button>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
