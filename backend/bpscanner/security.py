"""Аутентификация, роли и проверка доступа к подразделениям."""
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import settings
from .db import db

bearer_scheme = HTTPBearer(auto_error=False)

ACCESS_READ = "read"
ACCESS_WRITE = "write"
ACCESS_OWNER = "owner"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), (hashed or "").encode())
    except ValueError:
        return False


def is_admin_user(user: dict | None) -> bool:
    """Единый источник истины для роли администратора.

    Исторически в базе встречаются оба поля: `is_admin` и `role == "admin"`.
    """
    if not user:
        return False
    return bool(user.get("is_admin")) or user.get("role") == "admin"


def create_token(user: dict) -> str:
    expires = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_ttl_hours)
    payload = {
        "user_id": user["id"],
        "email": user["email"],
        "is_admin": is_admin_user(user),
        "exp": int(expires.timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def public_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "email": user.get("email", ""),
        "name": user.get("name", ""),
        "is_admin": is_admin_user(user),
        "role": "admin" if is_admin_user(user) else (user.get("role") or "user"),
        "created_at": user.get("created_at"),
    }


async def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)) -> dict:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Требуется авторизация")
    try:
        payload = jwt.decode(credentials.credentials, settings.jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Сессия истекла, войдите снова")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Недействительный токен")

    # Роль и само существование пользователя берём из базы, а не из токена:
    # так снятие прав или удаление пользователя действует сразу.
    user = await db.users.find_one({"id": payload.get("user_id")}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Пользователь не найден")
    if user.get("disabled"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Учётная запись отключена")
    return {
        "user_id": user["id"],
        "email": user.get("email", ""),
        "name": user.get("name", ""),
        "is_admin": is_admin_user(user),
    }


async def get_admin_user(user: dict = Depends(get_current_user)) -> dict:
    if not user["is_admin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Требуются права администратора")
    return user


def division_role(user: dict, division: dict) -> str | None:
    """Возвращает роль пользователя в подразделении: owner / shared / admin / None."""
    if division.get("created_by") == user["user_id"]:
        return "owner"
    if user["user_id"] in (division.get("shared_with") or []):
        return "shared"
    if user["is_admin"]:
        return "admin"
    return None


async def get_division_for(user: dict, division_id: str, access: str = ACCESS_READ) -> dict:
    """Загружает подразделение и проверяет доступ.

    read / write — владелец, пользователи с общим доступом и администраторы;
    owner — только владелец и администраторы (удаление, шаринг, редактирование карточки).
    """
    division = await db.divisions.find_one({"id": division_id}, {"_id": 0})
    if not division:
        raise HTTPException(status_code=404, detail="Подразделение не найдено")

    role = division_role(user, division)
    if role is None:
        raise HTTPException(status_code=403, detail="Нет доступа к подразделению")
    if access == ACCESS_OWNER and role == "shared":
        raise HTTPException(status_code=403, detail="Действие доступно только владельцу подразделения")
    return division
