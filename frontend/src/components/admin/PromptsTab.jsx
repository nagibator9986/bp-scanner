import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  Copy,
  FileCode,
  History,
  Info,
  Loader2,
  Play,
  RotateCcw,
  Save,
  Undo2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog, EmptyState, ErrorState, LoadingState, Panel } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useApi } from "@/hooks/useApi";
import api, { errorMessage } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Плейсхолдер, который бэкенд добавляет в конец промпта сам, если его нет в шаблоне. */
const AUTO_PLACEHOLDER = "knowledge_context";
const PLACEHOLDER_RE = /\{([a-z_]+)\}/g;
const LIMITS = { system_prompt: 20000, user_prompt_template: 50000, description: 1000 };

const toForm = (prompt) => ({
  system_prompt: prompt.system_prompt || "",
  user_prompt_template: prompt.user_prompt_template || "",
  description: prompt.description || "",
});

const isSameForm = (a, b) =>
  a.system_prompt === b.system_prompt && a.user_prompt_template === b.user_prompt_template && a.description === b.description;

function PromptBadge({ prompt }) {
  return prompt.is_default ? (
    <Badge variant="secondary" className="font-normal" data-testid="prompt-default-badge">
      По умолчанию
    </Badge>
  ) : (
    <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 font-normal text-blue-500" data-testid="prompt-custom-badge">
      Изменён · v{prompt.version}
    </Badge>
  );
}

function CharCount({ value, limit }) {
  const over = value.length > limit;
  return (
    <span className={cn("text-xs tabular-nums", over ? "text-red-500" : "text-muted-foreground")}>
      {formatNumber(value.length, 0)} / {formatNumber(limit, 0)}
    </span>
  );
}

function Notice({ tone = "info", icon: Icon = Info, children, testId }) {
  const tones = {
    info: "border-blue-500/25 bg-blue-500/5",
    warning: "border-amber-500/30 bg-amber-500/10",
  };
  const iconTones = { info: "text-blue-500", warning: "text-amber-500" };
  return (
    <div className={cn("flex items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed text-foreground", tones[tone])} data-testid={testId}>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", iconTones[tone])} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const code = (name) => (
  <code key={name} className="rounded bg-secondary px-1 py-0.5 font-mono text-[11px] text-foreground">
    {`{${name}}`}
  </code>
);

const joinCodes = (names) =>
  names.flatMap((name, index) => (index === 0 ? [code(name)] : [<span key={`sep-${name}`}>, </span>, code(name)]));

/** Тестовый прогон текущего текста редактора на подключённой модели. */
function PromptTestPanel({ systemPrompt, userPrompt }) {
  const [testInput, setTestInput] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const run = async () => {
    setRunning(true);
    setResult(null);
    const started = performance.now();
    try {
      const { data } = await api.post("/admin/prompts/test", {
        system_prompt: systemPrompt,
        user_prompt: userPrompt,
        test_input: testInput,
      });
      setResult({ ...data, elapsed: (performance.now() - started) / 1000 });
    } catch (err) {
      setResult({ success: false, error: errorMessage(err, "Не удалось выполнить тест") });
    } finally {
      setRunning(false);
    }
  };

  // Ответ этапов анализа должен быть JSON — проверяем и красиво форматируем
  const json = useMemo(() => {
    if (!result?.success || typeof result.response !== "string") return null;
    const raw = result.response.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return null;
    }
  }, [result]);

  const responseText = result?.success ? json || String(result.response ?? "") : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(responseText);
      toast.success("Ответ скопирован");
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  return (
    <Panel
      title="Тестирование"
      icon={Play}
      description="Отправляет текущий текст редактора (включая несохранённые изменения) в подключённую модель"
      data-testid="prompt-test-panel"
    >
      <div className="space-y-3">
        <Notice>
          При тесте плейсхолдеры не подставляются — шаблон отправляется как есть, а тестовые данные добавляются в конец
          промпта под заголовком «Тестовые данные».
        </Notice>
        <div className="space-y-1.5">
          <Label htmlFor="prompt-test-input" className="text-sm text-muted-foreground">
            Тестовые данные (необязательно)
          </Label>
          <Textarea
            id="prompt-test-input"
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            placeholder="Например, фрагмент анкеты или JSON с процессами…"
            className="min-h-[110px] font-mono text-xs"
            data-testid="prompt-test-input"
          />
        </div>
        <Button onClick={run} disabled={running || !userPrompt.trim()} data-testid="prompt-test-btn">
          {running ? <Loader2 className="animate-spin" /> : <Play />}
          {running ? "Модель отвечает…" : "Запустить тест"}
        </Button>

        {result && (
          <div
            className={cn(
              "space-y-2 rounded-lg border p-3",
              result.success ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"
            )}
            data-testid="prompt-test-result"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {result.success ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
                <span className="font-medium text-foreground">{result.success ? "Ответ модели" : result.error || "Ошибка"}</span>
                {result.success && result.elapsed != null && (
                  <span className="text-xs text-muted-foreground">
                    за {formatNumber(result.elapsed, 1)} с · {formatNumber(responseText.length, 0)} симв.
                  </span>
                )}
                {result.success &&
                  (json ? (
                    <Badge variant="outline" className="border-emerald-500/30 font-normal text-emerald-500">
                      Валидный JSON
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-500/30 font-normal text-amber-500">
                      Не JSON
                    </Badge>
                  ))}
              </div>
              {result.success && (
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={copy}>
                  <Copy /> Копировать
                </Button>
              )}
            </div>
            {result.success ? (
              <pre
                className="max-h-[480px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/60 p-3 font-mono text-xs leading-relaxed text-foreground"
                data-testid="prompt-test-response"
              >
                {responseText || "Пустой ответ"}
              </pre>
            ) : (
              result.detail && (
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/60 p-3 font-mono text-xs text-muted-foreground">
                  {result.detail}
                </pre>
              )
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

function PromptHistoryList({ prompt, onRestored }) {
  const path = `/admin/prompts/${encodeURIComponent(prompt.step_name)}/history`;
  const { data, error, loading, reload } = useApi(path);
  const [toRestore, setToRestore] = useState(null);
  const [restoring, setRestoring] = useState(false);

  const restore = async () => {
    if (!toRestore) return;
    setRestoring(true);
    try {
      const { data: result } = await api.post(
        `/admin/prompts/${encodeURIComponent(prompt.step_name)}/restore/${toRestore.version}`
      );
      toast.success(`Версия ${toRestore.version} восстановлена как версия ${result?.new_version ?? ""}`.trim());
      setToRestore(null);
      onRestored();
    } catch (err) {
      toast.error(errorMessage(err, "Не удалось восстановить версию"));
    } finally {
      setRestoring(false);
    }
  };

  if (loading) return <LoadingState label="Загрузка истории…" className="py-10" />;
  if (error) return <ErrorState message={error} onRetry={reload} className="py-8" />;
  if (!data?.length) {
    return (
      <EmptyState
        icon={History}
        title="История пуста"
        description="Предыдущие версии появятся после первого сохранения изменённого промпта."
        className="py-10"
      />
    );
  }

  return (
    <>
      <ul className="space-y-2" data-testid="prompt-history-list">
        {data.map((item) => (
          <li key={item.id} className="rounded-lg border border-border bg-background/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono font-normal">
                  v{item.version}
                </Badge>
                <span className="text-xs text-muted-foreground">сохранена в историю {formatDateTime(item.created_at)}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setToRestore(item)}
                data-testid={`prompt-restore-${item.version}`}
              >
                <RotateCcw /> Восстановить
              </Button>
            </div>
            <details className="group mt-2">
              <summary className="cursor-pointer select-none text-xs text-primary hover:underline">Показать текст версии</summary>
              <div className="mt-2 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Системный промпт</p>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/60 p-2 font-mono text-[11px] text-foreground">
                  {item.system_prompt || "—"}
                </pre>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Шаблон</p>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/60 p-2 font-mono text-[11px] text-foreground">
                  {item.user_prompt_template || "—"}
                </pre>
              </div>
            </details>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={Boolean(toRestore)}
        onOpenChange={(open) => !open && !restoring && setToRestore(null)}
        title={toRestore ? `Восстановить версию ${toRestore.version}?` : ""}
        description="Текущий текст промпта сохранится в историю, а восстановленный станет новой версией и будет использоваться в следующих анализах."
        confirmLabel="Восстановить"
        destructive={false}
        onConfirm={restore}
        busy={restoring}
      />
    </>
  );
}

export function PromptsTab() {
  const { data, error, loading, reload } = useApi("/admin/prompts");
  const prompts = useMemo(() => data || [], [data]);

  const [selectedStep, setSelectedStep] = useState(null);
  const [pendingStep, setPendingStep] = useState(null);
  const activeStep =
    selectedStep && prompts.some((p) => p.step_name === selectedStep) ? selectedStep : prompts[0]?.step_name;
  const current = useMemo(() => prompts.find((p) => p.step_name === activeStep) || null, [prompts, activeStep]);

  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const templateRef = useRef(null);

  // Новый этап или обновлённые с сервера данные — заполняем редактор заново
  useEffect(() => {
    setForm(current ? toForm(current) : null);
  }, [current]);

  const dirty = Boolean(form && current) && !isSameForm(form, toForm(current));

  const analysis = useMemo(() => {
    if (!form || !current) return null;
    const template = form.user_prompt_template;
    const declared = current.placeholders || [];
    const used = new Set(Array.from(template.matchAll(PLACEHOLDER_RE), (match) => match[1]));
    return {
      used,
      missing: declared.filter((name) => name !== AUTO_PLACEHOLDER && !used.has(name)),
      unknown: Array.from(used).filter((name) => !declared.includes(name)),
      knowledgeAuto: declared.includes(AUTO_PLACEHOLDER) && !used.has(AUTO_PLACEHOLDER),
      legacy: template.includes("{{"),
    };
  }, [form, current]);

  const requestStep = (step) => {
    if (step === activeStep) return;
    if (dirty) setPendingStep(step);
    else setSelectedStep(step);
  };

  const setField = (key) => (event) => {
    const { value } = event.target;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const insertPlaceholder = (name) => {
    const token = `{${name}}`;
    const element = templateRef.current;
    const value = form.user_prompt_template;
    const start = element ? element.selectionStart : value.length;
    const end = element ? element.selectionEnd : value.length;
    setForm((prev) => ({ ...prev, user_prompt_template: value.slice(0, start) + token + value.slice(end) }));
    requestAnimationFrame(() => {
      if (!element) return;
      element.focus();
      element.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const tooLong =
    form &&
    (form.system_prompt.length > LIMITS.system_prompt ||
      form.user_prompt_template.length > LIMITS.user_prompt_template ||
      form.description.length > LIMITS.description);

  const save = async () => {
    if (!form || !current || saving) return;
    if (!form.user_prompt_template.trim()) {
      toast.error("Шаблон пользовательского промпта не может быть пустым");
      return;
    }
    if (tooLong) {
      toast.error("Текст превышает допустимую длину");
      return;
    }
    setSaving(true);
    try {
      const { data: result } = await api.post("/admin/prompts", {
        step_name: current.step_name,
        system_prompt: form.system_prompt,
        user_prompt_template: form.user_prompt_template,
        description: form.description,
      });
      toast.success(`Промпт «${current.step_title}» сохранён${result?.version ? ` (версия ${result.version})` : ""}`);
      await reload({ silent: true });
    } catch (err) {
      toast.error(errorMessage(err, "Не удалось сохранить промпт"));
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = async () => {
    if (!current) return;
    setResetting(true);
    try {
      await api.post(`/admin/prompts/${encodeURIComponent(current.step_name)}/reset`);
      toast.success(`Промпт «${current.step_title}» сброшен к значению по умолчанию`);
      setResetOpen(false);
      await reload({ silent: true });
    } catch (err) {
      toast.error(errorMessage(err, "Не удалось сбросить промпт"));
    } finally {
      setResetting(false);
    }
  };

  const onEditorKeyDown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (dirty) save();
    }
  };

  if (loading) return <LoadingState label="Загрузка промптов…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!prompts.length) {
    return <EmptyState icon={FileCode} title="Промпты не найдены" description="Сервер не вернул ни одного этапа анализа." />;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]" data-testid="prompts-tab">
      <Panel title="Этапы анализа" icon={FileCode} bodyClassName="px-2 pb-2" className="self-start">
        <nav className="space-y-1" aria-label="Этапы анализа">
          {prompts.map((prompt) => {
            const active = prompt.step_name === activeStep;
            return (
              <button
                key={prompt.step_name}
                type="button"
                onClick={() => requestStep(prompt.step_name)}
                className={cn(
                  "w-full rounded-lg px-3 py-2.5 text-left transition-colors",
                  active ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-secondary/60"
                )}
                aria-current={active ? "true" : undefined}
                data-testid={`prompt-step-${prompt.step_name}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("truncate text-sm font-medium", active ? "text-primary" : "text-foreground")}>
                    {prompt.step_title}
                  </span>
                  {active && dirty && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Есть несохранённые изменения" />}
                </div>
                {prompt.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{prompt.description}</p>}
                <div className="mt-1.5">
                  <PromptBadge prompt={prompt} />
                </div>
              </button>
            );
          })}
        </nav>
      </Panel>

      {current && form && analysis && (
        <div className="min-w-0 space-y-4">
          <Panel
            title={current.step_title}
            icon={Braces}
            description={
              current.is_default
                ? "Используется стандартный промпт"
                : `Версия ${current.version}${current.updated_at ? ` · изменён ${formatDateTime(current.updated_at)}` : ""}`
            }
            actions={<PromptBadge prompt={current} />}
            data-testid="prompt-editor"
          >
            <div className="space-y-5" onKeyDown={onEditorKeyDown}>
              <Notice>
                Подставляются только плейсхолдеры этого этапа, записанные в одинарных фигурных скобках, например{" "}
                {code("division_name")}. Фигурные скобки в примерах JSON тоже пишутся одинарными — они остаются в тексте
                как есть. Изменения применяются к следующим запускам анализа.
              </Notice>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="prompt-description" className="text-sm text-muted-foreground">
                    Описание
                  </Label>
                  <CharCount value={form.description} limit={LIMITS.description} />
                </div>
                <Input
                  id="prompt-description"
                  value={form.description}
                  onChange={setField("description")}
                  placeholder="Назначение промпта"
                  data-testid="prompt-description-input"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="prompt-system" className="text-sm text-muted-foreground">
                    Системный промпт
                  </Label>
                  <CharCount value={form.system_prompt} limit={LIMITS.system_prompt} />
                </div>
                <Textarea
                  id="prompt-system"
                  value={form.system_prompt}
                  onChange={setField("system_prompt")}
                  placeholder="Роль и правила поведения модели…"
                  className="min-h-[160px] font-mono text-xs leading-relaxed md:text-xs"
                  spellCheck={false}
                  data-testid="prompt-system-input"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="prompt-template" className="text-sm text-muted-foreground">
                    Шаблон пользовательского промпта
                  </Label>
                  <CharCount value={form.user_prompt_template} limit={LIMITS.user_prompt_template} />
                </div>
                <div className="flex flex-wrap items-center gap-1.5" data-testid="placeholder-chips">
                  <span className="mr-1 text-xs text-muted-foreground">Вставить:</span>
                  {(current.placeholders || []).map((name) => {
                    const used = analysis.used.has(name);
                    const auto = name === AUTO_PLACEHOLDER;
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => insertPlaceholder(name)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors",
                          used
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/15"
                            : auto
                              ? "border-border bg-secondary/60 text-muted-foreground hover:text-foreground"
                              : "border-amber-500/40 bg-amber-500/10 text-amber-500 hover:bg-amber-500/15"
                        )}
                        title={
                          used
                            ? "Уже есть в шаблоне — нажмите, чтобы вставить ещё раз"
                            : auto
                              ? "Необязательно: при отсутствии добавляется в конец автоматически"
                              : "Отсутствует в шаблоне — нажмите, чтобы вставить в позицию курсора"
                        }
                        data-testid={`placeholder-chip-${name}`}
                      >
                        {used && <CheckCircle2 className="h-3 w-3" />}
                        {`{${name}}`}
                      </button>
                    );
                  })}
                </div>
                <Textarea
                  id="prompt-template"
                  ref={templateRef}
                  value={form.user_prompt_template}
                  onChange={setField("user_prompt_template")}
                  placeholder="Шаблон с плейсхолдерами…"
                  className="min-h-[420px] font-mono text-xs leading-relaxed md:text-xs"
                  spellCheck={false}
                  data-testid="prompt-template-input"
                />
              </div>

              <div className="space-y-2">
                {analysis.missing.length > 0 && (
                  <Notice tone="warning" icon={AlertTriangle} testId="prompt-missing-placeholders">
                    В шаблоне нет {analysis.missing.length > 1 ? "плейсхолдеров" : "плейсхолдера"} {joinCodes(analysis.missing)} —
                    эти данные не попадут в промпт.
                  </Notice>
                )}
                {analysis.unknown.length > 0 && (
                  <Notice tone="warning" icon={AlertTriangle} testId="prompt-unknown-placeholders">
                    {joinCodes(analysis.unknown)} — не входят в список плейсхолдеров этого этапа, подстановка не
                    гарантируется: текст может остаться как есть.
                  </Notice>
                )}
                {analysis.knowledgeAuto && (
                  <Notice testId="prompt-knowledge-hint">
                    {code(AUTO_PLACEHOLDER)} можно не указывать: если его нет в шаблоне, контекст из базы знаний
                    автоматически добавляется в конец промпта.
                  </Notice>
                )}
                {analysis.legacy && (
                  <Notice>
                    Шаблон в старом формате: двойные скобки <code className="font-mono">{"{{ }}"}</code> при отправке будут
                    заменены на одинарные.
                  </Notice>
                )}
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setHistoryOpen(true)} data-testid="prompt-history-btn">
                    <History /> История
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setResetOpen(true)}
                    disabled={current.is_default}
                    title={current.is_default ? "Уже используется промпт по умолчанию" : undefined}
                    data-testid="prompt-reset-btn"
                  >
                    <RotateCcw /> Сбросить к умолчанию
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  {dirty && (
                    <Button variant="ghost" onClick={() => setForm(toForm(current))} disabled={saving} data-testid="prompt-revert-btn">
                      <Undo2 /> Отменить изменения
                    </Button>
                  )}
                  <Button onClick={save} disabled={!dirty || saving || tooLong} data-testid="prompt-save-btn">
                    {saving ? <Loader2 className="animate-spin" /> : <Save />}
                    Сохранить
                  </Button>
                </div>
              </div>
              {dirty && <p className="text-right text-xs text-muted-foreground">Есть несохранённые изменения · Ctrl+S — сохранить</p>}
            </div>
          </Panel>

          <PromptTestPanel key={current.step_name} systemPrompt={form.system_prompt} userPrompt={form.user_prompt_template} />

          <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
            <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto border-border bg-card" data-testid="prompt-history-dialog">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 pr-6">
                  <History className="h-5 w-5 text-primary" /> История версий: {current.step_title}
                </DialogTitle>
                <DialogDescription>
                  Сюда попадают предыдущие версии при каждом сохранении, восстановлении и сбросе. Текущая версия — v
                  {current.version}.
                </DialogDescription>
              </DialogHeader>
              {historyOpen && (
                <PromptHistoryList
                  prompt={current}
                  onRestored={() => {
                    setHistoryOpen(false);
                    reload({ silent: true });
                  }}
                />
              )}
            </DialogContent>
          </Dialog>
        </div>
      )}

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={(open) => !resetting && setResetOpen(open)}
        title="Сбросить промпт к значению по умолчанию?"
        description="Текущая версия сохранится в истории — её можно будет восстановить."
        confirmLabel="Сбросить"
        onConfirm={resetToDefault}
        busy={resetting}
      />

      <ConfirmDialog
        open={Boolean(pendingStep)}
        onOpenChange={(open) => !open && setPendingStep(null)}
        title="Несохранённые изменения"
        description="Изменения в текущем промпте будут потеряны. Перейти к другому этапу?"
        confirmLabel="Перейти без сохранения"
        onConfirm={() => {
          setSelectedStep(pendingStep);
          setPendingStep(null);
        }}
      />
    </div>
  );
}
