import { useEffect, useState } from "react";
import { CalendarClock, Loader2, Save, TrendingUp, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORIES, INITIATIVE_STATUSES } from "@/lib/constants";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export function StatusSelect({ value, onChange, className, disabled }) {
  const current = INITIATIVE_STATUSES[value || "new"] || INITIATIVE_STATUSES.new;
  return (
    <Select value={value || "new"} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className={cn("h-8 w-[140px] gap-1 text-xs", current.text, className)} data-testid="initiative-status-select">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: current.color }} />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(INITIATIVE_STATUSES).map(([key, status]) => (
          <SelectItem key={key} value={key}>
            {status.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Карточка управления инициативой: статус, ответственный, срок, приоритет, комментарий. */
export function InitiativeDialog({ rec, onOpenChange, onSave }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (rec) {
      setForm({
        status: rec.status || "new",
        owner: rec.owner || "",
        due_date: rec.due_date || "",
        priority: String(rec.priority || 3),
        comment: rec.comment || "",
      });
    }
  }, [rec]);

  const save = async () => {
    setSaving(true);
    const ok = await onSave(rec, { ...form, priority: Number(form.priority) });
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={Boolean(rec)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle className="pr-6">{rec?.title}</DialogTitle>
          <DialogDescription>{rec?.description}</DialogDescription>
        </DialogHeader>
        {form && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Статус</Label>
                <StatusSelect value={form.status} onChange={(status) => setForm((prev) => ({ ...prev, status }))} className="w-full" />
              </div>
              <div className="space-y-1.5">
                <Label>Приоритет</Label>
                <Select value={form.priority} onValueChange={(priority) => setForm((prev) => ({ ...prev, priority }))}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((p) => (
                      <SelectItem key={p} value={String(p)}>
                        P{p} {p === 1 ? "— наивысший" : p === 5 ? "— низкий" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="initiative-owner">Ответственный</Label>
                <Input id="initiative-owner" value={form.owner} onChange={(e) => setForm((prev) => ({ ...prev, owner: e.target.value }))} placeholder="ФИО" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="initiative-due">Срок</Label>
                <Input id="initiative-due" type="date" value={form.due_date} onChange={(e) => setForm((prev) => ({ ...prev, due_date: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="initiative-comment">Комментарий</Label>
              <Textarea
                id="initiative-comment"
                value={form.comment}
                onChange={(e) => setForm((prev) => ({ ...prev, comment: e.target.value }))}
                placeholder="Решение комитета, ограничения, следующий шаг…"
                className="min-h-[90px]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button onClick={save} disabled={saving} data-testid="save-initiative-btn">
                {saving ? <Loader2 className="animate-spin" /> : <Save />} Сохранить
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function InitiativeMeta({ rec }) {
  if (!rec.owner && !rec.due_date && !rec.comment) return null;
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {(rec.owner || rec.due_date) && (
        <p className="flex flex-wrap gap-x-3">
          {rec.owner && (
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" /> {rec.owner}
            </span>
          )}
          {rec.due_date && (
            <span className="flex items-center gap-1">
              <CalendarClock className="h-3 w-3" /> до {formatDate(rec.due_date)}
            </span>
          )}
        </p>
      )}
      {rec.comment && <p className="line-clamp-2 italic">«{rec.comment}»</p>}
    </div>
  );
}

/** Канбан-доска инициатив по статусам. */
export function InitiativeBoard({ recommendations, onStatusChange, onOpen }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-2">
      <div className="grid min-w-[1100px] grid-cols-5 gap-3">
        {Object.entries(INITIATIVE_STATUSES).map(([key, status]) => {
          const items = recommendations.filter((rec) => (rec.status || "new") === key);
          const fte = items.reduce((sum, rec) => sum + (rec.estimated_fte_savings || 0), 0);
          return (
            <div key={key} className="flex flex-col rounded-xl border border-border bg-secondary/30" data-testid={`board-column-${key}`}>
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: status.color }} /> {status.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {items.length}
                  {fte > 0 && ` · ${formatNumber(fte, 1)} FTE`}
                </span>
              </div>
              <div className="flex-1 space-y-2 p-2">
                {items.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">Пусто</p>}
                {items.map((rec) => {
                  const category = CATEGORIES[rec.category] || CATEGORIES.simple_automation;
                  return (
                    <div key={rec.id} className="rounded-lg border border-border bg-card p-2.5 shadow-sm">
                      <button type="button" className="text-left" onClick={() => onOpen(rec)}>
                        <p className="text-xs font-medium leading-snug text-foreground hover:text-primary">{rec.title}</p>
                      </button>
                      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: category.color }} /> {category.short}
                        <span>P{rec.priority || "–"}</span>
                        {rec.estimated_fte_savings > 0 && (
                          <span className="flex items-center gap-0.5 text-emerald-500">
                            <TrendingUp className="h-3 w-3" /> {formatNumber(rec.estimated_fte_savings, 1)}
                          </span>
                        )}
                      </div>
                      <InitiativeMeta rec={rec} />
                      <StatusSelect value={rec.status} onChange={(value) => onStatusChange(rec, value)} className="mt-2 w-full" />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
