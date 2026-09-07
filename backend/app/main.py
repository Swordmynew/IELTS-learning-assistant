from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import router
from app.config import get_settings
from app.db import create_schema
from app.seed import seed_official_knowledge, seed_question_bank


@asynccontextmanager
async def lifespan(_: FastAPI):
    await create_schema()
    await seed_official_knowledge()
    await seed_question_bank()
    yield


settings = get_settings()
app = FastAPI(
    title="IELTS Adaptive Coach API",
    version="0.1.0",
    description=(
        "Adaptive IELTS Academic planning and evidence-grounded writing feedback. "
        "All generated bands are unofficial learning estimates."
    ),
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
