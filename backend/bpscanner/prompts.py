"""Промпты этапов анализа: значения по умолчанию, хранение в БД и подстановка переменных."""
import logging
import re
import uuid

from .db import db, now_iso

logger = logging.getLogger("bpscanner.prompts")

STEP_META = {
    "extracting_processes": {
        "title": "Извлечение процессов",
        "placeholders": ["division_name", "division_description", "questionnaire", "documents", "knowledge_context"],
    },
    "scoring": {
        "title": "Скоринг процессов",
        "placeholders": ["division_name", "processes", "knowledge_context"],
    },
    "recommendations": {
        "title": "Рекомендации",
        "placeholders": ["division_name", "processes", "scoring", "knowledge_context"],
    },
    "tobe": {
        "title": "TO-BE модели",
        "placeholders": ["division_name", "processes", "recommendations", "knowledge_context"],
    },
    "n8n": {
        "title": "N8N workflows",
        "placeholders": ["division_name", "processes", "recommendations", "knowledge_context"],
    },
}

# Важно: в шаблонах фигурные скобки JSON пишутся одинарными.
# Подставляются только плейсхолдеры вида {name} из STEP_META.
DEFAULT_PROMPTS = {
    "extracting_processes": {
        "description": "Извлечение бизнес-процессов из анкеты и документов",
        "system_prompt": (
            "Ты — ведущий бизнес-аналитик банка с опытом процессного моделирования (BPMN 2.0, Lean). "
            "Выявляешь бизнес-процессы подразделения по анкете и документам. Опирайся на исходные данные; "
            "если сведений не хватает — делай разумные допущения, типичные для банка. "
            "Отвечай строго валидным JSON без пояснений и markdown."
        ),
        "user_prompt_template": """Подразделение: "{division_name}"
Описание: {division_description}

## Анкета
{questionnaire}

## Документы
{documents}

{knowledge_context}

Выяви ключевые бизнес-процессы подразделения (от 4 до 10). Для каждого процесса опиши последовательность шагов от триггера до результата: кто выполняет шаг (роль), в какой системе, сколько минут он занимает, выполняется ли вручную. Проверки и согласования с двумя исходами оформляй шагом с "type": "decision" и вопросом в названии.

Верни JSON-массив:
[{"name":"Название процесса","description":"Цель и краткое описание","owner":"Владелец процесса","trigger":"Что запускает процесс","frequency":"Частота","volume":"Объём, если известен","sla":"Норматив","roles":["Роль 1","Роль 2"],"systems":["Система 1"],"input_documents":["Документ"],"output_documents":["Документ"],"pain_points":["Проблема"],"steps":[{"name":"Шаг","role":"Роль 1","system":"Система 1","type":"task","manual":true,"duration_min":15},{"name":"Документы корректны?","role":"Роль 2","type":"decision"}]}]""",
    },
    "scoring": {
        "description": "Скоринг процессов по 6 измерениям",
        "system_prompt": (
            "Ты — эксперт по оценке и приоритизации бизнес-процессов для автоматизации в банке. "
            "Оценивай объективно и используй всю шкалу 1–10. Отвечай строго валидным JSON."
        ),
        "user_prompt_template": """Оцени процессы подразделения "{division_name}" по шести измерениям (1 — минимум, 10 — максимум):
- complexity — сложность процесса (число шагов, ветвлений, участников);
- manual_effort — доля ручного труда;
- system_fragmentation — разрозненность систем и ручной перенос данных;
- approval_burden — нагрузка согласований;
- ai_suitability — пригодность для AI (неструктурированные документы, классификация, извлечение данных, генерация текстов);
- automation_readiness — готовность к автоматизации (формализованность, наличие API, стабильность правил).

Процессы:
{processes}

{knowledge_context}

Верни JSON-массив — по одному объекту на каждый процесс, process_name точно как во входных данных:
[{"process_name":"Название","complexity":6,"manual_effort":8,"system_fragmentation":7,"approval_burden":5,"ai_suitability":7,"automation_readiness":6,"bottlenecks":["Узкое место"],"rationale":"Краткое обоснование"}]""",
    },
    "recommendations": {
        "description": "Генерация рекомендаций по автоматизации",
        "system_prompt": (
            "Ты — эксперт по цифровой трансформации банков: RPA, low-code (n8n), интеграции, BPM, AI/LLM. "
            "Даёшь конкретные реализуемые рекомендации с измеримым эффектом. Отвечай строго валидным JSON."
        ),
        "user_prompt_template": """Сформируй рекомендации по улучшению процессов подразделения "{division_name}".

Процессы:
{processes}

Скоринг:
{scoring}

{knowledge_context}

Категории:
- simple_automation — быстрая автоматизация рутины (n8n, скрипты, RPA, шаблоны), 2–6 недель;
- classic_digitization — цифровизация и интеграция систем (BPM/СЭД, API, единые справочники, электронные формы);
- ai_reengineering — реинжиниринг с применением AI (LLM-ассистенты, OCR/IDP, классификация, предиктивная аналитика).

Дай от 8 до 15 рекомендаций, покрыв все три категории. Для каждой оцени экономию FTE и срок реализации.
priority: 1 — наивысший, 5 — низкий. complexity: low | medium | high.

Верни JSON-массив:
[{"title":"Название","description":"Что именно сделать","category":"simple_automation","related_processes":["Название процесса"],"effect":"Ожидаемый эффект","complexity":"low","priority":1,"implementation_stack":"Технологии","estimated_fte_savings":0.5,"implementation_weeks":4,"kpi":"Как измерить результат"}]""",
    },
    "tobe": {
        "description": "Генерация TO-BE моделей процессов",
        "system_prompt": (
            "Ты — эксперт по реинжинирингу бизнес-процессов и проектированию целевых процессов. "
            "Отвечай строго валидным JSON."
        ),
        "user_prompt_template": """Спроектируй целевые TO-BE модели процессов подразделения "{division_name}" с учётом рекомендаций.

AS-IS процессы:
{processes}

Рекомендации:
{recommendations}

{knowledge_context}

Для каждого процесса из AS-IS (process_name точно как во входных данных) опиши целевой процесс: какие шаги убраны, объединены и автоматизированы, и новую последовательность шагов. Автоматические шаги помечай "automated": true, а в role указывай систему или робота.

Верни JSON-массив:
[{"process_name":"Название AS-IS процесса","improvements":["Улучшение"],"removed_steps":["Шаг"],"merged_steps":["Шаг А + Шаг Б"],"automated_steps":["Шаг"],"new_process":{"name":"Название TO-BE","steps":[{"name":"Шаг","role":"Роль","system":"Система","type":"task","automated":false}]},"expected_effect":"Эффект","time_reduction_percent":40,"risks":["Риск"],"dependencies":["Зависимость"]}]""",
    },
    "n8n": {
        "description": "Генерация n8n workflows для автоматизации",
        "system_prompt": (
            "Ты — эксперт по автоматизации процессов на платформе n8n. Проектируешь практичные workflow "
            "из реальных нод n8n. Отвечай строго валидным JSON."
        ),
        "user_prompt_template": """Спроектируй n8n workflows для автоматизации процессов подразделения "{division_name}".

Рекомендации по автоматизации:
{recommendations}

Процессы:
{processes}

{knowledge_context}

Сделай от 4 до 8 workflows под разные сценарии: приём и обработка заявок и документов, уведомления и эскалации по SLA, синхронизация данных между системами, регулярная отчётность, согласования, мониторинг.

Поле "type" ноды: trigger | action | condition | transform | output.
Поле "n8n_node" — конкретная нода n8n: scheduleTrigger, webhook, manualTrigger, emailReadImap, httpRequest, emailSend, telegram, slack, postgres, microsoftSql, googleSheets, microsoftExcel, extractFromFile, if, switch, merge, splitInBatches, set, code, wait, respondToWebhook.
Связи "connections" описывают поток данных; у ноды if первая связь — ветка «да», вторая — «нет».

Верни JSON-массив:
[{"name":"Название","description":"Что делает workflow","use_case":"Сценарий","related_recommendation":"Название рекомендации","related_process":"Название процесса","complexity":"medium","estimated_time_savings":"10 часов в неделю","integration_points":["Система"],"nodes":[{"id":"trigger_1","type":"trigger","n8n_node":"scheduleTrigger","name":"По будням в 9:00","description":"Запуск по расписанию","parameters":{"cron":"0 9 * * 1-5"}},{"id":"http_1","type":"action","n8n_node":"httpRequest","name":"Получить заявки","description":"Запрос к API СЭД","parameters":{"method":"GET","url":"https://sed.example/api/requests"}}],"connections":[{"from":"trigger_1","to":"http_1"}]}]""",
    },
}

_PLACEHOLDER_RE = re.compile(r"\{([a-z_]+)\}")


def render_prompt(template: str, variables: dict) -> str:
    """Подставляет известные плейсхолдеры, не трогая остальные фигурные скобки.

    Шаблоны старого формата (str.format, скобки JSON удвоены как {{ }}) тоже поддерживаются.
    Если в шаблоне нет {knowledge_context}, контекст базы знаний добавляется в конец.
    """
    legacy_format = "{{" in template
    text = _PLACEHOLDER_RE.sub(
        lambda m: str(variables[m.group(1)]) if m.group(1) in variables else m.group(0),
        template,
    )
    if legacy_format:
        text = text.replace("{{", "{").replace("}}", "}")
    knowledge = variables.get("knowledge_context")
    if knowledge and "{knowledge_context}" not in template:
        text = f"{text}\n\n{knowledge}"
    return text


async def get_active_prompt(step_name: str) -> dict:
    """Активный промпт этапа из БД или значение по умолчанию."""
    prompt = await db.prompts.find_one({"step_name": step_name}, {"_id": 0})
    if prompt and prompt.get("is_active", True) and prompt.get("user_prompt_template"):
        return prompt
    default = DEFAULT_PROMPTS[step_name]
    return {"step_name": step_name, **default, "is_default": True}


async def sync_default_prompts() -> None:
    """Создаёт недостающие промпты и обновляет те, что администратор не менял."""
    for step_name, default in DEFAULT_PROMPTS.items():
        existing = await db.prompts.find_one({"step_name": step_name})
        if not existing:
            await db.prompts.insert_one({
                "id": str(uuid.uuid4()),
                "step_name": step_name,
                **default,
                "version": 1,
                "is_active": True,
                "is_default": True,
                "created_at": now_iso(),
            })
        elif existing.get("is_default") and (
            existing.get("user_prompt_template") != default["user_prompt_template"]
            or existing.get("system_prompt") != default["system_prompt"]
        ):
            await db.prompts.update_one(
                {"step_name": step_name},
                {"$set": {**default, "is_active": True, "updated_at": now_iso()}},
            )
            logger.info("Default prompt '%s' updated to the current version", step_name)
