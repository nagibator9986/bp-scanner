import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ArrowRight, BarChart3, Eye, EyeOff, GitBranch, Loader2, Moon, Scan, Sun, Workflow } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import api, { errorMessage } from "@/lib/api";

const FEATURES = [
  { icon: GitBranch, title: "Процессы и BPMN", text: "Выявление процессов и схемы AS-IS / TO-BE с дорожками по ролям" },
  { icon: BarChart3, title: "Скоринг и приоритеты", text: "Оценка по 6 измерениям и индекс потенциала автоматизации" },
  { icon: Workflow, title: "Готовая автоматизация", text: "Рекомендации, эффект в FTE и workflows для импорта в n8n" },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const { token, login } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ email: "", password: "", name: "" });

  if (token) return <Navigate to="/" replace />;

  const update = (key) => (event) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
    setError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const endpoint = isRegister ? "/auth/register" : "/auth/login";
      const payload = isRegister ? form : { email: form.email, password: form.password };
      const { data } = await api.post(endpoint, payload);
      login(data);
      toast.success(isRegister ? "Аккаунт создан" : `Добро пожаловать, ${data.user.name || data.user.email}`);
      navigate("/");
    } catch (err) {
      setError(errorMessage(err, "Не удалось выполнить вход"));
    } finally {
      setLoading(false);
    }
  };

  const title = process.env.REACT_APP_ENV === "test" ? "AI BP Scanner TEST" : "AI BP Scanner";

  return (
    <div className="relative flex min-h-screen bg-background" data-testid="login-page">
      <div className="absolute right-4 top-4 z-10">
        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Сменить тему" data-testid="login-theme-toggle">
          {theme === "dark" ? <Sun /> : <Moon />}
        </Button>
      </div>

      <div className="flex flex-1 items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-md">
          <div className="mb-10 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 shadow-lg shadow-blue-500/25">
              <Scan className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{title}</h1>
              <p className="text-sm text-muted-foreground">Интеллектуальный анализ процессов</p>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card/80 p-7 shadow-xl backdrop-blur">
            <h2 className="text-xl font-semibold text-foreground">{isRegister ? "Создать аккаунт" : "Вход в систему"}</h2>
            <p className="mb-6 mt-1 text-sm text-muted-foreground">
              {isRegister ? "Заполните данные для регистрации" : "Введите учётные данные"}
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              {isRegister && (
                <div className="space-y-1.5">
                  <Label htmlFor="name">Имя</Label>
                  <Input id="name" value={form.name} onChange={update("name")} placeholder="Иван Иванов" className="h-11" required data-testid="register-name-input" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={update("email")}
                  placeholder="user@bank.kz"
                  className="h-11"
                  required
                  data-testid="login-email-input"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Пароль</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={isRegister ? "new-password" : "current-password"}
                    value={form.password}
                    onChange={update("password")}
                    placeholder={isRegister ? "Минимум 6 символов" : "Введите пароль"}
                    minLength={isRegister ? 6 : undefined}
                    className="h-11 pr-10"
                    required
                    data-testid="login-password-input"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500" data-testid="login-error">
                  {error}
                </p>
              )}

              <Button type="submit" disabled={loading} className="h-11 w-full shadow-lg shadow-primary/25" data-testid="login-submit-btn">
                {loading ? <Loader2 className="animate-spin" /> : null}
                {isRegister ? "Зарегистрироваться" : "Войти"}
                {!loading && <ArrowRight />}
              </Button>
            </form>

            <button
              type="button"
              onClick={() => {
                setIsRegister((value) => !value);
                setError("");
              }}
              className="mt-5 w-full text-center text-sm text-muted-foreground transition-colors hover:text-primary"
              data-testid="toggle-auth-mode-btn"
            >
              {isRegister ? "Уже есть аккаунт? Войти" : "Нет аккаунта? Зарегистрироваться"}
            </button>
          </div>
        </div>
      </div>

      <div className="hidden flex-1 items-center justify-center border-l border-border bg-card/40 p-12 lg:flex">
        <div className="max-w-lg">
          <h2 className="text-3xl font-bold leading-tight text-foreground">
            От анкеты подразделения до готовой автоматизации
          </h2>
          <p className="mt-4 leading-relaxed text-muted-foreground">
            Платформа анализирует анкету и внутренние документы, выявляет процессы, оценивает их и предлагает
            план цифровой трансформации с моделями TO-BE и сценариями n8n.
          </p>
          <div className="mt-8 space-y-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="flex items-start gap-4 rounded-xl border border-border bg-card/70 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <feature.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-foreground">{feature.title}</p>
                  <p className="text-sm text-muted-foreground">{feature.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
