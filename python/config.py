"""
Configuration management for Meta Product Insights Python backend.
Reads from environment variables or .env file.
"""

import os
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlparse

from dotenv import load_dotenv

# Load .env from project root
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))


@dataclass
class Config:
    database_url: str = ""
    forge_api_url: str = ""
    forge_api_key: str = ""

    # DB parsed fields
    db_host: str = ""
    db_port: int = 4000
    db_user: str = ""
    db_password: str = ""
    db_name: str = ""

    def __post_init__(self):
        self.database_url = self.database_url or os.getenv("DATABASE_URL", "")
        self.forge_api_url = self.forge_api_url or os.getenv("BUILT_IN_FORGE_API_URL", "")
        self.forge_api_key = self.forge_api_key or os.getenv("BUILT_IN_FORGE_API_KEY", "")

        if self.database_url:
            parsed = urlparse(self.database_url)
            self.db_host = parsed.hostname or ""
            self.db_port = parsed.port or 4000
            self.db_user = parsed.username or ""
            self.db_password = parsed.password or ""
            self.db_name = (parsed.path or "").lstrip("/")


def get_config() -> Config:
    return Config()
