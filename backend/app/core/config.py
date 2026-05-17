from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str
    REDIS_URL: str

    OPENAI_API_KEY: str

    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    R2_ACCESS_KEY: str = ""
    R2_SECRET_KEY: str = ""
    R2_BUCKET: str = ""
    R2_ENDPOINT_URL: str = ""

    PINECONE_API_KEY: str = ""
    PINECONE_INDEX: str = ""

    CHROMA_PATH: str = "./chroma_data"

    ENVIRONMENT: str = "dev"

    class Config:
        env_file = ".env"


settings = Settings()
