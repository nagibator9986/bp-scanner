import { Bot, Cpu, Zap } from "lucide-react";

export const STATUS = {
  not_started: { label: "Не начат", dot: "bg-slate-400", text: "text-muted-foreground" },
  in_progress: { label: "Идёт анализ", dot: "bg-amber-500 animate-pulse", text: "text-amber-500" },
  completed: { label: "Завершён", dot: "bg-emerald-500", text: "text-emerald-500" },
  error: { label: "Ошибка", dot: "bg-red-500", text: "text-red-500" },
};

/** Статусы старой версии (названия этапов) считаем «идёт анализ». */
export const normalizeStatus = (status) => (STATUS[status] ? status : status ? "in_progress" : "not_started");

export const CATEGORIES = {
  simple_automation: {
    label: "Простая автоматизация",
    short: "Автоматизация",
    color: "#10b981",
    icon: Zap,
    text: "text-emerald-500",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/25",
  },
  classic_digitization: {
    label: "Классическая цифровизация",
    short: "Цифровизация",
    color: "#3b82f6",
    icon: Cpu,
    text: "text-blue-500",
    bg: "bg-blue-500/10",
    border: "border-blue-500/25",
  },
  ai_reengineering: {
    label: "AI-реинжиниринг",
    short: "AI",
    color: "#a855f7",
    icon: Bot,
    text: "text-purple-500",
    bg: "bg-purple-500/10",
    border: "border-purple-500/25",
  },
};

export const COMPLEXITY = {
  low: { label: "Низкая", text: "text-emerald-500", value: 1 },
  medium: { label: "Средняя", text: "text-amber-500", value: 2 },
  high: { label: "Высокая", text: "text-red-500", value: 3 },
};

export const SCORE_FIELDS = [
  { key: "complexity", label: "Сложность", short: "Сложн." },
  { key: "manual_effort", label: "Ручной труд", short: "Ручн." },
  { key: "system_fragmentation", label: "Фрагментация систем", short: "Фрагм." },
  { key: "approval_burden", label: "Согласования", short: "Согл." },
  { key: "ai_suitability", label: "Пригодность для AI", short: "AI" },
  { key: "automation_readiness", label: "Готовность к автоматизации", short: "Готовн." },
];

export const ANALYSIS_STEPS = [
  { key: "prepare", title: "Подготовка данных" },
  { key: "extracting_processes", title: "Извлечение процессов" },
  { key: "generating_bpmn", title: "BPMN-схемы AS-IS" },
  { key: "scoring", title: "Скоринг процессов" },
  { key: "generating_recommendations", title: "Рекомендации" },
  { key: "generating_tobe", title: "TO-BE модели" },
  { key: "generating_n8n", title: "N8N workflows" },
  { key: "saving", title: "Сохранение результатов" },
];

export const ACCEPTED_FILES = ".pdf,.docx,.xlsx,.pptx,.txt,.csv,.md";

/** Цвет индекса потенциала автоматизации (0–100). */
export const potentialColor = (value) => {
  if (value == null) return "#64748b";
  if (value >= 70) return "#10b981";
  if (value >= 45) return "#f59e0b";
  return "#64748b";
};

/** Цвет оценки 1–10 для тепловой карты скоринга. */
export const scoreColor = (value) => {
  const v = Math.max(1, Math.min(10, Number(value) || 1));
  const hue = 145 - ((v - 1) / 9) * 145; // зелёный → красный
  return `hsl(${hue} 70% 45%)`;
};
