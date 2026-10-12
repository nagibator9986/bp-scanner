import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Scan, ArrowRight, Eye, EyeOff, Sun, Moon } from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "@/contexts/ThemeContext";
import api from "@/lib/api";

export default function LoginPage() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", name: "" });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const endpoint = isRegister ? "/auth/register" : "/auth/login";
      const payload = isRegister ? form : { email: form.email, password: form.password };
      const { data } = await api.post(endpoint, payload);
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      toast.success(isRegister ? "Регистрация успешна" : "Вход выполнен");
      navigate("/");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Ошибка авторизации");
    } finally {
      setLoading(false);
    }
  };

  const ThemeButton = () => (
    <Button variant="ghost" size="icon" onClick={toggleTheme} className="text-muted-foreground hover:text-foreground" data-testid="login-theme-toggle">
      {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
    </Button>
  );

 const envName = process.env.REACT_APP_ENV;
 const title =
    envName === "test"
        ? "AI BP Scanner TEST"
        : "AI BP Scanner";

  return (
    <div className="min-h-screen flex bg-background" data-testid="login-page">
      <div className="absolute top-4 right-4 z-10">
        <ThemeButton />
      </div>
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md animate-fade-in-up">
          <div className="flex items-center gap-3 mb-12">
            <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center glow-blue">
              <Scan className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white" style={{ fontFamily: "IBM Plex Sans" }}>
                {title}
              </h1>
              <p className="text-sm text-slate-500">Интеллектуальный анализ процессов</p>
            </div>
          </div>

          <div className="glass-card rounded-xl p-8">
            <h2 className="text-xl font-semibold text-foreground mb-1">
              {isRegister ? "Создать аккаунт" : "Вход в систему"}
            </h2>
            <p className="text-sm text-muted-foreground mb-8">
              {isRegister ? "Заполните данные для регистрации" : "Введите учётные данные для входа"}
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">
              {isRegister && (
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-sm">Имя</Label>
                  <Input
                    data-testid="register-name-input"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Ваше имя"
                    className="bg-background border-input focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder:text-muted-foreground/50 h-11"
                    required
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label className="text-muted-foreground text-sm">Email</Label>
                <Input
                  data-testid="login-email-input"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="user@bank.com"
                  className="bg-background border-input focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder:text-muted-foreground/50 h-11"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground text-sm">Пароль</Label>
                <div className="relative">
                  <Input
                    data-testid="login-password-input"
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="Введите пароль"
                    className="bg-background border-input focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder:text-muted-foreground/50 h-11 pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                data-testid="login-submit-btn"
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-[0_0_15px_rgba(59,130,246,0.4)] hover:shadow-[0_0_25px_rgba(59,130,246,0.5)] transition-all"
              >
                {loading ? "Загрузка..." : (isRegister ? "Зарегистрироваться" : "Войти")}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </form>

            <div className="mt-6 text-center">
              <button
                data-testid="toggle-auth-mode-btn"
                onClick={() => setIsRegister(!isRegister)}
                className="text-sm text-muted-foreground hover:text-blue-400 transition-colors"
              >
                {isRegister ? "Уже есть аккаунт? Войти" : "Нет аккаунта? Зарегистрироваться"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 items-center justify-center bg-card border-l border-border p-12">
        <div className="max-w-lg text-center animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
          <div className="w-24 h-24 mx-auto mb-8 rounded-2xl bg-blue-600/10 flex items-center justify-center border border-blue-500/20 animate-pulse-glow">
            <Scan className="w-12 h-12 text-blue-400" />
          </div>
          <h2 className="text-3xl font-bold text-foreground mb-4" style={{ fontFamily: "IBM Plex Sans" }}>
            Трансформация бизнес-процессов
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            AI-платформа для анализа, скоринга и автоматизации бизнес-процессов банковских подразделений.
            От опросника до готового N8N workflow за минуты.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-4">
            {["Глубокий анализ", "BPMN AS-IS/TO-BE", "N8N автоматизация"].map((t, i) => (
              <div key={i} className="glass-card rounded-lg p-3">
                <p className="text-xs text-blue-400 font-medium">{t}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
