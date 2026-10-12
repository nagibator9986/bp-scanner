"""Поддельный OpenAI-совместимый сервер (как vLLM с Qwen) для тестов конвейера."""
import json
import re
import socket
import threading
import time

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

PROCESSES = [
    {
        "name": "Приём и регистрация заявок",
        "description": "Регистрация входящих заявок клиентов",
        "owner": "Начальник отдела",
        "trigger": "Поступление заявки",
        "frequency": "Ежедневно",
        "volume_per_month": 600,
        "roles": ["Операционист", "Контролёр"],
        "systems": ["СЭД", "АБИС"],
        "pain_points": ["Ручной ввод данных"],
        "steps": [
            {"name": "Получить заявку", "role": "Операционист", "system": "СЭД", "type": "task", "manual": True, "duration_min": 5},
            {"name": "Внести данные в АБИС", "role": "Операционист", "system": "АБИС", "type": "task", "manual": True, "duration_min": 15},
            {"name": "Данные корректны?", "role": "Контролёр", "type": "decision"},
            {"name": "Подтвердить регистрацию", "role": "Контролёр", "system": "АБИС", "type": "task", "duration_min": 4},
        ],
    },
    {
        "name": "Подготовка отчётности",
        "description": "Ежемесячная управленческая отчётность",
        "roles": ["Аналитик"],
        "systems": ["Excel"],
        "steps": ["Выгрузить данные", "Свести в Excel", "Отправить руководителю"],
    },
]

SCORING = [
    {"process_name": "Приём и регистрация заявок", "complexity": "6", "manual_effort": 9, "system_fragmentation": 8,
     "approval_burden": 4, "ai_suitability": 7, "automation_readiness": 8, "bottlenecks": ["Двойной ввод"]},
    {"process_name": "подготовка отчетности", "complexity": 4, "manual_effort": 15, "system_fragmentation": 6,
     "approval_burden": 2, "ai_suitability": 5, "automation_readiness": 9, "bottlenecks": "Ручное сведение; Ошибки"},
]

RECOMMENDATIONS = [
    {"title": "Автоматический перенос заявок из СЭД в АБИС", "description": "Интеграция через n8n", "category": "simple_automation",
     "related_processes": ["Приём и регистрация заявок"], "effect": "Минус 15 минут на заявку", "complexity": "low",
     "priority": 1, "implementation_stack": "n8n, REST", "estimated_fte_savings": "1,5", "implementation_weeks": 4},
    {"title": "Витрина данных для отчётности", "description": "BI-отчёты вместо Excel", "category": "Классическая цифровизация",
     "related_processes": ["Подготовка отчётности"], "complexity": "средняя", "priority": 2, "estimated_fte_savings": 0.5},
    {"title": "LLM-классификация заявок", "description": "Модель определяет тип заявки", "category": "ai",
     "related_processes": ["Приём и регистрация заявок"], "complexity": "high", "priority": 3, "estimated_fte_savings": 0.8},
]

TOBE = [
    {"process_name": "Приём и регистрация заявок", "improvements": ["Автоматический перенос данных"],
     "removed_steps": ["Внести данные в АБИС"], "automated_steps": ["Перенести данные в АБИС"],
     "new_process": {"name": "Регистрация заявок (TO-BE)", "steps": [
         {"name": "Получить заявку", "role": "Операционист", "system": "СЭД"},
         {"name": "Перенести данные в АБИС", "role": "Робот n8n", "system": "n8n", "automated": True},
         {"name": "Подтвердить регистрацию", "role": "Контролёр"},
     ]},
     "expected_effect": "Сокращение времени на 60%", "time_reduction_percent": 60, "risks": ["Изменение API СЭД"]},
]

WORKFLOWS = [
    {"name": "Перенос заявок из СЭД в АБИС", "description": "Каждые 15 минут забирает новые заявки",
     "estimated_time_savings": "20 часов в неделю", "integration_points": ["СЭД", "АБИС"],
     "nodes": [
         {"id": "t1", "type": "trigger", "n8n_node": "scheduleTrigger", "name": "Каждые 15 минут", "parameters": {"cron": "*/15 * * * *"}},
         {"id": "h1", "type": "action", "n8n_node": "httpRequest", "name": "Получить заявки", "parameters": {"method": "GET", "url": "https://sed.local/api"}},
         {"id": "c1", "type": "condition", "n8n_node": "if", "name": "Есть новые?"},
         {"id": "a1", "type": "action", "n8n_node": "postgres", "name": "Записать в АБИС"},
         {"id": "n1", "type": "action", "n8n_node": "telegram", "name": "Уведомить об ошибке"},
     ],
     "connections": [{"from": "t1", "to": "h1"}, {"from": "h1", "to": "c1"}, {"from": "c1", "to": "a1"}, {"from": "c1", "to": "n1"}]},
    {"name": "Отчёт по заявкам", "nodes": [
        {"id": "s", "type": "trigger", "name": "Старт"}, {"id": "x", "type": "transform", "name": "Сводка"}]},
]


class FakeLLM:
    def __init__(self):
        self.requests: list[dict] = []
        self.port = None
        self.server = None
        self.delay = 0.0
        # Имитация окна модели как в vLLM: max_model_len в /v1/models и ошибка 400 при переполнении
        self.context_limit: int | None = None
        self.report_context = True
        self.rejected: list[dict] = []
        self.digest_reply = None  # своя функция ответа на конспектирование (user -> str)

    @staticmethod
    def count_tokens(text: str) -> int:
        return len(text) // 3 + 1  # «токенизатор» сервера: ~3 символа на токен

    def reply_for(self, system: str, user: str) -> str:
        if "BROKEN" in user:
            return "Извините, я не могу ответить в формате JSON."
        if "Ответь одним словом" in user:
            return "OK"
        if "Выяви ключевые бизнес-процессы" in user:
            # Qwen3 без reasoning-parser: блок рассуждений + JSON
            return "<think>Анализирую анкету...</think>\n" + json.dumps(PROCESSES, ensure_ascii=False)
        if "Фрагмент документа" in user:
            if self.digest_reply:
                return self.digest_reply(user)
            return "- Заявки регистрируются вручную в АБИС (из конспекта документа)"
        if "Предложи ответы на вопросы" in user:
            return json.dumps({"dept_function": "Обслуживание клиентов МСБ", "has_approvals": "да",
                               "process_frequency": "ежедневно", "unknown_question": "x", "kpis": ""}, ensure_ascii=False)
        if "Оцени процессы" in user:
            return "Вот оценка:\n```json\n" + json.dumps(self.scoring_for(user), ensure_ascii=False) + "\n```"
        if "Сформируй рекомендации" in user:
            return json.dumps({"items": RECOMMENDATIONS}, ensure_ascii=False)
        if "TO-BE" in user:
            return json.dumps(TOBE, ensure_ascii=False)
        if "n8n workflows" in user:
            text = json.dumps(WORKFLOWS, ensure_ascii=False)
            return text[:-1] + ",]"  # висячая запятая — должна быть исправлена парсером
        return "[]"

    @staticmethod
    def scoring_for(user: str) -> list[dict]:
        """Оценки для процессов из промпта; при нескольких процессах «забывает» последний,
        чтобы проверять дозапрос пропущенных процессов."""
        processes = next((json.loads(line) for line in user.splitlines() if line.startswith('[{"name"')), [])
        key = lambda name: re.sub(r"\W+", " ", name.lower().replace("ё", "е")).strip()  # noqa: E731
        known = {key(s["process_name"]): s for s in SCORING}
        result = [
            known.get(key(p["name"])) or {"process_name": p["name"], "complexity": 5, "manual_effort": 6, "system_fragmentation": 5,
                                          "approval_burden": 4, "ai_suitability": 5, "automation_readiness": 6}
            for p in processes
        ]
        return result[:-1] if len(result) > 1 else result

    def build_app(self) -> FastAPI:
        app = FastAPI()

        @app.get("/v1/models")
        async def models():
            if not (self.context_limit and self.report_context):
                return JSONResponse({"error": "not found"}, status_code=404)
            return {"object": "list", "data": [{"id": "qwen-test", "object": "model", "owned_by": "vllm", "max_model_len": self.context_limit}]}

        @app.post("/v1/chat/completions")
        async def completions(request: Request):
            body = await request.json()
            messages = body.get("messages", [])
            system = next((m["content"] for m in messages if m["role"] == "system"), "")
            user = next((m["content"] for m in messages if m["role"] == "user"), "")
            prompt_tokens = self.count_tokens(system) + self.count_tokens(user)
            if self.context_limit:
                completion = body.get("max_tokens") or 0
                if prompt_tokens + completion > self.context_limit:
                    self.rejected.append(body)
                    message = (f"This model's maximum context length is {self.context_limit} tokens. However, you requested "
                               f"{prompt_tokens + completion} tokens ({prompt_tokens} in the messages, {completion} in the completion). "
                               "Please reduce the length of the messages or completion.")
                    return JSONResponse({"object": "error", "message": message, "type": "BadRequestError", "code": 400}, status_code=400)
            self.requests.append(body)
            if self.delay:
                time.sleep(self.delay)
            return {
                "id": "chatcmpl-test",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": body.get("model"),
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": self.reply_for(system, user)},
                    "finish_reason": "stop",
                }],
                "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": 10, "total_tokens": prompt_tokens + 10},
            }

        return app

    def start(self) -> str:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            self.port = sock.getsockname()[1]
        config = uvicorn.Config(self.build_app(), host="127.0.0.1", port=self.port, log_level="warning")
        self.server = uvicorn.Server(config)
        thread = threading.Thread(target=self.server.run, daemon=True)
        thread.start()
        for _ in range(100):
            if self.server.started:
                break
            time.sleep(0.05)
        return f"http://127.0.0.1:{self.port}/v1"

    def stop(self) -> None:
        if self.server:
            self.server.should_exit = True

    def user_prompts(self) -> list[str]:
        return [next((m["content"] for m in r.get("messages", []) if m["role"] == "user"), "") for r in self.requests]
