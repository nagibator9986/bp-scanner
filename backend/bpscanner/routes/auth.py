"""Регистрация, вход и профиль пользователя."""
import re
import time
import uuid
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request

from ..config import settings
from ..db import db, now_iso
from ..schemas import PasswordChange, UserLogin, UserRegister
from ..security import create_token, get_current_user, hash_password, public_user, verify_password

router = APIRouter(tags=["auth"])

# Простая защита от перебора паролей: не более 10 неудачных попыток за 10 минут
_FAILED_WINDOW = 600
_FAILED_LIMIT = 10
_failed_logins: dict[str, deque] = defaultdict(deque)


def _login_key(request: Request, email: str) -> str:
    client = request.client.host if request.client else "unknown"
    return f"{client}|{email}"


def _check_rate_limit(key: str) -> None:
    attempts = _failed_logins[key]
    cutoff = time.monotonic() - _FAILED_WINDOW
    while attempts and attempts[0] < cutoff:
        attempts.popleft()
    if len(attempts) >= _FAILED_LIMIT:
        raise HTTPException(status_code=429, detail="Слишком много попыток входа. Повторите через несколько минут")


async def find_user_by_email(email: str) -> dict | None:
    email = email.strip()
    user = await db.users.find_one({"email": email.lower()})
    if user:
        return user
    return await db.users.find_one({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}})


@router.post("/auth/register")
async def register(data: UserRegister):
    if not settings.allow_registration:
        raise HTTPException(status_code=403, detail="Регистрация отключена администратором")
    email = str(data.email).strip().lower()
    if await find_user_by_email(email):
        raise HTTPException(status_code=400, detail="Пользователь с таким email уже зарегистрирован")
    user = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password": hash_password(data.password),
        "name": data.name.strip(),
        "is_admin": False,
        "role": "user",
        "created_at": now_iso(),
    }
    await db.users.insert_one(dict(user))
    return {"token": create_token(user), "user": public_user(user)}


@router.post("/auth/login")
async def login(data: UserLogin, request: Request):
    key = _login_key(request, data.email.strip().lower())
    _check_rate_limit(key)
    user = await find_user_by_email(data.email)
    if not user or not verify_password(data.password, user.get("password", "")):
        _failed_logins[key].append(time.monotonic())
        raise HTTPException(status_code=401, detail="Неверный email или пароль")
    if user.get("disabled"):
        raise HTTPException(status_code=403, detail="Учётная запись отключена")
    _failed_logins.pop(key, None)
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_login_at": now_iso()}})
    return {"token": create_token(user), "user": public_user(user)}


@router.get("/auth/me")
async def get_me(user=Depends(get_current_user)):
    record = await db.users.find_one({"id": user["user_id"]}, {"_id": 0, "password": 0})
    if not record:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return public_user(record)


@router.post("/auth/change-password")
async def change_password(data: PasswordChange, user=Depends(get_current_user)):
    record = await db.users.find_one({"id": user["user_id"]})
    if not record or not verify_password(data.current_password, record.get("password", "")):
        raise HTTPException(status_code=400, detail="Текущий пароль указан неверно")
    await db.users.update_one({"id": user["user_id"]}, {"$set": {"password": hash_password(data.new_password)}})
    return {"status": "updated"}


@router.get("/auth/check-admin")
async def check_admin(user=Depends(get_current_user)):
    return {"is_admin": user["is_admin"], "role": "admin" if user["is_admin"] else "user"}


@router.get("/users")
async def list_users(division_id: str | None = None, user=Depends(get_current_user)):
    """Пользователи, с которыми можно поделиться подразделением."""
    exclude = {user["user_id"]}
    if division_id:
        division = await db.divisions.find_one({"id": division_id}, {"_id": 0, "created_by": 1})
        if division and division.get("created_by"):
            exclude.add(division["created_by"])
    users = await db.users.find(
        {"id": {"$nin": list(exclude)}, "disabled": {"$ne": True}},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "is_admin": 1, "role": 1},
    ).to_list(1000)
    result = [
        {"id": u["id"], "name": u.get("name", ""), "email": u.get("email", "")}
        for u in users
        if not (u.get("is_admin") or u.get("role") == "admin")
    ]
    result.sort(key=lambda u: (u["name"] or u["email"]).lower())
    return result
