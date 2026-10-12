import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, AlertTriangle, FileCode, BookOpen, Users, BarChart3, Loader2, Building2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { ErrorLogsTab } from "@/components/admin/ErrorLogsTab";
import { PromptsTab } from "@/components/admin/PromptsTab";
import { KnowledgeTab } from "@/components/admin/KnowledgeTab";
import { DivisionsDataTab } from "@/components/admin/DivisionsDataTab";

export default function AdminPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [stats, setStats] = useState(null);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    checkAdminAccess();
  }, []);

  const checkAdminAccess = async () => {
    try {
      const { data } = await api.get("/auth/check-admin");
      if (!data.is_admin) {
        toast.error("Доступ запрещён. Требуются права администратора.");
        navigate("/dashboard");
        return;
      }
      setIsAdmin(true);
      loadStats();
    } catch (err) {
      toast.error("Ошибка проверки доступа");
      navigate("/dashboard");
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const { data } = await api.get("/admin/stats");
      setStats(data);
    } catch (err) {
      console.error("Failed to load stats:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (!isAdmin) return null;

  const tabs = [
    { value: "overview", icon: BarChart3, label: "Обзор" },
    { value: "divisions", icon: Building2, label: "Подразделения", badge: stats?.divisions },
    { value: "errors", icon: AlertTriangle, label: "Ошибки", badge: stats?.unresolved_errors },
    { value: "prompts", icon: FileCode, label: "Промпты" },
    { value: "knowledge", icon: BookOpen, label: "База знаний", badge: stats?.knowledge_items },
  ];

  return (
    <div className="p-6 md:p-8 lg:p-10 space-y-6" data-testid="admin-page">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/dashboard")}
          className="text-slate-400 hover:text-white"
          data-testid="admin-back-btn"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white tracking-tight">Панель администратора</h1>
          <p className="text-sm text-slate-400">Управление системой, промптами и базой знаний</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="bg-slate-900/60 border border-slate-800 p-1 h-auto flex-wrap" data-testid="admin-tabs">
          {tabs.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="data-[state=active]:bg-blue-600/15 data-[state=active]:text-blue-400 data-[state=active]:border data-[state=active]:border-blue-500/20 text-slate-400 gap-2 text-sm px-4 py-2 relative"
              data-testid={`admin-tab-${t.value}`}
            >
              <t.icon className="w-4 h-4" strokeWidth={1.5} />
              <span className="hidden sm:inline">{t.label}</span>
              {t.badge > 0 && (
                <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-xs">
                  {t.badge}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="glass-card border-slate-800">
              <CardHeader className="pb-2">
                <CardDescription className="text-slate-500">Пользователи</CardDescription>
                <CardTitle className="text-3xl text-white">{stats?.users || 0}</CardTitle>
              </CardHeader>
            </Card>
            <Card className="glass-card border-slate-800">
              <CardHeader className="pb-2">
                <CardDescription className="text-slate-500">Подразделения</CardDescription>
                <CardTitle className="text-3xl text-white">{stats?.divisions || 0}</CardTitle>
              </CardHeader>
            </Card>
            <Card className="glass-card border-slate-800">
              <CardHeader className="pb-2">
                <CardDescription className="text-slate-500">Завершённых анализов</CardDescription>
                <CardTitle className="text-3xl text-emerald-400">{stats?.completed_analyses || 0}</CardTitle>
              </CardHeader>
            </Card>
            <Card className="glass-card border-slate-800">
              <CardHeader className="pb-2">
                <CardDescription className="text-slate-500">Нерешённых ошибок</CardDescription>
                <CardTitle className="text-3xl text-red-400">{stats?.unresolved_errors || 0}</CardTitle>
              </CardHeader>
            </Card>
          </div>
          
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="glass-card border-slate-800">
              <CardHeader>
                <CardTitle className="text-lg text-white">Быстрые действия</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button 
                  variant="outline" 
                  className="w-full justify-start text-slate-300 border-slate-700 hover:bg-slate-800"
                  onClick={() => setTab("errors")}
                >
                  <AlertTriangle className="w-4 h-4 mr-2 text-red-400" />
                  Просмотреть ошибки ({stats?.unresolved_errors || 0})
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start text-slate-300 border-slate-700 hover:bg-slate-800"
                  onClick={() => setTab("prompts")}
                >
                  <FileCode className="w-4 h-4 mr-2 text-blue-400" />
                  Настроить промпты
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start text-slate-300 border-slate-700 hover:bg-slate-800"
                  onClick={() => setTab("knowledge")}
                >
                  <BookOpen className="w-4 h-4 mr-2 text-emerald-400" />
                  Управление базой знаний ({stats?.knowledge_items || 0})
                </Button>
              </CardContent>
            </Card>
            
            <Card className="glass-card border-slate-800">
              <CardHeader>
                <CardTitle className="text-lg text-white">Информация о системе</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Версия</span>
                  <span className="text-slate-300">1.0.0</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">AI Модель</span>
                  <span className="text-slate-300">GPT-5.2</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Элементов в базе знаний</span>
                  <span className="text-slate-300">{stats?.knowledge_items || 0}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="divisions">
          <DivisionsDataTab />
        </TabsContent>

        <TabsContent value="errors">
          <ErrorLogsTab />
        </TabsContent>

        <TabsContent value="prompts">
          <PromptsTab />
        </TabsContent>

        <TabsContent value="knowledge">
          <KnowledgeTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
