"""Use a compact 384-dimensional vector column for local multilingual embeddings.

The vector column contains derived data. Existing 1536-dimensional values are
discarded during migration and are rebuilt when documents are re-ingested.
"""

from sqlalchemy import text

from alembic import op

revision = "0003_local_embedding_dimensions"
down_revision = "0002_vocabulary_test_sessions"
branch_labels = None
depends_on = None


def _vector_type() -> str | None:
    return op.get_bind().execute(
        text(
            "SELECT format_type(a.atttypid, a.atttypmod) "
            "FROM pg_attribute a "
            "WHERE a.attrelid = 'knowledge_chunks'::regclass "
            "AND a.attname = 'embedding_vector' AND NOT a.attisdropped"
        )
    ).scalar_one_or_none()


def _replace_vector_column(dimensions: int) -> None:
    op.execute("DROP INDEX IF EXISTS ix_knowledge_chunks_embedding_hnsw")
    op.execute("ALTER TABLE knowledge_chunks DROP COLUMN IF EXISTS embedding_vector")
    op.execute(
        f"ALTER TABLE knowledge_chunks ADD COLUMN embedding_vector vector({dimensions})"
    )
    op.execute(
        "CREATE INDEX ix_knowledge_chunks_embedding_hnsw "
        "ON knowledge_chunks USING hnsw (embedding_vector vector_cosine_ops)"
    )


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql" and _vector_type() != "vector(384)":
        _replace_vector_column(384)


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql" and _vector_type() != "vector(1536)":
        _replace_vector_column(1536)
