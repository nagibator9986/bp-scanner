import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, ClipboardPaste, CloudOff, Loader2, Save, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { AudioInput, DocExtractInput } from "@/components/AudioInput";
import { ErrorState, LoadingState, Meter } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import api, { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

const AUTOSAVE_MS = 1500;

const isAnswered = (value) =>
  value !== undefined && value !== null && (typeof value === "boolean" || String(value).trim() !== "");

const sectionVisible = (section, answers) =>
  !section.condition || answers[section.condition.question_id] === section.condition.value;

function InputToolbar({ questionId, onAppend }) {
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) onAppend(text);
    } catch {
      toast.error("Нет доступа к буферу обмена — используйте Ctrl+V");
    }
  };
  return (
    <div className="mt-1 flex items-center gap-0.5" data-testid={`toolbar-${questionId}`}>
      <AudioInput onTranscript={(text) => onAppend(` ${text}`)} />
      <DocExtractInput onTextExtracted={(text) => onAppend(`\n${text}`)} />
      <Button type="button" variant="ghost" size="sm" onClick={paste} className="h-8 px-2 text-muted-foreground" title="Вставить из буфера" data-testid={`paste-btn-${questionId}`}>
        <ClipboardPaste />
      </Button>
      <span className="ml-1 text-[11px] text-muted-foreground">голос · документ · буфер обмена</span>
    </div>
  );
}

function SaveIndicator({ state, savedAt }) {
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Сохранение…
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-red-500">
        <CloudOff className="h-3.5 w-3.5" /> Не сохранено
      </span>
    );
  }
  if (state === "dirty") return <span className="text-xs text-amber-500">Есть несохранённые изменения</span>;
  if (savedAt) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-emerald-500">
        <Check className="h-3.5 w-3.5" /> Сохранено {savedAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
      </span>
    );
  }
  return null;
}

function SuggestionsPanel({ suggestions, schema, answers, onAccept, onAcceptEmpty, onDismiss }) {
  const questions = Object.fromEntries((schema || []).flatMap((section) => section.questions.map((q) => [q.id, q])));
  const entries = Object.entries(suggestions).filter(([id]) => questions[id]);
  const format = (value) => (typeof value === "boolean" ? (value ? "Да" : "Нет") : String(value));
  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4" data-testid="suggestions-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Sparkles className="h-4 w-4 text-primary" /> Модель предложила ответы на {entries.length} вопросов по документам
        </p>
        <div className="flex gap-2">
          <Button size="sm" onClick={onAcceptEmpty} data-testid="accept-empty-btn">
            <Check /> Принять для пустых полей
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            <X /> Закрыть
          </Button>
        </div>
      </div>
      <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
        {entries.map(([id, value]) => (
          <div key={id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">{questions[id].text}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{format(value)}</p>
                {isAnswered(answers[id]) && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">Сейчас: {format(answers[id])}</p>
                )}
              </div>
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => onAccept(id, value)}>
                {isAnswered(answers[id]) ? "Заменить" : "Принять"}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const QuestionnaireTab = ({ divisionId, onSaved }) => {
  const [schema, setSchema] = useState(null);
  const [answers, setAnswers] = useState({});
  const [loadError, setLoadError] = useState(null);
  const [step, setStep] = useState(0);
  const [saveState, setSaveState] = useState("idle");
  const [suggestions, setSuggestions] = useState(null);
  const [suggesting, setSuggesting] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const answersRef = useRef(answers);
  const dirtyRef = useRef(false);
  const timerRef = useRef(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([api.get("/questionnaire/schema"), api.get(`/divisions/${divisionId}/questionnaire`)])
      .then(([schemaRes, answersRes]) => {
        setSchema(schemaRes.data);
        setAnswers(answersRes.data?.answers || {});
        answersRef.current = answersRes.data?.answers || {};
        if (answersRes.data?.updated_at) setSavedAt(new Date(answersRes.data.updated_at));
      })
      .catch((err) => setLoadError(errorMessage(err, "Не удалось загрузить анкету")));
  }, [divisionId]);

  useEffect(load, [load]);

  const save = useCallback(
    async ({ silent = true } = {}) => {
      clearTimeout(timerRef.current);
      if (!dirtyRef.current && silent) return;
      dirtyRef.current = false;
      setSaveState("saving");
      try {
        const { data } = await api.post(`/divisions/${divisionId}/questionnaire`, { answers: answersRef.current });
        setSaveState(dirtyRef.current ? "dirty" : "saved");
        setSavedAt(new Date());
        onSavedRef.current?.(data.completion);
        if (!silent) toast.success("Анкета сохранена");
      } catch (err) {
        dirtyRef.current = true;
        setSaveState("error");
        toast.error(errorMessage(err, "Ошибка сохранения анкеты"));
      }
    },
    [divisionId]
  );

  // Несохранённые ответы отправляются при уходе с вкладки и предупреждаем при закрытии страницы
  useEffect(() => {
    const warn = (event) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      clearTimeout(timerRef.current);
      if (dirtyRef.current) {
        api.post(`/divisions/${divisionId}/questionnaire`, { answers: answersRef.current }).catch(() => {});
      }
    };
  }, [divisionId]);

  const updateAnswers = (updater) => {
    setAnswers((prev) => {
      const next = updater(prev);
      answersRef.current = next;
      return next;
    });
    dirtyRef.current = true;
    setSaveState("dirty");
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => save(), AUTOSAVE_MS);
  };

  const setAnswer = (id, value) => updateAnswers((prev) => ({ ...prev, [id]: value }));

  const requestSuggestions = async () => {
    setSuggesting(true);
    try {
      const { data } = await api.post(`/divisions/${divisionId}/questionnaire/suggest`);
      if (!data.count) toast.info("В документах не нашлось ответов на вопросы анкеты");
      setSuggestions(data.count ? data.suggestions : null);
    } catch (err) {
      toast.error(errorMessage(err, "Не удалось получить подсказки"));
    } finally {
      setSuggesting(false);
    }
  };
  const acceptSuggestion = (id, value) => {
    setAnswer(id, value);
    setSuggestions((prev) => {
      const next = { ...prev };
      delete next[id];
      return Object.keys(next).length ? next : null;
    });
  };
  const acceptEmpty = () => {
    const accepted = Object.entries(suggestions).filter(([id]) => !isAnswered(answersRef.current[id]));
    updateAnswers((prev) => ({ ...prev, ...Object.fromEntries(accepted) }));
    toast.success(`Заполнено полей: ${accepted.length}`);
    setSuggestions(null);
  };
  const appendText = (id, text) => updateAnswers((prev) => ({ ...prev, [id]: `${prev[id] || ""}${text}`.trim() }));

  const visibleSections = useMemo(() => (schema || []).filter((s) => sectionVisible(s, answers)), [schema, answers]);
  const progress = useMemo(() => {
    const questions = visibleSections.flatMap((s) => s.questions);
    const required = questions.filter((q) => q.required);
    return {
      total: questions.length,
      done: questions.filter((q) => isAnswered(answers[q.id])).length,
      required: required.length,
      requiredDone: required.filter((q) => isAnswered(answers[q.id])).length,
    };
  }, [visibleSections, answers]);

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!schema) return <LoadingState />;

  const currentIndex = Math.min(step, visibleSections.length - 1);
  const section = visibleSections[currentIndex];
  if (!section) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-5" data-testid="questionnaire-tab">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Анкета подразделения</h2>
          <p className="mt-1 text-sm text-muted-foreground">Ответы сохраняются автоматически. Можно диктовать голосом или извлекать текст из документов.</p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Button variant="outline" size="sm" onClick={requestSuggestions} disabled={suggesting} data-testid="suggest-answers-btn">
            {suggesting ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {suggesting ? "Модель читает документы…" : "Заполнить по документам"}
          </Button>
          <SaveIndicator state={saveState} savedAt={savedAt} />
        </div>
      </div>

      {suggestions && (
        <SuggestionsPanel
          suggestions={suggestions}
          schema={schema}
          answers={answers}
          onAccept={acceptSuggestion}
          onAcceptEmpty={acceptEmpty}
          onDismiss={() => setSuggestions(null)}
        />
      )}

      <div className="rounded-xl border border-border bg-card/70 p-4">
        <div className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Заполнено {progress.done} из {progress.total} вопросов
          </span>
          <span className={progress.requiredDone === progress.required ? "text-emerald-500" : ""}>
            Обязательных: {progress.requiredDone} / {progress.required}
          </span>
        </div>
        <Meter value={progress.done} max={progress.total || 1} />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {visibleSections.map((item, index) => {
          const done = item.questions.filter((q) => isAnswered(answers[q.id])).length;
          const complete = item.questions.filter((q) => q.required).every((q) => isAnswered(answers[q.id])) && done > 0;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setStep(index)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                index === currentIndex
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : complete
                  ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
              data-testid={`step-${item.id}`}
            >
              {complete && index !== currentIndex ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-xs">{index + 1}</span>
              )}
              {item.title}
              <span className="text-xs opacity-70">
                {done}/{item.questions.length}
              </span>
            </button>
          );
        })}
      </div>

      <div className="space-y-6 rounded-xl border border-border bg-card/70 p-6">
        <h3 className="text-lg font-semibold text-foreground">{section.title}</h3>
        {section.questions.map((question) => (
          <div key={question.id} className="space-y-1.5" data-testid={`question-${question.id}`}>
            <Label htmlFor={question.id} className="text-sm text-foreground">
              {question.text}
              {question.required && <span className="ml-1 text-red-500">*</span>}
            </Label>

            {(question.type === "textarea" || question.type === "text") && (
              <>
                {question.type === "textarea" ? (
                  <Textarea
                    id={question.id}
                    value={answers[question.id] || ""}
                    onChange={(e) => setAnswer(question.id, e.target.value)}
                    onBlur={() => save()}
                    placeholder={question.placeholder || ""}
                    className="min-h-[110px]"
                  />
                ) : (
                  <Input
                    id={question.id}
                    value={answers[question.id] || ""}
                    onChange={(e) => setAnswer(question.id, e.target.value)}
                    onBlur={() => save()}
                    placeholder={question.placeholder || ""}
                  />
                )}
                <InputToolbar questionId={question.id} onAppend={(text) => appendText(question.id, text)} />
              </>
            )}

            {question.type === "number" && (
              <Input
                id={question.id}
                type="number"
                value={answers[question.id] ?? ""}
                onChange={(e) => setAnswer(question.id, e.target.value === "" ? null : Number(e.target.value))}
              />
            )}

            {question.type === "select" && (
              <Select value={answers[question.id] || ""} onValueChange={(value) => setAnswer(question.id, value)}>
                <SelectTrigger id={question.id}>
                  <SelectValue placeholder="Выберите…" />
                </SelectTrigger>
                <SelectContent>
                  {(question.options || []).map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {question.type === "boolean" && (
              <div className="flex items-center gap-3">
                <Switch id={question.id} checked={answers[question.id] === true} onCheckedChange={(value) => setAnswer(question.id, value)} />
                <span className="text-sm text-muted-foreground">{answers[question.id] === true ? "Да" : "Нет"}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" onClick={() => setStep(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0} data-testid="prev-step-btn">
          <ChevronLeft /> Назад
        </Button>
        <Button variant="secondary" onClick={() => save({ silent: false })} disabled={saveState === "saving"} data-testid="save-questionnaire-btn">
          {saveState === "saving" ? <Loader2 className="animate-spin" /> : <Save />} Сохранить
        </Button>
        <Button
          onClick={() => {
            save();
            setStep(Math.min(visibleSections.length - 1, currentIndex + 1));
          }}
          disabled={currentIndex >= visibleSections.length - 1}
          data-testid="next-step-btn"
        >
          Далее <ChevronRight />
        </Button>
      </div>
    </div>
  );
};
