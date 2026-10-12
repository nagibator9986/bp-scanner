import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Lightbulb, Zap, Cpu, Bot, Filter, ArrowUpDown, TrendingUp } from "lucide-react";
import api from "@/lib/api";

const CATEGORY_CONFIG = {
  simple_automation: { label: "Простая автоматизация", icon: Zap, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  classic_digitization: { label: "Классическая цифровизация", icon: Cpu, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
  ai_reengineering: { label: "AI реинжиниринг", icon: Bot, color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20" },
};

const COMPLEXITY_MAP = {
  low: { label: "Низкая", color: "text-emerald-400" },
  medium: { label: "Средняя", color: "text-amber-400" },
  high: { label: "Высокая", color: "text-red-400" },
};

export const RecommendationsTab = ({ divisionId }) => {
  const [recommendations, setRecommendations] = useState([]);
  const [tobe, setTobe] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [sortBy, setSortBy] = useState("priority");

  useEffect(() => {
    Promise.all([
      api.get(`/divisions/${divisionId}/recommendations`),
      api.get(`/divisions/${divisionId}/tobe`),
    ]).then(([recRes, tobeRes]) => {
      setRecommendations(recRes.data);
      setTobe(tobeRes.data);
    }).catch(console.error).finally(() => setLoading(false));
  }, [divisionId]);

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-blue-500 animate-spin" /></div>;
  }

  const filtered = recommendations
    .filter((r) => filter === "all" || r.category === filter)
    .sort((a, b) => {
      if (sortBy === "priority") return (a.priority || 5) - (b.priority || 5);
      if (sortBy === "complexity") {
        const ord = { low: 1, medium: 2, high: 3 };
        return (ord[a.complexity] || 2) - (ord[b.complexity] || 2);
      }
      return 0;
    });

  const categories = ["all", "simple_automation", "classic_digitization", "ai_reengineering"];
  const catCounts = {
    all: recommendations.length,
    simple_automation: recommendations.filter((r) => r.category === "simple_automation").length,
    classic_digitization: recommendations.filter((r) => r.category === "classic_digitization").length,
    ai_reengineering: recommendations.filter((r) => r.category === "ai_reengineering").length,
  };

  const totalFte = recommendations.reduce((sum, r) => sum + (r.estimated_fte_savings || 0), 0);

  return (
    <div className="space-y-6" data-testid="recommendations-tab">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Рекомендации по оптимизации</h2>
          <p className="text-sm text-slate-400 mt-1">{recommendations.length} инициатив выявлено</p>
        </div>
        {totalFte > 0 && (
          <div className="glass-card rounded-lg px-4 py-2 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <span className="text-sm text-slate-300">Потенциальная экономия: <span className="text-emerald-400 font-semibold">{totalFte.toFixed(1)} FTE</span></span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {categories.map((cat) => {
          const cfg = cat === "all" ? { label: "Все", icon: Filter, color: "text-white", bg: "bg-slate-800", border: "border-slate-700" } : CATEGORY_CONFIG[cat];
          return (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors border ${
                filter === cat ? `${cfg.bg} ${cfg.color} ${cfg.border}` : "bg-transparent text-slate-500 border-slate-800 hover:border-slate-700"
              }`}
              data-testid={`filter-${cat}`}
            >
              <cfg.icon className="w-4 h-4" />
              {cfg.label}
              <Badge variant="outline" className="border-current text-current text-xs ml-1 px-1.5">{catCounts[cat]}</Badge>
            </button>
          );
        })}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSortBy(sortBy === "priority" ? "complexity" : "priority")}
          className="text-slate-400 hover:text-white ml-auto"
          data-testid="sort-btn"
        >
          <ArrowUpDown className="w-4 h-4 mr-1" />
          {sortBy === "priority" ? "По приоритету" : "По сложности"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((rec, i) => {
          const cfg = CATEGORY_CONFIG[rec.category] || CATEGORY_CONFIG.simple_automation;
          const cpl = COMPLEXITY_MAP[rec.complexity] || COMPLEXITY_MAP.medium;
          return (
            <Card
              key={rec.id || i}
              className="glass-card border-slate-800 bg-transparent animate-fade-in-up overflow-hidden"
              style={{ animationDelay: `${i * 0.04}s` }}
              data-testid={`rec-card-${i}`}
            >
              <div className={`h-1 ${cfg.bg.replace("/10", "")}`} style={{ backgroundColor: cfg.color === "text-emerald-400" ? "rgba(16,185,129,0.5)" : cfg.color === "text-blue-400" ? "rgba(59,130,246,0.5)" : "rgba(168,85,247,0.5)" }} />
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-lg ${cfg.bg} flex items-center justify-center`}>
                      <cfg.icon className={`w-4 h-4 ${cfg.color}`} />
                    </div>
                    <Badge className={`${cfg.bg} ${cfg.color} border ${cfg.border} text-xs`}>{cfg.label}</Badge>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-500">P{rec.priority || "-"}</span>
                    <span className={`text-xs ${cpl.color}`}>{cpl.label}</span>
                  </div>
                </div>

                <h3 className="text-sm font-semibold text-white mb-2">{rec.title}</h3>
                <p className="text-sm text-slate-400 mb-3 line-clamp-3">{rec.description}</p>

                {rec.effect && (
                  <div className="p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/15 mb-3">
                    <p className="text-xs text-emerald-400 font-medium mb-0.5">Эффект</p>
                    <p className="text-xs text-slate-300">{rec.effect}</p>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {rec.related_processes?.map((p, pi) => (
                    <Badge key={pi} variant="outline" className="border-slate-700 text-slate-400 text-xs">{p}</Badge>
                  ))}
                </div>

                {rec.implementation_stack && (
                  <p className="text-xs text-slate-500 mt-2 font-mono">{rec.implementation_stack}</p>
                )}

                {rec.estimated_fte_savings > 0 && (
                  <div className="mt-3 flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-xs text-emerald-400 font-medium">-{rec.estimated_fte_savings} FTE</span>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {recommendations.length === 0 && (
        <div className="text-center py-16 glass-card rounded-xl">
          <Lightbulb className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-white font-medium">Рекомендации не сформированы</p>
          <p className="text-sm text-slate-400 mt-1">Запустите анализ для генерации рекомендаций</p>
        </div>
      )}
    </div>
  );
};
