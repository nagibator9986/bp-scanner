import axios from "axios";

const API_URL = `${process.env.REACT_APP_BACKEND_URL}`;

const api = axios.create({
  baseURL: API_URL
});

// Перехватчик запросов: добавляем токен в заголовки
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

// Перехватчик ответов: обрабатываем ошибки авторизации
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }

    return Promise.reject(err);
  }
);

export default api;