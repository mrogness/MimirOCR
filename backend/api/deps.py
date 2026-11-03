"""FastAPI dependency wiring for database access."""
from typing import Generator

from sqlalchemy.orm import Session

from backend.persistence.database import Session as SessionLocal


def get_db() -> Generator[Session, None, None]:
    """Yield a request-scoped SQLAlchemy session and close it after the request.

    Repository methods own commits; this dependency guarantees session cleanup even when a
    handler raises.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
