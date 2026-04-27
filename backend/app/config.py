from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Meta Product Insights"
    debug: bool = False

    database_url: str = ""
    gcs_bucket: str = ""
    gcs_credentials_path: str = ""
    agent_api_key: str = ""
    owner_open_id: str = "cloudrun-default-user"
    session_secret: str = "dev-secret"
    cors_origins: str = "http://localhost:5173,http://localhost:3000"
    port: int = 8001

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
