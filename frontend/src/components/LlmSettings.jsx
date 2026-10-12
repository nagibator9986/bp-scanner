import { useEffect, useState } from "react";
import { CheckCircle2, Globe, KeyRound, Loader2, PlugZap, Save, Server, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import api, { errorMessage } from "@/lib/api";
import { formatNumber, formatTokens } from "@/lib/format";
import { cn } from "@/lib/utils";

const PROVIDERS = [
  { value: "custom", label: "Внутренняя модель", desc: "OpenAI-совместимый API: vLLM, Ollama, TGI, LiteLLM (Qwen и др.)" },
  { value: "openai", label: "OpenAI", desc: "Облачный API OpenAI" },
];

const EMPTY = {
  provider: "custom",
  endpoint_url: "",
  model_name: "",
  api_key: "",
  max_tokens: "",
  context_tokens: "",
  temperature: 0.2,
  disable_thinking: false,
  json_mode: false,
};

function Field({ label, icon: Icon, hint, children }) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {Icon && <Icon className="w-3.5 h-3.5" />} {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange, testId }) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-lg border border-border p-3 cursor-pointer">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} data-testid={testId} />
    </label>
  );
}

/** Форма настроек подключения к LLM (используется в модальном окне и в админ-панели). */
export function LlmSettingsForm({ onSaved }) {
  const [form, setForm] = useState(EMPTY);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/settings")
      .then(({ data }) => {
        if (cancelled) return;
        setMeta(data);
        setForm({
          provider: data.provider === "openai" ? "openai" : "custom",
          endpoint_url: data.endpoint_url || "",
          model_name: data.model_name || "",
          api_key: "",
          max_tokens: data.max_tokens || "",
          context_tokens: data.context_tokens || "",
          temperature: data.temperature ?? 0.2,
          disable_thinking: Boolean(data.disable_thinking),
          json_mode: Boolean(data.json_mode),
        });
      })
      .catch((err) => toast.error(errorMessage(err, "Не удалось загрузить настройки")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (key) => (value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setTestResult(null);
  };

  const payload = () => ({
    ...form,
    max_tokens: form.max_tokens ? Number(form.max_tokens) : null,
    context_tokens: form.context_tokens ? Number(form.context_tokens) : null,
    temperature: Number(form.temperature) || 0,
  });

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.post("/settings", payload());
      setMeta(data);
      setForm((prev) => ({ ...prev, api_key: "" }));
      toast.success("Настройки модели сохранены");
      onSaved?.(data);
    } catch (err) {
      toast.error(errorMessage(err, "Ошибка сохранения"));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await api.post("/settings/test", payload());
      setTestResult(data);
    } catch (err) {
      setTestResult({ success: false, error: errorMessage(err) });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const isCustom = form.provider === "custom";
  const canSave = form.model_name.trim() && (isCustom ? form.endpoint_url.trim() : form.api_key || meta?.api_key_set);

  return (
    <div className="space-y-5" data-testid="llm-settings-form">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {PROVIDERS.map((provider) => (
          <button
            key={provider.value}
            type="button"
            onClick={() => set("provider")(provider.value)}
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
              form.provider === provider.value ? "border-primary/50 bg-primary/5" : "border-border hover:border-muted-foreground/40"
            )}
            data-testid={`provider-${provider.value}`}
          >
            <Server className={cn("w-4 h-4 mt-0.5 shrink-0", form.provider === provider.value ? "text-primary" : "text-muted-foreground")} />
            <div>
              <p className="text-sm font-medium text-foreground">{provider.label}</p>
              <p className="text-xs text-muted-foreground">{provider.desc}</p>
            </div>
          </button>
        ))}
      </div>

      {isCustom && (
        <Field label="Endpoint URL" icon={Globe} hint="Базовый адрес OpenAI-совместимого API, обычно заканчивается на /v1">
          <Input
            value={form.endpoint_url}
            onChange={(e) => set("endpoint_url")(e.target.value)}
            placeholder="http://qwen.internal:8000/v1"
            data-testid="endpoint-url-input"
          />
        </Field>
      )}

      <Field label="Модель" icon={Server} hint={isCustom ? "Имя модели на сервере, например Qwen/Qwen3-32B или qwen2.5:72b" : undefined}>
        <Input
          value={form.model_name}
          onChange={(e) => set("model_name")(e.target.value)}
          placeholder={isCustom ? "Qwen/Qwen3-32B" : "gpt-4o-mini"}
          data-testid="model-name-input"
        />
      </Field>

      <Field
        label={isCustom ? "API-ключ (если требуется)" : "API-ключ"}
        icon={KeyRound}
        hint={meta?.api_key_set ? `Сохранён ключ ${meta.api_key_display}. Оставьте поле пустым, чтобы не менять его.` : undefined}
      >
        <Input
          type="password"
          value={form.api_key}
          onChange={(e) => set("api_key")(e.target.value)}
          placeholder={meta?.api_key_set ? "••••••••" : isCustom ? "не требуется" : "sk-..."}
          autoComplete="new-password"
          data-testid="api-key-input"
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Макс. токенов ответа" hint="Пусто — по умолчанию сервера">
          <Input
            type="number"
            min={0}
            value={form.max_tokens}
            onChange={(e) => set("max_tokens")(e.target.value)}
            placeholder="8192"
          />
        </Field>
        <Field label="Контекстное окно" hint="Пусто — определить автоматически (vLLM: max_model_len)">
          <Input
            type="number"
            min={0}
            value={form.context_tokens}
            onChange={(e) => set("context_tokens")(e.target.value)}
            placeholder="авто"
            data-testid="context-tokens-input"
          />
        </Field>
        <Field label="Температура" hint="0–2, для анализа лучше 0–0.3">
          <Input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={form.temperature}
            onChange={(e) => set("temperature")(e.target.value)}
          />
        </Field>
      </div>

      {isCustom && (
        <div className="space-y-2">
          <ToggleRow
            label="Отключить режим рассуждений (Qwen3)"
            hint="Передаёт chat_template_kwargs.enable_thinking=false — ответы быстрее и короче. Поддерживается vLLM/SGLang."
            checked={form.disable_thinking}
            onChange={set("disable_thinking")}
            testId="disable-thinking-switch"
          />
          <ToggleRow
            label="JSON-режим (response_format)"
            hint="Гарантирует валидный JSON, если сервер поддерживает guided decoding. При ошибке параметр отключится автоматически."
            checked={form.json_mode}
            onChange={set("json_mode")}
          />
        </div>
      )}

      {testResult && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border p-3 text-sm",
            testResult.success ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"
          )}
          data-testid="llm-test-result"
        >
          {testResult.success ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
          ) : (
            <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              {testResult.success ? `Соединение установлено. Ответ модели: «${testResult.reply}»` : testResult.error}
            </p>
            {testResult.success && testResult.context_tokens && (
              <p className="mt-1 text-xs text-muted-foreground">
                Контекстное окно: {formatNumber(testResult.context_tokens, 0)} токенов ({testResult.context_source}) · под промпт ≈{" "}
                {formatTokens(testResult.input_budget)} токенов, остальное — под ответ
              </p>
            )}
            {testResult.detail && <p className="mt-1 break-words text-xs text-muted-foreground">{testResult.detail}</p>}
          </div>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button variant="outline" onClick={test} disabled={testing || !form.model_name.trim()} className="sm:flex-1" data-testid="test-llm-btn">
          {testing ? <Loader2 className="animate-spin" /> : <PlugZap />}
          Проверить соединение
        </Button>
        <Button onClick={save} disabled={saving || !canSave} className="sm:flex-1" data-testid="save-settings-btn">
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          Сохранить
        </Button>
      </div>
    </div>
  );
}

export function ModelConfigModal({ open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-xl max-h-[90vh] overflow-y-auto" data-testid="model-config-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="w-5 h-5 text-primary" /> Настройки AI-модели
          </DialogTitle>
          <DialogDescription>Подключение модели, которая выполняет анализ процессов.</DialogDescription>
        </DialogHeader>
        {open && <LlmSettingsForm onSaved={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
