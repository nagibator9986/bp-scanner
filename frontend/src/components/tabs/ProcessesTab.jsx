import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, GitBranch, Users, Monitor, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import api from "@/lib/api";

const SCORE_LABELS = {
  complexity: "Сложность",
  manual_effort: "Ручной труд",
  system_fragmentation: "Фрагментация",
  approval_burden: "Согласования",
  ai_suitability: "AI пригодность",
  automation_readiness: "Готовность к авт.",
};

export const ProcessesTab = ({ divisionId }) => {
  const [processes, setProcesses] = useState([]);
  const [scoring, setScoring] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [selectedScore, setSelectedScore] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get(`/divisions/${divisionId}/processes`),
      api.get(`/divisions/${divisionId}/scoring`),
    ]).then(([procRes, scoreRes]) => {
      setProcesses(procRes.data);
      setScoring(scoreRes.data);
      if (scoreRes.data.length > 0) setSelectedScore(scoreRes.data[0]);
    }).catch(console.error).finally(() => setLoading(false));
  }, [divisionId]);

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-blue-500 animate-spin" /></div>;
  }

  const radarData = selectedScore ? Object.entries(SCORE_LABELS).map(([key, label]) => ({
    subject: label, value: selectedScore[key] || 0, fullMark: 10,
  })) : [];

  const barData = scoring.map((s) => ({
    name: s.process_name?.length > 20 ? s.process_name.slice(0, 20) + "..." : s.process_name,
    total: s.total_score || 0,
    ai: s.ai_suitability || 0,
    auto: s.automation_readiness || 0,
  }));

  return (
    <div className="space-y-6" data-testid="processes-tab">
      <div>
        <h2 className="text-xl font-semibold text-white">Реестр процессов</h2>
        <p className="text-sm text-slate-400 mt-1">Выявленные бизнес-процессы и их скоринг</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 space-y-3">
          {processes.map((proc, i) => {
            const score = scoring.find((s) => s.process_name === proc.name);
            const isExpanded = expandedId === proc.id;
            return (
              <div
                key={proc.id}
                className="glass-card rounded-xl overflow-hidden animate-fade-in-up"
                style={{ animationDelay: `${i * 0.05}s` }}
                data-testid={`process-card-${i}`}
              >
                <div
                  className="p-4 cursor-pointer flex items-center justify-between hover:bg-slate-800/30 transition-colors"
                  onClick={() => { setExpandedId(isExpanded ? null : proc.id); if (score) setSelectedScore(score); }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-blue-600/10 flex items-center justify-center shrink-0">
                      <GitBranch className="w-4 h-4 text-blue-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{proc.name}</p>
                      <p className="text-xs text-slate-500 truncate">{proc.trigger || proc.frequency || ""}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {score && (
                      <Badge className={`text-xs ${score.ai_suitability >= 7 ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : score.ai_suitability >= 4 ? "bg-amber-500/15 text-amber-400 border-amber-500/30" : "bg-slate-700/30 text-slate-400 border-slate-600"}`}>
                        AI: {score.ai_suitability}/10
                      </Badge>
                    )}
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-slate-800">
                    <p className="text-sm text-slate-300 pt-3">{proc.description}</p>

                    {proc.steps && proc.steps.length > 0 && (
                      <div>
                        <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">Шаги процесса</p>
                        <div className="space-y-1.5">
                          {proc.steps.map((step, si) => (
                            <div key={si} className="flex items-start gap-2">
                              <span className="w-5 h-5 rounded-full bg-blue-600/15 text-blue-400 text-xs flex items-center justify-center shrink-0 mt-0.5">{si + 1}</span>
                              <span className="text-sm text-slate-300">{step}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      {proc.roles && proc.roles.length > 0 && (
                        <div>
                          <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-1.5 flex items-center gap-1"><Users className="w-3 h-3" /> Роли</p>
                          <div className="flex flex-wrap gap-1">{proc.roles.map((r, ri) => <Badge key={ri} variant="outline" className="border-slate-700 text-slate-400 text-xs">{r}</Badge>)}</div>
                        </div>
                      )}
                      {proc.systems && proc.systems.length > 0 && (
                        <div>
                          <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-1.5 flex items-center gap-1"><Monitor className="w-3 h-3" /> Системы</p>
                          <div className="flex flex-wrap gap-1">{proc.systems.map((s, si) => <Badge key={si} variant="outline" className="border-blue-500/30 text-blue-400 text-xs">{s}</Badge>)}</div>
                        </div>
                      )}
                    </div>

                    {proc.sla && (
                      <div className="flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-slate-500" />
                        <span className="text-xs text-slate-400">SLA: {proc.sla}</span>
                      </div>
                    )}

                    {score && score.bottlenecks && score.bottlenecks.length > 0 && (
                      <div>
                        <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-1.5">Узкие места</p>
                        {score.bottlenecks.map((b, bi) => (
                          <div key={bi} className="flex items-start gap-2 mb-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                            <span className="text-sm text-red-300">{b}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="lg:col-span-5 space-y-4">
          {selectedScore && (
            <Card className="glass-card border-slate-800 bg-transparent">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-white">
                  Скоринг: {selectedScore.process_name?.length > 30 ? selectedScore.process_name.slice(0, 30) + "..." : selectedScore.process_name}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#1e293b" />
                    <PolarAngleAxis dataKey="subject" stroke="#94a3b8" fontSize={10} />
                    <PolarRadiusAxis domain={[0, 10]} tick={false} axisLine={false} />
                    <Radar dataKey="value" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} strokeWidth={2} />
                  </RadarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {barData.length > 0 && (
            <Card className="glass-card border-slate-800 bg-transparent">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-white">Сравнение процессов</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={barData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis type="number" stroke="#94a3b8" fontSize={11} />
                    <YAxis type="category" dataKey="name" stroke="#94a3b8" fontSize={10} width={100} />
                    <Tooltip contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", color: "#f8fafc" }} />
                    <Bar dataKey="ai" fill="#10b981" radius={[0, 4, 4, 0]} name="AI пригодность" />
                    <Bar dataKey="auto" fill="#3b82f6" radius={[0, 4, 4, 0]} name="Автоматизация" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {processes.length === 0 && (
        <div className="text-center py-16 glass-card rounded-xl">
          <GitBranch className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-white font-medium">Процессы не извлечены</p>
          <p className="text-sm text-slate-400 mt-1">Запустите анализ для выявления процессов</p>
        </div>
      )}
    </div>
  );
};
