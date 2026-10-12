import React, { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { LoadingState } from "@/components/common";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import Layout from "@/pages/Layout";
import LoginPage from "@/pages/LoginPage";

import "@/App.css";

// Тяжёлые страницы (графики, BPMN) загружаются по требованию
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const DivisionsPage = lazy(() => import("@/pages/DivisionsPage"));
const DivisionDetailPage = lazy(() => import("@/pages/DivisionDetailPage"));
const AdminPage = lazy(() => import("@/pages/AdminPage"));

const ProtectedRoute = ({ children }) => {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return children;
};

const AdminRoute = ({ children }) => {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;
  return children;
};

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <TooltipProvider delayDuration={200}>
          <BrowserRouter>
            <Toaster position="top-right" richColors closeButton />
            <Suspense fallback={<LoadingState className="h-screen" />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <Layout />
                    </ProtectedRoute>
                  }
                >
                  <Route index element={<DashboardPage />} />
                  <Route path="dashboard" element={<Navigate to="/" replace />} />
                  <Route path="divisions" element={<DivisionsPage />} />
                  <Route path="divisions/:id" element={<DivisionDetailPage />} />
                  <Route
                    path="admin"
                    element={
                      <AdminRoute>
                        <AdminPage />
                      </AdminRoute>
                    }
                  />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
