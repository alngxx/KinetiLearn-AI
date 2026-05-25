from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import REAL, TIMESTAMP, UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    title = Column(String(255), nullable=True)
    is_active = Column(Boolean, nullable=False, server_default=text("TRUE"))
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    messages = relationship(
        "ChatMessage",
        back_populates="session",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_chat_sessions_user_id", "user_id"),
        Index("ix_chat_sessions_updated_at", "updated_at"),
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("chat_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    token_count = Column(Integer, nullable=True)
    model_name = Column(String(50), nullable=True)
    latency_ms = Column(Integer, nullable=True)
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    session = relationship("ChatSession", back_populates="messages")
    citations = relationship(
        "ChatMessageCitation",
        back_populates="message",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        CheckConstraint(
            "role IN ('user', 'assistant')",
            name="ck_chat_messages_role_valid",
        ),
        Index("ix_chat_messages_session_id", "session_id"),
        Index("ix_chat_messages_created_at", "created_at"),
    )


class ChatMessageCitation(Base):
    __tablename__ = "chat_message_citations"

    chat_message_id = Column(
        UUID(as_uuid=True),
        ForeignKey("chat_messages.id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )
    document_chunk_id = Column(
        UUID(as_uuid=True),
        ForeignKey("document_chunks.id", ondelete="RESTRICT"),
        primary_key=True,
        nullable=False,
    )
    relevance_score = Column(REAL, nullable=True)
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    message = relationship("ChatMessage", back_populates="citations")

    __table_args__ = (
        Index("ix_chat_message_citations_chat_message_id", "chat_message_id"),
        Index("ix_chat_message_citations_document_chunk_id", "document_chunk_id"),
    )
