from pathlib import Path

from fastapi.testclient import TestClient

from bpscanner.app import create_app
from tests.conftest import ADMIN, auth, login, register


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_admin_is_bootstrapped_and_recognised(client, admin_token):
    me = client.get("/api/auth/me", headers=auth(admin_token)).json()
    assert me["email"] == ADMIN["email"] and me["is_admin"] is True
    assert client.get("/api/auth/check-admin", headers=auth(admin_token)).json()["is_admin"] is True
    assert client.get("/api/admin/stats", headers=auth(admin_token)).status_code == 200


def test_register_login_and_errors(client):
    token = register(client, "New.User@Test.local", "Анна")
    me = client.get("/api/auth/me", headers=auth(token)).json()
    assert me["email"] == "new.user@test.local" and me["is_admin"] is False

    duplicate = client.post("/api/auth/register", json={"email": "new.user@TEST.local", "password": "secret123", "name": "x"})
    assert duplicate.status_code == 400

    bad = client.post("/api/auth/login", json={"email": "new.user@test.local", "password": "wrong"})
    assert bad.status_code == 401 and bad.json()["detail"]

    assert login(client, "NEW.USER@test.local", "secret123")
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers=auth("garbage")).status_code == 401

    short = client.post("/api/auth/register", json={"email": "a@b.ru", "password": "123", "name": "x"})
    assert short.status_code == 422


def test_non_admin_has_no_admin_access(client, user_token):
    for path in ("/api/admin/stats", "/api/admin/errors", "/api/admin/prompts", "/api/admin/users"):
        assert client.get(path, headers=auth(user_token)).status_code == 403
    assert client.post("/api/settings", json={"model_name": "x"}, headers=auth(user_token)).status_code == 403
    assert client.get("/api/auth/check-admin", headers=auth(user_token)).json()["is_admin"] is False


def test_role_changes_apply_immediately(client, admin_token, user_token):
    users = client.get("/api/admin/users", headers=auth(admin_token)).json()
    user = next(u for u in users if u["email"] == "user@test.local")
    admin = next(u for u in users if u["email"] == ADMIN["email"])

    assert client.patch(f"/api/admin/users/{user['id']}/role", params={"role": "admin"}, headers=auth(admin_token)).status_code == 200
    # Токен выпущен до смены роли, но права берутся из базы
    assert client.get("/api/admin/stats", headers=auth(user_token)).status_code == 200

    assert client.patch(f"/api/admin/users/{user['id']}/role", params={"role": "user"}, headers=auth(admin_token)).status_code == 200
    assert client.get("/api/admin/stats", headers=auth(user_token)).status_code == 403

    # Последнего администратора разжаловать нельзя
    response = client.patch(f"/api/admin/users/{admin['id']}/role", params={"role": "user"}, headers=auth(admin_token))
    assert response.status_code == 400

    # Отключённый пользователь теряет доступ
    client.patch(f"/api/admin/users/{user['id']}/status", params={"disabled": True}, headers=auth(admin_token))
    assert client.get("/api/divisions", headers=auth(user_token)).status_code == 403


def _create_division(client, token, name="Отдел продаж"):
    response = client.post("/api/divisions", json={"name": name, "description": "Описание", "employees_count": 12}, headers=auth(token))
    assert response.status_code == 200, response.text
    return response.json()


def test_division_access_control(client, admin_token, user_token):
    owner = user_token
    other = register(client, "other@test.local", "Пётр")
    division = _create_division(client, owner)
    division_id = division["id"]
    assert division["access"] == "owner"

    endpoints = [
        f"/api/divisions/{division_id}",
        f"/api/divisions/{division_id}/questionnaire",
        f"/api/divisions/{division_id}/documents",
        f"/api/divisions/{division_id}/processes",
        f"/api/divisions/{division_id}/bpmn",
        f"/api/divisions/{division_id}/scoring",
        f"/api/divisions/{division_id}/recommendations",
        f"/api/divisions/{division_id}/tobe",
        f"/api/divisions/{division_id}/n8n",
        f"/api/divisions/{division_id}/analysis-status",
        f"/api/divisions/{division_id}/export/word",
    ]
    for path in endpoints:
        assert client.get(path, headers=auth(other)).status_code == 403, path
    assert client.post(f"/api/divisions/{division_id}/questionnaire", json={"answers": {"x": "y"}}, headers=auth(other)).status_code == 403
    assert client.post(f"/api/divisions/{division_id}/analyze", headers=auth(other)).status_code == 403
    assert client.get("/api/divisions/unknown-id", headers=auth(other)).status_code == 404
    assert client.get("/api/divisions", headers=auth(other)).json() == []

    other_id = client.get("/api/auth/me", headers=auth(other)).json()["id"]
    share = client.post(f"/api/divisions/{division_id}/share", json={"user_ids": [other_id, "ghost"]}, headers=auth(owner))
    assert share.json()["shared_with"] == [other_id]

    assert client.get(f"/api/divisions/{division_id}", headers=auth(other)).json()["access"] == "shared"
    save = client.post(f"/api/divisions/{division_id}/questionnaire", json={"answers": {"dept_function": "Продажи"}}, headers=auth(other))
    assert save.status_code == 200 and save.json()["completion"]["done"] == 1
    # Совладелец не может удалять, менять карточку и делиться дальше
    assert client.delete(f"/api/divisions/{division_id}", headers=auth(other)).status_code == 403
    assert client.put(f"/api/divisions/{division_id}", json={"name": "X"}, headers=auth(other)).status_code == 403
    assert client.post(f"/api/divisions/{division_id}/share", json={"user_ids": []}, headers=auth(other)).status_code == 403

    # Администратор видит всё
    assert client.get(f"/api/divisions/{division_id}", headers=auth(admin_token)).status_code == 200
    assert any(d["id"] == division_id for d in client.get("/api/divisions", headers=auth(admin_token)).json())

    client.delete(f"/api/divisions/{division_id}/share/{other_id}", headers=auth(owner))
    assert client.get(f"/api/divisions/{division_id}", headers=auth(other)).status_code == 403

    assert client.delete(f"/api/divisions/{division_id}", headers=auth(owner)).json()["status"] == "deleted"
    assert client.get(f"/api/divisions/{division_id}", headers=auth(owner)).status_code == 404


def test_users_list_for_sharing_hides_admins_and_self(client, admin_token, user_token):
    register(client, "colleague@test.local", "Коллега")
    users = client.get("/api/users", headers=auth(user_token)).json()
    emails = {u["email"] for u in users}
    assert emails == {"colleague@test.local"}
    assert all(set(u) == {"id", "name", "email"} for u in users)


def test_spa_fallback_does_not_leak_files(client, tmp_path, tmp_settings):
    build = tmp_path / "frontend" / "build"
    (build / "static").mkdir(parents=True)
    (build / "index.html").write_text("<html>app</html>")
    (build / "static" / "app.js").write_text("console.log(1)")
    (tmp_path / "secret.env").write_text("JWT_SECRET=leaked")
    tmp_settings(frontend_dir=build)

    with TestClient(create_app()) as spa_client:
        assert spa_client.get("/static/app.js").text == "console.log(1)"
        assert "app" in spa_client.get("/divisions/123").text
        for path in ("/../../secret.env", "/..%2F..%2Fsecret.env", "/%2e%2e/%2e%2e/secret.env"):
            assert "leaked" not in spa_client.get(path).text
        assert spa_client.get("/api/unknown").status_code == 404
    assert Path(build / "index.html").exists()
