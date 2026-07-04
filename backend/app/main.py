from fastapi import FastAPI

from app.modules.config import models as config_models  # noqa: F401
from app.modules.auth import models as auth_models  # noqa: F401
from app.modules.documents import models as documents_models  # noqa: F401
from app.modules.classes import models as classes_models  # noqa: F401
from app.modules.exams import models as exams_models  # noqa: F401
from app.modules.scoring import models as scoring_models  # noqa: F401
from app.modules.quiz import models as quiz_models  # noqa: F401
from app.modules.chat import models as chat_models  # noqa: F401
from app.modules.config.router import (
    categories_router,
    departments_router,
    employee_levels_router,
    job_positions_router,
    seniority_levels_router,
    skills_router,
)
from app.modules.auth.router import router as auth_router
from app.modules.auth.router import users_router
from app.modules.documents.router import router as documents_router
from app.modules.classes.router import router as classes_router
from app.modules.exams.router import router as exams_router
from app.modules.chat.router import router as chat_router
from app.modules.quiz.router import router as quiz_router
from app.modules.scoring.router import router as scoring_router

app = FastAPI(title="KinetiLearn API")

app.include_router(categories_router, prefix="/api/v1/config")
app.include_router(skills_router, prefix="/api/v1/config")
app.include_router(departments_router, prefix="/api/v1/config")
app.include_router(seniority_levels_router, prefix="/api/v1/config")
app.include_router(job_positions_router, prefix="/api/v1/config")
app.include_router(employee_levels_router, prefix="/api/v1/config")
app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(users_router, prefix="/api/v1")
app.include_router(documents_router, prefix="/api/v1/documents", tags=["documents"])
app.include_router(classes_router, prefix="/api/v1/classes", tags=["classes"])
app.include_router(exams_router, prefix="/api/v1/exams", tags=["exams"])
app.include_router(chat_router, prefix="/api/v1/chat", tags=["chat"])
app.include_router(quiz_router, prefix="/api/v1/quiz", tags=["quiz"])
app.include_router(scoring_router, prefix="/api/v1/scoring", tags=["scoring"])


@app.get("/health")
async def health():
    return {"status": "ok"}
