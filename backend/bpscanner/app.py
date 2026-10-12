"""Сборка FastAPI-приложения: роуты, middleware, миграции и запуск."""
import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from . import __version__
from .config import settings
from .db import db, ensure_indexes, now_iso
from .errors import log_error
from .prompts import sync_default_prompts
from .routes import admin, analysis, auth, divisions, editing
from .routes import settings as settings_routes
from .security import hash_password

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("bpscanner")
access_logger = logging.getLogger("bpscanner.access")


async def run_migrations() -> None:
    """Безопасные миграции данных старой версии; выполняются при каждом старте."""
    await db.divisions.update_many({"shared_with": {"$exists": False}}, {"$set": {"shared_with": []}})
    # Роль администратора: старое поле role → is_admin
    await db.users.update_many({"role": "admin", "is_admin": {"$ne": True}}, {"$set": {"is_admin": True}})
    await db.users.update_many({"is_admin": True, "role": {"$ne": "admin"}}, {"$set": {"role": "admin"}})
    # Устаревший промпт генерации BPMN больше не используется (схемы строятся автоматически)
    await db.prompts.update_many({"step_name": "generating_bpmn"}, {"$set": {"is_active": False, "obsolete": True}})


async def ensure_admin_user() -> None:
    email = settings.admin_email.strip().lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        update = {}
        if not existing.get("is_admin") or existing.get("role") != "admin":
            update.update({"is_admin": True, "role": "admin"})
        if settings.admin_password and settings.reset_admin_password:
            update["password"] = hash_password(settings.admin_password)
            logger.warning("Admin password was reset from ADMIN_PASSWORD (RESET_ADMIN_PASSWORD=true)")
        if update:
            await db.users.update_one({"email": email}, {"$set": update})
        return

    password = settings.admin_password
    if not password:
        password = "admin123"
        logger.warning(
            "ADMIN_PASSWORD не задан: создан администратор %s с паролем по умолчанию. "
            "Смените пароль после первого входа или задайте ADMIN_PASSWORD.", email
        )
    try:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": email,
            "password": hash_password(password),
            "name": "Администратор",
            "is_admin": True,
            "role": "admin",
            "created_at": now_iso(),
        })
        logger.info("Admin user %s created", email)
    except Exception as exc:  # параллельный старт нескольких реплик
        logger.warning("Could not create admin user: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    try:
        await ensure_indexes()
        await run_migrations()
        await sync_default_prompts()
        await ensure_admin_user()
    except Exception:
        logger.exception("Startup initialization failed (MongoDB недоступна?)")
    yield


def _register_frontend(app: FastAPI) -> None:
    """Раздача собранного фронтенда, если он лежит рядом (запуск без nginx)."""
    root = settings.frontend_dir.resolve()
    index = root / "index.html"
    if not index.is_file():
        return

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        if full_path.startswith("api/") or full_path == "api":
            raise HTTPException(status_code=404)
        candidate = (root / full_path).resolve()
        # Защита от выхода за пределы каталога сборки (../)
        if full_path and candidate.is_relative_to(root) and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index)


def create_app() -> FastAPI:
    app = FastAPI(title="AI BP Scanner", version=__version__, lifespan=lifespan)

    api = APIRouter(prefix="/api")

    @api.get("/health", tags=["system"])
    async def health():
        return {"status": "ok", "env": settings.env, "version": __version__}

    @api.get("/ready", tags=["system"])
    async def ready():
        try:
            await db.command("ping")
        except Exception as exc:
            return JSONResponse(status_code=503, content={"status": "error", "db": str(exc)[:200]})
        return {"status": "ok", "db": "ok"}

    for module in (auth, divisions, analysis, editing, settings_routes, admin):
        api.include_router(module.router)
    app.include_router(api)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins or ["*"],
        # Авторизация — через заголовок Bearer, cookies не используются
        allow_credentials=not settings.cors_allow_all,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )

    @app.middleware("http")
    async def access_log(request: Request, call_next):
        started = time.perf_counter()
        response = await call_next(request)
        if request.url.path.startswith("/api") and request.url.path not in ("/api/health", "/api/ready"):
            access_logger.info(
                "%s %s -> %s (%.0f ms)", request.method, request.url.path, response.status_code,
                (time.perf_counter() - started) * 1000,
            )
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        messages = []
        for error in exc.errors():
            location = ".".join(str(p) for p in error.get("loc", [])[1:]) or "запрос"
            messages.append(f"{location}: {error.get('msg')}")
        return JSONResponse(status_code=422, content={"detail": "Некорректные данные — " + "; ".join(messages)})

    @app.exception_handler(Exception)
    async def unhandled_error(request: Request, exc: Exception):
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        await log_error(None, f"api {request.method} {request.url.path}"[:200], f"{exc.__class__.__name__}: {exc}"[:500], exc=exc)
        return JSONResponse(status_code=500, content={"detail": "Внутренняя ошибка сервера"})

    _register_frontend(app)
    return app


app = create_app()
