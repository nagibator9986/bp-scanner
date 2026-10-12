import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, Building2, LogOut, Scan, ChevronLeft, ChevronRight, Sun, Moon, Settings, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useState, useEffect } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { ModelConfigModal } from "@/components/ModelConfigModal";
import api from "@/lib/api";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Дашборд" },
  { to: "/divisions", icon: Building2, label: "Подразделения" },
];

export default function Layout() {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const isAdmin = user?.is_admin === true;
  

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  return (
    <div className="flex h-screen overflow-hidden" data-testid="app-layout">
      <aside
        className={`${collapsed ? "w-16" : "w-64"} flex flex-col bg-card border-r border-border transition-all duration-300 shrink-0`}
        data-testid="sidebar"
      >
        <div className={`flex items-center gap-3 p-4 ${collapsed ? "justify-center" : ""}`}>
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
            <Scan className="w-5 h-5 text-white" />
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <h1 className="text-sm font-bold text-foreground truncate">AI BP Scanner</h1>
              <p className="text-xs text-muted-foreground truncate">Анализ процессов</p>
            </div>
          )}
        </div>

        <Separator className="bg-border" />

        <nav className="flex-1 p-2 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-200 ${
                  isActive
                    ? "bg-blue-600/15 text-blue-500 border border-blue-500/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                } ${collapsed ? "justify-center" : ""}`
              }
              data-testid={`nav-${item.label}`}
            >
              <item.icon className="w-5 h-5 shrink-0" strokeWidth={1.5} />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
          
          {isAdmin && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-200 ${
                  isActive
                    ? "bg-amber-600/15 text-amber-500 border border-amber-500/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                } ${collapsed ? "justify-center" : ""}`
              }
              data-testid="nav-admin"
            >
              <ShieldCheck className="w-5 h-5 shrink-0" strokeWidth={1.5} />
              {!collapsed && <span>Админ-панель</span>}
            </NavLink>
          )}
        </nav>

        <div className="p-2 space-y-1">
          <Separator className="bg-border mb-2" />

          <Button
            variant="ghost"
            size="sm"
            onClick={toggleTheme}
            className={`w-full text-muted-foreground hover:text-foreground ${collapsed ? "justify-center px-0" : "justify-start"}`}
            data-testid="theme-toggle-btn"
          >
            {theme === "dark" ? <Sun className="w-4 h-4 shrink-0" /> : <Moon className="w-4 h-4 shrink-0" />}
            {!collapsed && <span className="ml-2">{theme === "dark" ? "Светлая тема" : "Тёмная тема"}</span>}
          </Button>

          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSettingsOpen(true)}
              className={`w-full text-muted-foreground hover:text-foreground ${collapsed ? "justify-center px-0" : "justify-start"}`}
              data-testid="settings-btn"
            >
              <Settings className="w-4 h-4 shrink-0" />
              {!collapsed && <span className="ml-2">Настройки AI</span>}
            </Button>
          )}

          {!collapsed && (
            <div className="px-3 py-2">
              <p className="text-xs font-medium text-foreground truncate">{user.name || "User"}</p>
              <p className="text-xs text-muted-foreground truncate">{user.email || ""}</p>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className={`w-full text-muted-foreground hover:text-red-400 hover:bg-red-500/10 ${collapsed ? "justify-center px-0" : "justify-start"}`}
            data-testid="logout-btn"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {!collapsed && <span className="ml-2">Выйти</span>}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
            className="w-full text-muted-foreground hover:text-foreground"
            data-testid="toggle-sidebar-btn"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto bg-background">
        <Outlet />
      </main>

      <ModelConfigModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
