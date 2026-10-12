"""Схема адаптивной анкеты подразделения и расчёт её заполненности."""

QUESTIONNAIRE_SCHEMA = [
    {
        "id": "general",
        "title": "Общая информация",
        "questions": [
            {"id": "dept_function", "text": "Основная функция подразделения", "type": "textarea", "required": True, "placeholder": "Опишите основную деятельность подразделения..."},
            {"id": "employees_roles", "text": "Основные роли сотрудников", "type": "textarea", "required": True, "placeholder": "Перечислите ключевые роли..."},
            {"id": "org_structure", "text": "Организационная структура", "type": "textarea", "placeholder": "Опишите структуру подразделения..."},
        ],
    },
    {
        "id": "processes",
        "title": "Процессы",
        "questions": [
            {"id": "top_processes", "text": "Топ-5 ключевых процессов подразделения", "type": "textarea", "required": True, "placeholder": "1. Процесс...\n2. Процесс...\n3. Процесс..."},
            {"id": "process_frequency", "text": "Частота выполнения процессов", "type": "select", "options": ["Ежедневно", "Еженедельно", "Ежемесячно", "Ежеквартально", "По запросу", "Смешанная"], "required": True},
            {"id": "has_approvals", "text": "Есть ли процессы согласования?", "type": "boolean"},
            {"id": "has_deadlines", "text": "Есть ли жёсткие сроки/SLA?", "type": "boolean"},
        ],
    },
    {
        "id": "approvals",
        "title": "Согласования",
        "condition": {"question_id": "has_approvals", "value": True},
        "questions": [
            {"id": "approval_routes", "text": "Маршруты согласования", "type": "textarea", "placeholder": "Опишите кто и что согласовывает..."},
            {"id": "approval_limits", "text": "Лимиты и пороги", "type": "textarea", "placeholder": "Суммы, уровни, полномочия..."},
            {"id": "approval_participants", "text": "Участники согласования", "type": "textarea", "placeholder": "Роли и подразделения..."},
            {"id": "approval_deadlines", "text": "Сроки согласования", "type": "textarea", "placeholder": "Регламентные сроки..."},
        ],
    },
    {
        "id": "systems",
        "title": "Системы и инструменты",
        "questions": [
            {"id": "systems_list", "text": "Используемые информационные системы", "type": "textarea", "required": True, "placeholder": "АБИС, СЭД, Excel, 1С, CRM и т.д."},
            {"id": "manual_operations", "text": "Ручные операции", "type": "textarea", "required": True, "placeholder": "Какие операции выполняются вручную?"},
            {"id": "data_transfers", "text": "Обмен данными между системами", "type": "textarea", "placeholder": "Какие данные куда передаются?"},
            {"id": "templates_docs", "text": "Шаблоны и формы документов", "type": "textarea", "placeholder": "Какие шаблоны используются?"},
        ],
    },
    {
        "id": "pain_points",
        "title": "Проблемы и улучшения",
        "questions": [
            {"id": "bottlenecks", "text": "Основные узкие места", "type": "textarea", "required": True, "placeholder": "Где возникают задержки и проблемы?"},
            {"id": "pain_points", "text": "Ключевые проблемы в работе", "type": "textarea", "required": True, "placeholder": "Что мешает эффективной работе?"},
            {"id": "workarounds", "text": "Текущие обходные решения", "type": "textarea", "placeholder": "Как сейчас решаете проблемы?"},
            {"id": "desired_improvements", "text": "Желаемые улучшения", "type": "textarea", "placeholder": "Что хотели бы автоматизировать или улучшить?"},
        ],
    },
    {
        "id": "kpi",
        "title": "KPI и метрики",
        "questions": [
            {"id": "kpis", "text": "Ключевые KPI подразделения", "type": "textarea", "placeholder": "Основные показатели эффективности..."},
            {"id": "slas", "text": "SLA по основным процессам", "type": "textarea", "placeholder": "Регламентные сроки выполнения..."},
            {"id": "reporting", "text": "Отчётность", "type": "textarea", "placeholder": "Какие отчёты формируются, как часто?"},
        ],
    },
]

QUESTION_LABELS = {q["id"]: q["text"] for section in QUESTIONNAIRE_SCHEMA for q in section["questions"]}
MAX_ANSWER_CHARS = 20000


def _is_answered(value) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return True
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict)):
        return bool(value)
    return True


def _section_visible(section: dict, answers: dict) -> bool:
    condition = section.get("condition")
    if not condition:
        return True
    return answers.get(condition["question_id"]) == condition["value"]


def questionnaire_completion(answers: dict | None) -> dict:
    """Процент заполнения: по обязательным вопросам и по всем видимым вопросам."""
    answers = answers or {}
    required_total = required_done = total = done = 0
    for section in QUESTIONNAIRE_SCHEMA:
        if not _section_visible(section, answers):
            continue
        for question in section["questions"]:
            answered = _is_answered(answers.get(question["id"]))
            total += 1
            done += answered
            if question.get("required"):
                required_total += 1
                required_done += answered
    return {
        "required_total": required_total,
        "required_done": required_done,
        "total": total,
        "done": done,
        "percent": round(100 * done / total) if total else 0,
        "required_percent": round(100 * required_done / required_total) if required_total else 100,
    }


def sanitize_answers(answers: dict) -> dict:
    """Обрезает слишком длинные ответы и отбрасывает неподдерживаемые типы значений."""
    clean = {}
    for key, value in (answers or {}).items():
        key = str(key)[:100]
        if isinstance(value, str):
            clean[key] = value[:MAX_ANSWER_CHARS]
        elif isinstance(value, (bool, int, float)) or value is None:
            clean[key] = value
        elif isinstance(value, list):
            clean[key] = [str(v)[:MAX_ANSWER_CHARS] for v in value[:100]]
        else:
            clean[key] = str(value)[:MAX_ANSWER_CHARS]
    return clean


def format_answers_for_prompt(answers: dict | None) -> str:
    """Человекочитаемое представление анкеты для промпта (вопрос → ответ)."""
    answers = answers or {}
    lines = []
    for section in QUESTIONNAIRE_SCHEMA:
        if not _section_visible(section, answers):
            continue
        section_lines = []
        for question in section["questions"]:
            value = answers.get(question["id"])
            if not _is_answered(value):
                continue
            if isinstance(value, bool):
                value = "Да" if value else "Нет"
            elif isinstance(value, list):
                value = ", ".join(map(str, value))
            section_lines.append(f"- {question['text']}: {value}")
        if section_lines:
            lines.append(f"## {section['title']}")
            lines.extend(section_lines)
    known = {q["id"] for s in QUESTIONNAIRE_SCHEMA for q in s["questions"]}
    extra = [f"- {k}: {v}" for k, v in answers.items() if k not in known and _is_answered(v)]
    if extra:
        lines.append("## Дополнительно")
        lines.extend(extra)
    return "\n".join(lines) if lines else "Анкета не заполнена"
