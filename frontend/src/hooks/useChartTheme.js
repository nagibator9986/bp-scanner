import { useTheme } from "@/contexts/ThemeContext";

/** Цвета осей, сетки и подсказок Recharts под текущую тему. */
export function useChartTheme() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  return {
    dark,
    grid: dark ? "#1e293b" : "#e2e8f0",
    axis: dark ? "#94a3b8" : "#64748b",
    text: dark ? "#e2e8f0" : "#1e293b",
    muted: dark ? "#334155" : "#cbd5e1",
    cursor: dark ? "rgba(148,163,184,0.08)" : "rgba(100,116,139,0.08)",
    tooltip: {
      backgroundColor: dark ? "#0f172a" : "#ffffff",
      border: `1px solid ${dark ? "#1e293b" : "#e2e8f0"}`,
      borderRadius: 8,
      color: dark ? "#f8fafc" : "#0f172a",
      fontSize: 12,
      boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
    },
  };
}
