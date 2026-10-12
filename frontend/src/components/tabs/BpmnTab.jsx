import { useState, useEffect, useRef } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Workflow, Download, Circle, Square, Diamond, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css";

const FlowDiagram = ({ steps, roles }) => {
  if (!steps || steps.length === 0) return <p className="text-slate-500 text-sm">Нет данных для отображения</p>;

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex items-start gap-1 min-w-max py-4 px-2">
        <div className="flex flex-col items-center">
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center">
            <Circle className="w-4 h-4 text-emerald-400 fill-emerald-400" />
          </div>
          <span className="text-[10px] text-slate-500 mt-1">Старт</span>
        </div>

        {steps.map((step, i) => (
          <div key={i} className="flex items-center">
            <div className="w-8 flex items-center justify-center">
              <ArrowRight className="w-4 h-4 text-slate-600" />
            </div>
            <div className="flow-node bg-slate-800/80 border border-slate-700 rounded-lg px-4 py-3 min-w-[140px] max-w-[200px]">
              <p className="text-xs font-medium text-white leading-snug">{step}</p>
              {roles && roles[i % roles.length] && (
                <p className="text-[10px] text-blue-400 mt-1">{roles[i % roles.length]}</p>
              )}
            </div>
          </div>
        ))}

        <div className="flex items-center">
          <div className="w-8 flex items-center justify-center">
            <ArrowRight className="w-4 h-4 text-slate-600" />
          </div>
          <div className="flex flex-col items-center">
            <div className="w-10 h-10 rounded-full bg-red-500/20 border-2 border-red-500 flex items-center justify-center">
              <Circle className="w-4 h-4 text-red-400 fill-red-400" />
            </div>
            <span className="text-[10px] text-slate-500 mt-1">Конец</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export const BpmnTab = ({ divisionId }) => {
  const [bpmnModels, setBpmnModels] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [tobe, setTobe] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProcess, setSelectedProcess] = useState("");
  const [viewType, setViewType] = useState("as_is");
  const containerRef = useRef(null);
  const viewerRef = useRef(null);

  useEffect(() => {
    Promise.all([
      api.get(`/divisions/${divisionId}/bpmn`),
      api.get(`/divisions/${divisionId}/processes`),
      api.get(`/divisions/${divisionId}/tobe`),
    ]).then(([bpmnRes, procRes, tobeRes]) => {
      setBpmnModels(bpmnRes.data);
      setProcesses(procRes.data);
      setTobe(tobeRes.data);
      if (procRes.data.length > 0) setSelectedProcess(procRes.data[0].name);
    }).catch(console.error).finally(() => setLoading(false));
  }, [divisionId]);

  useEffect(() => {
    if (!selectedProcess || !containerRef.current) return;

    const model = bpmnModels.find(
      (m) => m.process_name === selectedProcess && m.type === viewType
    );

    if (!model || !model.xml) {
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
      return;
    }

    const loadBpmn = async () => {
      try {
        const BpmnViewer = (await import("bpmn-js/lib/NavigatedViewer")).default;
        if (viewerRef.current) {
          viewerRef.current.destroy();
        }
        const viewer = new BpmnViewer({ container: containerRef.current });
        viewerRef.current = viewer;
        await viewer.importXML(model.xml);
        await new Promise(resolve => setTimeout(resolve, 50));
        const canvas = viewer.get("canvas");
        canvas.zoom("fit-viewport");
      } catch (err) {
        console.error("BPMN render error:", err);
      }
    };

    loadBpmn();

    return () => {
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, [selectedProcess, viewType, bpmnModels]);

  const downloadXml = () => {
    const model = bpmnModels.find((m) => m.process_name === selectedProcess && m.type === viewType);
    if (!model?.xml) return;
    const blob = new Blob([model.xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedProcess}_${viewType}.bpmn`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("BPMN XML скачан");
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-blue-500 animate-spin" /></div>;
  }

  const selectedProc = processes.find((p) => p.name === selectedProcess);
  const selectedTobe = tobe.find((t) => t.process_name === selectedProcess);
  const currentModel = bpmnModels.find((m) => m.process_name === selectedProcess && m.type === viewType);
  const steps = viewType === "as_is" ? selectedProc?.steps : selectedTobe?.new_process?.steps;
  const roles = selectedProc?.roles;

  return (
    <div className="space-y-6" data-testid="bpmn-tab">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">BPMN карта процессов</h2>
          <p className="text-sm text-slate-400 mt-1">Визуализация AS-IS и TO-BE моделей</p>
        </div>
        <div className="flex items-center gap-3">
          <Tabs value={viewType} onValueChange={setViewType}>
            <TabsList className="bg-slate-900/60 border border-slate-800">
              <TabsTrigger value="as_is" className="data-[state=active]:bg-slate-700 data-[state=active]:text-white text-sm" data-testid="bpmn-asis-toggle">
                AS-IS
              </TabsTrigger>
              <TabsTrigger value="to_be" className="data-[state=active]:bg-blue-600/20 data-[state=active]:text-blue-400 text-sm" data-testid="bpmn-tobe-toggle">
                TO-BE
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {currentModel && (
            <Button variant="outline" size="sm" onClick={downloadXml} className="border-slate-700 text-slate-300 hover:bg-slate-800" data-testid="download-bpmn-btn">
              <Download className="w-4 h-4 mr-1" /> XML
            </Button>
          )}
        </div>
      </div>

      {processes.length > 0 && (
        <Select value={selectedProcess} onValueChange={setSelectedProcess}>
          <SelectTrigger className="bg-slate-950 border-slate-800 text-white max-w-md" data-testid="bpmn-process-select">
            <SelectValue placeholder="Выберите процесс" />
          </SelectTrigger>
          <SelectContent className="bg-slate-900 border-slate-800">
            {processes.map((p) => (
              <SelectItem key={p.id} value={p.name} className="text-white hover:bg-slate-800 focus:bg-slate-800">
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {currentModel?.xml && (
        <div className="glass-card rounded-xl overflow-hidden border border-slate-800">
          <div className="flex items-center justify-between px-4 py-2 bg-slate-900/60 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Workflow className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-medium text-white">{selectedProcess}</span>
              <Badge className={viewType === "as_is" ? "bg-slate-600/30 text-slate-400 border-slate-500/30" : "bg-blue-600/15 text-blue-400 border-blue-500/30"}>
                {viewType === "as_is" ? "AS-IS" : "TO-BE"}
              </Badge>
            </div>
          </div>
          <div
            ref={containerRef}
            className="bpmn-container"
            style={{ width: "100%", height: "400px", background: "hsl(222 47% 11%)" }}
            data-testid="bpmn-viewer"
          />
        </div>
      )}

      {steps && steps.length > 0 && (
        <div className="glass-card rounded-xl p-5">
          <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
            <Workflow className="w-4 h-4 text-blue-400" />
            Диаграмма потока {viewType === "as_is" ? "(AS-IS)" : "(TO-BE)"}
          </h3>
          <FlowDiagram steps={steps} roles={roles} />
        </div>
      )}

      {viewType === "to_be" && selectedTobe && (
        <div className="glass-card rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-medium text-white">Изменения TO-BE</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {selectedTobe.improvements?.length > 0 && (
              <div>
                <p className="text-xs text-emerald-400 uppercase tracking-wider font-medium mb-2">Улучшения</p>
                {selectedTobe.improvements.map((imp, i) => (
                  <div key={i} className="flex items-start gap-2 mb-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                    <span className="text-sm text-slate-300">{imp}</span>
                  </div>
                ))}
              </div>
            )}
            {selectedTobe.removed_steps?.length > 0 && (
              <div>
                <p className="text-xs text-red-400 uppercase tracking-wider font-medium mb-2">Удалённые шаги</p>
                {selectedTobe.removed_steps.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 mb-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                    <span className="text-sm text-slate-300 line-through">{s}</span>
                  </div>
                ))}
              </div>
            )}
            {selectedTobe.automated_steps?.length > 0 && (
              <div>
                <p className="text-xs text-blue-400 uppercase tracking-wider font-medium mb-2">Автоматизированные шаги</p>
                {selectedTobe.automated_steps.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 mb-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                    <span className="text-sm text-slate-300">{s}</span>
                  </div>
                ))}
              </div>
            )}
            {selectedTobe.risks?.length > 0 && (
              <div>
                <p className="text-xs text-amber-400 uppercase tracking-wider font-medium mb-2">Риски</p>
                {selectedTobe.risks.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 mb-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                    <span className="text-sm text-slate-300">{r}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {selectedTobe.expected_effect && (
            <div className="mt-3 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
              <p className="text-xs text-emerald-400 uppercase tracking-wider font-medium mb-1">Ожидаемый эффект</p>
              <p className="text-sm text-slate-300">{selectedTobe.expected_effect}</p>
            </div>
          )}
        </div>
      )}

      {processes.length === 0 && (
        <div className="text-center py-16 glass-card rounded-xl">
          <Workflow className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-white font-medium">BPMN модели не сгенерированы</p>
          <p className="text-sm text-slate-400 mt-1">Запустите анализ для генерации моделей</p>
        </div>
      )}
    </div>
  );
};
