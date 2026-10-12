import logging
import uvicorn
from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer()
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import json
import asyncio
import uuid
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
import jwt
import bcrypt
from fastapi import HTTPException, status
import asyncio
import os
from openai import AsyncOpenAI
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse
from pathlib import Path
from fastapi import HTTPException

logger = logging.getLogger('server')

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ.get('JWT_SECRET')
EMERGENT_KEY = os.environ.get('EMERGENT_LLM_KEY')

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "app" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ENV = os.getenv("ENV", "prod")

app = FastAPI()

api_router = APIRouter(prefix="/api")

@api_router.get("/health")
async def health():
    return {"status": f"{ENV} alive"}

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

# ============== AUTH ==============

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

def create_token(user_id: str, email: str, is_admin: bool) -> str:
    return jwt.encode(
        {
            "user_id": user_id,
            "email": email,
            "is_admin": is_admin,
            "exp": datetime.now(timezone.utc).timestamp() + 86400 * 7
        },
        JWT_SECRET,
        algorithm="HS256"
    )

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=["HS256"])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# ============== MODELS ==============

class UserRegister(BaseModel):
    email: str
    password: str
    name: str

class UserLogin(BaseModel):
    email: str
    password: str

class DivisionCreate(BaseModel):
    name: str
    description: str = ""
    head_name: str = ""
    employees_count: int = 0

class DivisionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    head_name: Optional[str] = None
    employees_count: Optional[int] = None

class DivisionShareRequest(BaseModel):
    user_ids: List[str]

class QuestionnaireData(BaseModel):
    answers: Dict[str, Any]

class UserSettings(BaseModel):
    provider: str = "openai"
    api_key: str = ""
    model_name: str = "gpt-5.2"
    endpoint_url: str = ""

# ============== ADMIN MODELS ==============

class PromptCreate(BaseModel):
    step_name: str  # extracting_processes, generating_bpmn, scoring, recommendations, tobe, n8n
    system_prompt: str
    user_prompt_template: str
    description: str = ""

class PromptUpdate(BaseModel):
    system_prompt: Optional[str] = None
    user_prompt_template: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

class KnowledgeCreate(BaseModel):
    title: str
    content: str
    category: str = "general"  # general, regulations, standards, processes
    is_global: bool = True  # если True - используется во всех запросах

class KnowledgeUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    category: Optional[str] = None
    is_global: Optional[bool] = None
    is_active: Optional[bool] = None

class PromptTestRequest(BaseModel):
    system_prompt: str
    user_prompt: str
    test_input: str = ""

# ============== ADMIN AUTH ==============

async def get_admin_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Проверяет что пользователь является администратором"""
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=["HS256"])
        user = await db.users.find_one({"id": payload["user_id"]}, {"_id": 0})
        if not user or user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Admin access required")
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# ============== DEFAULT PROMPTS ==============

DEFAULT_PROMPTS = {
    "extracting_processes": {
        "system_prompt": "Ты эксперт бизнес-аналитик банковской сферы. Анализируй данные подразделения и выявляй бизнес-процессы. Отвечай СТРОГО валидным JSON массивом.",
        "user_prompt_template": """Проанализируй данные подразделения "{division_name}" и выяви все бизнес-процессы.

Анкета: {questionnaire}

Документы: {documents}

{knowledge_context}

Верни JSON массив процессов:
[{{"name":"Название","description":"Описание","steps":["Шаг 1","Шаг 2"],"roles":["Роль 1"],"input_documents":["Док 1"],"output_documents":["Dok 1"],"systems":["Система 1"],"trigger":"Триггер","frequency":"Частота","sla":"SLA"}}]

Выяви минимум 5 процессов.""",
        "description": "Извлечение бизнес-процессов из анкеты и документов"
    },
    "generating_bpmn": {
        "system_prompt": "Ты эксперт BPMN моделирования. Генерируй валидный BPMN 2.0 XML с пространствами имён bpmn, bpmndi, dc, di. ОБЯЗАТЕЛЬНО включай BPMNDiagram с правильными координатами для каждого элемента. Отвечай ТОЛЬКО XML без обёрток markdown.",
        "user_prompt_template": """Сгенерируй BPMN 2.0 XML для процесса:
Название: {process_name}
Шаги: {steps}
Роли: {roles}

{knowledge_context}

КРИТИЧЕСКИ ВАЖНО для координат:
- StartEvent: x=100, y=200
- Каждый следующий Task: x увеличивается на 200 (т.е. 300, 500, 700, 900...)
- EndEvent: x = последний Task + 200
- ВСЕ элементы на одной линии y=200
- Размер Task: width=100, height=80
- Размер Event: width=36, height=36
- Gateway: width=50, height=50

Пример структуры BPMNDiagram:
<bpmndi:BPMNDiagram id="BPMNDiagram_1">
  <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
    <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
      <dc:Bounds x="100" y="182" width="36" height="36" />
    </bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
      <dc:Bounds x="250" y="160" width="100" height="80" />
    </bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
      <di:waypoint x="136" y="200" />
      <di:waypoint x="250" y="200" />
    </bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane>
</bpmndi:BPMNDiagram>

Требования:
1. StartEvent в начале
2. Task для КАЖДОГО шага (используй шаги из списка)
3. sequenceFlow между ВСЕМИ элементами
4. EndEvent в конце
5. BPMNDiagram с dc:Bounds для КАЖДОГО элемента (Shape) и di:waypoint для КАЖДОГО потока (Edge)
6. Координаты НЕ должны накладываться друг на друга!""",
        "description": "Генерация BPMN диаграмм для процессов"
    },
    "scoring": {
        "system_prompt": "Ты эксперт по оценке бизнес-процессов. Отвечай СТРОГО валидным JSON массивом.",
        "user_prompt_template": """Оцени процессы по шкале 1-10:
{processes}

{knowledge_context}

Верни JSON:
[{{"process_name":"Название","complexity":7,"manual_effort":8,"system_fragmentation":6,"approval_burden":5,"ai_suitability":8,"automation_readiness":7,"bottlenecks":["Узкое место 1"],"total_score":41}}]""",
        "description": "Скоринг процессов по 6 измерениям"
    },
    "recommendations": {
        "system_prompt": "Ты эксперт по цифровой трансформации банков. Отвечай СТРОГО валидным JSON массивом.",
        "user_prompt_template": """Сформируй рекомендации на основе процессов и скоринга.
Процессы: {processes}
Скоринг: {scoring}

{knowledge_context}

Верни JSON с категориями simple_automation, classic_digitization, ai_reengineering:
[{{"title":"Название","description":"Описание","category":"simple_automation","effect":"Эффект","complexity":"low|medium|high","priority":1,"related_processes":["Процесс"],"implementation_stack":"Стек","estimated_fte_savings":0.5}}]

Минимум 8 рекомендаций по всем 3 категориям.""",
        "description": "Генерация рекомендаций по автоматизации"
    },
    "tobe": {
        "system_prompt": "Ты эксперт по реинжинирингу бизнес-процессов. Отвечай СТРОГО валидным JSON массивом.",
        "user_prompt_template": """Сформируй TO-BE модели на основе AS-IS и рекомендаций.
AS-IS: {processes}
Рекомендации: {recommendations}

{knowledge_context}

Верни JSON:
[{{"process_name":"Название","improvements":["Улучшение"],"removed_steps":["Шаг"],"merged_steps":["Шаги"],"automated_steps":["Шаг"],"new_process":{{"name":"Новое название","steps":["Шаг 1"]}},"risks":["Риск"],"dependencies":["Зависимость"],"expected_effect":"Эффект"}}]""",
        "description": "Генерация TO-BE моделей процессов"
    },
    "n8n": {
        "system_prompt": "Ты эксперт по автоматизации процессов с помощью N8N и других low-code платформ. Генерируй детальные и разнообразные workflows. Отвечай СТРОГО валидным JSON массивом.",
        "user_prompt_template": """Сгенерируй разнообразные N8N workflows для автоматизации банковских процессов.
Рекомендации: {recommendations}

{knowledge_context}

Создай workflows с разными типами нод:
- trigger: scheduleTrigger, webhook, manualTrigger, cron
- action: httpRequest, email, slack, telegram, database, spreadsheet, pdf, ocr
- condition: if, switch, merge, splitInBatches
- transform: set, code, function, itemLists
- output: respondToWebhook, wait, sendEmail

Верни JSON массив с МИНИМУМ 6 разнообразными workflows:
[{{
  "name": "Уникальное название workflow",
  "description": "Подробное описание что делает workflow",
  "related_recommendation": "Связанная рекомендация",
  "use_case": "Конкретный сценарий использования",
  "nodes": [
    {{"id": "trigger_1", "type": "trigger", "name": "Название триггера", "description": "Когда запускается", "parameters": {{"schedule": "0 9 * * *"}}}},
    {{"id": "http_1", "type": "action", "name": "Получение данных", "description": "Описание действия", "parameters": {{"method": "GET", "url": "https://api.example.com"}}}},
    {{"id": "condition_1", "type": "condition", "name": "Проверка условия", "description": "Логика ветвления", "parameters": {{"conditions": "value > 100"}}}},
    {{"id": "transform_1", "type": "transform", "name": "Обработка данных", "description": "Трансформация", "parameters": {{}}}},
    {{"id": "action_2", "type": "action", "name": "Отправка уведомления", "description": "Email/Telegram/Slack", "parameters": {{}}}},
    {{"id": "output_1", "type": "output", "name": "Результат", "description": "Финальное действие", "parameters": {{}}}}
  ],
  "connections": [
    {{"from": "trigger_1", "to": "http_1"}},
    {{"from": "http_1", "to": "condition_1"}},
    {{"from": "condition_1", "to": "transform_1"}},
    {{"from": "transform_1", "to": "action_2"}},
    {{"from": "action_2", "to": "output_1"}}
  ],
  "estimated_time_savings": "X часов/день или X часов/неделю",
  "complexity": "low|medium|high",
  "integration_points": ["Система 1", "Система 2"]
}}]

Включи workflows для разных сценариев:
1. Обработка входящих документов и заявок
2. Уведомления и эскалации
3. Синхронизация данных между системами
4. Генерация отчетов и дашбордов
5. Мониторинг и алертинг
6. Автоматизация согласований""",
        "description": "Генерация N8N workflows с разнообразными сценариями"
    }
}

# ============== QUESTIONNAIRE SCHEMA ==============

QUESTIONNAIRE_SCHEMA = [
    {
        "id": "general",
        "title": "Общая информация",
        "questions": [
            {"id": "dept_function", "text": "Основная функция подразделения", "type": "textarea", "required": True, "placeholder": "Опишите основную деятельность подразделения..."},
            {"id": "employees_roles", "text": "Основные роли сотрудников", "type": "textarea", "required": True, "placeholder": "Перечислите ключевые роли..."},
            {"id": "org_structure", "text": "Организационная структура", "type": "textarea", "placeholder": "Опишите структуру подразделения..."},
        ]
    },
    {
        "id": "processes",
        "title": "Процессы",
        "questions": [
            {"id": "top_processes", "text": "Топ-5 ключевых процессов подразделения", "type": "textarea", "required": True, "placeholder": "1. Процесс...\n2. Процесс...\n3. Процесс..."},
            {"id": "process_frequency", "text": "Частота выполнения процессов", "type": "select", "options": ["Ежедневно", "Еженедельно", "Ежемесячно", "Ежеквартально", "По запросу", "Смешанная"], "required": True},
            {"id": "has_approvals", "text": "Есть ли процессы согласования?", "type": "boolean"},
            {"id": "has_deadlines", "text": "Есть ли жёсткие сроки/SLA?", "type": "boolean"},
        ]
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
        ]
    },
    {
        "id": "systems",
        "title": "Системы и инструменты",
        "questions": [
            {"id": "systems_list", "text": "Используемые информационные системы", "type": "textarea", "required": True, "placeholder": "АБИС, СЭД, Excel, 1С, CRM и т.д."},
            {"id": "manual_operations", "text": "Ручные операции", "type": "textarea", "required": True, "placeholder": "Какие операции выполняются вручную?"},
            {"id": "data_transfers", "text": "Обмен данными между системами", "type": "textarea", "placeholder": "Какие данные куда передаются?"},
            {"id": "templates_docs", "text": "Шаблоны и формы документов", "type": "textarea", "placeholder": "Какие шаблоны используются?"},
        ]
    },
    {
        "id": "pain_points",
        "title": "Проблемы и улучшения",
        "questions": [
            {"id": "bottlenecks", "text": "Основные узкие места", "type": "textarea", "required": True, "placeholder": "Где возникают задержки и проблемы?"},
            {"id": "pain_points", "text": "Ключевые проблемы в работе", "type": "textarea", "required": True, "placeholder": "Что мешает эффективной работе?"},
            {"id": "workarounds", "text": "Текущие обходные решения", "type": "textarea", "placeholder": "Как сейчас решаете проблемы?"},
            {"id": "desired_improvements", "text": "Желаемые улучшения", "type": "textarea", "placeholder": "Что хотели бы автоматизировать или улучшить?"},
        ]
    },
    {
        "id": "kpi",
        "title": "KPI и метрики",
        "questions": [
            {"id": "kpis", "text": "Ключевые KPI подразделения", "type": "textarea", "placeholder": "Основные показатели эффективности..."},
            {"id": "slas", "text": "SLA по основным процессам", "type": "textarea", "placeholder": "Регламентные сроки выполнения..."},
            {"id": "reporting", "text": "Отчётность", "type": "textarea", "placeholder": "Какие отчёты формируются, как часто?"},
        ]
    }
]

# ============== DOCUMENT PARSING ==============

def extract_text_from_file(file_path: str) -> str:
    ext = Path(file_path).suffix.lower()
    try:
        if ext == '.pdf':
            import PyPDF2
            text = ""
            with open(file_path, 'rb') as f:
                reader = PyPDF2.PdfReader(f)
                for page in reader.pages:
                    text += page.extract_text() or ""
            return text
        elif ext == '.docx':
            from docx import Document
            doc = Document(file_path)
            return "\n".join([p.text for p in doc.paragraphs])
        elif ext == '.xlsx':
            import openpyxl
            wb = openpyxl.load_workbook(file_path)
            text = ""
            for ws in wb:
                for row in ws.iter_rows(values_only=True):
                    text += " | ".join([str(c) for c in row if c]) + "\n"
            return text
        elif ext == '.pptx':
            from pptx import Presentation
            prs = Presentation(file_path)
            text = ""
            for slide in prs.slides:
                for shape in slide.shapes:
                    if hasattr(shape, "text"):
                        text += shape.text + "\n"
            return text
        elif ext == '.txt':
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()
        return ""
    except Exception as e:
        logger.error(f"Error extracting text from {file_path}: {e}")
        return ""

# ============== AI SERVICE ==============

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

async def ai_call(
    system_msg: str,
    user_msg: str,
    session_id: str,
    max_retries: int = 3,
    settings: dict = None,
) -> str:
    settings = settings or {}

    client_kwargs = {
        "api_key": settings.get("api_key") or OPENAI_API_KEY,
    }

    if settings.get("endpoint_url"):
        client_kwargs["base_url"] = settings["endpoint_url"]

    client = AsyncOpenAI(**client_kwargs)

    model = settings.get("model_name", "gpt-4o-mini")

    last_error = None

    for attempt in range(max_retries):
        try:
            resp = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_msg},
                    {"role": "user", "content": user_msg},
                ],
                temperature=0.3,
            )

            return resp.choices[0].message.content

        except Exception as e:
            last_error = e
            print(f"AI call attempt {attempt+1}/{max_retries} failed: {e}")

            if attempt < max_retries - 1:
                await asyncio.sleep(2 ** attempt * 2)

    raise last_error

def clean_for_mongo(data):
    """Remove _id and ensure all values are JSON-safe for MongoDB insert"""
    if isinstance(data, dict):
        return {k: clean_for_mongo(v) for k, v in data.items() if k != "_id"}
    if isinstance(data, list):
        return [clean_for_mongo(item) for item in data]
    return data

def parse_json_response(response: str) -> Any:
    try:
        if "```json" in response:
            json_str = response.split("```json")[1].split("```")[0].strip()
        elif "```" in response:
            json_str = response.split("```")[1].split("```")[0].strip()
        else:
            json_str = response.strip()
        return json.loads(json_str)
    except (json.JSONDecodeError, IndexError) as e:
        logger.error(f"JSON parse error: {e}, response: {response[:300]}")
        return None

# ============== ADMIN HELPERS ==============

async def log_error(division_id: str, step: str, error_message: str, error_detail: str = None, input_data: dict = None):
    """Логирует ошибку в БД для панели администратора"""
    import traceback
    error_log = {
        "id": str(uuid.uuid4()),
        "division_id": division_id,
        "step": step,
        "error_message": error_message,
        "error_detail": error_detail[:2000] if error_detail else None,
        "stack_trace": traceback.format_exc()[:3000],
        "input_data_summary": json.dumps(input_data, ensure_ascii=False, default=str)[:1000] if input_data else None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "resolved": False
    }
    await db.error_logs.insert_one(error_log)
    logger.error(f"[ERROR LOG] {division_id}/{step}: {error_message}")
    return error_log["id"]

async def get_active_prompt(step_name: str) -> dict:
    """Получает активный промпт для шага или дефолтный"""
    prompt = await db.prompts.find_one({"step_name": step_name, "is_active": True}, {"_id": 0})
    if prompt:
        return prompt
    # Возвращаем дефолтный промпт
    default = DEFAULT_PROMPTS.get(step_name, {})
    return {
        "step_name": step_name,
        "system_prompt": default.get("system_prompt", ""),
        "user_prompt_template": default.get("user_prompt_template", ""),
        "is_default": True
    }

async def get_knowledge_context(division_id: str = None, include_global: bool = True) -> str:
    """Собирает контекст из базы знаний"""
    query = {"is_active": {"$ne": False}}
    if include_global:
        if division_id:
            query["$or"] = [{"is_global": True}, {"division_id": division_id}]
        else:
            query["is_global"] = True
    else:
        query["division_id"] = division_id

    knowledge_items = await db.knowledge_base.find(query, {"_id": 0}).to_list(50)

    if not knowledge_items:
        return ""

    context_parts = ["Дополнительный контекст из базы знаний:"]
    for item in knowledge_items:
        context_parts.append(f"\n### {item.get('title', 'Документ')} ({item.get('category', 'general')})")
        context_parts.append(item.get("content", "")[:3000])

    return "\n".join(context_parts)

async def init_default_prompts():
    """Инициализирует дефолтные промпты в БД если их нет"""
    for step_name, prompt_data in DEFAULT_PROMPTS.items():
        existing = await db.prompts.find_one({"step_name": step_name})
        if not existing:
            await db.prompts.insert_one({
                "id": str(uuid.uuid4()),
                "step_name": step_name,
                "system_prompt": prompt_data["system_prompt"],
                "user_prompt_template": prompt_data["user_prompt_template"],
                "description": prompt_data["description"],
                "version": 1,
                "is_active": True,
                "is_default": True,
                "created_at": datetime.now(timezone.utc).isoformat()
            })
    logger.info("Default prompts initialized")

async def run_startup_migrations():
        """
        Безопасные миграции БД.
        Можно выполнять при каждом старте.
        """
        result = await db.divisions.update_many(
            {
                "shared_with": {"$exists": False}
            },
            {
                "$set": {
                    "shared_with": []
                }
            }
        )

        logger.info(
            f"[MIGRATION] shared_with migration: "
            f"matched={result.matched_count}, "
            f"modified={result.modified_count}"
        )

async def run_full_analysis(division_id: str, user_id: str = None):
    """
    Полный пайплайн анализа бизнес-процессов.
    Этапы: Discovery (10%) -> AS-IS BPMN (35%) -> Scoring (60%) -> Рекомендации (75%) -> TO-BE (88%) -> N8N (95%) -> Завершено (100%)
    """
    current_step = "initialization"
    step_timeout = int(os.environ.get("AI_STEP_TIMEOUT", 600))
    
    async def update_status(status: str, progress: int, step_name: str = None):
        """Обновляет статус анализа в БД с логированием"""
        nonlocal current_step
        current_step = step_name or status
        await db.divisions.update_one({"id": division_id}, {"$set": {
            "analysis_status": status, 
            "analysis_progress": progress,
            "analysis_current_step": current_step,
            "analysis_updated_at": datetime.now(timezone.utc).isoformat()
        }})
        logger.info(f"[{division_id}] Анализ: {status} ({progress}%) - {current_step}")
    
    async def set_error(error_msg: str, error_detail: str = None, input_data: dict = None):
        """Устанавливает статус ошибки с детальной информацией и логирует"""
        full_error = f"[Этап: {current_step}] {error_msg}"
        if error_detail:
            full_error += f" | Детали: {error_detail[:500]}"
        await db.divisions.update_one({"id": division_id}, {"$set": {
            "analysis_status": "error",
            "analysis_error": full_error,
            "analysis_failed_step": current_step,
            "analysis_updated_at": datetime.now(timezone.utc).isoformat()
        }})
        # Логируем в таблицу ошибок для админ-панели
        await log_error(division_id, current_step, error_msg, error_detail, input_data)
        logger.error(f"[{division_id}] Ошибка анализа: {full_error}")
    
    try:
        settings = None

        # берём ТОЛЬКО настройки администратора
        admin_user = await db.users.find_one({"is_admin": True}, {"_id": 0})

        if not admin_user:
            raise Exception("Admin user not found")

        settings = await db.settings.find_one(
            {"user_id": admin_user["id"]},
            {"_id": 0}
        )

        if not settings:
            raise Exception("Admin settings not found")

        async def call_ai_with_timeout(sys_msg: str, usr_msg: str, sid: str, timeout: int = step_timeout, max_retries: int = 2) -> str:
            """Обёртка для AI-вызова с тайм-аутом и retry"""
            last_error = None
            for attempt in range(max_retries):
                try:
                    result = await asyncio.wait_for(
                        ai_call(sys_msg, usr_msg, sid, settings=settings),
                        timeout=timeout
                    )
                    return result
                except asyncio.TimeoutError:
                    last_error = f"Превышено время ожидания ответа AI ({timeout} сек)"
                    logger.warning(f"[{division_id}] Тайм-аут AI (попытка {attempt+1}/{max_retries}): {sid}")
                    if attempt < max_retries - 1:
                        await asyncio.sleep(5)  # небольшая пауза перед retry
                except Exception as e:
                    last_error = f"Ошибка AI: {str(e)}"
                    logger.warning(f"[{division_id}] Ошибка AI (попытка {attempt+1}/{max_retries}): {e}")
                    if attempt < max_retries - 1:
                        await asyncio.sleep(3)
            raise Exception(last_error)

        division = await db.divisions.find_one({"id": division_id}, {"_id": 0})
        if not division:
            await set_error("Подразделение не найдено")
            return

        questionnaire = await db.questionnaires.find_one({"division_id": division_id}, {"_id": 0})
        q_text = json.dumps(questionnaire.get("answers", {}), ensure_ascii=False, indent=2) if questionnaire else "Анкета не заполнена"

        docs = await db.documents.find({"division_id": division_id}, {"_id": 0}).to_list(100)
        doc_texts = []
        for doc in docs:
            text = extract_text_from_file(doc.get("file_path", ""))
            if text:
                doc_texts.append(f"=== {doc.get('filename', 'Документ')} ===\n{text[:5000]}")
        documents_text = "\n\n".join(doc_texts) if doc_texts else "Документы не загружены"

        await update_status("extracting_processes", 10, "Извлечение бизнес-процессов")

        # STEP 1: Extract processes
        try:
            proc_resp = await call_ai_with_timeout(
                "Ты эксперт бизнес-аналитик банковской сферы. Анализируй данные подразделения и выявляй бизнес-процессы. Отвечай СТРОГО валидным JSON массивом.",
                f"""Проанализируй данные подразделения "{division.get('name', '')}" и выяви все бизнес-процессы.

Анкета: {q_text}

Документы: {documents_text[:12000]}

Верни JSON массив процессов:
[{{"name":"Название","description":"Описание","steps":["Шаг 1","Шаг 2"],"roles":["Роль 1"],"input_documents":["Док 1"],"output_documents":["Dok 1"],"systems":["Система 1"],"trigger":"Триггер","frequency":"Частота","sla":"SLA"}}]

Выяви минимум 5 процессов.""",
                f"proc-{division_id}-{uuid.uuid4().hex[:8]}"
            )
        except Exception as e:
            await set_error("Не удалось извлечь процессы", str(e))
            return

        processes_raw = parse_json_response(proc_resp) or []
        if not processes_raw:
            await set_error("AI не смог распознать процессы", "Получен пустой или невалидный JSON ответ")
            return
            
        processes = []
        for i, proc in enumerate(processes_raw):
            p = clean_for_mongo(proc)
            p["id"] = str(uuid.uuid4())
            p["division_id"] = division_id
            p["order"] = i
            processes.append(p)
            await db.processes.insert_one({**p})

        await update_status("extracting_processes", 30, f"Извлечено {len(processes)} процессов")

        # STEP 2: Generate BPMN AS-IS
        await update_status("generating_bpmn", 35, "Генерация BPMN диаграмм AS-IS")

        bpmn_errors = 0
        for idx, proc in enumerate(processes[:5]):
            try:
                bpmn_resp = await call_ai_with_timeout(
                    "Ты эксперт BPMN моделирования. Генерируй валидный BPMN 2.0 XML с пространствами имён bpmn, bpmndi, dc, di. Включай BPMNDiagram с координатами. Отвечай ТОЛЬКО XML без обёрток.",
                    f"""Сгенерируй BPMN 2.0 XML для процесса:
Название: {proc.get('name','')}
Шаги: {json.dumps(proc.get('steps',[]), ensure_ascii=False)}
Роли: {json.dumps(proc.get('roles',[]), ensure_ascii=False)}

Требования: StartEvent, Task для каждого шага, ExclusiveGateway для решений, EndEvent, все sequenceFlow, BPMNDiagram с координатами (x увеличивается на 180).""",
                    f"bpmn-{proc.get('id','')}"
                )
                bpmn_xml = bpmn_resp.strip()
                if "```xml" in bpmn_xml:
                    bpmn_xml = bpmn_xml.split("```xml")[1].split("```")[0].strip()
                elif "```" in bpmn_xml:
                    bpmn_xml = bpmn_xml.split("```")[1].split("```")[0].strip()

                await db.bpmn_models.insert_one({
                    "id": str(uuid.uuid4()), "division_id": division_id,
                    "process_id": proc["id"], "process_name": proc.get("name", ""),
                    "type": "as_is", "xml": bpmn_xml,
                    "created_at": datetime.now(timezone.utc).isoformat()
                })
                await update_status("generating_bpmn", 35 + int((idx + 1) / min(len(processes), 5) * 15), f"BPMN {idx+1}/{min(len(processes), 5)}")
            except Exception as e:
                bpmn_errors += 1
                logger.warning(f"[{division_id}] BPMN для '{proc.get('name','')}' не создан: {e}")
                if bpmn_errors >= 3:
                    await set_error("Ошибка генерации BPMN диаграмм", f"Не удалось создать BPMN для {bpmn_errors} процессов")
                    return

        await update_status("scoring", 55, "BPMN AS-IS завершены")

        # STEP 3: Scoring
        await update_status("scoring", 60, "Скоринг процессов")

        proc_for_scoring = json.dumps([{"name": p.get("name",""), "description": p.get("description",""), "steps_count": len(p.get("steps",[])), "systems": p.get("systems",[])} for p in processes], ensure_ascii=False, default=str)

        try:
            score_resp = await call_ai_with_timeout(
                "Ты эксперт по оценке бизнес-процессов. Отвечай СТРОГО валидным JSON массивом.",
                f"""Оцени процессы по шкале 1-10:
{proc_for_scoring}

Верни JSON:
[{{"process_name":"Название","complexity":7,"manual_effort":8,"system_fragmentation":6,"approval_burden":5,"ai_suitability":8,"automation_readiness":7,"bottlenecks":["Узкое место 1"],"total_score":41}}]""",
                f"score-{division_id}-{uuid.uuid4().hex[:8]}"
            )
        except Exception as e:
            await set_error("Ошибка скоринга процессов", str(e))
            return

        scoring_raw = parse_json_response(score_resp) or []
        scoring = []
        for s in scoring_raw:
            sc = clean_for_mongo(s)
            sc["id"] = str(uuid.uuid4())
            sc["division_id"] = division_id
            scoring.append(sc)
            await db.scoring.insert_one({**sc})

        await update_status("generating_recommendations", 70, f"Оценено {len(scoring)} процессов")

        # STEP 4: Recommendations
        await update_status("generating_recommendations", 75, "Генерация рекомендаций по автоматизации")

        proc_summary = json.dumps([{"name": p.get("name",""), "systems": p.get("systems",[])} for p in processes], ensure_ascii=False, default=str)
        score_summary = json.dumps([{"process_name": s.get("process_name",""), "manual_effort": s.get("manual_effort",0), "ai_suitability": s.get("ai_suitability",0), "bottlenecks": s.get("bottlenecks",[])} for s in scoring], ensure_ascii=False, default=str)

        try:
            rec_resp = await call_ai_with_timeout(
                "Ты эксперт по цифровой трансформации банков. Отвечай СТРОГО валидным JSON массивом.",
                f"""Сформируй рекомендации на основе процессов и скоринга.
Процессы: {proc_summary}
Скоринг: {score_summary}

Верни JSON с категориями simple_automation, classic_digitization, ai_reengineering:
[{{"title":"Название","description":"Описание","category":"simple_automation","effect":"Эффект","complexity":"low|medium|high","priority":1,"related_processes":["Процесс"],"implementation_stack":"Стек","estimated_fte_savings":0.5}}]

Минимум 8 рекомендаций по всем 3 категориям.""",
                f"rec-{division_id}-{uuid.uuid4().hex[:8]}"
            )
        except Exception as e:
            await set_error("Ошибка генерации рекомендаций", str(e))
            return

        recommendations_raw = parse_json_response(rec_resp) or []
        recommendations = []
        for r in recommendations_raw:
            rc = clean_for_mongo(r)
            rc["id"] = str(uuid.uuid4())
            rc["division_id"] = division_id
            recommendations.append(rc)
            await db.recommendations.insert_one({**rc})

        await update_status("generating_tobe", 85, f"Создано {len(recommendations)} рекомендаций")

        # STEP 5: TO-BE
        await update_status("generating_tobe", 88, "Генерация моделей TO-BE")

        proc_asis = json.dumps([{"name": p.get("name",""), "steps": p.get("steps",[])} for p in processes], ensure_ascii=False, default=str)
        rec_summary = json.dumps([{"title": r.get("title",""), "category": r.get("category",""), "related_processes": r.get("related_processes",[])} for r in recommendations], ensure_ascii=False, default=str)

        try:
            tobe_resp = await call_ai_with_timeout(
                "Ты эксперт по реинжинирингу бизнес-процессов. Отвечай СТРОГО валидным JSON массивом.",
                f"""Сформируй TO-BE модели на основе AS-IS и рекомендаций.
AS-IS: {proc_asis}
Рекомендации: {rec_summary}

Верни JSON:
[{{"process_name":"Название","improvements":["Улучшение"],"removed_steps":["Шаг"],"merged_steps":["Шаги"],"automated_steps":["Шаг"],"new_process":{{"name":"Новое название","steps":["Шаг 1"]}},"risks":["Риск"],"dependencies":["Зависимость"],"expected_effect":"Эффект"}}]""",
                f"tobe-{division_id}-{uuid.uuid4().hex[:8]}"
            )
        except Exception as e:
            await set_error("Ошибка генерации TO-BE моделей", str(e))
            return

        tobe_raw = parse_json_response(tobe_resp) or []
        tobe = []
        for tb in tobe_raw:
            t = clean_for_mongo(tb)
            t["id"] = str(uuid.uuid4())
            t["division_id"] = division_id
            tobe.append(t)
            await db.tobe_models.insert_one({**t})

        # TO-BE BPMN (необязательный этап - ошибки не прерывают процесс)
        await update_status("generating_tobe", 90, "Генерация BPMN TO-BE диаграмм")
        for tb in tobe[:3]:
            try:
                new_proc = tb.get("new_process") or {}
                if isinstance(new_proc, dict) and new_proc.get("steps"):
                    steps_json = json.dumps(new_proc.get("steps", []), ensure_ascii=False, default=str)
                    tobe_bpmn = await call_ai_with_timeout(
                        "Генерируй валидный BPMN 2.0 XML. Отвечай ТОЛЬКО XML.",
                        f"BPMN 2.0 XML для TO-BE процесса '{tb.get('process_name','')}'. Шаги: {steps_json}. Включи StartEvent, Tasks, EndEvent, sequenceFlows, BPMNDiagram с координатами.",
                        f"bpmn-tobe-{tb.get('id','')}"
                    )
                    bpmn_xml = tobe_bpmn.strip()
                    if "```xml" in bpmn_xml:
                        bpmn_xml = bpmn_xml.split("```xml")[1].split("```")[0].strip()
                    elif "```" in bpmn_xml:
                        bpmn_xml = bpmn_xml.split("```")[1].split("```")[0].strip()
                    await db.bpmn_models.insert_one({
                        "id": str(uuid.uuid4()), "division_id": division_id,
                        "process_name": tb.get("process_name", ""), "type": "to_be",
                        "xml": bpmn_xml, "created_at": datetime.now(timezone.utc).isoformat()
                    })
            except Exception as e:
                logger.warning(f"[{division_id}] TO-BE BPMN для '{tb.get('process_name','')}' пропущен: {e}")

        await update_status("generating_n8n", 92, f"TO-BE модели завершены ({len(tobe)} шт)")

        # STEP 6: N8N Workflows
        await update_status("generating_n8n", 95, "Генерация N8N workflows для автоматизации")

        auto_recs = [{"title": r.get("title",""), "description": r.get("description",""), "category": str(r.get("category",""))} for r in recommendations if str(r.get("category","")) in ["simple_automation", "classic_digitization"]]
        
        if not auto_recs:
            # Если нет подходящих рекомендаций, используем первые 3 любые
            auto_recs = [{"title": r.get("title",""), "description": r.get("description",""), "category": str(r.get("category",""))} for r in recommendations[:3]]
        
        auto_recs_json = json.dumps(auto_recs, ensure_ascii=False, default=str)

        n8n_count = 0
        n8n_error = None
        try:
            n8n_resp = await call_ai_with_timeout(
                "Ты эксперт по автоматизации N8N. Отвечай СТРОГО валидным JSON массивом.",
                f"""Сгенерируй N8N workflows для автоматизации.
Рекомендации: {auto_recs_json}

Верни JSON:
[{{"name":"Workflow название","description":"Описание","related_recommendation":"Рекомендация","nodes":[{{"id":"n1","type":"trigger","name":"Триггер","description":"Описание"}},{{"id":"n2","type":"action","name":"Действие","description":"Описание"}},{{"id":"n3","type":"condition","name":"Условие","description":"Описание"}},{{"id":"n4","type":"output","name":"Результат","description":"Описание"}}],"connections":[{{"from":"n1","to":"n2"}},{{"from":"n2","to":"n3"}},{{"from":"n3","to":"n4"}}],"estimated_time_savings":"2 часа/день"}}]

Минимум 3 workflow.""",
                f"n8n-{division_id}-{uuid.uuid4().hex[:8]}",
                timeout=int(os.environ.get("AI_LAST_STEP_TIMEOUT", 800))
            )
            n8n_raw = parse_json_response(n8n_resp) or []
            for wf in n8n_raw:
                w = clean_for_mongo(wf)
                w["id"] = str(uuid.uuid4())
                w["division_id"] = division_id
                await db.n8n_workflows.insert_one({**w})
                n8n_count += 1
        except Exception as e:
            # N8N не критичен - можно завершить анализ без него
            n8n_error = str(e)
            logger.warning(f"[{division_id}] N8N workflows не созданы (продолжаем): {e}")

        # ЗАВЕРШЕНИЕ
        completion_status = {
            "analysis_status": "completed", "analysis_progress": 100,
            "analysis_completed_at": datetime.now(timezone.utc).isoformat(),
            "analysis_current_step": "Анализ завершён успешно" if not n8n_error else f"Анализ завершён (N8N пропущен: {n8n_error[:100]})",
            "processes_count": len(processes), "recommendations_count": len(recommendations),
            "n8n_workflows_count": n8n_count
        }
        if n8n_error:
            completion_status["n8n_warning"] = n8n_error[:200]
        
        await db.divisions.update_one({"id": division_id}, {"$set": completion_status})
        logger.info(f"[{division_id}] Анализ ЗАВЕРШЁН: {len(processes)} процессов, {len(recommendations)} рекомендаций, {n8n_count} workflows{' (N8N пропущен)' if n8n_error else ''}")

    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        logger.error(f"[{division_id}] Критическая ошибка анализа: {e}\n{error_trace}")
        await db.divisions.update_one({"id": division_id}, {"$set": {
            "analysis_status": "error", 
            "analysis_error": f"[Этап: {current_step}] {str(e)[:300]}",
            "analysis_failed_step": current_step
        }})

# ============== AUTH ROUTES ==============

@api_router.post("/auth/register")
async def register(data: UserRegister):
    existing = await db.users.find_one({"email": data.email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = {
        "id": str(uuid.uuid4()),
        "email": data.email,
        "password": hash_password(data.password),
        "name": data.name,
        "is_admin": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user)
    token = create_token(user["id"], user["email"], user.get("is_admin", False))
    return {
        "token": token,
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "is_admin": user.get("is_admin", False)}}

@api_router.post("/auth/login")
async def login(data: UserLogin):
    user = await db.users.find_one({"email": data.email})
    if not user or not verify_password(data.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(user["id"], user["email"], user.get("is_admin", False))
    return {"token": token, "user": {"id": user["id"], "email": user["email"], "name": user["name"], "is_admin": user.get("is_admin", False)}}

@api_router.get("/auth/me")
async def get_me(user=Depends(get_current_user)):
    u = await db.users.find_one({"id": user["user_id"]}, {"_id": 0, "password": 0})
    if not u:
        raise HTTPException(status_code=404)
    return u

@api_router.get("/users")
async def list_users(
        division_id: str | None = None,
        user=Depends(get_current_user)
):
    exclude_ids = {user["user_id"]}

    if division_id:
        division = await db.divisions.find_one(
            {"id": division_id},
            {"_id": 0}
        )

        if division and division.get("created_by"):
            exclude_ids.add(division["created_by"])

    users = await db.users.find(
        {
            "id": {"$nin": list(exclude_ids)},
            "is_admin": {"$ne": True}
        },
        {
            "_id": 0,
            "password": 0
        }
    ).to_list(500)

    result = [
        {
            "id": u["id"],
            "name": u.get("name", ""),
            "email": u.get("email", ""),
            "is_admin": u.get("is_admin", False)
        }
        for u in users
    ]

    result.sort(key=lambda x: (x["name"] or "").lower())

    return result

# ============== DIVISION ACCESS HELPERS ==============

async def get_division_or_404(division_id: str):
    division = await db.divisions.find_one(
        {"id": division_id},
        {"_id": 0}
    )

    if not division:
        raise HTTPException(
            status_code=404,
            detail="Division not found"
        )

    return division


async def ensure_division_owner(user: dict, division_id: str):
    division = await get_division_or_404(division_id)

    if user.get("is_admin"):
        return division

    if division.get("created_by") != user["user_id"]:
        raise HTTPException(
            status_code=403,
            detail="Only owner can perform this action"
        )

    return division

# ============== DIVISION ROUTES ==============

@api_router.post("/divisions")
async def create_division(data: DivisionCreate, user=Depends(get_current_user)):
    division = {
        "id": str(uuid.uuid4()),
        "name": data.name,
        "description": data.description,
        "head_name": data.head_name,
        "employees_count": data.employees_count,
        "created_by": user["user_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "analysis_status": "not_started",
        "analysis_progress": 0,
        "processes_count": 0,
        "recommendations_count": 0,
        "shared_with": []
    }
    await db.divisions.insert_one(division)
    return {k: v for k, v in division.items() if k != "_id"}

@api_router.get("/divisions")
async def list_divisions(user=Depends(get_current_user)):
    if user.get("is_admin"):
        return await db.divisions.find({}, {"_id": 0}).to_list(100)

    user_id = user["user_id"]

    return await db.divisions.find(
        {
            "$or": [
                {"created_by": user_id},
                {"shared_with": user_id}
            ]
        },
        {"_id": 0}
    ).to_list(100)

@api_router.get("/divisions/{division_id}")
async def get_division(division_id: str, user=Depends(get_current_user)):
    d = await db.divisions.find_one({"id": division_id}, {"_id": 0})

    if not d:
        raise HTTPException(status_code=404, detail="Division not found")

    if user.get("is_admin"):
        return d

    user_id = user["user_id"]

    if d.get("created_by") == user_id:
        return d

    if user_id in d.get("shared_with", []):
        return d

    raise HTTPException(status_code=403, detail="Access denied")

@api_router.put("/divisions/{division_id}")
async def update_division(
        division_id: str,
        data: DivisionUpdate,
        user=Depends(get_current_user)
):
    await ensure_division_owner(user, division_id)

    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if update:
        await db.divisions.update_one({"id": division_id}, {"$set": update})
    return await db.divisions.find_one({"id": division_id}, {"_id": 0})

@api_router.delete("/divisions/{division_id}")
async def delete_division(
        division_id: str,
        user=Depends(get_current_user)
):
    await ensure_division_owner(user, division_id)

    for col in ["divisions", "questionnaires", "documents", "processes", "bpmn_models", "scoring", "recommendations", "tobe_models", "n8n_workflows"]:
        if col == "divisions":
            await db[col].delete_one({"id": division_id})
        else:
            await db[col].delete_many({"division_id": division_id})
    return {"status": "deleted"}


@api_router.post("/divisions/{division_id}/share")
async def share_division(
        division_id: str,
        data: DivisionShareRequest,
        user=Depends(get_current_user)
):
    division = await db.divisions.find_one({"id": division_id}, {"_id": 0})

    if not division:
        raise HTTPException(status_code=404, detail="Division not found")

    # только владелец или админ
    if not user.get("is_admin") and division.get("created_by") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Only owner can share")

    # убрать дубликаты и владельца
    users = list(set(data.user_ids))
    users = [u for u in users if u != division.get("created_by")]

    await db.divisions.update_one(
        {"id": division_id},
        {"$set": {"shared_with": users}}
    )

    return {"status": "shared", "shared_with": users}


@api_router.delete("/divisions/{division_id}/share/{target_user_id}")
async def unshare_division(
        division_id: str,
        target_user_id: str,
        user=Depends(get_current_user)
):
    division = await db.divisions.find_one({"id": division_id}, {"_id": 0})

    if not division:
        raise HTTPException(status_code=404, detail="Division not found")

    if not user.get("is_admin") and division.get("created_by") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Only owner can unshare")

    await db.divisions.update_one(
        {"id": division_id},
        {"$pull": {"shared_with": target_user_id}}
    )

    return {"status": "removed"}

# ============== QUESTIONNAIRE ROUTES ==============

@api_router.get("/questionnaire/schema")
async def get_questionnaire_schema():
    return QUESTIONNAIRE_SCHEMA

@api_router.post("/divisions/{division_id}/questionnaire")
async def save_questionnaire(division_id: str, data: QuestionnaireData, user=Depends(get_current_user)):
    existing = await db.questionnaires.find_one({"division_id": division_id})
    now = datetime.now(timezone.utc).isoformat()
    if existing:
        await db.questionnaires.update_one({"division_id": division_id}, {"$set": {"answers": data.answers, "updated_at": now}})
    else:
        await db.questionnaires.insert_one({"id": str(uuid.uuid4()), "division_id": division_id, "answers": data.answers, "created_at": now, "updated_at": now})
    return {"status": "saved"}

@api_router.get("/divisions/{division_id}/questionnaire")
async def get_questionnaire(division_id: str, user=Depends(get_current_user)):
    q = await db.questionnaires.find_one({"division_id": division_id}, {"_id": 0})
    return q or {"answers": {}}

# ============== DOCUMENT ROUTES ==============

@api_router.post("/divisions/{division_id}/documents")
async def upload_document(division_id: str, file: UploadFile = File(...), user=Depends(get_current_user)):
    div_dir = UPLOAD_DIR / division_id
    div_dir.mkdir(exist_ok=True)
    file_id = str(uuid.uuid4())
    file_ext = Path(file.filename).suffix
    file_path = str(div_dir / f"{file_id}{file_ext}")
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
    doc = {
        "id": file_id, "division_id": division_id, "filename": file.filename,
        "file_path": file_path, "file_size": len(content), "file_type": file_ext,
        "uploaded_by": user["user_id"], "uploaded_at": datetime.now(timezone.utc).isoformat()
    }
    await db.documents.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}

@api_router.get("/divisions/{division_id}/documents")
async def list_documents(division_id: str, user=Depends(get_current_user)):
    return await db.documents.find({"division_id": division_id}, {"_id": 0}).to_list(100)

@api_router.delete("/divisions/{division_id}/documents/{doc_id}")
async def delete_document(division_id: str, doc_id: str, user=Depends(get_current_user)):
    doc = await db.documents.find_one({"id": doc_id, "division_id": division_id})
    if doc and os.path.exists(doc.get("file_path", "")):
        os.remove(doc["file_path"])
    await db.documents.delete_one({"id": doc_id})
    return {"status": "deleted"}

# ============== SETTINGS ROUTES ==============

@api_router.get("/settings")
async def get_settings(user=Depends(get_current_user)):
    s = await db.settings.find_one({"user_id": user["user_id"]}, {"_id": 0})

    if not s:
        return {
            "provider": "openai",
            "model_name": "gpt-5.2",
            "api_key": "",
            "endpoint_url": ""
        }

    result = {k: v for k, v in s.items() if k != "user_id"}

    # 🔥 фикс: убираем emergent если он есть в БД
    if result.get("provider") == "emergent":
        result["provider"] = "openai"

    if not user.get("is_admin"):
        result["api_key"] = ""

    if result.get("api_key") and len(result["api_key"]) > 12:
        result["api_key_display"] = (
            result["api_key"][:6] + "..." + result["api_key"][-4:]
        )

    return result

@api_router.post("/settings")
async def save_settings(data: UserSettings, user=Depends(get_current_user)):
    if not user.get("is_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admin can update AI settings"
        )

    await db.settings.update_one(
        {"user_id": user["user_id"]},
        {
            "$set": {
                **data.model_dump(),
                "user_id": user["user_id"]
            }
        },
        upsert=True
    )
    return {"status": "saved"}

# ============== TEXT EXTRACTION ==============

@api_router.post("/extract-text")
async def extract_text_from_upload(file: UploadFile = File(...), user=Depends(get_current_user)):
    import tempfile
    ext = Path(file.filename).suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name
    text = extract_text_from_file(tmp_path)
    os.unlink(tmp_path)
    return {"text": text, "filename": file.filename}

# ============== ANALYSIS ROUTES ==============

@api_router.post("/divisions/{division_id}/analyze")
async def start_analysis(
        division_id: str,
        user=Depends(get_current_user)
):
    await ensure_division_owner(user, division_id)

    for col in ["processes", "bpmn_models", "scoring", "recommendations", "tobe_models", "n8n_workflows"]:
        await db[col].delete_many({"division_id": division_id})
    await db.divisions.update_one({"id": division_id}, {"$set": {"analysis_status": "in_progress", "analysis_progress": 5, "analysis_error": None}})
    asyncio.create_task(run_full_analysis(division_id, user["user_id"]))
    return {"status": "started"}

@api_router.get("/divisions/{division_id}/analysis-status")
async def get_analysis_status(division_id: str, user=Depends(get_current_user)):
    d = await db.divisions.find_one({"id": division_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404)
    return {
        "status": d.get("analysis_status", "not_started"), 
        "progress": d.get("analysis_progress", 0), 
        "error": d.get("analysis_error"),
        "current_step": d.get("analysis_current_step", ""),
        "failed_step": d.get("analysis_failed_step", ""),
        "updated_at": d.get("analysis_updated_at", "")
    }

# ============== RESULTS ROUTES ==============

@api_router.get("/divisions/{division_id}/processes")
async def get_processes(division_id: str, user=Depends(get_current_user)):
    return await db.processes.find({"division_id": division_id}, {"_id": 0}).to_list(100)

@api_router.get("/divisions/{division_id}/bpmn")
async def get_bpmn_models(division_id: str, type: str = None, user=Depends(get_current_user)):
    q = {"division_id": division_id}
    if type:
        q["type"] = type
    return await db.bpmn_models.find(q, {"_id": 0}).to_list(100)

@api_router.get("/divisions/{division_id}/scoring")
async def get_scoring(division_id: str, user=Depends(get_current_user)):
    return await db.scoring.find({"division_id": division_id}, {"_id": 0}).to_list(100)

@api_router.get("/divisions/{division_id}/recommendations")
async def get_recommendations(division_id: str, user=Depends(get_current_user)):
    return await db.recommendations.find({"division_id": division_id}, {"_id": 0}).to_list(100)

@api_router.get("/divisions/{division_id}/tobe")
async def get_tobe_models(division_id: str, user=Depends(get_current_user)):
    return await db.tobe_models.find({"division_id": division_id}, {"_id": 0}).to_list(100)

@api_router.get("/divisions/{division_id}/n8n")
async def get_n8n_workflows(division_id: str, user=Depends(get_current_user)):
    return await db.n8n_workflows.find({"division_id": division_id}, {"_id": 0}).to_list(100)

# ============== EXPORT REPORTS ==============

from io import BytesIO
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.style import WD_STYLE_TYPE

def create_word_report(division, questionnaire, processes, scoring, recommendations, tobe, n8n_workflows):
    """Создаёт Word документ с полным отчётом"""
    doc = Document()

    # Стили
    title_style = doc.styles['Title']
    title_style.font.size = Pt(24)
    title_style.font.bold = True

    # Заголовок
    title = doc.add_heading(f'Отчёт по анализу бизнес-процессов', 0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER

    doc.add_paragraph(f"Подразделение: {division.get('name', 'Н/Д')}")
    doc.add_paragraph(f"Дата анализа: {division.get('analysis_completed_at', 'Н/Д')[:10] if division.get('analysis_completed_at') else 'Н/Д'}")
    doc.add_paragraph()

    # Раздел 1: Анкета
    doc.add_heading('1. Анкета подразделения', level=1)
    if questionnaire and questionnaire.get('answers'):
        answers = questionnaire['answers']
        table = doc.add_table(rows=1, cols=2)
        table.style = 'Table Grid'
        hdr = table.rows[0].cells
        hdr[0].text = 'Вопрос'
        hdr[1].text = 'Ответ'

        question_labels = {
            'dept_function': 'Основные функции',
            'employees_roles': 'Роли сотрудников',
            'top_processes': 'Ключевые процессы',
            'process_frequency': 'Частота выполнения',
            'has_approvals': 'Требуются согласования',
            'systems_list': 'Используемые системы',
            'manual_operations': 'Ручные операции',
            'bottlenecks': 'Узкие места',
            'pain_points': 'Проблемные точки'
        }

        for key, value in answers.items():
            row = table.add_row().cells
            row[0].text = question_labels.get(key, key)
            row[1].text = str(value) if value else 'Н/Д'
    else:
        doc.add_paragraph('Анкета не заполнена')

    doc.add_page_break()

    # Раздел 2: Выявленные процессы
    doc.add_heading('2. Выявленные бизнес-процессы', level=1)
    if processes:
        for i, proc in enumerate(processes, 1):
            doc.add_heading(f'2.{i} {proc.get("name", "Процесс")}', level=2)
            doc.add_paragraph(f'Описание: {proc.get("description", "Н/Д")}')

            if proc.get('steps'):
                doc.add_paragraph('Шаги процесса:', style='List Bullet')
                for step in proc['steps']:
                    doc.add_paragraph(f'• {step}', style='List Bullet')

            if proc.get('roles'):
                doc.add_paragraph(f'Роли: {", ".join(proc["roles"])}')
            if proc.get('systems'):
                doc.add_paragraph(f'Системы: {", ".join(proc["systems"])}')
            if proc.get('sla'):
                doc.add_paragraph(f'SLA: {proc["sla"]}')
            doc.add_paragraph()
    else:
        doc.add_paragraph('Процессы не выявлены')

    doc.add_page_break()

    # Раздел 3: Скоринг
    doc.add_heading('3. Скоринг процессов', level=1)
    if scoring:
        table = doc.add_table(rows=1, cols=4)
        table.style = 'Table Grid'
        hdr = table.rows[0].cells
        hdr[0].text = 'Процесс'
        hdr[1].text = 'Сложность'
        hdr[2].text = 'Ручной труд'
        hdr[3].text = 'Готовность к автоматизации'

        for s in scoring:
            row = table.add_row().cells
            row[0].text = s.get('process_name', 'Н/Д')
            row[1].text = str(s.get('complexity', 'Н/Д'))
            row[2].text = str(s.get('manual_effort', 'Н/Д'))
            row[3].text = str(s.get('automation_readiness', 'Н/Д'))
    else:
        doc.add_paragraph('Скоринг не выполнен')

    doc.add_page_break()

    # Раздел 4: Рекомендации
    doc.add_heading('4. Рекомендации по автоматизации', level=1)
    if recommendations:
        categories = {
            'simple_automation': 'Простая автоматизация',
            'classic_digitization': 'Классическая цифровизация',
            'ai_reengineering': 'AI реинжиниринг'
        }

        for cat_key, cat_name in categories.items():
            cat_recs = [r for r in recommendations if r.get('category') == cat_key]
            if cat_recs:
                doc.add_heading(f'4.{list(categories.keys()).index(cat_key)+1} {cat_name}', level=2)
                for rec in cat_recs:
                    doc.add_paragraph(f"• {rec.get('title', 'Н/Д')}", style='List Bullet')
                    doc.add_paragraph(f"  Описание: {rec.get('description', 'Н/Д')}")
                    doc.add_paragraph(f"  Эффект: {rec.get('effect', 'Н/Д')}")
                    doc.add_paragraph(f"  Сложность: {rec.get('complexity', 'Н/Д')}")
                    doc.add_paragraph()
    else:
        doc.add_paragraph('Рекомендации не сформированы')

    doc.add_page_break()

    # Раздел 5: N8N Workflows
    doc.add_heading('5. N8N Workflows для автоматизации', level=1)
    if n8n_workflows:
        for i, wf in enumerate(n8n_workflows, 1):
            doc.add_heading(f'5.{i} {wf.get("name", "Workflow")}', level=2)
            doc.add_paragraph(f'Описание: {wf.get("description", "Н/Д")}')
            doc.add_paragraph(f'Экономия времени: {wf.get("estimated_time_savings", "Н/Д")}')
            if wf.get('nodes'):
                doc.add_paragraph(f'Количество нод: {len(wf["nodes"])}')
            doc.add_paragraph()
    else:
        doc.add_paragraph('Workflows не сгенерированы')

    # Финальный раздел
    doc.add_page_break()
    doc.add_heading('6. Заключение', level=1)
    doc.add_paragraph(f'Всего выявлено процессов: {len(processes) if processes else 0}')
    doc.add_paragraph(f'Всего рекомендаций: {len(recommendations) if recommendations else 0}')
    doc.add_paragraph(f'Подготовлено workflows: {len(n8n_workflows) if n8n_workflows else 0}')

    return doc

@api_router.get("/divisions/{division_id}/export/word")
async def export_word_report(division_id: str, user=Depends(get_current_user)):
    """Экспорт отчёта в Word"""
    division = await db.divisions.find_one({"id": division_id}, {"_id": 0})
    if not division:
        raise HTTPException(status_code=404, detail="Division not found")

    questionnaire = await db.questionnaires.find_one({"division_id": division_id}, {"_id": 0})
    processes = await db.processes.find({"division_id": division_id}, {"_id": 0}).to_list(100)
    scoring = await db.scoring.find({"division_id": division_id}, {"_id": 0}).to_list(100)
    recommendations = await db.recommendations.find({"division_id": division_id}, {"_id": 0}).to_list(100)
    tobe = await db.tobe_models.find({"division_id": division_id}, {"_id": 0}).to_list(100)
    n8n_workflows = await db.n8n_workflows.find({"division_id": division_id}, {"_id": 0}).to_list(100)

    doc = create_word_report(division, questionnaire, processes, scoring, recommendations, tobe, n8n_workflows)

    buffer = BytesIO()
    doc.save(buffer)
    buffer.seek(0)

    # Транслитерация для имени файла
    import re
    safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', division.get('name', 'report'))
    filename = f"{safe_name}_report.docx"

    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@api_router.get("/divisions/{division_id}/export/pdf")
async def export_pdf_report(division_id: str, user=Depends(get_current_user)):
    """Экспорт отчёта в PDF"""
    from weasyprint import HTML, CSS

    division = await db.divisions.find_one({"id": division_id}, {"_id": 0})
    if not division:
        raise HTTPException(status_code=404, detail="Division not found")

    questionnaire = await db.questionnaires.find_one({"division_id": division_id}, {"_id": 0})
    processes = await db.processes.find({"division_id": division_id}, {"_id": 0}).to_list(100)
    scoring = await db.scoring.find({"division_id": division_id}, {"_id": 0}).to_list(100)
    recommendations = await db.recommendations.find({"division_id": division_id}, {"_id": 0}).to_list(100)
    tobe = await db.tobe_models.find({"division_id": division_id}, {"_id": 0}).to_list(100)
    n8n_workflows = await db.n8n_workflows.find({"division_id": division_id}, {"_id": 0}).to_list(100)

    # Генерация HTML
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body {{ font-family: 'DejaVu Sans', Arial, sans-serif; margin: 40px; color: #333; }}
            h1 {{ color: #1e3a5f; border-bottom: 2px solid #3b82f6; padding-bottom: 10px; }}
            h2 {{ color: #1e3a5f; margin-top: 30px; }}
            h3 {{ color: #475569; }}
            table {{ width: 100%; border-collapse: collapse; margin: 15px 0; }}
            th, td {{ border: 1px solid #e2e8f0; padding: 10px; text-align: left; }}
            th {{ background-color: #f1f5f9; font-weight: bold; }}
            .category {{ background-color: #eff6ff; padding: 15px; margin: 10px 0; border-radius: 8px; }}
            .category-title {{ color: #1d4ed8; font-weight: bold; margin-bottom: 10px; }}
            .recommendation {{ margin: 10px 0; padding: 10px; background: #fff; border-left: 3px solid #3b82f6; }}
            .workflow {{ background: #f8fafc; padding: 15px; margin: 10px 0; border-radius: 8px; }}
            .summary {{ background: #ecfdf5; padding: 20px; border-radius: 8px; margin-top: 30px; }}
            .summary-title {{ color: #047857; font-weight: bold; font-size: 18px; }}
            ul {{ padding-left: 20px; }}
            li {{ margin: 5px 0; }}
        </style>
    </head>
    <body>
        <h1>Отчёт по анализу бизнес-процессов</h1>
        <p><strong>Подразделение:</strong> {division.get('name', 'Н/Д')}</p>
        <p><strong>Дата анализа:</strong> {division.get('analysis_completed_at', 'Н/Д')[:10] if division.get('analysis_completed_at') else 'Н/Д'}</p>
        
        <h2>1. Анкета подразделения</h2>
    """

    if questionnaire and questionnaire.get('answers'):
        html_content += "<table><tr><th>Вопрос</th><th>Ответ</th></tr>"
        question_labels = {
            'dept_function': 'Основные функции',
            'employees_roles': 'Роли сотрудников',
            'top_processes': 'Ключевые процессы',
            'systems_list': 'Используемые системы',
            'manual_operations': 'Ручные операции',
            'bottlenecks': 'Узкие места',
            'pain_points': 'Проблемные точки'
        }
        for key, value in questionnaire['answers'].items():
            label = question_labels.get(key, key)
            html_content += f"<tr><td>{label}</td><td>{value or 'Н/Д'}</td></tr>"
        html_content += "</table>"
    else:
        html_content += "<p>Анкета не заполнена</p>"

    html_content += "<h2>2. Выявленные бизнес-процессы</h2>"
    if processes:
        for i, proc in enumerate(processes, 1):
            html_content += f"<h3>2.{i} {proc.get('name', 'Процесс')}</h3>"
            html_content += f"<p><strong>Описание:</strong> {proc.get('description', 'Н/Д')}</p>"
            if proc.get('steps'):
                html_content += "<p><strong>Шаги:</strong></p><ul>"
                for step in proc['steps']:
                    html_content += f"<li>{step}</li>"
                html_content += "</ul>"
            if proc.get('roles'):
                html_content += f"<p><strong>Роли:</strong> {', '.join(proc['roles'])}</p>"
            if proc.get('systems'):
                html_content += f"<p><strong>Системы:</strong> {', '.join(proc['systems'])}</p>"
    else:
        html_content += "<p>Процессы не выявлены</p>"

    html_content += "<h2>3. Скоринг процессов</h2>"
    if scoring:
        html_content += "<table><tr><th>Процесс</th><th>Сложность</th><th>Ручной труд</th><th>Готовность к автоматизации</th></tr>"
        for s in scoring:
            html_content += f"<tr><td>{s.get('process_name', 'Н/Д')}</td><td>{s.get('complexity', 'Н/Д')}</td><td>{s.get('manual_effort', 'Н/Д')}</td><td>{s.get('automation_readiness', 'Н/Д')}</td></tr>"
        html_content += "</table>"
    else:
        html_content += "<p>Скоринг не выполнен</p>"

    html_content += "<h2>4. Рекомендации по автоматизации</h2>"
    if recommendations:
        categories = {
            'simple_automation': 'Простая автоматизация',
            'classic_digitization': 'Классическая цифровизация',
            'ai_reengineering': 'AI реинжиниринг'
        }
        for cat_key, cat_name in categories.items():
            cat_recs = [r for r in recommendations if r.get('category') == cat_key]
            if cat_recs:
                html_content += f'<div class="category"><div class="category-title">{cat_name}</div>'
                for rec in cat_recs:
                    html_content += f'''<div class="recommendation">
                        <strong>{rec.get('title', 'Н/Д')}</strong><br>
                        {rec.get('description', '')}<br>
                        <small>Эффект: {rec.get('effect', 'Н/Д')} | Сложность: {rec.get('complexity', 'Н/Д')}</small>
                    </div>'''
                html_content += '</div>'
    else:
        html_content += "<p>Рекомендации не сформированы</p>"

    html_content += "<h2>5. N8N Workflows</h2>"
    if n8n_workflows:
        for i, wf in enumerate(n8n_workflows, 1):
            html_content += f'''<div class="workflow">
                <h3>5.{i} {wf.get('name', 'Workflow')}</h3>
                <p>{wf.get('description', 'Н/Д')}</p>
                <p><strong>Экономия времени:</strong> {wf.get('estimated_time_savings', 'Н/Д')}</p>
            </div>'''
    else:
        html_content += "<p>Workflows не сгенерированы</p>"

    html_content += f'''
        <div class="summary">
            <div class="summary-title">Заключение</div>
            <p>Всего выявлено процессов: <strong>{len(processes) if processes else 0}</strong></p>
            <p>Всего рекомендаций: <strong>{len(recommendations) if recommendations else 0}</strong></p>
            <p>Подготовлено workflows: <strong>{len(n8n_workflows) if n8n_workflows else 0}</strong></p>
        </div>
    </body>
    </html>
    '''

    pdf_buffer = BytesIO()
    HTML(string=html_content).write_pdf(pdf_buffer)
    pdf_buffer.seek(0)

    # Транслитерация для имени файла
    import re
    safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', division.get('name', 'report'))
    filename = f"{safe_name}_report.pdf"

    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        pdf_buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

# ============== DASHBOARD ==============

@api_router.get("/dashboard")
async def get_dashboard(user=Depends(get_current_user)):
    
    query = {}
    if not user.get("is_admin"):
        query["created_by"] = user["user_id"]

    divisions = await db.divisions.find(query, {"_id": 0}).to_list(100)

    total = len(divisions)
    analyzed = len([d for d in divisions if d.get("analysis_status") == "completed"])
    in_progress = len([d for d in divisions if d.get("analysis_status") == "in_progress"])
    total_processes = sum(d.get("processes_count", 0) for d in divisions)
    total_recommendations = sum(d.get("recommendations_count", 0) for d in divisions)

    response = {
        "total_divisions": total,
        "analyzed_divisions": analyzed,
        "in_progress": in_progress,
        "total_processes": total_processes,
        "total_recommendations": total_recommendations,
        "divisions": divisions
    }

    logger.info(f"GET /api/dashboard | user={user.get('user_id')} | total_divisions={total} | analyzed={analyzed} | in_progress={in_progress}")

    return response

# ============== ADMIN: ERROR LOGS ==============

@api_router.get("/admin/errors")
async def get_error_logs(
    page: int = 1,
    limit: int = 50,
    step: str = None,
    resolved: bool = None,
    division_id: str = None,
    admin=Depends(get_admin_user)
):
    """Получить список ошибок с фильтрацией"""
    query = {}
    if step:
        query["step"] = step
    if resolved is not None:
        query["resolved"] = resolved
    if division_id:
        query["division_id"] = division_id

    total = await db.error_logs.count_documents(query)
    errors = await db.error_logs.find(query, {"_id": 0}).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)

    return {
        "errors": errors,
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit
    }

@api_router.get("/admin/errors/stats")
async def get_error_stats(admin=Depends(get_admin_user)):
    """Статистика ошибок по этапам"""
    pipeline = [
        {"$group": {"_id": "$step", "count": {"$sum": 1}, "unresolved": {"$sum": {"$cond": [{"$eq": ["$resolved", False]}, 1, 0]}}}},
        {"$sort": {"count": -1}}
    ]
    stats = await db.error_logs.aggregate(pipeline).to_list(20)
    total_errors = await db.error_logs.count_documents({})
    unresolved = await db.error_logs.count_documents({"resolved": False})

    return {
        "by_step": stats,
        "total": total_errors,
        "unresolved": unresolved
    }

@api_router.get("/admin/errors/{error_id}")
async def get_error_detail(error_id: str, admin=Depends(get_admin_user)):
    """Получить детали ошибки"""
    error = await db.error_logs.find_one({"id": error_id}, {"_id": 0})
    if not error:
        raise HTTPException(status_code=404, detail="Error not found")
    return error

@api_router.patch("/admin/errors/{error_id}")
async def update_error(error_id: str, resolved: bool = None, notes: str = None, admin=Depends(get_admin_user)):
    """Пометить ошибку как решённую"""
    update = {}
    if resolved is not None:
        update["resolved"] = resolved
        update["resolved_at"] = datetime.now(timezone.utc).isoformat() if resolved else None
        update["resolved_by"] = admin["user_id"] if resolved else None
    if notes:
        update["admin_notes"] = notes

    await db.error_logs.update_one({"id": error_id}, {"$set": update})
    return {"status": "updated"}

@api_router.delete("/admin/errors/{error_id}")
async def delete_error(error_id: str, admin=Depends(get_admin_user)):
    """Удалить запись об ошибке"""
    await db.error_logs.delete_one({"id": error_id})
    return {"status": "deleted"}

# ============== ADMIN: PROMPTS ==============

@api_router.get("/admin/prompts")
async def get_prompts(admin=Depends(get_admin_user)):
    """Получить все промпты"""
    prompts = await db.prompts.find({}, {"_id": 0}).sort("step_name", 1).to_list(50)

    # Добавляем дефолтные промпты если их нет в БД
    existing_steps = {p["step_name"] for p in prompts}
    for step_name, default in DEFAULT_PROMPTS.items():
        if step_name not in existing_steps:
            prompts.append({
                "step_name": step_name,
                "system_prompt": default["system_prompt"],
                "user_prompt_template": default["user_prompt_template"],
                "description": default["description"],
                "is_default": True,
                "is_active": True
            })

    return prompts

@api_router.get("/admin/prompts/{step_name}")
async def get_prompt(step_name: str, admin=Depends(get_admin_user)):
    """Получить промпт для конкретного шага"""
    prompt = await db.prompts.find_one({"step_name": step_name}, {"_id": 0})
    if not prompt:
        default = DEFAULT_PROMPTS.get(step_name)
        if not default:
            raise HTTPException(status_code=404, detail="Prompt not found")
        return {
            "step_name": step_name,
            "system_prompt": default["system_prompt"],
            "user_prompt_template": default["user_prompt_template"],
            "description": default["description"],
            "is_default": True,
            "is_active": True
        }
    return prompt

@api_router.post("/admin/prompts")
async def create_or_update_prompt(data: PromptCreate, admin=Depends(get_admin_user)):
    """Создать или обновить промпт"""
    existing = await db.prompts.find_one({"step_name": data.step_name})

    if existing:
        # Сохраняем историю
        await db.prompt_history.insert_one({
            "id": str(uuid.uuid4()),
            "prompt_id": existing["id"],
            "step_name": existing["step_name"],
            "system_prompt": existing["system_prompt"],
            "user_prompt_template": existing["user_prompt_template"],
            "version": existing.get("version", 1),
            "created_at": datetime.now(timezone.utc).isoformat()
        })

        # Обновляем промпт
        new_version = existing.get("version", 1) + 1
        await db.prompts.update_one(
            {"step_name": data.step_name},
            {"$set": {
                "system_prompt": data.system_prompt,
                "user_prompt_template": data.user_prompt_template,
                "description": data.description,
                "version": new_version,
                "is_default": False,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "updated_by": admin["user_id"]
            }}
        )
        return {"status": "updated", "version": new_version}
    else:
        # Создаём новый промпт
        prompt = {
            "id": str(uuid.uuid4()),
            "step_name": data.step_name,
            "system_prompt": data.system_prompt,
            "user_prompt_template": data.user_prompt_template,
            "description": data.description,
            "version": 1,
            "is_active": True,
            "is_default": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "created_by": admin["user_id"]
        }
        await db.prompts.insert_one(prompt)
        return {"status": "created", "id": prompt["id"]}

@api_router.patch("/admin/prompts/{step_name}")
async def patch_prompt(step_name: str, data: PromptUpdate, admin=Depends(get_admin_user)):
    """Частично обновить промпт"""
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if update:
        update["updated_at"] = datetime.now(timezone.utc).isoformat()
        update["updated_by"] = admin["user_id"]
        await db.prompts.update_one({"step_name": step_name}, {"$set": update})
    return {"status": "updated"}

@api_router.get("/admin/prompts/{step_name}/history")
async def get_prompt_history(step_name: str, admin=Depends(get_admin_user)):
    """История изменений промпта"""
    history = await db.prompt_history.find({"step_name": step_name}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return history

@api_router.post("/admin/prompts/{step_name}/restore/{version}")
async def restore_prompt_version(step_name: str, version: int, admin=Depends(get_admin_user)):
    """Восстановить версию промпта из истории"""
    history_item = await db.prompt_history.find_one({"step_name": step_name, "version": version}, {"_id": 0})
    if not history_item:
        raise HTTPException(status_code=404, detail="Version not found")

    # Сохраняем текущую версию в историю
    current = await db.prompts.find_one({"step_name": step_name})
    if current:
        await db.prompt_history.insert_one({
            "id": str(uuid.uuid4()),
            "prompt_id": current["id"],
            "step_name": current["step_name"],
            "system_prompt": current["system_prompt"],
            "user_prompt_template": current["user_prompt_template"],
            "version": current.get("version", 1),
            "created_at": datetime.now(timezone.utc).isoformat()
        })

    # Восстанавливаем
    new_version = (current.get("version", 1) if current else 0) + 1
    await db.prompts.update_one(
        {"step_name": step_name},
        {"$set": {
            "system_prompt": history_item["system_prompt"],
            "user_prompt_template": history_item["user_prompt_template"],
            "version": new_version,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": admin["user_id"],
            "restored_from_version": version
        }},
        upsert=True
    )
    return {"status": "restored", "new_version": new_version}

@api_router.post("/admin/prompts/test")
async def test_prompt(data: PromptTestRequest, admin=Depends(get_admin_user)):
    """Тестировать промпт без сохранения"""
    try:
        settings = await db.settings.find_one({"user_id": admin["user_id"]}, {"_id": 0})
        response = await ai_call(
            data.system_prompt,
            data.user_prompt + ("\n\nТестовые данные:\n" + data.test_input if data.test_input else ""),
            f"test-{uuid.uuid4().hex[:8]}",
            max_retries=1,
            settings=settings
        )
        return {"success": True, "response": response}
    except Exception as e:
        return {"success": False, "error": str(e)}

@api_router.post("/admin/prompts/{step_name}/reset")
async def reset_prompt_to_default(step_name: str, admin=Depends(get_admin_user)):
    """Сбросить промпт к дефолтному"""
    default = DEFAULT_PROMPTS.get(step_name)
    if not default:
        raise HTTPException(status_code=404, detail="Default prompt not found")

    # Сохраняем текущий в историю
    current = await db.prompts.find_one({"step_name": step_name})
    if current and not current.get("is_default"):
        await db.prompt_history.insert_one({
            "id": str(uuid.uuid4()),
            "prompt_id": current["id"],
            "step_name": step_name,
            "system_prompt": current["system_prompt"],
            "user_prompt_template": current["user_prompt_template"],
            "version": current.get("version", 1),
            "created_at": datetime.now(timezone.utc).isoformat()
        })

    # Удаляем кастомный промпт
    await db.prompts.delete_one({"step_name": step_name})
    return {"status": "reset_to_default"}

# ============== ADMIN: KNOWLEDGE BASE ==============

@api_router.get("/admin/knowledge")
async def get_knowledge_items(category: str = None, is_global: bool = None, admin=Depends(get_admin_user)):
    """Получить элементы базы знаний"""
    query = {}
    if category:
        query["category"] = category
    if is_global is not None:
        query["is_global"] = is_global

    items = await db.knowledge_base.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    return items

@api_router.post("/admin/knowledge")
async def create_knowledge(data: KnowledgeCreate, admin=Depends(get_admin_user)):
    """Создать элемент базы знаний"""
    item = {
        "id": str(uuid.uuid4()),
        "title": data.title,
        "content": data.content,
        "category": data.category,
        "is_global": data.is_global,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": admin["user_id"]
    }
    await db.knowledge_base.insert_one(item)
    return {k: v for k, v in item.items() if k != "_id"}

@api_router.post("/admin/knowledge/upload")
async def upload_knowledge_file(
    file: UploadFile = File(...),
    title: str = None,
    category: str = "general",
    is_global: bool = True,
    admin=Depends(get_admin_user)
):
    """Загрузить документ в базу знаний"""
    import tempfile
    ext = Path(file.filename).suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    text = extract_text_from_file(tmp_path)
    os.unlink(tmp_path)

    if not text:
        raise HTTPException(status_code=400, detail="Could not extract text from file")

    item = {
        "id": str(uuid.uuid4()),
        "title": title or file.filename,
        "content": text[:50000],  # Лимит на размер контента
        "category": category,
        "is_global": is_global,
        "is_active": True,
        "source_filename": file.filename,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": admin["user_id"]
    }
    await db.knowledge_base.insert_one(item)
    return {k: v for k, v in item.items() if k != "_id"}

@api_router.get("/admin/knowledge/{item_id}")
async def get_knowledge_item(item_id: str, admin=Depends(get_admin_user)):
    """Получить элемент базы знаний"""
    item = await db.knowledge_base.find_one({"id": item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Knowledge item not found")
    return item

@api_router.patch("/admin/knowledge/{item_id}")
async def update_knowledge(item_id: str, data: KnowledgeUpdate, admin=Depends(get_admin_user)):
    """Обновить элемент базы знаний"""
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if update:
        update["updated_at"] = datetime.now(timezone.utc).isoformat()
        update["updated_by"] = admin["user_id"]
        await db.knowledge_base.update_one({"id": item_id}, {"$set": update})
    return {"status": "updated"}

@api_router.delete("/admin/knowledge/{item_id}")
async def delete_knowledge(item_id: str, admin=Depends(get_admin_user)):
    """Удалить элемент базы знаний"""
    await db.knowledge_base.delete_one({"id": item_id})
    return {"status": "deleted"}

@api_router.get("/admin/knowledge/categories/list")
async def get_knowledge_categories(admin=Depends(get_admin_user)):
    """Получить список категорий знаний"""
    pipeline = [
        {"$group": {"_id": "$category", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}}
    ]
    categories = await db.knowledge_base.aggregate(pipeline).to_list(50)
    return [{"category": c["_id"], "count": c["count"]} for c in categories]

# ============== ADMIN: USER MANAGEMENT ==============

@api_router.get("/admin/users")
async def get_users(admin=Depends(get_admin_user)):
    """Получить список пользователей"""
    users = await db.users.find({}, {"_id": 0, "password": 0}).to_list(500)
    return users

@api_router.patch("/admin/users/{user_id}/role")
async def set_user_role(user_id: str, role: str, admin=Depends(get_admin_user)):
    """Установить роль пользователя"""
    if role not in ["user", "admin", "analyst"]:
        raise HTTPException(status_code=400, detail="Invalid role")
    await db.users.update_one({"id": user_id}, {"$set": {"role": role}})
    return {"status": "updated"}

@api_router.get("/admin/stats")
async def get_admin_stats(admin=Depends(get_admin_user)):
    """Общая статистика для админ-панели"""
    users_count = await db.users.count_documents({})
    divisions_count = await db.divisions.count_documents({})
    completed_analyses = await db.divisions.count_documents({"analysis_status": "completed"})
    error_count = await db.error_logs.count_documents({"resolved": False})
    knowledge_count = await db.knowledge_base.count_documents({"is_active": True})

    return {
        "users": users_count,
        "divisions": divisions_count,
        "completed_analyses": completed_analyses,
        "unresolved_errors": error_count,
        "knowledge_items": knowledge_count
    }

# ============== ADMIN: DIVISIONS DATA ==============

@api_router.get("/admin/divisions")
async def get_all_divisions(admin=Depends(get_admin_user)):
    """Получить все подразделения для админ-панели"""
    divisions = await db.divisions.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return divisions

@api_router.get("/admin/divisions/{division_id}/questionnaire")
async def get_division_questionnaire_admin(division_id: str, admin=Depends(get_admin_user)):
    """Получить анкету подразделения (админ)"""
    questionnaire = await db.questionnaires.find_one({"division_id": division_id}, {"_id": 0})
    return questionnaire or {"answers": {}}

@api_router.get("/admin/divisions/{division_id}/documents")
async def get_division_documents_admin(division_id: str, admin=Depends(get_admin_user)):
    """Получить документы подразделения (админ)"""
    documents = await db.documents.find({"division_id": division_id}, {"_id": 0}).to_list(100)

    # Добавляем превью извлечённого текста
    for doc in documents:
        if doc.get("file_path"):
            text = extract_text_from_file(doc["file_path"])
            if text:
                doc["extracted_text_preview"] = text[:500] + "..." if len(text) > 500 else text

    return documents

# ============== AUTH: CHECK ADMIN ==============

@api_router.get("/auth/check-admin")
async def check_admin(user=Depends(get_current_user)):
    """Проверить является ли пользователь администратором"""
    u = await db.users.find_one({"id": user["user_id"]}, {"_id": 0, "password": 0})
    return {"is_admin": u.get("role") == "admin" if u else False, "role": u.get("role", "user") if u else "user"}

# ============== USER: KNOWLEDGE SELECTION ==============

@api_router.get("/knowledge")
async def get_available_knowledge(user=Depends(get_current_user)):
    """Получить доступные элементы базы знаний для пользователя"""
    items = await db.knowledge_base.find(
        {"is_active": True},
        {"_id": 0, "content": 0}  # Не возвращаем полный контент
    ).to_list(100)
    return items

@api_router.get("/divisions/{division_id}/knowledge-selection")
async def get_division_knowledge_selection(division_id: str, user=Depends(get_current_user)):
    """Получить выбранные знания для подразделения"""
    selection = await db.division_knowledge.find_one({"division_id": division_id}, {"_id": 0})
    return selection or {"division_id": division_id, "selected_ids": [], "use_global": True}

@api_router.post("/divisions/{division_id}/knowledge-selection")
async def set_division_knowledge_selection(
    division_id: str,
    selected_ids: List[str] = [],
    use_global: bool = True,
    user=Depends(get_current_user)
):
    """Установить выбор знаний для подразделения"""
    await db.division_knowledge.update_one(
        {"division_id": division_id},
        {"$set": {
            "division_id": division_id,
            "selected_ids": selected_ids,
            "use_global": use_global,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    return {"status": "saved"}

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend" / "build"

app.include_router(api_router)

# статика CRA
static_dir = FRONTEND_DIR / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

# index
@app.get("/")
async def serve_root():
    return FileResponse(FRONTEND_DIR / "index.html")


# SPA fallback
@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    if full_path.startswith("api"):
        raise HTTPException(status_code=404)

    file_path = FRONTEND_DIR / full_path

    # если файл есть — отдаем его
    if file_path.exists() and file_path.is_file():
        return FileResponse(file_path)

    # иначе — React
    return FileResponse(FRONTEND_DIR / "index.html")

# ============== APP SETUP ==============

app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    UPLOAD_DIR.mkdir(exist_ok=True)

    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)

    await db.divisions.create_index("id", unique=True)
    await db.divisions.create_index("created_by")

    await db.error_logs.create_index("created_at")
    await db.error_logs.create_index("step")

    await db.prompts.create_index("step_name", unique=True)
    await db.knowledge_base.create_index("category")

    # Инициализируем дефолтные промпты
    await init_default_prompts()

    # Запуск миграций БД
    await run_startup_migrations()

    # ===============================
    # 🔐 Обеспечение admin пользователя
    # ===============================
    ADMIN_EMAIL = "admin@bpscanner.ru"

    user = await db.users.find_one({"email": ADMIN_EMAIL})

    if not user:
        # ❗ если пользователя нет — создаём
        admin_user = {
            "id": str(uuid.uuid4()),
            "email": ADMIN_EMAIL,
            "password": hash_password("admin123"),
            "name": "Администратор",
            "is_admin": True,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        try:
            await db.users.insert_one(admin_user)
            logger.info("✅ Admin user created")
        except Exception as e:
            logger.warning(f"Could not create admin user: {e}")
    else:
        # 🔄 Миграция старой схемы role → is_admin
        update_fields = {}

        # если был старый role=admin → переносим
        if user.get("role") == "admin":
            update_fields["is_admin"] = True

        # если вообще нет is_admin → добавим False (чтобы структура была консистентной)
        if "is_admin" not in user:
            update_fields["is_admin"] = update_fields.get("is_admin", False)

        # если пользователь уже должен быть админом — гарантируем
        if not user.get("is_admin") and user.get("email") == ADMIN_EMAIL:
            update_fields["is_admin"] = True

        if update_fields:
            await db.users.update_one(
                {"email": ADMIN_EMAIL},
                {"$set": update_fields}
            )
            logger.info(f"🔄 User updated with fields: {update_fields}")
        else:
            logger.info("✅ Admin already configured")


@app.middleware("http")
async def log_requests(request: Request, call_next):
    print('\n\n\n')
    print("=== REQUEST START ===")
    print("method:", request.method)
    print("url:", request.url)
    print("headers:", dict(request.headers))
    print("authorization:", request.headers.get("authorization"))
    response = await call_next(request)
    print("status_code:", response.status_code)
    print("=== REQUEST END ===")
    print('\n\n\n')
    return response


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="debug",
    )