import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  FileText,
  GitBranch,
  Loader2,
  Pencil,
  Plus,
  Search,
  Share2,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog, EmptyState, ErrorState, LoadingState, Meter, PageHeader, StatusBadge } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useApi } from "@/hooks/useApi";
import api, { errorMessage } from "@/lib/api";
import { STATUS, potentialColor } from "@/lib/constants";
import { formatDate, formatNumber, plural } from "@/lib/format";

const EMPTY_FORM = { name: "", description: "", head_name: "", employees_count: 0 };

const SORTS = {
  created: { label: "Сначала новые", fn: (a, b) => String(b.created_at).localeCompare(String(a.created_at)) },
  name: { label: "По названию", fn: (a, b) => a.name.localeCompare(b.name, "ru") },
  potential: { label: "По потенциалу", fn: (a, b) => (b.avg_automation_potential ?? -1) - (a.avg_automation_potential ?? -1) },
  readiness: { label: "По заполненности", fn: (a, b) => (b.questionnaire_completion?.percent || 0) - (a.questionnaire_completion?.percent || 0) },
};

function DivisionFormDialog({ open, onOpenChange, initial, onSubmit, title, submitLabel }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(initial ? { ...EMPTY_FORM, ...initial } : EMPTY_FORM);
  }, [open, initial]);

  const update = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit({ ...form, employees_count: Number(form.employees_count) || 0 });
      onOpenChange(false);
    } catch {
      // ошибка уже показана в уведомлении — диалог остаётся открытым
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="division-name">Название *</Label>
            <Input id="division-name" value={form.name} onChange={update("name")} placeholder="Департамент проблемных кредитов" required data-testid="division-name-input" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="division-desc">Описание</Label>
            <Textarea id="division-desc" value={form.description} onChange={update("description")} placeholder="Функции и зона ответственности…" className="min-h-[80px]" data-testid="division-desc-input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="division-head">Руководитель</Label>
              <Input id="division-head" value={form.head_name} onChange={update("head_name")} placeholder="ФИО" data-testid="division-head-input" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="division-count">Сотрудников</Label>
              <Input id="division-count" type="number" min={0} value={form.employees_count} onChange={update("employees_count")} data-testid="division-count-input" />
            </div>
          </div>
          <Button type="submit" disabled={saving || !form.name.trim()} className="w-full" data-testid="submit-division-btn">
            {saving ? <Loader2 className="animate-spin" /> : null}
            {submitLabel}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ShareDialog({ division, onOpenChange, onSaved }) {
  const [users, setUsers] = useState(null);
  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!division) return;
    setUsers(null);
    setError(null);
    setQuery("");
    setSelected(division.shared_with || []);
    api
      .get(`/users?division_id=${division.id}`)
      .then(({ data }) => setUsers(data))
      .catch((err) => setError(errorMessage(err, "Не удалось загрузить пользователей")));
  }, [division]);

  const filtered = (users || []).filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(query.toLowerCase()));

  const save = async () => {
    setSaving(true);
    try {
      await api.post(`/divisions/${division.id}/share`, { user_ids: selected });
      toast.success("Доступ обновлён");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, "Ошибка сохранения доступа"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(division)} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle>Совместный доступ</DialogTitle>
          <DialogDescription>
            Коллеги смогут заполнять анкету, загружать документы, запускать анализ и смотреть результаты «{division?.name}».
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <ErrorState message={error} className="py-6" />
        ) : users === null ? (
          <LoadingState className="py-8" />
        ) : users.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Нет других пользователей для предоставления доступа</p>
        ) : (
          <>
            {users.length > 6 && <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск пользователя…" />}
            <div className="max-h-[360px] space-y-2 overflow-y-auto">
              {filtered.map((user) => (
                <label key={user.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 hover:bg-secondary/50">
                  <Checkbox
                    checked={selected.includes(user.id)}
                    onCheckedChange={(checked) =>
                      setSelected((prev) => (checked ? [...prev, user.id] : prev.filter((id) => id !== user.id)))
                    }
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{user.name || user.email}</p>
                    <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                  </div>
                </label>
              ))}
            </div>
          </>
        )}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
          {users?.length > 0 && (
            <Button className="flex-1" onClick={save} disabled={saving}>
              {saving && <Loader2 className="animate-spin" />} Сохранить ({selected.length})
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DivisionCard({ division, index, onOpen, onEdit, onShare, onDelete }) {
  const isOwnerOrAdmin = division.access === "owner" || division.access === "admin";
  const completion = division.questionnaire_completion || {};
  const sharedCount = (division.shared_with || []).length;

  const stop = (handler) => (event) => {
    event.stopPropagation();
    handler(division);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(division)}
      onKeyDown={(event) => event.key === "Enter" && onOpen(division)}
      className="group flex cursor-pointer flex-col rounded-xl border border-border bg-card/70 p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5"
      data-testid={`division-card-${index}`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${division.access === "shared" ? "bg-purple-500/10" : "bg-primary/10"}`}>
          <Building2 className={`h-5 w-5 ${division.access === "shared" ? "text-purple-500" : "text-primary"}`} />
        </div>
        <StatusBadge status={division.analysis_status} />
      </div>

      <h3 className="truncate text-base font-semibold text-foreground">{division.name}</h3>
      <div className="mb-2 mt-1 flex flex-wrap gap-1.5">
        {division.access === "shared" && (
          <Badge variant="outline" className="border-purple-500/40 text-purple-500">
            Доступ от {division.owner_name || "коллеги"}
          </Badge>
        )}
        {division.access === "admin" && (
          <Badge variant="outline" className="border-amber-500/40 text-amber-500">
            {division.owner_name || "Другой пользователь"}
          </Badge>
        )}
        {division.access === "owner" && sharedCount > 0 && (
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-500">
            <Users className="mr-1 h-3 w-3" /> {sharedCount} {plural(sharedCount, ["коллега", "коллеги", "коллег"])}
          </Badge>
        )}
      </div>
      <p className="mb-4 line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">{division.description || "Описание не указано"}</p>

      <div className="space-y-2">
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>Анкета</span>
            <span>{completion.required_percent ?? 0}% обязательных</span>
          </div>
          <Meter value={completion.percent || 0} />
        </div>
        {division.avg_automation_potential != null && (
          <div>
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>Потенциал автоматизации</span>
              <span>{division.avg_automation_potential}%</span>
            </div>
            <Meter value={division.avg_automation_potential} color={potentialColor(division.avg_automation_potential)} />
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileText className="h-3.5 w-3.5" /> {division.documents_count}
          </span>
          <span className="flex items-center gap-1">
            <GitBranch className="h-3.5 w-3.5" /> {division.processes_count || 0}
          </span>
          {division.fte_savings_total > 0 && <span className="text-emerald-500">−{formatNumber(division.fte_savings_total)} FTE</span>}
          <span>{formatDate(division.created_at)}</span>
        </div>
        <div className="flex items-center">
          {isOwnerOrAdmin && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={stop(onEdit)} aria-label="Редактировать">
                    <Pencil />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Редактировать</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={stop(onShare)} aria-label="Поделиться" data-testid={`share-division-${index}`}>
                    <Share2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Совместный доступ</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-red-500"
                    onClick={stop(onDelete)}
                    aria-label="Удалить"
                    data-testid={`delete-division-${index}`}
                  >
                    <Trash2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Удалить</TooltipContent>
              </Tooltip>
            </>
          )}
          <ArrowRight className="ml-1 h-5 w-5 text-muted-foreground transition-colors group-hover:text-primary" />
        </div>
      </div>
    </div>
  );
}

export default function DivisionsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, error, loading, reload } = useApi("/divisions", { initial: [] });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("created");
  const [editing, setEditing] = useState(null);
  const [sharing, setSharing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const leavingRef = useRef(false);
  const createOpen = searchParams.get("create") === "1";
  const setCreateOpen = (open) => {
    // После создания уже выполнен переход на страницу подразделения — адрес не трогаем
    if (leavingRef.current) return;
    const next = new URLSearchParams(searchParams);
    if (open) next.set("create", "1");
    else next.delete("create");
    setSearchParams(next, { replace: true });
  };

  const divisions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data || [])
      .filter((d) => statusFilter === "all" || d.analysis_status === statusFilter)
      .filter((d) => !query || `${d.name} ${d.description} ${d.head_name}`.toLowerCase().includes(query))
      .sort(SORTS[sort].fn);
  }, [data, search, statusFilter, sort]);

  const createDivision = async (form) => {
    try {
      const { data: created } = await api.post("/divisions", form);
      toast.success("Подразделение создано");
      leavingRef.current = true;
      navigate(`/divisions/${created.id}?tab=questionnaire`);
    } catch (err) {
      toast.error(errorMessage(err, "Ошибка создания"));
      throw err;
    }
  };

  const updateDivision = async (form) => {
    try {
      await api.put(`/divisions/${editing.id}`, form);
      toast.success("Изменения сохранены");
      reload({ silent: true });
    } catch (err) {
      toast.error(errorMessage(err, "Ошибка сохранения"));
      throw err;
    }
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await api.delete(`/divisions/${deleting.id}`);
      toast.success("Подразделение удалено");
      setDeleting(null);
      reload({ silent: true });
    } catch (err) {
      toast.error(errorMessage(err, "Ошибка удаления"));
    } finally {
      setBusy(false);
    }
  };

  const createButton = (
    <Button onClick={() => setCreateOpen(true)} data-testid="create-division-btn">
      <Plus /> Новое подразделение
    </Button>
  );

  return (
    <div className="space-y-6 p-6 md:p-8" data-testid="divisions-page">
      <PageHeader title="Подразделения" description="Анкеты, документы и результаты анализа по каждому подразделению" actions={createButton} />

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (data || []).length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Нет подразделений"
          description="Создайте первое подразделение: заполните анкету, загрузите регламенты и запустите AI-анализ."
          action={createButton}
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск…" className="pl-9" data-testid="search-divisions-input" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="sm:w-48" data-testid="status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все статусы</SelectItem>
                {Object.entries(STATUS).map(([key, value]) => (
                  <SelectItem key={key} value={key}>
                    {value.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="sm:w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SORTS).map(([key, value]) => (
                  <SelectItem key={key} value={key}>
                    {value.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {divisions.length === 0 ? (
            <EmptyState icon={Search} title="Ничего не найдено" description="Измените условия поиска или фильтр статуса" />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {divisions.map((division, index) => (
                <DivisionCard
                  key={division.id}
                  division={division}
                  index={index}
                  onOpen={(d) => navigate(`/divisions/${d.id}`)}
                  onEdit={setEditing}
                  onShare={setSharing}
                  onDelete={setDeleting}
                />
              ))}
            </div>
          )}
        </>
      )}

      <DivisionFormDialog open={createOpen} onOpenChange={setCreateOpen} onSubmit={createDivision} title="Новое подразделение" submitLabel="Создать" />
      <DivisionFormDialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        initial={editing}
        onSubmit={updateDivision}
        title="Редактирование подразделения"
        submitLabel="Сохранить"
      />
      <ShareDialog division={sharing} onOpenChange={(open) => !open && setSharing(null)} onSaved={() => reload({ silent: true })} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Удалить «${deleting?.name}»?`}
        description="Будут удалены анкета, документы, результаты анализа и настройки доступа. Действие необратимо."
        onConfirm={confirmDelete}
        busy={busy}
      />
    </div>
  );
}
