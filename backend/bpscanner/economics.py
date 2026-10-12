"""Экономика процессов: трудозатраты AS-IS / TO-BE, высвобождаемые FTE и деньги.

Расчёт детерминированный и прозрачный:
  трудозатраты на экземпляр = сумма длительностей ручных шагов (решения и автоматические шаги — 0);
  часы в месяц = минуты на экземпляр × экземпляров в месяц / 60;
  FTE = часы в месяц / рабочих часов в месяц на одного сотрудника;
  деньги в год = сэкономленные часы в месяц × 12 × стоимость часа.
Модель оценивает только длительности шагов и объёмы — формулы считаются здесь.
"""
import re

from .db import db
from .normalize import match_name

DEFAULT_ECONOMICS = {"hourly_cost": 0.0, "currency": "₸", "fte_hours_month": 165.0}

# Частота выполнения → экземпляров в месяц (если модель не указала объём числом)
_FREQUENCY_RULES = [
    (r"(\d+)\s*раз[а]?\s*в\s*день", lambda n: n * 21),
    (r"(\d+)\s*раз[а]?\s*в\s*неделю", lambda n: n * 4.3),
    (r"(\d+)\s*раз[а]?\s*в\s*месяц", lambda n: n),
    (r"ежедневн|каждый день|daily", 21),
    (r"еженедельн|weekly", 4.3),
    (r"ежемесячн|monthly", 1),
    (r"ежекварт|quarterly", 1 / 3),
    (r"ежегодн|раз в год|annual|yearly", 1 / 12),
]


async def load_economics_settings() -> dict:
    stored = await db.settings.find_one({"scope": "economics"}, {"_id": 0}) or {}
    result = dict(DEFAULT_ECONOMICS)
    for key in DEFAULT_ECONOMICS:
        if stored.get(key) not in (None, ""):
            result[key] = stored[key]
    result["fte_hours_month"] = float(result["fte_hours_month"]) or DEFAULT_ECONOMICS["fte_hours_month"]
    result["hourly_cost"] = float(result["hourly_cost"] or 0)
    return result


def frequency_to_monthly(text: str | None) -> float | None:
    value = (text or "").lower()
    if not value:
        return None
    for pattern, rule in _FREQUENCY_RULES:
        match = re.search(pattern, value)
        if match:
            return float(rule(int(match.group(1)))) if callable(rule) else float(rule)
    return None


def monthly_volume(process: dict) -> tuple[float | None, str | None]:
    volume = process.get("volume_per_month")
    if isinstance(volume, (int, float)) and volume > 0:
        return float(volume), "model"
    derived = frequency_to_monthly(process.get("frequency"))
    return (derived, "frequency") if derived else (None, None)


def _step_minutes(step: dict) -> float:
    if step.get("type") == "decision" or step.get("automated"):
        return 0.0
    return float(step.get("duration_min") or 0)


def case_minutes(steps: list[dict]) -> float | None:
    """Ручные трудозатраты на один экземпляр процесса, если модель дала длительности."""
    manual = [s for s in steps if s.get("type") != "decision" and not s.get("automated")]
    if not manual or not any(s.get("duration_min") for s in manual):
        return None
    return round(sum(_step_minutes(s) for s in steps), 1)


def process_economics(process: dict) -> dict:
    volume, source = monthly_volume(process)
    minutes = case_minutes(process.get("steps_detail") or [])
    hours = round(minutes * volume / 60, 1) if minutes is not None and volume else None
    return {"volume_per_month": volume, "volume_source": source, "minutes_per_case": minutes, "hours_per_month": hours}


def tobe_economics(tobe: dict, process: dict | None) -> dict:
    """Трудозатраты TO-BE: длительности из ответа модели, иначе — из совпадающего шага AS-IS."""
    asis = (process or {}).get("economics") or process_economics(process or {})
    asis_steps = (process or {}).get("steps_detail") or []
    steps = ((tobe.get("new_process") or {}).get("steps_detail")) or []
    minutes = None
    if steps:
        manual_durations = [s["duration_min"] for s in asis_steps if s.get("duration_min") and not s.get("automated")]
        average = sum(manual_durations) / len(manual_durations) if manual_durations else None
        total, known = 0.0, True
        for step in steps:
            if step.get("type") == "decision" or step.get("automated"):
                continue
            duration = step.get("duration_min")
            if not duration:
                index = match_name(step["name"], [s["name"] for s in asis_steps])
                duration = asis_steps[index].get("duration_min") if index is not None else None
            if not duration:
                duration = average
            if duration is None:
                known = False
                break
            total += duration
        minutes = round(total, 1) if known else None
    if minutes is None and asis.get("minutes_per_case") is not None and tobe.get("time_reduction_percent") is not None:
        minutes = round(asis["minutes_per_case"] * (1 - tobe["time_reduction_percent"] / 100), 1)

    volume = asis.get("volume_per_month")
    hours = round(minutes * volume / 60, 1) if minutes is not None and volume else None
    saved = None
    if hours is not None and asis.get("hours_per_month") is not None:
        saved = round(max(asis["hours_per_month"] - hours, 0), 1)
    reduction = None
    if minutes is not None and asis.get("minutes_per_case"):
        reduction = round(100 * (1 - minutes / asis["minutes_per_case"]))
    return {"minutes_per_case": minutes, "hours_per_month": hours, "saved_hours_month": saved, "reduction_percent": reduction}


def money(hours_month: float | None, eco: dict) -> float | None:
    if hours_month is None or not eco.get("hourly_cost"):
        return None
    return round(hours_month * 12 * eco["hourly_cost"])


def fte(hours_month: float | None, eco: dict) -> float | None:
    if hours_month is None:
        return None
    return round(hours_month / eco["fte_hours_month"], 2)


def summarize(processes: list[dict], tobe_models: list[dict], eco: dict) -> dict:
    """Строки по процессам и итоги подразделения."""
    tobe_by_process = {t.get("process_id"): t for t in tobe_models if t.get("process_id")}
    rows = []
    for process in processes:
        asis = process.get("economics") or process_economics(process)
        tobe = tobe_by_process.get(process.get("id"))
        target = (tobe or {}).get("economics") or (tobe_economics(tobe, process) if tobe else {})
        saved = target.get("saved_hours_month")
        rows.append({
            "process_id": process.get("id"),
            "process_name": process.get("name"),
            "volume_per_month": asis.get("volume_per_month"),
            "volume_source": asis.get("volume_source"),
            "minutes_per_case": asis.get("minutes_per_case"),
            "hours_per_month": asis.get("hours_per_month"),
            "fte": fte(asis.get("hours_per_month"), eco),
            "tobe_minutes_per_case": target.get("minutes_per_case"),
            "tobe_hours_per_month": target.get("hours_per_month"),
            "saved_hours_month": saved,
            "saved_fte": fte(saved, eco),
            "saved_money_year": money(saved, eco),
            "reduction_percent": target.get("reduction_percent"),
        })
    known = [r for r in rows if r["hours_per_month"] is not None]
    saved_rows = [r for r in rows if r["saved_hours_month"] is not None]
    hours_asis = round(sum(r["hours_per_month"] for r in known), 1) if known else None
    saved_hours = round(sum(r["saved_hours_month"] for r in saved_rows), 1) if saved_rows else None
    return {
        "rows": rows,
        "totals": {
            "hours_per_month": hours_asis,
            "fte": fte(hours_asis, eco),
            "saved_hours_month": saved_hours,
            "saved_fte": fte(saved_hours, eco),
            "saved_money_year": money(saved_hours, eco),
            "processes_with_data": len(known),
            "processes_total": len(rows),
        },
        "settings": eco,
    }
