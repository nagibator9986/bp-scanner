import { useEffect, useState } from "react";
import { Calculator, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import api, { errorMessage } from "@/lib/api";

/** Параметры расчёта экономического эффекта (общие для всех подразделений). */
export function EconomicsSettingsForm({ onSaved }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get("/settings/economics")
      .then(({ data }) => setForm({ hourly_cost: data.hourly_cost || "", currency: data.currency, fte_hours_month: data.fte_hours_month }))
      .catch((err) => toast.error(errorMessage(err, "Не удалось загрузить параметры")));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.post("/settings/economics", {
        hourly_cost: Number(form.hourly_cost) || 0,
        currency: form.currency || "₸",
        fte_hours_month: Number(form.fte_hours_month) || 165,
      });
      toast.success("Параметры экономики сохранены");
      onSaved?.(data);
    } catch (err) {
      toast.error(errorMessage(err, "Ошибка сохранения"));
    } finally {
      setSaving(false);
    }
  };

  if (!form) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  const update = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <div className="space-y-5" data-testid="economics-settings-form">
      <div className="flex items-start gap-3 rounded-lg border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
        <Calculator className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p>
          Трудозатраты процесса = сумма длительностей ручных шагов × число экземпляров в месяц. Высвобождаемые FTE = сэкономленные
          часы / рабочих часов в месяц. Экономия в год = сэкономленные часы × 12 × стоимость часа. Длительности шагов и объёмы
          оценивает модель, их можно уточнить в редакторе процессов.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="hourly-cost">Стоимость часа сотрудника</Label>
          <Input id="hourly-cost" type="number" min={0} value={form.hourly_cost} onChange={update("hourly_cost")} placeholder="например, 4500" />
          <p className="text-xs text-muted-foreground">С налогами и накладными; пусто — деньги не считаются</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="currency">Валюта</Label>
          <Input id="currency" value={form.currency} onChange={update("currency")} maxLength={8} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fte-hours">Рабочих часов в месяц (1 FTE)</Label>
          <Input id="fte-hours" type="number" min={1} max={744} value={form.fte_hours_month} onChange={update("fte_hours_month")} />
        </div>
      </div>
      <Button onClick={save} disabled={saving} data-testid="save-economics-btn">
        {saving ? <Loader2 className="animate-spin" /> : <Save />} Сохранить
      </Button>
    </div>
  );
}
