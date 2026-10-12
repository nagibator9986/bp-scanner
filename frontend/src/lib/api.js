import axios from "axios";

// По умолчанию API доступен на том же домене по /api (nginx проксирует на бэкенд)
const API_URL = (process.env.REACT_APP_BACKEND_URL || "/api").replace(/\/$/, "");

const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Истёкшая сессия → на страницу входа. Запросы авторизации обрабатываются формой сами.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url || "";
    const isAuthRequest = url.startsWith("/auth/login") || url.startsWith("/auth/register");
    if (error.response?.status === 401 && !isAuthRequest) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

/** Понятное сообщение об ошибке запроса для показа пользователю. */
export function errorMessage(error, fallback = "Произошла ошибка") {
  if (!error?.response) {
    return error?.message === "Network Error" ? "Нет соединения с сервером" : fallback;
  }
  const detail = error.response.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (Array.isArray(detail) && detail.length) return detail.map((d) => d.msg || String(d)).join("; ");
  return fallback;
}

/** Скачивание файла с сервера с учётом имени из Content-Disposition. */
export async function downloadFile(url, fallbackName) {
  const response = await api.get(url, { responseType: "blob" });
  const disposition = response.headers["content-disposition"] || "";
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plain = disposition.match(/filename="?([^";]+)"?/i);
  const name = utf8 ? decodeURIComponent(utf8[1]) : plain ? plain[1] : fallbackName;
  const href = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  return name;
}

export default api;
