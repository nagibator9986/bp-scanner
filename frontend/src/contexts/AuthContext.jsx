import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import api from "@/lib/api";

const AuthContext = createContext(null);

const readStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    return null;
  }
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredUser);
  const [token, setToken] = useState(() => localStorage.getItem("token"));

  const login = useCallback((data) => {
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken(null);
    setUser(null);
  }, []);

  // Роль и профиль актуализируются с сервера при каждом запуске приложения
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api
      .get("/auth/me")
      .then(({ data }) => {
        if (cancelled) return;
        localStorage.setItem("user", JSON.stringify(data));
        setUser(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token]);

  const value = useMemo(
    () => ({ user, token, isAdmin: user?.is_admin === true, login, logout, setUser }),
    [user, token, login, logout]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
