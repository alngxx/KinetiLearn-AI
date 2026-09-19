"""Assign the existing documents to classes, filling the new class_documents table.

A one-off: documents uploaded before class assignment existed have no links, and
the exam-generation source picker only shows a class's own documents — so
anything left unassigned is invisible there. Every document that predates the
feature is mapped here.

The mapping was derived from evidence, not guesswork, in this order:
  1. an existing exercise_documents row, i.e. an exam already built from that
     document for that class (the six PDFs);
  2. the document's own first chunk, whose H1 names the class outright
     (the ten markdown files);
  3. topic, for the two PDFs that have neither (flagged GUESS below).

"Introduction to Neural Networks" is deliberately left unassigned: it is
CS2109S university coursework and its only plausible home, "CS Fundamentals",
is deactivated. It stays visible on the admin documents page and can be
assigned there.

Idempotent: a link is only inserted when it does not already exist, so running
this repeatedly is safe.

Run from backend/ with the venv active:  python -m scripts.backfill_document_classes
"""
import asyncio
import sys

from sqlalchemy import select

from app.core.database import SessionLocal

# The models reference each other by name, so the mapper cannot configure itself
# until every module is loaded — the same list, for the same reason, as
# alembic/env.py.
import app.modules.config.models  # noqa: F401
import app.modules.auth.models  # noqa: F401
import app.modules.documents.models  # noqa: F401
import app.modules.classes.models  # noqa: F401
import app.modules.exams.models  # noqa: F401
import app.modules.scoring.models  # noqa: F401
import app.modules.quiz.models  # noqa: F401
import app.modules.chat.models  # noqa: F401

from app.modules.classes.models import Class
from app.modules.documents.models import ClassDocument, Document

CLAUDE_101 = "Claude 101"
CLAUDE_CODE = "Claude Code in Action"
MCP = "Model Context Protocol: Advanced Topics"
AGENTIC = "Agentic Engineering by Google"

# document title -> class names
MAPPING = {
    # From an existing exam built on that document for that class.
    "The New SDLC With Vibe Coding": [AGENTIC],
    "Vibe Coding Agent Security and Evaluation": [AGENTIC],
    "Agent Skills": [AGENTIC],
    "Agent Tools & Interoperability": [AGENTIC],
    "Code of Practice on Workplace Safety and Health (WSH) Risk Management": ["Workplace Safety"],
    "Tripartite Guidelines on Fair Employment Practices": ["HR & Employee Relations"],

    # From the document's own H1.
    "What is Claude": [CLAUDE_101],
    "Prompting Claude Wisely": [CLAUDE_101],
    "Artifacts, Projects, and Tools": [CLAUDE_101],
    "Steering Long Sessions": [CLAUDE_CODE],
    "Configuring Claude": [CLAUDE_CODE],
    "Automating Repeat Work": [CLAUDE_CODE],
    "Verifying and Sharing": [CLAUDE_CODE],
    "MCP Fundamentals: Architecture and Core Concepts": [MCP],
    "End-to-End MCP Application": [MCP],
    "Advanced MCP Development: Custom Workflow Servers": [MCP],

    # GUESS - by topic only.
    # Subtitled "Hooks, Agents, MCP Tools & Professional Development", so it
    # straddles Claude Code and MCP; filed under the bulk of its content.
    "Claude Code PlayBook": [CLAUDE_CODE],
    # "Workstream 4: Secure Design Patterns for Agentic Systems" - security is
    # not in the class description, but it is unambiguously MCP material.
    "Model Context Protocol (MCP) Security": [MCP],
}

# Mapped to nothing on purpose - see the module docstring.
UNASSIGNED = ["Introduction to Neural Networks"]


async def main():
    async with SessionLocal() as db:
        result = await db.execute(select(Document.id, Document.title))
        document_ids = {title: doc_id for doc_id, title in result.all()}

        result = await db.execute(select(Class.id, Class.name))
        class_ids = {name: class_id for class_id, name in result.all()}

        # Validate the whole mapping before writing anything, so a rename in the
        # data never leaves a half-applied backfill behind.
        missing_documents = [t for t in MAPPING if t not in document_ids]
        missing_classes = sorted(
            {n for names in MAPPING.values() for n in names if n not in class_ids}
        )
        if missing_documents or missing_classes:
            print("ERROR: the mapping does not match the data in this database:")
            for title in missing_documents:
                print(f"  missing document: {title}")
            for name in missing_classes:
                print(f"  missing class:    {name}")
            sys.exit(1)

        result = await db.execute(select(ClassDocument.class_id, ClassDocument.document_id))
        existing = {(class_id, doc_id) for class_id, doc_id in result.all()}

        print("Assigning documents to classes:")
        created = skipped = 0
        for title, class_names in MAPPING.items():
            document_id = document_ids[title]
            for name in class_names:
                class_id = class_ids[name]
                if (class_id, document_id) in existing:
                    print(f"  skip  {title}  ->  {name}")
                    skipped += 1
                    continue
                db.add(ClassDocument(class_id = class_id, document_id = document_id))
                print(f"  link  {title}  ->  {name}")
                created += 1

        for title in UNASSIGNED:
            marker = "" if title in document_ids else "  (not in this database)"
            print(f"  none  {title}  ->  left unassigned on purpose{marker}")

        await db.commit()

    print(f"Backfill summary: {created} created, {skipped} skipped")


if __name__ == "__main__":
    asyncio.run(main())
