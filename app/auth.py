"""Password hashing, JWT issuing/verification and the auth dependencies."""

import datetime as dt
import threading
from functools import cache
from typing import Annotated

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.deps import DbSession
from app.models import Role, User

# argon2id with OWASP's recommended parameters (19 MiB, 2 passes). Each hash allocates that
# memory, so at most HASH_CONCURRENCY run at once; a login burst can't OOM a 256Mi pod.
password_hasher = PasswordHasher(time_cost=2, memory_cost=19 * 1024, parallelism=1)
HASH_CONCURRENCY = 4
_hash_slots = threading.BoundedSemaphore(HASH_CONCURRENCY)

bearer_scheme = HTTPBearer(
    auto_error=False,
    description="Paste the `access_token` returned by POST /auth/login.",
)


def hash_password(password: str) -> str:
    with _hash_slots:
        return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        with _hash_slots:
            return password_hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


@cache
def _dummy_hash() -> str:
    return hash_password("timing-equalizer-not-a-real-password")


def authenticate(db: Session, email: str, password: str) -> User | None:
    """Return the user for valid credentials, else None.

    Unknown emails still pay for one hash verification so response time doesn't reveal
    which addresses are registered.
    """
    user = db.scalar(select(User).where(User.email == email.strip().lower()))
    if user is None:
        verify_password(password, _dummy_hash())
        return None
    if not verify_password(password, user.password_hash) or not user.is_active:
        return None
    if password_hasher.check_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
        db.commit()
    return user


def create_access_token(user: User) -> tuple[str, int]:
    """Return a signed JWT and its lifetime in seconds."""
    settings = get_settings()
    lifetime = dt.timedelta(minutes=settings.access_token_expire_minutes)
    now = dt.datetime.now(dt.UTC)
    payload = {"sub": str(user.id), "role": user.role.value, "iat": now, "exp": now + lifetime}
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, int(lifetime.total_seconds())


def _unauthorized(message: str = "Could not validate credentials") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=message,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: DbSession,
) -> User:
    if credentials is None:
        raise _unauthorized("Not authenticated")
    settings = get_settings()
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "iat", "sub"]},
        )
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, ValueError):
        raise _unauthorized() from None

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise _unauthorized()
    return user


def require_admin(user: Annotated[User, Depends(get_current_user)]) -> User:
    if user.role != Role.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
AdminUser = Annotated[User, Depends(require_admin)]
