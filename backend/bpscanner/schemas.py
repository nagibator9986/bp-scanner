"""Модели входных данных API."""
from typing import Any, Literal

from pydantic import BaseModel, Field

# Простая проверка формата: внутренние домены вида user@bank.local тоже допустимы
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class UserRegister(BaseModel):
    email: str = Field(pattern=EMAIL_PATTERN, max_length=254)
    password: str = Field(min_length=6, max_length=128)
    name: str = Field(min_length=1, max_length=120)


class UserLogin(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=128)


class DivisionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    head_name: str = Field(default="", max_length=200)
    employees_count: int = Field(default=0, ge=0, le=1_000_000)


class DivisionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    head_name: str | None = Field(default=None, max_length=200)
    employees_count: int | None = Field(default=None, ge=0, le=1_000_000)


class DivisionShareRequest(BaseModel):
    user_ids: list[str] = Field(default_factory=list, max_length=500)


class QuestionnaireData(BaseModel):
    answers: dict[str, Any]


class KnowledgeSelection(BaseModel):
    selected_ids: list[str] = Field(default_factory=list, max_length=200)
    use_global: bool = True


class LLMSettingsUpdate(BaseModel):
    provider: str = "custom"
    model_name: str = Field(default="", max_length=200)
    endpoint_url: str = Field(default="", max_length=500)
    # Пустой ключ при сохранении означает «оставить текущий»; для удаления — clear_api_key
    api_key: str = Field(default="", max_length=500)
    clear_api_key: bool = False
    max_tokens: int | None = Field(default=None, ge=0, le=1_000_000)
    # Контекстное окно модели в токенах; пусто — определить автоматически
    context_tokens: int | None = Field(default=None, ge=0, le=10_000_000)
    temperature: float = Field(default=0.2, ge=0, le=2)
    disable_thinking: bool = False
    json_mode: bool = False


class PromptCreate(BaseModel):
    step_name: str
    system_prompt: str = Field(max_length=20000)
    user_prompt_template: str = Field(min_length=1, max_length=50000)
    description: str = Field(default="", max_length=1000)


class PromptUpdate(BaseModel):
    system_prompt: str | None = Field(default=None, max_length=20000)
    user_prompt_template: str | None = Field(default=None, max_length=50000)
    description: str | None = Field(default=None, max_length=1000)
    is_active: bool | None = None


class PromptTestRequest(BaseModel):
    system_prompt: str = Field(max_length=20000)
    user_prompt: str = Field(max_length=100000)
    test_input: str = Field(default="", max_length=100000)


class KnowledgeCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    content: str = Field(min_length=1, max_length=200000)
    category: str = Field(default="general", max_length=50)
    is_global: bool = True
    division_id: str | None = None


class KnowledgeUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    content: str | None = Field(default=None, max_length=200000)
    category: str | None = Field(default=None, max_length=50)
    is_global: bool | None = None
    is_active: bool | None = None


class PasswordReset(BaseModel):
    password: str = Field(min_length=6, max_length=128)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(min_length=6, max_length=128)


class AnalyzeRequest(BaseModel):
    mode: Literal["full", "scoring", "recommendations"] = "full"


class StepInput(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    role: str = Field(default="", max_length=120)
    system: str = Field(default="", max_length=120)
    type: Literal["task", "decision", "subprocess"] = "task"
    manual: bool = True
    automated: bool = False
    duration_min: float | None = Field(default=None, ge=0, le=100000)


class ProcessInput(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    owner: str = Field(default="", max_length=200)
    trigger: str = Field(default="", max_length=500)
    frequency: str = Field(default="", max_length=200)
    volume_per_month: float | None = Field(default=None, ge=0, le=10_000_000)
    sla: str = Field(default="", max_length=300)
    roles: list[str] = Field(default_factory=list, max_length=50)
    systems: list[str] = Field(default_factory=list, max_length=50)
    pain_points: list[str] = Field(default_factory=list, max_length=50)
    input_documents: list[str] = Field(default_factory=list, max_length=50)
    output_documents: list[str] = Field(default_factory=list, max_length=50)
    steps: list[StepInput] = Field(default_factory=list, max_length=80)


class InitiativeUpdate(BaseModel):
    status: Literal["new", "accepted", "in_progress", "done", "rejected"] | None = None
    owner: str | None = Field(default=None, max_length=200)
    comment: str | None = Field(default=None, max_length=3000)
    due_date: str | None = Field(default=None, pattern=r"^(\d{4}-\d{2}-\d{2})?$")
    priority: int | None = Field(default=None, ge=1, le=5)


class EconomicsSettings(BaseModel):
    hourly_cost: float = Field(default=0, ge=0, le=10_000_000)
    currency: str = Field(default="₸", min_length=1, max_length=8)
    fte_hours_month: float = Field(default=165, gt=0, le=744)
