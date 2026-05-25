from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class Document(Base):
    __tablename__ = "documents"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    category_id = Column(
        UUID(as_uuid=True),
        ForeignKey("categories.id", ondelete="SET NULL"),
        nullable=True,
    )
    active_version_number = Column(Integer, nullable=True)
    created_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
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

    versions = relationship(
        "DocumentVersion",
        back_populates="document",
        cascade="all, delete-orphan",
    )
    document_skills = relationship(
        "DocumentSkill",
        back_populates="document",
        cascade="all, delete-orphan",
    )
    skills = relationship(
        "Skill",
        secondary="document_skills",
        viewonly=True,
    )

    __table_args__ = (
        Index("ix_documents_category_id", "category_id"),
        Index("ix_documents_is_active", "is_active"),
    )


class DocumentVersion(Base):
    __tablename__ = "document_versions"

    document_id = Column(
        UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )
    version_number = Column(Integer, primary_key=True, nullable=False)
    file_url = Column(String(500), nullable=False)
    file_name = Column(String(255), nullable=False)
    file_size_bytes = Column(BigInteger, nullable=False)
    mime_type = Column(String(100), nullable=False)
    processing_status = Column(
        String(20),
        nullable=False,
        server_default=text("'pending'"),
    )
    processing_error = Column(Text, nullable=True)
    change_note = Column(Text, nullable=True)
    uploaded_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    document = relationship("Document", back_populates="versions")
    chunks = relationship(
        "DocumentChunk",
        back_populates="document_version",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        CheckConstraint(
            "mime_type IN ("
            "'application/pdf', "
            "'application/vnd.openxmlformats-officedocument.wordprocessingml.document'"
            ")",
            name="ck_document_versions_mime_type_valid",
        ),
        CheckConstraint(
            "processing_status IN ('pending', 'processing', 'ready', 'failed')",
            name="ck_document_versions_processing_status_valid",
        ),
    )


class DocumentSkill(Base):
    __tablename__ = "document_skills"

    document_id = Column(
        UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )
    skill_id = Column(
        UUID(as_uuid=True),
        ForeignKey("skills.id", ondelete="RESTRICT"),
        primary_key=True,
        nullable=False,
    )
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    document = relationship("Document", back_populates="document_skills")
    skill = relationship("Skill")


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    document_id = Column(UUID(as_uuid=True), nullable=False)
    version_number = Column(Integer, nullable=False)
    chunk_index = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    token_count = Column(Integer, nullable=True)
    vector_id = Column(String(255), nullable=True)
    embedded_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    document_version = relationship("DocumentVersion", back_populates="chunks")

    __table_args__ = (
        ForeignKeyConstraint(
            ["document_id", "version_number"],
            ["document_versions.document_id", "document_versions.version_number"],
            ondelete="CASCADE",
            name="fk_document_chunks_document_version",
        ),
        UniqueConstraint(
            "document_id",
            "version_number",
            "chunk_index",
            name="uq_document_chunks_doc_version_index",
        ),
        Index(
            "ix_document_chunks_document_version",
            "document_id",
            "version_number",
        ),
        Index("ix_document_chunks_vector_id", "vector_id"),
    )
