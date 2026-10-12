import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Moon,
  Scan,
  Settings,
  ShieldCheck,
  Sun,
} from "lucide-react";

import { ModelConfigModal } from "@/components/LlmSettings";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/", icon: LayoutDashboard, label: "Дашборд", end: true },
  { to: "/divisions", icon: Building2, label: "Подразделения" },
];

const readCollapsed = () => {
  try {
    return localStorage.getItem("bp-sidebar-collapsed") === "1" || window.innerWidth < 900;
  } catch {
    return false;
  }
};

function SidebarItem({ collapsed, icon: Icon, label, children, ...props }) {
  const content = (
    <NavLink
      {...props}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
          isActive
            ? "bg-primary/10 text-primary ring-1 ring-primary/20"
            : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
          collapsed && "justify-center px-0"
        )
      }
    >
      <Icon className="w-5 h-5 shrink-0" strokeWidth={1.6} />
      {!collapsed && <span className="truncate">{label}</span>}
      {children}
    </NavLink>
  );
  if (!collapsed) return content;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export default function Layout() {
  const navigate = useNavigate();
  const { user, isAdmin, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem("bp-sidebar-collapsed", collapsed ? "1" : "0");
    } catch {
      // localStorage недоступен — просто не запоминаем состояние
    }
  }, [collapsed]);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const footerButton = "w-full text-muted-foreground hover:text-foreground";
  const envLabel = process.env.REACT_APP_ENV === "test" ? "TEST" : null;

  return (
    <div className="flex h-screen overflow-hidden" data-testid="app-layout">
      <aside
        className={cn(
          "flex shrink-0 flex-col border-r border-border bg-card/80 backdrop-blur transition-[width] duration-300",
          collapsed ? "w-16" : "w-64"
        )}
        data-testid="sidebar"
      >
        <div className={cn("flex items-center gap-3 p-4", collapsed && "justify-center px-2")}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 shadow-lg shadow-blue-500/20">
            <Scan className="h-5 w-5 text-white" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate text-sm font-bold text-foreground">
                AI BP Scanner
                {envLabel && <span className="rounded bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-500">{envLabel}</span>}
              </p>
              <p className="truncate text-xs text-muted-foreground">Анализ бизнес-процессов</p>
            </div>
          )}
        </div>

        <Separator />

        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          {NAV_ITEMS.map((item) => (
            <SidebarItem key={item.to} collapsed={collapsed} data-testid={`nav-${item.label}`} {...item} />
          ))}
          {isAdmin && (
            <SidebarItem collapsed={collapsed} to="/admin" icon={ShieldCheck} label="Админ-панель" data-testid="nav-admin" />
          )}
        </nav>

        <div className="space-y-1 p-2">
          <Separator className="mb-2" />
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleTheme}
            className={cn(footerButton, collapsed ? "justify-center px-0" : "justify-start")}
            data-testid="theme-toggle-btn"
          >
            {theme === "dark" ? <Sun /> : <Moon />}
            {!collapsed && (theme === "dark" ? "Светлая тема" : "Тёмная тема")}
          </Button>

          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSettingsOpen(true)}
              className={cn(footerButton, collapsed ? "justify-center px-0" : "justify-start")}
              data-testid="settings-btn"
            >
              <Settings />
              {!collapsed && "Настройки AI"}
            </Button>
          )}

          {!collapsed && user && (
            <div className="rounded-lg bg-secondary/50 px-3 py-2">
              <p className="truncate text-xs font-medium text-foreground">{user.name || "Пользователь"}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              {isAdmin && <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-500">Администратор</p>}
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className={cn("w-full text-muted-foreground hover:bg-red-500/10 hover:text-red-500", collapsed ? "justify-center px-0" : "justify-start")}
            data-testid="logout-btn"
          >
            <LogOut />
            {!collapsed && "Выйти"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed((value) => !value)}
            className="w-full text-muted-foreground hover:text-foreground"
            aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
            data-testid="toggle-sidebar-btn"
          >
            {collapsed ? <ChevronRight /> : <ChevronLeft />}
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto bg-background">
        <div className="mx-auto max-w-[1600px]">
          <Outlet />
        </div>
      </main>

      {isAdmin && <ModelConfigModal open={settingsOpen} onOpenChange={setSettingsOpen} />}
    </div>
  );
}
