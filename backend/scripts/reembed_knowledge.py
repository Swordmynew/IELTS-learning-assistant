"""Rebuild every knowledge embedding after changing the embedding model."""

from __future__ import annotations

import asyncio

from sqlalchemy import select, text

from app.config import get_settings
from app.db import KnowledgeChunkRow, SessionLocal, create_schema
from app.seed import seed_official_knowledge
from app.services.embeddings import embed_text


async def main() -> None:
    settings = get_settings()
    await create_schema()
    await seed_official_knowledge()
    async with SessionLocal() as session:
        chunks = (await session.scalars(select(KnowledgeChunkRow))).all()
        for index, chunk in enumerate(chunks, start=1):
            vector, model = await embed_text(chunk.content, settings)
            chunk.embedding = vector
            chunk.metadata_json = {**chunk.metadata_json, "embedding_model": model}
            if session.bind and session.bind.dialect.name == "postgresql":
                await session.execute(
                    text(
                        "UPDATE knowledge_chunks "
                        "SET embedding_vector = CAST(:embedding AS vector) WHERE id = :chunk_id"
                    ),
                    {"embedding": str(vector), "chunk_id": chunk.id},
                )
            print(f"embedded {index}/{len(chunks)}")
        await session.commit()
    print(f"reembedded_chunks {len(chunks)}")
    print(f"embedding_provider {settings.embedding_provider}")


if __name__ == "__main__":
    asyncio.run(main())
