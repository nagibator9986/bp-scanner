import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Workflow, Play, Cog, GitBranch, CheckCircle2, Copy, Clock, ArrowRight, Zap, Download, FileJson } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

const NODE_CONFIG = {
  trigger: { icon: Play, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  action: { icon: Cog, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30" },
  condition: { icon: GitBranch, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30" },
  output: { icon: CheckCircle2, color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/30" },
};

const N8nWorkflowDiagram = ({ workflow }) => {
  if (!workflow.nodes || workflow.nodes.length === 0) return null;

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex items-center gap-2 min-w-max py-2">
        {workflow.nodes.map((node, i) => {
          const cfg = NODE_CONFIG[node.type] || NODE_CONFIG.action;
          const Icon = cfg.icon;
          return (
            <div key={node.id || i} className="flex items-center">
              {i > 0 && (
                <div className="w-8 flex items-center justify-center">
                  <ArrowRight className="w-4 h-4 text-slate-600" />
                </div>
              )}
              <div className={`n8n-node ${cfg.bg} border ${cfg.border} rounded-lg px-4 py-3 min-w-[150px]`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon className={`w-4 h-4 ${cfg.color}`} />
                  <span className={`text-xs font-medium ${cfg.color} uppercase tracking-wider`}>{node.type}</span>
                </div>
                <p className="text-sm font-medium text-white">{node.name}</p>
                {node.description && (
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2">{node.description}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Конвертер в формат N8N
const convertToN8nFormat = (wf) => {
  const nodeTypeMap = {
    trigger: "n8n-nodes-base.scheduleTrigger",
    webhook: "n8n-nodes-base.webhook",
    action: "n8n-nodes-base.httpRequest",
    http: "n8n-nodes-base.httpRequest",
    email: "n8n-nodes-base.emailSend",
    condition: "n8n-nodes-base.if",
    switch: "n8n-nodes-base.switch",
    output: "n8n-nodes-base.respondToWebhook",
    set: "n8n-nodes-base.set",
    code: "n8n-nodes-base.code",
    database: "n8n-nodes-base.postgres",
    api: "n8n-nodes-base.httpRequest",
  };

  const nodes = (wf.nodes || []).map((n, i) => ({
    id: n.id || `node_${i}`,
    name: n.name,
    type: nodeTypeMap[n.type] || nodeTypeMap.action,
    typeVersion: 1,
    position: [250 + i * 250, 300],
    parameters: n.parameters || n.config || {},
  }));

  const connections = {};
  if (wf.connections && Array.isArray(wf.connections)) {
    wf.connections.forEach(conn => {
      const fromNode = conn.from || conn.source;
      const toNode = conn.to || conn.target;
      if (fromNode && toNode) {
        if (!connections[fromNode]) {
          connections[fromNode] = { main: [[]] };
        }
        connections[fromNode].main[0].push({
          node: toNode,
          type: "main",
          index: 0
        });
      }
    });
  } else {
    // Автоматическое создание связей на основе порядка нод
    nodes.forEach((node, i) => {
      if (i < nodes.length - 1) {
        connections[node.id] = {
          main: [[{ node: nodes[i + 1].id, type: "main", index: 0 }]]
        };
      }
    });
  }

  return {
    name: wf.name,
    nodes,
    connections,
    active: false,
    settings: {
      executionOrder: "v1"
    },
    versionId: "1",
    meta: {
      instanceId: "generated"
    }
  };
};

export const N8nTab = ({ divisionId }) => {
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    api.get(`/divisions/${divisionId}/n8n`)
      .then((r) => {
        setWorkflows(r.data);
        if (r.data.length > 0) setExpandedId(r.data[0].id);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [divisionId]);

  const copyJson = (wf) => {
    const n8nJson = convertToN8nFormat(wf);
    navigator.clipboard.writeText(JSON.stringify(n8nJson, null, 2));
    toast.success("N8N workflow JSON скопирован в буфер обмена");
  };

  const downloadJson = (wf) => {
    const n8nJson = convertToN8nFormat(wf);
    const blob = new Blob([JSON.stringify(n8nJson, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${wf.name.replace(/[^a-zA-Zа-яА-Я0-9]/g, "_")}_n8n_workflow.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("JSON файл скачан");
  };

  const downloadAllWorkflows = () => {
    const allWorkflows = workflows.map(wf => convertToN8nFormat(wf));
    const blob = new Blob([JSON.stringify(allWorkflows, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `all_n8n_workflows.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Скачано ${workflows.length} workflows`);
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-blue-500 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6" data-testid="n8n-tab">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">N8N Workflows</h2>
          <p className="text-sm text-slate-400 mt-1">Готовые MVP автоматизации для импорта в N8N</p>
        </div>
        {workflows.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={downloadAllWorkflows}
            className="border-blue-500/30 text-blue-400 hover:bg-blue-600/10"
            data-testid="download-all-n8n"
          >
            <Download className="w-4 h-4 mr-1.5" /> Скачать все ({workflows.length})
          </Button>
        )}
      </div>

      <div className="space-y-4">
        {workflows.map((wf, i) => {
          const isExpanded = expandedId === wf.id;
          return (
            <Card
              key={wf.id || i}
              className="glass-card border-slate-800 bg-transparent overflow-hidden animate-fade-in-up"
              style={{ animationDelay: `${i * 0.06}s` }}
              data-testid={`n8n-workflow-${i}`}
            >
              <CardContent className="p-0">
                <div
                  className="p-5 cursor-pointer hover:bg-slate-800/20 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : wf.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-600/10 flex items-center justify-center shrink-0 mt-0.5">
                        <Workflow className="w-5 h-5 text-blue-400" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-white">{wf.name}</h3>
                        <p className="text-sm text-slate-400 mt-0.5">{wf.description}</p>
                        {wf.related_recommendation && (
                          <Badge variant="outline" className="border-slate-700 text-slate-500 text-xs mt-2">{wf.related_recommendation}</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {wf.estimated_time_savings && (
                        <div className="flex items-center gap-1 text-emerald-400">
                          <Clock className="w-3.5 h-3.5" />
                          <span className="text-xs font-medium">{wf.estimated_time_savings}</span>
                        </div>
                      )}
                      <Badge className="bg-blue-600/10 text-blue-400 border border-blue-500/20 text-xs">
                        {wf.nodes?.length || 0} нод
                      </Badge>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-slate-800">
                    <div className="p-5">
                      <N8nWorkflowDiagram workflow={wf} />
                    </div>
                    <div className="px-5 pb-5 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadJson(wf)}
                        className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-600/10"
                        data-testid={`download-n8n-${i}`}
                      >
                        <Download className="w-4 h-4 mr-1.5" /> Скачать JSON
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyJson(wf)}
                        className="border-slate-700 text-slate-300 hover:bg-slate-800"
                        data-testid={`copy-n8n-${i}`}
                      >
                        <Copy className="w-4 h-4 mr-1.5" /> Копировать
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-blue-500/30 text-blue-400 hover:bg-blue-600/10"
                        onClick={() => window.open("https://n8n.io", "_blank")}
                      >
                        <Zap className="w-4 h-4 mr-1.5" /> Открыть N8N
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {workflows.length === 0 && (
        <div className="text-center py-16 glass-card rounded-xl">
          <Workflow className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-white font-medium">N8N workflows не сгенерированы</p>
          <p className="text-sm text-slate-400 mt-1">Запустите анализ для создания автоматизаций</p>
        </div>
      )}
    </div>
  );
};
