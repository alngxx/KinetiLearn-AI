from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

# Import every model module so SQLAlchemy can resolve cross-module relationships
# (e.g. Document -> Skill) when it configures mappers. The FastAPI app gets this
# for free via main.py; the worker must do it explicitly.
from app.modules.config import models as config_models  # noqa: F401,E402
from app.modules.auth import models as auth_models  # noqa: F401,E402
from app.modules.documents import models as documents_models  # noqa: F401,E402
from app.modules.classes import models as classes_models  # noqa: F401,E402
from app.modules.exams import models as exams_models  # noqa: F401,E402
from app.modules.scoring import models as scoring_models  # noqa: F401,E402
from app.modules.quiz import models as quiz_models  # noqa: F401,E402
from app.modules.chat import models as chat_models  # noqa: F401,E402

# Celery tasks are synchronous, so the worker needs a sync engine rather than
# the async (asyncpg) one used by the FastAPI app.
sync_url = settings.DATABASE_URL.replace("+asyncpg", "+psycopg2")
engine = create_engine(sync_url)
SyncSessionLocal = sessionmaker(bind = engine, expire_on_commit = False)
