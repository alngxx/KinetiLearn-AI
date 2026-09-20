from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str
    REDIS_URL: str

    OPENAI_API_KEY: str

    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # How long a learner's material download link stays valid. Minutes, not the
    # hour the JWT gets: the link carries its own signature and needs no token
    # once issued, so a leaked one should go stale quickly. Long enough to
    # survive a slow click-to-open and one retry.
    DOWNLOAD_URL_EXPIRE_SECONDS: int = 300

    # Longer than a download link, because an avatar sits in an already-rendered
    # page rather than being redeemed on click: if the browser drops the image
    # from its cache and re-requests it, an expired URL is a broken picture.
    # Capped at the JWT's hour so the link cannot outlive the session that got it.
    AVATAR_URL_EXPIRE_SECONDS: int = 3600

    R2_ACCESS_KEY: str = ""
    R2_SECRET_KEY: str = ""
    R2_BUCKET_NAME: str = ""
    R2_ENDPOINT_URL: str = ""

    PINECONE_API_KEY: str = ""
    PINECONE_INDEX: str = ""

    CHROMA_PATH: str = "./chroma_data"

    ENVIRONMENT: str = "dev"

    class Config:
        env_file = ".env"


settings = Settings()
