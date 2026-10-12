import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, GitBranch, Lightbulb, TrendingUp, Plus, ArrowRight, Loader2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import api from "@/lib/api";

const STATUS_MAP = {
  not_started: { label: "Не начат", color: "bg-slate-600" },
  in_progress: { label: "В процессе", color: "bg-amber-500" },
  completed: { label: "Завершён", color: "bg-emerald-500" },
  error: { label: "Ошибка", color: "bg-red-500" },
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/dashboard").then((r) => setData(r.data)).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  const stats = [
    { label: "Подразделения", value: data?.total_divisions || 0, icon: Building2, accent: "text-blue-400" },
    { label: "Проанализировано", value: data?.analyzed_divisions || 0, icon: TrendingUp, accent: "text-emerald-400" },
    { label: "Процессы", value: data?.total_processes || 0, icon: GitBranch, accent: "text-purple-400" },
    { label: "Рекомендации", value: data?.total_recommendations || 0, icon: Lightbulb, accent: "text-amber-400" },
  ];

  const pieData = [
    { name: "Завершено", value: data?.analyzed_divisions || 0, color: "#10b981" },
    { name: "В процессе", value: data?.in_progress || 0, color: "#f59e0b" },
    { name: "Не начато", value: Math.max(0, (data?.total_divisions || 0) - (data?.analyzed_divisions || 0) - (data?.in_progress || 0)), color: "#475569" },
  ].filter((d) => d.value > 0);

  const barData = (data?.divisions || []).filter((d) => d.processes_count > 0).map((d) => ({
    name: d.name?.length > 15 ? d.name.slice(0, 15) + "..." : d.name,
    processes: d.processes_count || 0,
    recommendations: d.recommendations_count || 0,
  }));

  return (
    <div className="p-6 md:p-8 lg:p-10 space-y-8" data-testid="dashboard-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Дашборд</h1>
          <p className="text-slate-400 mt-1">Портфельный обзор анализа подразделений</p>
        </div>
        <Button
          data-testid="create-division-from-dashboard-btn"
          onClick={() => navigate("/divisions")}
          className="bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_15px_rgba(59,130,246,0.4)]"
        >
          <Plus className="w-4 h-4 mr-2" /> Новое подразделение
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <div
            key={i}
            className="stat-card glass-card rounded-xl p-5 animate-fade-in-up"
            style={{ animationDelay: `${i * 0.08}s` }}
            data-testid={`stat-card-${i}`}
          >
            <div className="flex items-center justify-between mb-3">
              <s.icon className={`w-5 h-5 ${s.accent}`} strokeWidth={1.5} />
              <span className="text-xs text-slate-500 uppercase tracking-wider font-medium">{s.label}</span>
            </div>
            <p className="text-3xl font-bold text-white">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {barData.length > 0 && (
          <Card className="lg:col-span-8 glass-card border-slate-800 bg-transparent">
            <CardHeader>
              <CardTitle className="text-lg text-white">Процессы по подразделениям</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={barData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} />
                  <YAxis stroke="#94a3b8" fontSize={12} />
                  <Tooltip contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", color: "#f8fafc" }} />
                  <Bar dataKey="processes" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Процессы" />
                  <Bar dataKey="recommendations" fill="#10b981" radius={[4, 4, 0, 0]} name="Рекомендации" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {pieData.length > 0 && (
          <Card className={`${barData.length > 0 ? "lg:col-span-4" : "lg:col-span-12"} glass-card border-slate-800 bg-transparent`}>
            <CardHeader>
              <CardTitle className="text-lg text-white">Статус анализа</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={4}>
                    {pieData.map((entry, i) => (<Cell key={i} fill={entry.color} />))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", color: "#f8fafc" }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 mt-2">
                {pieData.map((d, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                    <span className="text-xs text-slate-400">{d.name}: {d.value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {(data?.divisions || []).length > 0 && (
        <Card className="glass-card border-slate-800 bg-transparent">
          <CardHeader>
            <CardTitle className="text-lg text-white">Подразделения</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.divisions.map((d, i) => {
                const st = STATUS_MAP[d.analysis_status] || STATUS_MAP.not_started;
                return (
                  <div
                    key={d.id}
                    className="flex items-center justify-between p-4 rounded-lg bg-slate-900/40 hover:bg-slate-800/50 transition-colors cursor-pointer border border-transparent hover:border-slate-700"
                    onClick={() => navigate(`/divisions/${d.id}`)}
                    data-testid={`division-row-${i}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-blue-600/10 flex items-center justify-center">
                        <Building2 className="w-5 h-5 text-blue-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{d.name}</p>
                        <p className="text-xs text-slate-500">{d.head_name || "Руководитель не указан"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <Badge variant="outline" className="border-slate-700 text-slate-400 text-xs">
                        {d.processes_count || 0} процессов
                      </Badge>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${st.color}`} />
                        <span className="text-xs text-slate-400">{st.label}</span>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-600" />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {(data?.divisions || []).length === 0 && (
        <div className="text-center py-20 glass-card rounded-xl">
          <Building2 className="w-16 h-16 text-slate-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">Нет подразделений</h3>
          <p className="text-slate-400 mb-6">Создайте первое подразделение для начала анализа</p>
          <Button onClick={() => navigate("/divisions")} className="bg-blue-600 hover:bg-blue-500 text-white" data-testid="empty-create-division-btn">
            <Plus className="w-4 h-4 mr-2" /> Создать подразделение
          </Button>
        </div>
      )}
    </div>
  );
}
