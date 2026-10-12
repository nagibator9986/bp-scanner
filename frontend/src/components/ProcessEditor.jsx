import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import api, { errorMessage } from "@/lib/api";

const EMPTY_STEP = { name: "", role: "", system: "", type: "task", mode: "manual", duration_min: "" };

const toForm = (process) => ({
  name: process?.name || "",
  description: process?.description || "",
  owner: process?.owner || "",
  trigger: process?.trigger || "",
  frequency: process?.frequency || "",
  volume_per_month: process?.volume_per_month ?? process?.economics?.volume_per_month ?? "",
  sla: process?.sla || "",
  pain_points: (process?.pain_points || []).join("\n"),
  steps: (process?.steps_detail?.length ? process.steps_detail : (process?.steps || []).map((name) => ({ name }))).map((step) => ({
    name: step.name || "",
    role: step.role || "",
    system: step.system || "",
    type: step.type === "decision" ? "decision" : "task",
    mode: step.automated ? "auto" : step.manual === false ? "system" : "manual",
    duration_min: step.duration_min ?? "",
  })),
});

const toPayload = (form) => ({
  name: form.name.trim(),
  description: form.description,
  owner: form.owner,
  trigger: form.trigger,
  frequency: form.frequency,
  volume_per_month: form.volume_per_month === "" ? null : Number(form.volume_per_month),
  sla: form.sla,
  pain_points: form.pain_points.split("\n").map((s) => s.trim()).filter(Boolean),
  steps: form.steps
    .filter((step) => step.name.trim())
    .map((step) => ({
      name: step.name.trim(),
      role: step.role.trim(),
      system: step.system.trim(),
      type: step.type,
      automated: step.mode === "auto",
      manual: step.mode === "manual",
      duration_min: step.duration_min === "" || step.type === "decision" ? null : Number(step.duration_min),
    })),
});

/** Создание и редактирование процесса; после сохранения BPMN-схема перестраивается на сервере. */
export function ProcessEditorDialog({ open, onOpenChange, divisionId, process, onSaved }) {
  const [form, setForm] = useState(() => toForm(process));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(toForm(process));
  }, [open, process]);

  const roles = useMemo(() => [...new Set(form.steps.map((s) => s.role).filter(Boolean))], [form.steps]);
  const systems = useMemo(() => [...new Set(form.steps.map((s) => s.system).filter(Boolean))], [form.steps]);
  const minutes = form.steps
    .filter((s) => s.type !== "decision" && s.mode !== "auto")
    .reduce((sum, s) => sum + (Number(s.duration_min) || 0), 0);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));
  const setStep = (index, key, value) =>
    setForm((prev) => ({ ...prev, steps: prev.steps.map((step, i) => (i === index ? { ...step, [key]: value } : step)) }));
  const moveStep = (index, delta) =>
    setForm((prev) => {
      const steps = [...prev.steps];
      const [item] = steps.splice(index, 1);
      steps.splice(index + delta, 0, item);
      return { ...prev, steps };
    });
  const removeStep = (index) => setForm((prev) => ({ ...prev, steps: prev.steps.filter((_, i) => i !== index) }));
  const addStep = () => setForm((prev) => ({ ...prev, steps: [...prev.steps, { ...EMPTY_STEP, role: prev.steps.at(-1)?.role || "" }] }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = toPayload(form);
      const { data } = process
        ? await api.put(`/divisions/${divisionId}/processes/${process.id}`, payload)
        : await api.post(`/divisions/${divisionId}/processes`, payload);
      toast.success(process ? "Процесс сохранён, BPMN-схема обновлена" : "Процесс добавлен");
      onSaved?.(data);
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, "Не удалось сохранить процесс"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto bg-card border-border" data-testid="process-editor">
        <DialogHeader>
          <DialogTitle>{process ? "Редактирование процесса" : "Новый процесс"}</DialogTitle>
          <DialogDescription>
            Схема BPMN перестроится автоматически. Скоринг и рекомендации пересчитываются отдельной кнопкой на странице подразделения.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="process-name">Название *</Label>
            <Input id="process-name" value={form.name} onChange={set("name")} data-testid="process-name-input" />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="process-description">Описание</Label>
            <Textarea id="process-description" value={form.description} onChange={set("description")} className="min-h-[60px]" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="process-owner">Владелец</Label>
            <Input id="process-owner" value={form.owner} onChange={set("owner")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="process-trigger">Триггер</Label>
            <Input id="process-trigger" value={form.trigger} onChange={set("trigger")} />
          </div>
          <div className="grid grid-cols-3 gap-3 md:col-span-2">
            <div className="space-y-1.5">
              <Label htmlFor="process-frequency">Частота</Label>
              <Input id="process-frequency" value={form.frequency} onChange={set("frequency")} placeholder="Ежедневно" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="process-volume">Экземпляров в месяц</Label>
              <Input id="process-volume" type="number" min={0} value={form.volume_per_month} onChange={set("volume_per_month")} data-testid="process-volume-input" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="process-sla">SLA</Label>
              <Input id="process-sla" value={form.sla} onChange={set("sla")} />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Шаги процесса</Label>
            <span className="text-xs text-muted-foreground">
              Ручные трудозатраты: {minutes} мин на экземпляр
              {form.volume_per_month ? ` · ${Math.round((minutes * Number(form.volume_per_month)) / 60)} ч/мес` : ""}
            </span>
          </div>
          <datalist id="process-roles">
            {roles.map((role) => (
              <option key={role} value={role} />
            ))}
          </datalist>
          <datalist id="process-systems">
            {systems.map((system) => (
              <option key={system} value={system} />
            ))}
          </datalist>
          <div className="space-y-2">
            {form.steps.map((step, index) => (
              <div key={index} className="grid grid-cols-12 items-center gap-2 rounded-lg border border-border p-2" data-testid={`step-row-${index}`}>
                <span className="col-span-12 text-xs text-muted-foreground md:col-span-1 md:text-center">{index + 1}</span>
                <Input className="col-span-12 md:col-span-4" value={step.name} onChange={(e) => setStep(index, "name", e.target.value)} placeholder="Название шага" />
                <Input className="col-span-6 md:col-span-2" list="process-roles" value={step.role} onChange={(e) => setStep(index, "role", e.target.value)} placeholder="Роль" />
                <Input className="col-span-6 md:col-span-2" list="process-systems" value={step.system} onChange={(e) => setStep(index, "system", e.target.value)} placeholder="Система" />
                <div className="col-span-5 md:col-span-1">
                  <Select value={step.type === "decision" ? "decision" : step.mode} onValueChange={(value) => {
                    if (value === "decision") setStep(index, "type", "decision");
                    else {
                      setStep(index, "type", "task");
                      setStep(index, "mode", value);
                    }
                  }}>
                    <SelectTrigger className="px-2 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Вручную</SelectItem>
                      <SelectItem value="system">В системе</SelectItem>
                      <SelectItem value="auto">Авто</SelectItem>
                      <SelectItem value="decision">Решение</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  className="col-span-3 md:col-span-1"
                  type="number"
                  min={0}
                  value={step.type === "decision" || step.mode === "auto" ? "" : step.duration_min}
                  disabled={step.type === "decision" || step.mode === "auto"}
                  onChange={(e) => setStep(index, "duration_min", e.target.value)}
                  placeholder="мин"
                  title="Минут рабочего времени"
                />
                <div className="col-span-4 flex justify-end md:col-span-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" disabled={index === 0} onClick={() => moveStep(index, -1)} aria-label="Выше">
                    <ArrowUp />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" disabled={index === form.steps.length - 1} onClick={() => moveStep(index, 1)} aria-label="Ниже">
                    <ArrowDown />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-red-500" onClick={() => removeStep(index)} aria-label="Удалить шаг">
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={addStep} data-testid="add-step-btn">
            <Plus /> Добавить шаг
          </Button>
          <p className="text-xs text-muted-foreground">
            «Решение» — проверка с исходами «Да» (дальше) и «Нет» (возврат на предыдущий шаг). «Авто» — шаг выполняет система или робот.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="process-pains">Проблемы (по одной в строке)</Label>
          <Textarea id="process-pains" value={form.pain_points} onChange={set("pain_points")} className="min-h-[60px]" />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={save} disabled={saving || !form.name.trim()} data-testid="save-process-btn">
            {saving ? <Loader2 className="animate-spin" /> : <Save />} Сохранить
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
