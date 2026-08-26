"""Shared seeding for the exam suites.

Generation moved to the Celery worker, so POST /exams/generate returns a job
rather than a finished exercise. The finalize/update/unpublish suites only ever
needed *a draft* to act on, so they seed one directly instead of driving an LLM
through an endpoint that no longer produces one. The generation path itself is
covered by test_exam_generation.py (request) and
test_exam_generation_worker.py (worker).
"""
import uuid
from datetime import datetime, timedelta, timezone

from app.core.dependencies import require_admin
from app.main import app
from app.modules.classes.models import Class
from app.modules.documents.models import Document, DocumentChunk, DocumentVersion
from app.modules.exams.models import (
    Exercise,
    ExerciseDocument,
    Question,
    QuestionOption,
)

BASE = "/api/v1/exams"

OPTION_LABELS = "ABCD"


def use_stub_admin():
    # The shared fixture stubs require_admin as a dict, which has no .id — and
    # generate reads current_user.id. Override with a minimal user.
    app.dependency_overrides[require_admin] = lambda: type("U", (), {"id": None})()


async def seed_class(db):
    cls = Class(name = f"Class {uuid.uuid4()}")
    db.add(cls)
    await db.flush()
    return cls


async def seed_document(db, *, num_chunks = 3, active_version = 1, status = "ready"):
    doc = Document(title = f"Doc {uuid.uuid4()}", active_version_number = active_version)
    db.add(doc)
    await db.flush()
    if active_version is not None:
        db.add(DocumentVersion(
            document_id = doc.id,
            version_number = active_version,
            file_url = "documents/x/v1.pdf",
            file_name = "f.pdf",
            file_size_bytes = 10,
            mime_type = "application/pdf",
            processing_status = status,
        ))
        await db.flush()
        for i in range(num_chunks):
            db.add(DocumentChunk(
                document_id = doc.id,
                version_number = active_version,
                chunk_index = i,
                content = f"chunk {i} content",
            ))
        await db.flush()
    return doc


async def seed_draft_rows(db, *, num_questions = 3, title = "Quiz A", cls = None, doc = None):
    """Build the same graph the worker commits: exercise, questions, options, sources."""
    cls = cls if cls is not None else await seed_class(db)
    doc = doc if doc is not None else await seed_document(db)

    exercise = Exercise(
        title = title,
        class_id = cls.id,
        start_time = datetime.now(timezone.utc),
        end_time = datetime.now(timezone.utc) + timedelta(days = 1),
        duration_minutes = 60,
        pass_score = 0,
        total_points = num_questions,
        is_active = False,
    )
    for order_index in range(num_questions):
        question = Question(
            source_document_id = doc.id,
            source_version_number = 1,
            question_text = f"Question {order_index}?",
            explanation = "Because the source says so.",
            points = 1,
            order_index = order_index,
        )
        for i, label in enumerate(OPTION_LABELS):
            question.options.append(QuestionOption(
                option_label = label,
                option_text = f"Option {i}",
                is_correct = (i == 1),
            ))
        exercise.questions.append(question)

    exercise.source_documents.append(ExerciseDocument(
        document_id = doc.id,
        version_number = 1,
    ))
    db.add(exercise)
    await db.commit()
    return exercise, cls, doc


async def seed_draft(db, client, *, num_questions = 3, title = "Quiz A"):
    """Seed a draft and read it back through the API, in the response shape the
    generate endpoint used to return."""
    use_stub_admin()
    exercise, _, _ = await seed_draft_rows(
        db, num_questions = num_questions, title = title
    )
    resp = await client.get(f"{BASE}/{exercise.id}")
    assert resp.status_code == 200
    return resp.json()
