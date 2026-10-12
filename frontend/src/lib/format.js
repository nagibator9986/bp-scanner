export const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("ru-RU");
};

export const formatDateTime = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

export const formatSize = (bytes) => {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1048576).toFixed(1)} МБ`;
};

export const formatNumber = (value, digits = 1) => {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString("ru-RU", { maximumFractionDigits: digits });
};

export const formatDuration = (seconds) => {
  if (!seconds && seconds !== 0) return "—";
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} мин ${seconds % 60} с`;
};

export const truncate = (text, length = 30) =>
  !text ? "" : text.length > length ? `${text.slice(0, length - 1)}…` : text;

/** Склонение: plural(5, ["процесс", "процесса", "процессов"]). */
export const plural = (count, forms) => {
  const n = Math.abs(count) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
};
