import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Building2,
  Eye,
  FileText,
  Globe,
  Info,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog, EmptyState, ErrorState, LoadingState, Panel } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useApi } from "@/hooks/useApi";
import api, { errorMessage } from "@/lib/api";
import { ACCEPTED_FILES } from "@/lib/constants";
import { formatDate, formatDateTime, formatNumber, formatSize, plural, truncate } from "@/lib/format";
import { cn } from "@/lib/utils";

const CATEGORY_LABELS = {
  general: "Общее",
  regulations: "Регламенты",
  standards: "Стандарты",
  processes: "Процессы",
  templates: "Шаблоны",
};
const categoryLabel = (category) => CATEGORY_LABELS[category] || category || "Без категории";

/** Ограничения бэкенда при сборке контекста базы знаний для промпта. */
const ITEM_PROMPT_CHARS = 4000;
const TOTAL_PROMPT_CHARS = 12000;
const MAX_CONTENT_CHARS = 200000;
const ACCEPTED_EXTENSIONS = ACCEPTED_FILES.split(",");

const chars = (count) => `${formatNumber(count, 0)} ${plural(count, ["символ", "символа", "символов"])}`;

function Field({ label, htmlFor, hint, children, aside }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={htmlFor} className="text-sm text-muted-foreground">
          {label}
        </Label>
        {aside}
      </div>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SwitchRow({ label, hint, checked, onCheckedChange, testId }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-border p-3">
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} data-testid={testId} />
    </label>
  );
}

function CategorySelect({ value, onChange, options, testId }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger data-testid={testId}>
        <SelectValue placeholder="Категория" />
      </SelectTrigger>
      <SelectContent>
        {options.map((category) => (
          <SelectItem key={category} value={category}>
            {categoryLabel(category)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Диалог создания (текст или файл) и редактирования материала. */
function KnowledgeEditorDialog({ open, onOpenChange, item, categoryOptions, onSaved }) {
  const isEdit = Boolean(item);
  const [mode, setMode] = useState("text");
  const [form, setForm] = useState(() => ({
    title: item?.title || "",
    content: item?.content || "",
    category: item?.category || "general",
    is_global: item ? item.is_global !== false : true,
    is_active: item ? item.is_active !== false : true,
  }));
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);

  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));

  const pickFile = (candidate) => {
    if (!candidate) return;
    const extension = `.${candidate.name.split(".").pop()}`.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(extension)) {
      toast.error(`Формат ${extension} не поддерживается. Допустимы: ${ACCEPTED_EXTENSIONS.join(", ")}`);
      return;
    }
    setFile(candidate);
  };

  const isFileMode = !isEdit && mode === "file";
  const contentTooLong = form.content.length > MAX_CONTENT_CHARS;
  const canSubmit = isFileMode
    ? Boolean(file)
    : Boolean(form.title.trim() && form.content.trim()) && !contentTooLong && form.title.length <= 300;

  const submit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/admin/knowledge/${item.id}`, {
          title: form.title.trim(),
          content: form.content,
          category: form.category,
          is_global: form.is_global,
          is_active: form.is_active,
        });
        toast.success("Материал обновлён");
      } else if (isFileMode) {
        const payload = new FormData();
        payload.append("file", file);
        if (form.title.trim()) payload.append("title", form.title.trim());
        payload.append("category", form.category);
        payload.append("is_global", form.is_global ? "true" : "false");
        const { data } = await api.post("/admin/knowledge/upload", payload);
        toast.success(`Документ «${data?.title || file.name}» добавлен: ${chars(data?.content?.length || 0)}`);
      } else {
        await api.post("/admin/knowledge", {
          title: form.title.trim(),
          content: form.content,
          category: form.category,
          is_global: form.is_global,
        });
        toast.success("Материал добавлен");
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, isFileMode ? "Не удалось загрузить файл" : "Не удалось сохранить материал"));
    } finally {
      setSaving(false);
    }
  };

  const commonFields = (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Категория">
          <CategorySelect
            value={form.category}
            onChange={set("category")}
            options={categoryOptions}
            testId="knowledge-category-select"
          />
        </Field>
        <Field label="Область применения">
          <SwitchRow
            label="Глобальный"
            checked={form.is_global}
            onCheckedChange={set("is_global")}
            testId="knowledge-global-switch"
          />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        {form.is_global
          ? "Глобальный материал попадает в промпт каждого анализа (если подразделение не отключило глобальные материалы)."
          : "Неглобальный материал используется только в подразделениях, которые выбрали его явно."}
      </p>
    </>
  );

  const textFields = (
    <>
      <Field label="Название" htmlFor="knowledge-title">
        <Input
          id="knowledge-title"
          value={form.title}
          onChange={(e) => set("title")(e.target.value)}
          placeholder="Например: Регламент согласования договоров"
          maxLength={300}
          data-testid="knowledge-title-input"
        />
      </Field>
      <Field
        label="Содержимое"
        htmlFor="knowledge-content"
        aside={
          <span className={cn("text-xs tabular-nums", contentTooLong ? "text-red-500" : "text-muted-foreground")}>
            {chars(form.content.length)}
          </span>
        }
        hint={
          form.content.length > ITEM_PROMPT_CHARS
            ? `В промпт анализа попадут только первые ${formatNumber(ITEM_PROMPT_CHARS, 0)} символов материала.`
            : undefined
        }
      >
        <Textarea
          id="knowledge-content"
          value={form.content}
          onChange={(e) => set("content")(e.target.value)}
          placeholder="Правила, регламенты, стандарты, терминология…"
          className="min-h-[220px] text-sm"
          data-testid="knowledge-content-input"
        />
      </Field>
    </>
  );

  return (
    <Dialog open={open} onOpenChange={(value) => !saving && onOpenChange(value)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-border bg-card" data-testid="knowledge-editor-dialog">
        <DialogHeader>
          <DialogTitle className="pr-6">{isEdit ? "Редактирование материала" : "Новый материал базы знаний"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? item.source_filename
                ? `Загружен из файла ${item.source_filename}`
                : "Изменения применяются к следующим анализам"
              : "Добавьте текст вручную или загрузите документ — текст будет извлечён автоматически"}
          </DialogDescription>
        </DialogHeader>

        {isEdit ? (
          <div className="space-y-4">
            {textFields}
            {commonFields}
            <SwitchRow
              label="Активен"
              hint="Отключённые материалы не используются в анализе, но остаются в базе"
              checked={form.is_active}
              onCheckedChange={set("is_active")}
              testId="knowledge-active-switch"
            />
          </div>
        ) : (
          <Tabs value={mode} onValueChange={setMode} className="space-y-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="text" className="gap-2" data-testid="knowledge-mode-text">
                <FileText className="h-4 w-4" /> Текст
              </TabsTrigger>
              <TabsTrigger value="file" className="gap-2" data-testid="knowledge-mode-file">
                <Upload className="h-4 w-4" /> Файл
              </TabsTrigger>
            </TabsList>
            <TabsContent value="text" className="mt-0 space-y-4">
              {textFields}
              {commonFields}
            </TabsContent>
            <TabsContent value="file" className="mt-0 space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_FILES}
                className="hidden"
                onChange={(e) => {
                  pickFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
                data-testid="knowledge-file-input"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  pickFile(e.dataTransfer.files?.[0]);
                }}
                className={cn(
                  "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
                  dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                )}
                data-testid="knowledge-dropzone"
              >
                <Upload className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />
                <span className="text-sm font-medium text-foreground">Перетащите файл или нажмите, чтобы выбрать</span>
                <span className="text-xs text-muted-foreground">
                  {ACCEPTED_EXTENSIONS.map((ext) => ext.slice(1).toUpperCase()).join(", ")}
                </span>
              </button>
              {file && (
                <div className="flex items-center gap-3 rounded-lg border border-border bg-background/40 p-3">
                  <FileText className="h-5 w-5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setFile(null)} aria-label="Убрать файл">
                    <X />
                  </Button>
                </div>
              )}
              <Field label="Название (необязательно)" htmlFor="knowledge-file-title" hint="По умолчанию — имя файла">
                <Input
                  id="knowledge-file-title"
                  value={form.title}
                  onChange={(e) => set("title")(e.target.value)}
                  placeholder={file?.name || "Название материала"}
                  maxLength={300}
                  data-testid="knowledge-file-title-input"
                />
              </Field>
              {commonFields}
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={!canSubmit || saving} data-testid="knowledge-save-btn">
            {saving ? <Loader2 className="animate-spin" /> : isFileMode ? <Upload /> : null}
            {isEdit ? "Сохранить" : isFileMode ? "Загрузить" : "Добавить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KnowledgeCard({ item, onView, onEdit, onDelete, onToggle, toggling }) {
  const active = item.is_active !== false;
  const length = item.content?.length || 0;
  return (
    <article
      className={cn(
        "flex flex-col rounded-xl border border-border bg-card/70 p-4 transition-colors hover:border-primary/30",
        !active && "opacity-60"
      )}
      data-testid={`knowledge-item-${item.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={() => onView(item)} className="min-w-0 text-left">
          <h4 className="truncate text-sm font-semibold text-foreground hover:text-primary" title={item.title}>
            {item.title}
          </h4>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {formatDate(item.created_at)}
            {item.source_filename && ` · ${item.source_filename}`}
          </p>
        </button>
        <Switch
          checked={active}
          onCheckedChange={(value) => onToggle(item, value)}
          disabled={toggling}
          aria-label={active ? "Отключить материал" : "Включить материал"}
          title={active ? "Активен — используется в анализе" : "Отключён"}
          data-testid={`knowledge-toggle-${item.id}`}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className="font-normal">
          {categoryLabel(item.category)}
        </Badge>
        {item.is_global ? (
          <Badge variant="outline" className="gap-1 border-blue-500/30 bg-blue-500/10 font-normal text-blue-500">
            <Globe className="h-3 w-3" /> Глобальный
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
            <Building2 className="h-3 w-3" /> По выбору
          </Badge>
        )}
        {!active && (
          <Badge variant="outline" className="font-normal text-muted-foreground">
            Отключён
          </Badge>
        )}
      </div>
      <p className="mt-3 line-clamp-3 flex-1 break-words text-xs leading-relaxed text-muted-foreground">
        {truncate(item.content, 260) || "Пустой материал"}
      </p>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
        <span className="text-xs tabular-nums text-muted-foreground">
          {chars(length)}
          {length > ITEM_PROMPT_CHARS && (
            <span className="text-amber-500" title={`В промпт попадут первые ${formatNumber(ITEM_PROMPT_CHARS, 0)} символов`}>
              {" "}
              · в промпт ≤ {formatNumber(ITEM_PROMPT_CHARS, 0)}
            </span>
          )}
        </span>
        <div className="flex shrink-0 gap-0.5">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onView(item)} title="Просмотр" aria-label="Просмотр" data-testid={`knowledge-view-${item.id}`}>
            <Eye className="text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(item)} title="Редактировать" aria-label="Редактировать" data-testid={`knowledge-edit-${item.id}`}>
            <Pencil className="text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onDelete(item)} title="Удалить" aria-label="Удалить" data-testid={`knowledge-delete-${item.id}`}>
            <Trash2 className="text-red-500" />
          </Button>
        </div>
      </div>
    </article>
  );
}

export function KnowledgeTab({ onChanged }) {
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [search, setSearch] = useState("");

  const itemsPath = useMemo(() => {
    const params = new URLSearchParams();
    if (categoryFilter !== "all") params.set("category", categoryFilter);
    if (scopeFilter !== "all") params.set("is_global", scopeFilter === "global" ? "true" : "false");
    const query = params.toString();
    return query ? `/admin/knowledge?${query}` : "/admin/knowledge";
  }, [categoryFilter, scopeFilter]);

  const { data: items, error, loading, reload, setData: setItems } = useApi(itemsPath);
  const { data: categories, reload: reloadCategories } = useApi("/admin/knowledge/categories/list");

  const [editor, setEditor] = useState({ open: false, item: null, seq: 0 });
  const [viewer, setViewer] = useState({ open: false, item: null });
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState(null);

  const categoryOptions = useMemo(() => {
    const set = new Set(Object.keys(CATEGORY_LABELS));
    (categories || []).forEach((row) => row.category && set.add(row.category));
    if (editor.item?.category) set.add(editor.item.category);
    return Array.from(set);
  }, [categories, editor.item]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items || [];
    return (items || []).filter(
      (item) => item.title?.toLowerCase().includes(query) || item.content?.toLowerCase().includes(query)
    );
  }, [items, search]);

  // Сколько текста глобальных материалов уходит в каждый промпт (считаем только без серверных фильтров)
  const promptBudget = useMemo(() => {
    if (!items || categoryFilter !== "all" || scopeFilter !== "all") return null;
    const globals = items.filter((item) => item.is_global && item.is_active !== false);
    const used = globals.reduce((sum, item) => sum + Math.min(item.content?.length || 0, ITEM_PROMPT_CHARS), 0);
    return { count: globals.length, used: Math.min(used, TOTAL_PROMPT_CHARS), overflow: used > TOTAL_PROMPT_CHARS };
  }, [items, categoryFilter, scopeFilter]);

  const afterChange = () => {
    reload({ silent: true });
    reloadCategories({ silent: true });
    onChanged?.();
  };

  const openCreate = () => setEditor((prev) => ({ open: true, item: null, seq: prev.seq + 1 }));
  const openEdit = (item) => setEditor((prev) => ({ open: true, item, seq: prev.seq + 1 }));

  const toggleActive = async (item, isActive) => {
    setTogglingId(item.id);
    const patchLocal = (value) =>
      setItems((list) => list?.map((row) => (row.id === item.id ? { ...row, is_active: value } : row)));
    patchLocal(isActive);
    try {
      await api.patch(`/admin/knowledge/${item.id}`, { is_active: isActive });
      toast.success(isActive ? "Материал включён" : "Материал отключён");
      onChanged?.();
    } catch (err) {
      patchLocal(item.is_active);
      toast.error(errorMessage(err, "Не удалось изменить статус материала"));
    } finally {
      setTogglingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/admin/knowledge/${toDelete.id}`);
      toast.success("Материал удалён");
      setToDelete(null);
      afterChange();
    } catch (err) {
      toast.error(errorMessage(err, "Не удалось удалить материал"));
    } finally {
      setDeleting(false);
    }
  };

  const hasFilters = categoryFilter !== "all" || scopeFilter !== "all" || search.trim();

  let body;
  if (loading) {
    body = <LoadingState label="Загрузка базы знаний…" />;
  } else if (error) {
    body = <ErrorState message={error} onRetry={reload} />;
  } else if (!filtered.length) {
    body = hasFilters ? (
      <EmptyState
        icon={Search}
        title="Ничего не найдено"
        description="Измените условия поиска или фильтры."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSearch("");
              setCategoryFilter("all");
              setScopeFilter("all");
            }}
          >
            Сбросить фильтры
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={BookOpen}
        title="База знаний пуста"
        description="Добавьте регламенты, стандарты и справочные материалы — модель будет учитывать их при анализе."
        action={
          <Button onClick={openCreate}>
            <Plus /> Добавить материал
          </Button>
        }
      />
    );
  } else {
    body = (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="knowledge-list">
        {filtered.map((item) => (
          <KnowledgeCard
            key={item.id}
            item={item}
            onView={(row) => setViewer({ open: true, item: row })}
            onEdit={openEdit}
            onDelete={setToDelete}
            onToggle={toggleActive}
            toggling={togglingId === item.id}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="knowledge-tab">
      <Panel
        title="База знаний"
        icon={BookOpen}
        description={
          items
            ? `${filtered.length} ${plural(filtered.length, ["материал", "материала", "материалов"])}${
                search.trim() ? ` из ${items.length}` : ""
              }`
            : undefined
        }
        actions={
          <Button size="sm" onClick={openCreate} data-testid="knowledge-add-btn">
            <Plus /> Добавить
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-lg border border-blue-500/25 bg-blue-500/5 p-3 text-xs leading-relaxed text-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
            <div className="space-y-1">
              <p>
                <span className="font-medium">Активные глобальные материалы</span> автоматически добавляются в промпт каждого
                анализа: до {formatNumber(ITEM_PROMPT_CHARS, 0)} символов из каждого материала и до{" "}
                {formatNumber(TOTAL_PROMPT_CHARS, 0)} символов суммарно, в порядке добавления.
              </p>
              <p className="text-muted-foreground">
                Подразделение может отключить глобальные материалы и выбрать нужные вручную — в том числе неглобальные.
              </p>
              {promptBudget && promptBudget.count > 0 && (
                <p className={cn(promptBudget.overflow ? "text-amber-500" : "text-muted-foreground")}>
                  {promptBudget.overflow && <AlertTriangle className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />}
                  Сейчас в каждый анализ уходит ≈{chars(promptBudget.used)} из {promptBudget.count}{" "}
                  {plural(promptBudget.count, ["глобального материала", "глобальных материалов", "глобальных материалов"])}
                  {promptBudget.overflow && " — лимит превышен, последние материалы будут обрезаны или не попадут в промпт"}.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по названию и содержимому…"
                className="pl-9"
                data-testid="knowledge-search"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full sm:w-[200px]" data-testid="knowledge-category-filter">
                <SelectValue placeholder="Категория" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все категории</SelectItem>
                {(categories || [])
                  .filter((row) => row.category)
                  .map((row) => (
                    <SelectItem key={row.category} value={row.category}>
                      {categoryLabel(row.category)} ({row.count})
                    </SelectItem>
                  ))}
                {categoryFilter !== "all" && !(categories || []).some((row) => row.category === categoryFilter) && (
                  <SelectItem value={categoryFilter}>{categoryLabel(categoryFilter)}</SelectItem>
                )}
              </SelectContent>
            </Select>
            <Select value={scopeFilter} onValueChange={setScopeFilter}>
              <SelectTrigger className="w-full sm:w-[190px]" data-testid="knowledge-scope-filter">
                <SelectValue placeholder="Область" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все материалы</SelectItem>
                <SelectItem value="global">Глобальные</SelectItem>
                <SelectItem value="local">По выбору</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {body}
        </div>
      </Panel>

      <KnowledgeEditorDialog
        key={editor.seq}
        open={editor.open}
        onOpenChange={(open) => setEditor((prev) => ({ ...prev, open }))}
        item={editor.item}
        categoryOptions={categoryOptions}
        onSaved={afterChange}
      />

      <Dialog open={viewer.open} onOpenChange={(open) => setViewer((prev) => ({ ...prev, open }))}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto border-border bg-card" data-testid="knowledge-view-dialog">
          {viewer.item && (
            <>
              <DialogHeader>
                <DialogTitle className="pr-6">{viewer.item.title}</DialogTitle>
                <DialogDescription>
                  {categoryLabel(viewer.item.category)} · {viewer.item.is_global ? "глобальный" : "по выбору"} ·{" "}
                  {viewer.item.is_active === false ? "отключён" : "активен"} · {chars(viewer.item.content?.length || 0)} ·
                  добавлен {formatDateTime(viewer.item.created_at)}
                </DialogDescription>
              </DialogHeader>
              <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background/60 p-4 font-sans text-sm leading-relaxed text-foreground">
                {viewer.item.content}
              </pre>
              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setViewer((prev) => ({ ...prev, open: false }));
                    openEdit(viewer.item);
                  }}
                >
                  <Pencil /> Редактировать
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(open) => !open && !deleting && setToDelete(null)}
        title="Удалить материал?"
        description={toDelete ? `«${toDelete.title}» будет удалён из базы знаний без возможности восстановления.` : undefined}
        onConfirm={confirmDelete}
        busy={deleting}
      />
    </div>
  );
}
