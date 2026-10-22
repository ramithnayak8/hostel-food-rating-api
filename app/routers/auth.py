"""Registration, login and the current user."""

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError

from app.auth import CurrentUser, authenticate, create_access_token, hash_password
from app.deps import DbSession, auth_rate_limit, limiter
from app.models import Role, User
from app.schemas import ErrorResponse, LoginRequest, Token, UserCreate, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])

RATE_LIMITED = {429: {"model": ErrorResponse, "description": "Too many attempts"}}


@router.post(
    "/register",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    summary="Register a student account",
    responses={409: {"model": ErrorResponse, "description": "Email taken"}, **RATE_LIMITED},
)
@limiter.limit(auth_rate_limit)
def register(request: Request, payload: UserCreate, db: DbSession) -> User:
    """Create a **student** account. Emails are case-insensitive and stored lowercased.

    Admin accounts cannot be self-registered; they are created with `scripts/create_admin.py`.
    Passwords must be at least 8 characters.
    """
    user = User(
        name=payload.name,
        email=payload.email,
        room_no=payload.room_no,
        role=Role.student,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "An account with this email already exists"
        ) from None
    db.refresh(user)
    return user


@router.post(
    "/login",
    response_model=Token,
    summary="Log in and receive a JWT",
    responses={401: {"model": ErrorResponse, "description": "Invalid credentials"}, **RATE_LIMITED},
)
@limiter.limit(auth_rate_limit)
def login(request: Request, payload: LoginRequest, db: DbSession) -> Token:
    """Exchange email + password (JSON body) for a bearer token.

    Use the token as `Authorization: Bearer <token>`; in Swagger, click **Authorize** and paste it.
    """
    user = authenticate(db, payload.email, payload.password)
    if user is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token, expires_in = create_access_token(user)
    return Token(access_token=token, expires_in=expires_in)


@router.get("/me", response_model=UserOut, summary="Current user")
def me(user: CurrentUser) -> User:
    """Return the account the bearer token belongs to."""
    return user
