import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css";

import { useTheme } from "@/contexts/ThemeContext";

const COLORS = {
  dark: { defaultFillColor: "#0f172a", defaultStrokeColor: "#94a3b8", defaultLabelColor: "#e2e8f0" },
  light: { defaultFillColor: "#ffffff", defaultStrokeColor: "#334155", defaultLabelColor: "#0f172a" },
};

/**
 * Просмотр BPMN 2.0 (bpmn-js NavigatedViewer): панорамирование мышью, масштаб колесом.
 * Через ref доступны zoomIn/zoomOut/fit и saveSVG.
 */
export const BpmnViewer = forwardRef(function BpmnViewer({ xml, height = 460 }, ref) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const { theme } = useTheme();
  const [state, setState] = useState("loading");
  const [error, setError] = useState(null);

  useImperativeHandle(ref, () => ({
    zoomIn: () => {
      const canvas = viewerRef.current?.get("canvas");
      if (canvas) canvas.zoom(canvas.zoom() * 1.2);
    },
    zoomOut: () => {
      const canvas = viewerRef.current?.get("canvas");
      if (canvas) canvas.zoom(canvas.zoom() / 1.2);
    },
    fit: () => viewerRef.current?.get("canvas").zoom("fit-viewport", "auto"),
    saveSVG: async () => (viewerRef.current ? (await viewerRef.current.saveSVG()).svg : null),
  }));

  // Просмотрщик пересоздаётся при смене схемы или темы; устаревшие загрузки отменяются
  useEffect(() => {
    if (!xml || !containerRef.current) return undefined;
    let cancelled = false;
    let viewer = null;
    setState("loading");
    setError(null);

    (async () => {
      try {
        const { default: NavigatedViewer } = await import("bpmn-js/lib/NavigatedViewer");
        if (cancelled) return;
        viewer = new NavigatedViewer({
          container: containerRef.current,
          bpmnRenderer: COLORS[theme] || COLORS.dark,
          textRenderer: { defaultStyle: { fontFamily: "Manrope, Arial, sans-serif", fontSize: 12 } },
        });
        viewerRef.current = viewer;
        const { warnings } = await viewer.importXML(xml);
        if (cancelled) return;
        if (warnings?.length) console.warn("BPMN import warnings:", warnings);
        viewer.get("canvas").zoom("fit-viewport", "auto");
        setState("ready");
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || "Не удалось отобразить схему");
          setState("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      viewer?.destroy();
      if (viewerRef.current === viewer) viewerRef.current = null;
    };
  }, [xml, theme]);

  return (
    <div className="relative" style={{ height }}>
      <div ref={containerRef} className="bpmn-canvas h-full w-full" data-testid="bpmn-viewer" />
      {state === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
      {state === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
          <AlertTriangle className="h-6 w-6 text-amber-500" />
          Схема не может быть отображена
          <span className="max-w-md text-xs">{error}</span>
        </div>
      )}
    </div>
  );
});
