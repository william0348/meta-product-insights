import logging
from datetime import datetime
from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import get_db
from ..models import User
from ..config import settings

logger = logging.getLogger(__name__)

DEFAULT_OPEN_ID = "cloudrun-default-user"

async def get_or_create_default_user(db: AsyncSession) -> User:
    result = await db.execute(select(User).where(User.openId == DEFAULT_OPEN_ID).limit(1))
    user = result.scalars().first()
    if not user:
        user = User(
            openId=DEFAULT_OPEN_ID,
            name="Admin",
            email="admin@localhost",
            role="admin",
            lastSignedIn=datetime.utcnow(),
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        logger.info(f"[Auth] Created default user: {user.id}")
    return user

async def get_current_user(db: AsyncSession = Depends(get_db)) -> User:
    return await get_or_create_default_user(db)
