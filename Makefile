BACKEND_IMAGE  := ps_ai_backend:latest
FRONTEND_IMAGE := ps_ai_frontend:latest
ZIP_NAME       := nurbank_app_$(shell date +%Y%m%d_%H%M%S).zip
EXCLUDE        := -x "*.zip" \
                  -x ".git/*" \
                  -x "*/.git/*" \
                  -x "__pycache__/*" \
                  -x "*/__pycache__/*" \
                  -x "node_modules/*" \
                  -x "*/node_modules/*" \
                  -x ".venv/*" \
                  -x "*/.venv/*" \
                  -x "uploads/*" \
                  -x "*/uploads/*" \
                  -x "test_reports/*" \
                  -x "*/test_reports/*" \
                  -x ".idea/*"

.PHONY: help pack build-backend build-frontend build up down logs

help:
	@echo "Доступные команды:"
	@echo "  make pack             — упаковать проект в zip для переноса на прод"
	@echo "  make build-backend    — собрать Docker-образ бэкенда"
	@echo "  make build-frontend   — собрать Docker-образ фронтенда"
	@echo "  make build            — собрать оба образа"
	@echo "  make up               — запустить все контейнеры (docker compose up -d)"
	@echo "  make down             — остановить все контейнеры"
	@echo "  make logs             — посмотреть логи всех контейнеров"

# ── Упаковка ────────────────────────────────────────────────────────────────

pack:
	zip -r $(ZIP_NAME) . $(EXCLUDE)
	@echo "Архив готов: $(ZIP_NAME)"

# ── Сборка образов ───────────────────────────────────────────────────────────

build-backend:
	docker build -t $(BACKEND_IMAGE) ./backend

build-frontend:
	docker build -t $(FRONTEND_IMAGE) ./frontend

build: build-backend build-frontend

# ── Управление контейнерами ──────────────────────────────────────────────────

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f
