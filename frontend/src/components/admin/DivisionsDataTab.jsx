import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, Building2, ClipboardList, Eye, FileText, Search } from "lucide-react";

import { EmptyState, ErrorState, LoadingState, Meter, Panel, StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApi } from "@/hooks/useApi";
import { STATUS, normalizeStatus } from "@/lib/constants";
import { formatDate, formatDateTime, formatNumber, formatSize, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_KEYS = Object.keys(STATUS);

const completionOf = (division) => {
  const completion = division.questionnaire_completion || {};
  return { percent: Math.round(completion.percent || 0), required: Math.round(completion.required_percent || 0) };
};

/** Зелёный — все обязательные вопросы отвечены, янтарный — анкета начата, серый — не начата. */
const completionColor = (percent, required) => (required >= 100 ? "#10b981" : percent > 0 ? "#f59e0b" : "#64748b");

const isAnswered = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return true;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
};

const formatAnswer = (value) => {
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (Array.isArray(value)) return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ");
  if (value && typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
};

/** Группирует ответы анкеты по разделам схемы; ответы вне схемы — в «Прочие ответы». */
function buildSections(answers, schema) {
  const known = new Set();
  const sections = [];
  (Array.isArray(schema) ? schema : []).forEach((section) => {
    const questions = (section.questions || []).map((question) => {
      known.add(question.id);
      return { id: question.id, text: question.text || question.id, value: answers[question.id] };
    });
    const condition = section.condition;
    const visible = !condition || answers[condition.question_id] === condition.value;
    if (visible || questions.some((q) => isAnswered(q.value))) {
      sections.push({ id: section.id || section.title, title: section.title, questions });
    }
  });
  const extra = Object.keys(answers)
    .filter((key) => !known.has(key))
    .map((key) => ({ id: key, text: key, value: answers[key] }));
  if (extra.length) sections.push({ id: "__other", title: "Прочие ответы", questions: extra });
  return sections;
}

function QuestionnairePanel({ questionnaire, schema }) {
  if (questionnaire.loading || schema.loading) return <LoadingState label="Загрузка анкеты…" className="py-10" />;
  if (questionnaire.error) {
    return <ErrorState message={questionnaire.error} onRetry={questionnaire.reload} className="py-8" />;
  }

  const answers = questionnaire.data?.answers || {};
  if (!Object.values(answers).some(isAnswered)) {
    return <EmptyState icon={ClipboardList} title="Анкета не заполнена" className="py-10" />;
  }

  const sections = buildSections(answers, schema.data);
  const questions = sections.flatMap((section) => section.questions);
  const answered = questions.filter((q) => isAnswered(q.value)).length;

  return (
    <div className="space-y-4" data-testid="division-questionnaire">
      {schema.error && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-foreground">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Не удалось загрузить формулировки вопросов — показаны идентификаторы.
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => schema.reload()}>
            Повторить
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Отвечено на {answered} из {questions.length} {plural(questions.length, ["вопроса", "вопросов", "вопросов"])}
      </p>
      {sections.map((section) => (
        <section key={section.id}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{section.title}</h4>
          <dl className="divide-y divide-border rounded-lg border border-border">
            {section.questions.map((question) => {
              const answeredQuestion = isAnswered(question.value);
              return (
                <div key={question.id} className="grid gap-1 p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
                  <dt className="text-sm text-muted-foreground">{question.text}</dt>
                  <dd
                    className={cn(
                      "whitespace-pre-wrap break-words text-sm",
                      answeredQuestion ? "text-foreground" : "italic text-muted-foreground/70"
                    )}
                  >
                    {answeredQuestion ? formatAnswer(question.value) : "Нет ответа"}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </div>
  );
}

function DocumentsPanel({ documents }) {
  if (documents.loading) return <LoadingState label="Загрузка документов…" className="py-10" />;
  if (documents.error) return <ErrorState message={documents.error} onRetry={documents.reload} className="py-8" />;
  const items = documents.data || [];
  if (!items.length) return <EmptyState icon={FileText} title="Документы не загружены" className="py-10" />;

  return (
    <ul className="space-y-2" data-testid="division-documents">
      {items.map((doc, index) => {
        const length = doc.text_length || 0;
        return (
          <li key={doc.id || index} className="rounded-lg border border-border bg-background/40 p-3">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <FileText className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground" title={doc.filename}>
                  {doc.filename}
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{formatSize(doc.file_size)}</span>
                  <span>{formatDateTime(doc.uploaded_at)}</span>
                  {length > 0 ? (
                    <span>
                      {formatNumber(length, 0)} {plural(length, ["символ", "символа", "символов"])} текста
                    </span>
                  ) : (
                    <span className="text-amber-500">текст не извлечён</span>
                  )}
                </p>
              </div>
            </div>
            {doc.extracted_text_preview && (
              <details className="mt-2">
                <summary className="cursor-pointer select-none text-xs text-primary hover:underline">
                  Начало извлечённого текста
                </summary>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/60 p-3 font-sans text-xs leading-relaxed text-foreground">
                  {doc.extracted_text_preview}
                  {length > doc.extracted_text_preview.length && "…"}
                </pre>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SummaryItem({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

/** Данные одного подразделения. Монтируется заново для каждого открытия — состояние не «протекает». */
function DivisionDetailsDialog({ open, onOpenChange, division }) {
  const [tab, setTab] = useState("questionnaire");
  // Все запросы стартуют сразу и живут, пока открыт диалог (вкладки не перезагружают данные)
  const questionnaire = useApi(division ? `/admin/divisions/${division.id}/questionnaire` : null);
  const documents = useApi(division ? `/admin/divisions/${division.id}/documents` : null);
  const schema = useApi(division ? "/questionnaire/schema" : null);
  if (!division) return null;

  const { percent, required } = completionOf(division);
  const documentsCount = documents.data ? documents.data.length : division.documents_count ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto border-border bg-card" data-testid="division-details-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
            <Building2 className="h-5 w-5 shrink-0 text-primary" />
            <span className="truncate">{division.name}</span>
          </DialogTitle>
          <DialogDescription className="line-clamp-2">
            {division.description || "Исходные данные подразделения: анкета и загруженные документы"}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 sm:grid-cols-4">
          <SummaryItem label="Статус">
            <StatusBadge status={division.analysis_status} />
          </SummaryItem>
          <SummaryItem label="Владелец">{division.owner_name || "—"}</SummaryItem>
          <SummaryItem label="Создано">{formatDate(division.created_at)}</SummaryItem>
          <SummaryItem label="Анкета">
            {percent}% <span className="text-xs font-normal text-muted-foreground">(обяз. {required}%)</span>
          </SummaryItem>
          <SummaryItem label="Процессы">{division.processes_count ?? 0}</SummaryItem>
          <SummaryItem label="Рекомендации">{division.recommendations_count ?? 0}</SummaryItem>
          <SummaryItem label="Экономия FTE">{division.fte_savings_total ? formatNumber(division.fte_savings_total, 1) : "—"}</SummaryItem>
          <SummaryItem label="Документы">{documentsCount}</SummaryItem>
        </dl>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" asChild>
            <Link to={`/divisions/${division.id}`} data-testid="division-details-open">
              <ArrowUpRight /> Открыть подразделение
            </Link>
          </Button>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="space-y-3">
          <TabsList>
            <TabsTrigger value="questionnaire" className="gap-2" data-testid="division-details-tab-questionnaire">
              <ClipboardList className="h-4 w-4" /> Анкета
            </TabsTrigger>
            <TabsTrigger value="documents" className="gap-2" data-testid="division-details-tab-documents">
              <FileText className="h-4 w-4" /> Документы ({documentsCount})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="questionnaire" className="mt-0">
            <QuestionnairePanel questionnaire={questionnaire} schema={schema} />
          </TabsContent>
          <TabsContent value="documents" className="mt-0">
            <DocumentsPanel documents={documents} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

export function DivisionsDataTab() {
  const { data, error, loading, reload } = useApi("/admin/divisions");
  const divisions = useMemo(() => data || [], [data]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [details, setDetails] = useState({ open: false, division: null, seq: 0 });

  const statusCounts = useMemo(() => {
    const counts = Object.fromEntries(STATUS_KEYS.map((key) => [key, 0]));
    divisions.forEach((d) => {
      counts[normalizeStatus(d.analysis_status)] += 1;
    });
    return counts;
  }, [divisions]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return divisions.filter((d) => {
      if (statusFilter !== "all" && normalizeStatus(d.analysis_status) !== statusFilter) return false;
      if (!query) return true;
      return [d.name, d.description, d.owner_name, d.head_name].some((field) => field?.toLowerCase().includes(query));
    });
  }, [divisions, search, statusFilter]);

  const openDetails = (division) => setDetails((prev) => ({ open: true, division, seq: prev.seq + 1 }));

  const filters = [
    { key: "all", label: "Все", count: divisions.length },
    ...STATUS_KEYS.map((key) => ({ key, label: STATUS[key].label, count: statusCounts[key], dot: STATUS[key].dot })),
  ];

  let body;
  if (loading) {
    body = <LoadingState label="Загрузка подразделений…" />;
  } else if (error) {
    body = <ErrorState message={error} onRetry={reload} />;
  } else if (!filtered.length) {
    body = divisions.length ? (
      <EmptyState
        icon={Search}
        title="Ничего не найдено"
        description="Измените запрос или фильтр статуса."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSearch("");
              setStatusFilter("all");
            }}
          >
            Сбросить фильтры
          </Button>
        }
      />
    ) : (
      <EmptyState icon={Building2} title="Подразделений пока нет" description="Они появятся, когда пользователи создадут первые подразделения." />
    );
  } else {
    body = (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[960px] text-sm" data-testid="admin-divisions-table">
          <thead className="bg-secondary/50 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Подразделение</th>
              <th className="px-4 py-2.5 font-semibold">Статус</th>
              <th className="px-4 py-2.5 font-semibold">Анкета</th>
              <th className="px-4 py-2.5 text-right font-semibold">Док.</th>
              <th className="px-4 py-2.5 text-right font-semibold">Процессы</th>
              <th className="px-4 py-2.5 text-right font-semibold">Рекоменд.</th>
              <th className="px-4 py-2.5 text-right font-semibold">FTE</th>
              <th className="px-4 py-2.5 font-semibold">Создано</th>
              <th className="px-4 py-2.5 text-right font-semibold">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((division) => {
              const { percent, required } = completionOf(division);
              return (
                <tr key={division.id} className="transition-colors hover:bg-secondary/30" data-testid={`admin-division-row-${division.id}`}>
                  <td className="max-w-[280px] px-4 py-3">
                    <Link
                      to={`/divisions/${division.id}`}
                      className="block truncate font-medium text-foreground hover:text-primary"
                      title={division.name}
                    >
                      {division.name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">{division.owner_name || "Владелец неизвестен"}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusBadge status={division.analysis_status} />
                  </td>
                  <td className="px-4 py-3">
                    <div title={`Заполнено ${percent}%, обязательные вопросы — ${required}%`}>
                      <Meter value={percent} color={completionColor(percent, required)} label={`${percent}%`} className="w-32" />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">{division.documents_count ?? 0}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">{division.processes_count ?? 0}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">{division.recommendations_count ?? 0}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">
                    {division.fte_savings_total ? formatNumber(division.fte_savings_total, 1) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(division.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openDetails(division)}
                        data-testid={`admin-division-details-${division.id}`}
                      >
                        <Eye /> Данные
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                        <Link
                          to={`/divisions/${division.id}`}
                          title="Открыть подразделение"
                          aria-label="Открыть подразделение"
                          data-testid={`admin-division-open-${division.id}`}
                        >
                          <ArrowUpRight />
                        </Link>
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="divisions-data-tab">
      <Panel
        title="Подразделения"
        icon={Building2}
        description={
          data
            ? `${divisions.length} ${plural(divisions.length, ["подразделение", "подразделения", "подразделений"])} всех пользователей`
            : undefined
        }
      >
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по названию, описанию или владельцу…"
                className="pl-9"
                data-testid="admin-divisions-search"
              />
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Фильтр по статусу">
              {filters.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setStatusFilter(filter.key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
                    statusFilter === filter.key
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                  aria-pressed={statusFilter === filter.key}
                  data-testid={`admin-divisions-status-${filter.key}`}
                >
                  {filter.dot && <span className={cn("h-1.5 w-1.5 rounded-full", filter.dot)} />}
                  {filter.label}
                  <span className="rounded bg-secondary px-1.5 text-[10px] tabular-nums text-secondary-foreground">
                    {filter.count}
                  </span>
                </button>
              ))}
            </div>
          </div>
          {body}
        </div>
      </Panel>

      <DivisionDetailsDialog
        key={details.seq}
        open={details.open}
        onOpenChange={(open) => setDetails((prev) => ({ ...prev, open }))}
        division={details.division}
      />
    </div>
  );
}
