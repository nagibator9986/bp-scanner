import os
import sys
import tempfile
import time
from pathlib import Path

# Окружение задаётся до импорта приложения: настройки читаются при импорте
_TMP = Path(tempfile.mkdtemp(prefix="bpscanner-tests-"))
os.environ.update({
    "JWT_SECRET": "test-secret-key-with-enough-length-for-hs256",
    "ADMIN_EMAIL": "admin@test.local",
    "ADMIN_PASSWORD": "admin-pass-123",
    "UPLOAD_DIR": str(_TMP / "uploads"),
    "FRONTEND_DIR": str(_TMP / "no-frontend"),
    "LLM_BASE_URL": "",
    "LLM_MODEL": "",
    "AI_MAX_ATTEMPTS": "1",
})
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

from bpscanner import db as db_module  # noqa: E402
from bpscanner.app import create_app  # noqa: E402
from bpscanner.config import settings  # noqa: E402
from bpscanner.llm import LLMClient  # noqa: E402
from tests.fake_llm import FakeLLM  # noqa: E402

ADMIN = {"email": "admin@test.local", "password": "admin-pass-123"}


@pytest.fixture(scope="session")
def fake_llm():
    server = FakeLLM()
    url = server.start()
    server.url = url
    yield server
    server.stop()


@pytest.fixture
def client(fake_llm):
    db_module.set_database(AsyncMongoMockClient()["bp_scanner_test"])
    fake_llm.requests.clear()
    fake_llm.rejected.clear()
    fake_llm.delay = 0.0
    fake_llm.context_limit = None
    fake_llm.report_context = True
    fake_llm.digest_reply = None
    LLMClient.forget()
    with TestClient(create_app()) as test_client:
        yield test_client


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def login(client, email: str, password: str) -> str:
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["token"]


@pytest.fixture
def admin_token(client):
    return login(client, ADMIN["email"], ADMIN["password"])


def register(client, email: str, name: str = "Пользователь", password: str = "secret123") -> str:
    response = client.post("/api/auth/register", json={"email": email, "password": password, "name": name})
    assert response.status_code == 200, response.text
    return response.json()["token"]


@pytest.fixture
def user_token(client):
    return register(client, "user@test.local", "Иван")


@pytest.fixture
def configure_llm(client, admin_token, fake_llm):
    def _configure(**overrides):
        payload = {"provider": "custom", "endpoint_url": fake_llm.url, "model_name": "qwen-test", **overrides}
        response = client.post("/api/settings", json=payload, headers=auth(admin_token))
        assert response.status_code == 200, response.text
        return response.json()
    return _configure


def wait_for_analysis(client, token: str, division_id: str, timeout: float = 30) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        status = client.get(f"/api/divisions/{division_id}/analysis-status", headers=auth(token)).json()
        if status["status"] in ("completed", "error"):
            return status
        time.sleep(0.1)
    raise AssertionError(f"analysis did not finish: {status}")


@pytest.fixture
def tmp_settings():
    """Временное изменение настроек с откатом."""
    original = {}

    def _set(**values):
        for key, value in values.items():
            original.setdefault(key, getattr(settings, key))
            setattr(settings, key, value)

    yield _set
    for key, value in original.items():
        setattr(settings, key, value)
