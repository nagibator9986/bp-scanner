"""Нормализация ответов LLM: приведение типов, значения по умолчанию, связывание сущностей.

Модель может вернуть строки вместо чисел, синонимы категорий, пропущенные поля —
здесь всё это приводится к стабильной структуре, с которой работают API, отчёты и фронтенд.
"""
import difflib
import re
from typing import Any

SCORE_FIELDS = [
    "complexity",
    "manual_effort",
    "system_fragmentation",
    "approval_burden",
    "ai_suitability",
    "automation_readiness",
]

CATEGORIES = ("simple_automation", "classic_digitization", "ai_reengineering")
CATEGORY_LABELS = {
    "simple_automation": "Простая автоматизация",
    "classic_digitization": "Классическая цифровизация",
    "ai_reengineering": "AI-реинжиниринг",
}
_CATEGORY_HINTS = [
    ("ai_reengineering", re.compile(r"\bai\b|\bии\b|искусствен|llm|реинжиниринг|\bml\b|машинн")),
    ("classic_digitization", re.compile(r"digit|цифров|интеграц|\bbpm\b|\bсэд\b|classic")),
    ("simple_automation", re.compile(r"simple|automation|автоматиз|\brpa\b|простая|n8n")),
]
_COMPLEXITY_ALIASES = {
    "low": "low", "низкая": "low", "простая": "low", "легкая": "low", "лёгкая": "low",
    "medium": "medium", "средняя": "medium", "mid": "medium", "moderate": "medium",
    "high": "high", "высокая": "high", "сложная": "high",
}
NODE_TYPES = ("trigger", "action", "condition", "transform", "output")
_NODE_TYPE_ALIASES = {
    "start": "trigger", "schedule": "trigger", "webhook": "trigger", "cron": "trigger",
    "if": "condition", "switch": "condition", "branch": "condition", "decision": "condition",
    "set": "transform", "code": "transform", "function": "transform", "map": "transform",
    "end": "output", "result": "output", "response": "output",
}


# ============== Примитивы ==============

def text(value: Any, limit: int = 1000) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        value = "; ".join(text(v, limit) for v in value if v not in (None, ""))
    elif isinstance(value, dict):
        value = value.get("name") or value.get("title") or value.get("text") or ""
    return str(value).strip()[:limit]


def str_list(value: Any, limit: int = 40, item_limit: int = 300) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, str):
        parts = re.split(r"[\n;]|,(?![^()]*\))", value)
    elif isinstance(value, (list, tuple)):
        parts = value
    else:
        parts = [value]
    result: list[str] = []
    for part in parts:
        item = text(part, item_limit)
        item = re.sub(r"^\s*(?:[-•*]|\d+[.)])\s*", "", item)
        if item and item not in result:
            result.append(item)
        if len(result) >= limit:
            break
    return result


def to_float(value: Any, low: float, high: float, default: float | None) -> float | None:
    if isinstance(value, bool):
        return default
    if isinstance(value, str):
        match = re.search(r"-?\d+(?:[.,]\d+)?", value)
        value = match.group(0).replace(",", ".") if match else None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if number != number:  # NaN
        return default
    return max(low, min(high, number))


def to_int(value: Any, low: int, high: int, default: int | None) -> int | None:
    number = to_float(value, low, high, None)
    return default if number is None else int(round(number))


def to_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"true", "yes", "да", "1", "y"}
    return default


def _key(name: str) -> str:
    return re.sub(r"[^\w]+", " ", (name or "").lower()).strip()


def match_name(name: str, candidates: list[str]) -> int | None:
    """Индекс наиболее похожего названия (точное совпадение → вхождение → нечёткое)."""
    key = _key(name)
    if not key or not candidates:
        return None
    keys = [_key(c) for c in candidates]
    if key in keys:
        return keys.index(key)
    for index, candidate in enumerate(keys):
        if candidate and (key in candidate or candidate in key):
            return index
    best = difflib.get_close_matches(key, keys, n=1, cutoff=0.6)
    return keys.index(best[0]) if best else None


def complexity(value: Any, default: str = "medium") -> str:
    return _COMPLEXITY_ALIASES.get(text(value, 30).lower(), default)


def category(value: Any) -> str:
    raw = text(value, 80).lower()
    if raw in CATEGORIES:
        return raw
    for key, pattern in _CATEGORY_HINTS:
        if pattern.search(raw):
            return key
    return "simple_automation"


# ============== Процессы ==============

def normalize_step(step: Any) -> dict | None:
    if isinstance(step, str):
        name = text(step, 300)
        data: dict = {}
    elif isinstance(step, dict):
        data = step
        name = text(step.get("name") or step.get("title") or step.get("step") or step.get("description"), 300)
    else:
        return None
    name = re.sub(r"^\s*(?:шаг\s*)?\d+[.)]\s*", "", name, flags=re.IGNORECASE)
    if not name:
        return None

    raw_type = text(data.get("type"), 40).lower()
    if raw_type in ("decision", "gateway", "exclusivegateway", "condition", "check", "решение"):
        step_type = "decision"
    elif raw_type in ("subprocess", "подпроцесс"):
        step_type = "subprocess"
    elif raw_type:
        step_type = "task"
    else:
        # Шаг-строка: вопрос в названии означает развилку («Документы корректны?»)
        step_type = "decision" if name.endswith("?") else "task"

    automated = to_bool(data.get("automated"), False)
    return {
        "name": name,
        "role": text(data.get("role") or data.get("actor") or data.get("performer"), 120),
        "system": text(data.get("system"), 120),
        "type": step_type,
        "manual": to_bool(data.get("manual"), not automated),
        "automated": automated,
        "duration_min": to_float(data.get("duration_min") or data.get("duration"), 0, 100000, None),
    }


def _unique(items: list[str]) -> list[str]:
    seen, result = set(), []
    for item in items:
        key = _key(item)
        if item and key not in seen:
            seen.add(key)
            result.append(item)
    return result


def normalize_process(raw: dict) -> dict | None:
    name = text(raw.get("name") or raw.get("title") or raw.get("process_name"), 200)
    if not name:
        return None
    steps_detail = [s for s in (normalize_step(s) for s in (raw.get("steps") or [])) if s]
    roles = _unique(str_list(raw.get("roles")) + [s["role"] for s in steps_detail if s["role"]])
    systems = _unique(str_list(raw.get("systems")) + [s["system"] for s in steps_detail if s["system"]])
    durations = [s["duration_min"] for s in steps_detail if s["duration_min"]]
    return {
        "name": name,
        "description": text(raw.get("description"), 2000),
        "owner": text(raw.get("owner"), 200),
        "trigger": text(raw.get("trigger"), 500),
        "frequency": text(raw.get("frequency"), 200),
        "volume": text(raw.get("volume"), 200),
        "sla": text(raw.get("sla"), 300),
        "roles": roles,
        "systems": systems,
        "input_documents": str_list(raw.get("input_documents")),
        "output_documents": str_list(raw.get("output_documents")),
        "pain_points": str_list(raw.get("pain_points")),
        "steps": [s["name"] for s in steps_detail],
        "steps_detail": steps_detail,
        "metrics": {
            "steps_count": len(steps_detail),
            "decisions_count": sum(1 for s in steps_detail if s["type"] == "decision"),
            "manual_steps": sum(1 for s in steps_detail if s["manual"] and s["type"] != "decision"),
            "roles_count": len(roles),
            "systems_count": len(systems),
            "total_duration_min": round(sum(durations), 1) if durations else None,
        },
    }


def normalize_processes(raw_items: list[dict], limit: int = 15) -> list[dict]:
    processes, seen = [], set()
    for raw in raw_items:
        process = normalize_process(raw)
        if not process or _key(process["name"]) in seen:
            continue
        seen.add(_key(process["name"]))
        processes.append(process)
        if len(processes) >= limit:
            break
    return processes


# ============== Скоринг ==============

def automation_potential(score: dict) -> int:
    """Интегральный индекс потенциала автоматизации 0–100.

    Высокий ручной труд, готовность к автоматизации, разрозненность систем, нагрузка
    согласований и пригодность для AI повышают потенциал.
    """
    weighted = (
        score["manual_effort"] * 0.30
        + score["automation_readiness"] * 0.25
        + score["system_fragmentation"] * 0.15
        + score["approval_burden"] * 0.15
        + score["ai_suitability"] * 0.15
    )
    return int(round((weighted - 1) / 9 * 100))


def normalize_scoring(raw_items: list[dict], processes: list[dict]) -> list[dict]:
    names = [p["name"] for p in processes]
    result, used = [], set()
    for position, raw in enumerate(raw_items):
        index = match_name(text(raw.get("process_name") or raw.get("name") or raw.get("process"), 200), names)
        if index is None and len(raw_items) == len(processes) and position not in used:
            index = position  # модель могла переписать название — сопоставляем по порядку
        if index is None or index in used:
            continue
        used.add(index)
        score = {field: to_int(raw.get(field), 1, 10, 5) for field in SCORE_FIELDS}
        score.update({
            "process_id": processes[index].get("id"),
            "process_name": names[index],
            "bottlenecks": str_list(raw.get("bottlenecks")),
            "rationale": text(raw.get("rationale") or raw.get("comment"), 1500),
            "total_score": sum(score[f] for f in SCORE_FIELDS),
        })
        score["automation_potential"] = automation_potential(score)
        result.append(score)
    result.sort(key=lambda s: s["automation_potential"], reverse=True)
    return result


# ============== Рекомендации ==============

def normalize_recommendations(raw_items: list[dict], processes: list[dict], limit: int = 20) -> list[dict]:
    names = [p["name"] for p in processes]
    result, seen = [], set()
    for raw in raw_items:
        title = text(raw.get("title") or raw.get("name"), 300)
        if not title or _key(title) in seen:
            continue
        seen.add(_key(title))
        related = str_list(raw.get("related_processes") or raw.get("related_process"))
        related_ids = []
        for name in related:
            index = match_name(name, names)
            if index is not None and processes[index].get("id") not in related_ids:
                related_ids.append(processes[index].get("id"))
        result.append({
            "title": title,
            "description": text(raw.get("description"), 3000),
            "category": category(raw.get("category")),
            "related_processes": related,
            "related_process_ids": [i for i in related_ids if i],
            "effect": text(raw.get("effect") or raw.get("expected_effect"), 1500),
            "complexity": complexity(raw.get("complexity")),
            "priority": to_int(raw.get("priority"), 1, 5, 3),
            "implementation_stack": text(raw.get("implementation_stack") or raw.get("stack"), 500),
            "estimated_fte_savings": round(to_float(raw.get("estimated_fte_savings") or raw.get("fte_savings"), 0, 100, 0.0), 2),
            "implementation_weeks": to_int(raw.get("implementation_weeks") or raw.get("weeks"), 1, 260, None),
            "kpi": text(raw.get("kpi"), 500),
        })
        if len(result) >= limit:
            break
    result.sort(key=lambda r: (r["priority"], -r["estimated_fte_savings"]))
    return result


# ============== TO-BE ==============

def normalize_tobe(raw_items: list[dict], processes: list[dict]) -> list[dict]:
    names = [p["name"] for p in processes]
    result, used = [], set()
    for position, raw in enumerate(raw_items):
        source_name = text(raw.get("process_name") or raw.get("name"), 200)
        index = match_name(source_name, names)
        if index is None and len(raw_items) == len(processes):
            index = position
        if index is not None and index in used:
            continue
        process = processes[index] if index is not None else None
        if index is not None:
            used.add(index)

        new_process = raw.get("new_process") if isinstance(raw.get("new_process"), dict) else {}
        steps_source = new_process.get("steps") or raw.get("new_steps") or raw.get("steps") or []
        steps_detail = [s for s in (normalize_step(s) for s in steps_source) if s]
        automated_steps = str_list(raw.get("automated_steps"))
        automated_keys = {_key(s) for s in automated_steps}
        for step in steps_detail:
            if _key(step["name"]) in automated_keys:
                step["automated"] = True
                step["manual"] = False

        steps_before = len(process["steps_detail"]) if process else None
        result.append({
            "process_id": process.get("id") if process else None,
            "process_name": process["name"] if process else (source_name or "Процесс"),
            "improvements": str_list(raw.get("improvements")),
            "removed_steps": str_list(raw.get("removed_steps")),
            "merged_steps": str_list(raw.get("merged_steps")),
            "automated_steps": automated_steps,
            "new_process": {
                "name": text(new_process.get("name"), 200) or (process["name"] if process else source_name),
                "steps": [s["name"] for s in steps_detail],
                "steps_detail": steps_detail,
            },
            "expected_effect": text(raw.get("expected_effect") or raw.get("effect"), 1500),
            "time_reduction_percent": to_int(raw.get("time_reduction_percent"), 0, 100, None),
            "risks": str_list(raw.get("risks")),
            "dependencies": str_list(raw.get("dependencies")),
            "metrics": {
                "steps_before": steps_before,
                "steps_after": len(steps_detail),
                "automated_count": sum(1 for s in steps_detail if s["automated"]),
            },
        })
    return result


# ============== n8n ==============

def _node_type(raw_type: str, n8n_node: str) -> str:
    value = (raw_type or "").lower()
    if value in NODE_TYPES:
        return value
    if value in _NODE_TYPE_ALIASES:
        return _NODE_TYPE_ALIASES[value]
    node = (n8n_node or "").lower()
    if "trigger" in node or node in ("webhook", "cron"):
        return "trigger"
    if node in ("if", "switch", "merge", "splitinbatches"):
        return "condition"
    if node in ("set", "code", "function", "itemlists"):
        return "transform"
    if node in ("respondtowebhook",):
        return "output"
    return "action"


def normalize_workflow(raw: dict) -> dict | None:
    name = text(raw.get("name") or raw.get("title"), 200)
    raw_nodes = raw.get("nodes") if isinstance(raw.get("nodes"), list) else []
    if not name or not raw_nodes:
        return None

    nodes, ids = [], set()
    for index, node in enumerate(raw_nodes):
        if not isinstance(node, dict):
            continue
        node_id = text(node.get("id"), 80) or f"node_{index + 1}"
        while node_id in ids:
            node_id = f"{node_id}_{index + 1}"
        ids.add(node_id)
        n8n_node = text(node.get("n8n_node") or node.get("n8n_type") or node.get("node"), 80)
        nodes.append({
            "id": node_id,
            "type": _node_type(text(node.get("type"), 40), n8n_node),
            "n8n_node": n8n_node,
            "name": text(node.get("name"), 120) or f"Шаг {index + 1}",
            "description": text(node.get("description"), 800),
            "parameters": node.get("parameters") if isinstance(node.get("parameters"), dict) else {},
        })
    if not nodes:
        return None

    connections = []
    for connection in raw.get("connections") or []:
        if not isinstance(connection, dict):
            continue
        source = text(connection.get("from") or connection.get("source"), 80)
        target = text(connection.get("to") or connection.get("target"), 80)
        if source in ids and target in ids and source != target:
            pair = {"from": source, "to": target}
            if pair not in connections:
                connections.append(pair)
    if not connections and len(nodes) > 1:
        connections = [{"from": a["id"], "to": b["id"]} for a, b in zip(nodes, nodes[1:])]

    return {
        "name": name,
        "description": text(raw.get("description"), 2000),
        "use_case": text(raw.get("use_case"), 1000),
        "related_recommendation": text(raw.get("related_recommendation"), 300),
        "related_process": text(raw.get("related_process"), 300),
        "complexity": complexity(raw.get("complexity")),
        "estimated_time_savings": text(raw.get("estimated_time_savings"), 200),
        "integration_points": str_list(raw.get("integration_points")),
        "nodes": nodes,
        "connections": connections,
    }


def normalize_workflows(raw_items: list[dict], limit: int = 12) -> list[dict]:
    result, seen = [], set()
    for raw in raw_items:
        workflow = normalize_workflow(raw)
        if workflow and _key(workflow["name"]) not in seen:
            seen.add(_key(workflow["name"]))
            result.append(workflow)
        if len(result) >= limit:
            break
    return result
