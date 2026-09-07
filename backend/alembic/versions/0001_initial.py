"""Initial application schema and PostgreSQL hybrid-search indexes."""

from alembic import op
from app.db import Base

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)
    if bind.dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")
        op.execute(
            "ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_vector vector(384)"
        )
        op.execute(
            "ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS search_tsv tsvector "
            "GENERATED ALWAYS AS (to_tsvector('english', content)) STORED"
        )
        op.execute(
            "CREATE INDEX IF NOT EXISTS ix_knowledge_chunks_embedding_hnsw "
            "ON knowledge_chunks USING hnsw (embedding_vector vector_cosine_ops)"
        )
        op.execute(
            "CREATE INDEX IF NOT EXISTS ix_knowledge_chunks_search_tsv "
            "ON knowledge_chunks USING gin (search_tsv)"
        )


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind())
