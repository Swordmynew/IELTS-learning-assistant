import os

# Keep automated tests isolated from the developer's local demo database.
os.environ["DATABASE_URL"] = "sqlite+aiosqlite://"
os.environ["OPENAI_API_KEY"] = ""
os.environ["LLM_PROVIDER"] = "offline"
os.environ["EMBEDDING_PROVIDER"] = "hashing"
