import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import router
from app.coach_api import router as coach_router
from app.config import get_settings
from app.db import create_schema
from app.seed import seed_learning_guidance, seed_official_knowledge, seed_question_bank
from app.services.vocabulary_extraction import extraction_worker
from app.vocabulary_api import router as vocabulary_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    await create_schema()
    await seed_official_knowledge()
    await seed_learning_guidance()
    await seed_question_bank()
    worker = asyncio.create_task(extraction_worker()) if get_settings().vocabulary_worker_enabled else None
    try:
        yield
    finally:
        if worker:
            worker.cancel()
            with suppress(asyncio.CancelledError):
                await worker


settings = get_settings()
app = FastAPI(
    title="IELTS Adaptive Coach API",
    version="0.1.0",
    description="Adaptive IELTS Academic planning and evidence-grounded writing feedback.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
app.include_router(coach_router)
app.include_router(vocabulary_router)
