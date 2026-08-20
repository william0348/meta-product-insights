from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, Enum, Integer, String, Text, func

LONGTEXT = Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "mpi_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    openId: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(320), nullable=True)
    loginMethod: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    role: Mapped[str] = mapped_column(Enum("user", "admin", name="user_role"), default="user", nullable=False)
    createdAt: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updatedAt: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
    lastSignedIn: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class UserToken(Base):
    __tablename__ = "mpi_user_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    userId: Mapped[int] = mapped_column(Integer, nullable=False)
    tokenType: Mapped[str] = mapped_column(Enum("ads_management", "catalog_management", name="token_type"), nullable=False)
    accessToken: Mapped[str] = mapped_column(Text, nullable=False)
    catalogId: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    adAccountId: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    minSpend: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    minCTR: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    maxSpend: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    maxCVR: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    minCVR: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    minROAS: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    batchSize: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    createdAt: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updatedAt: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class CatalogBatchHistory(Base):
    __tablename__ = "mpi_catalog_batch_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    userId: Mapped[int] = mapped_column(Integer, nullable=False)
    catalogId: Mapped[str] = mapped_column(String(64), nullable=False)
    operationType: Mapped[str] = mapped_column(Enum("UPDATE", "DELETE", "CREATE", name="operation_type"), nullable=False)
    totalItems: Mapped[int] = mapped_column(Integer, nullable=False)
    batchCount: Mapped[int] = mapped_column(Integer, nullable=False)
    updatedFields: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    updateCriteria: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(Enum("pending", "processing", "completed", "failed", name="batch_status"), default="pending", nullable=False)
    successCount: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    errorCount: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    warningCount: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    handles: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    errors: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    startedAt: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    completedAt: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    durationMs: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    createdAt: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class BatchJob(Base):
    __tablename__ = "mpi_batch_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    userId: Mapped[int] = mapped_column(Integer, nullable=False)
    jobType: Mapped[str] = mapped_column(Enum("catalog_update", "catalog_delete", "report_generation", name="job_type"), nullable=False)
    config: Mapped[dict] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(Enum("queued", "running", "completed", "failed", "cancelled", name="job_status"), default="queued", nullable=False)
    progress: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    currentBatch: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    totalBatches: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    processedItems: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    totalItems: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    successCount: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    errorCount: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    warningCount: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    handles: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    errors: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    statusMessage: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    catalogVerification: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    queuedAt: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    startedAt: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    completedAt: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    historyId: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    reportId: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    createdAt: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updatedAt: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class SavedReport(Base):
    __tablename__ = "mpi_saved_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    userId: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    adAccountId: Mapped[str] = mapped_column(String(64), nullable=False)
    dateStart: Mapped[str] = mapped_column(String(32), nullable=False)
    dateEnd: Mapped[str] = mapped_column(String(32), nullable=False)
    level: Mapped[str] = mapped_column(String(32), nullable=False)
    breakdown: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    minSpend: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    minCTR: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    data: Mapped[Optional[str]] = mapped_column(LONGTEXT, nullable=True)
    totalItems: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    totalSpend: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    totalImpressions: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    status: Mapped[str] = mapped_column(Enum("generating", "completed", "failed", name="report_status"), default="generating", nullable=False)
    errorMessage: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    generatedAt: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    durationMs: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    source: Mapped[str] = mapped_column(Enum("manual", "scheduled", name="report_source"), default="manual", nullable=False)
    scheduleId: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    createdAt: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updatedAt: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class ScheduledJob(Base):
    __tablename__ = "mpi_scheduled_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    userId: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    jobType: Mapped[str] = mapped_column(Enum("report_generation", "catalog_update", "report_and_catalog", name="schedule_job_type"), nullable=False)
    cronExpression: Mapped[str] = mapped_column(String(64), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Taipei", nullable=False)
    config: Mapped[dict] = mapped_column(JSON, nullable=False)
    reportConfigs: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    lastRunAt: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    nextRunAt: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    lastRunStatus: Mapped[Optional[str]] = mapped_column(Enum("success", "failed", "running", name="run_status"), nullable=True)
    lastRunJobId: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    runCount: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    createdAt: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updatedAt: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class ScheduleRun(Base):
    __tablename__ = "mpi_schedule_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scheduleId: Mapped[int] = mapped_column(Integer, nullable=False)
    userId: Mapped[int] = mapped_column(Integer, nullable=False)
    triggerType: Mapped[str] = mapped_column(Enum("auto", "manual", name="trigger_type"), default="auto", nullable=False)
    totalJobs: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    completedJobs: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    failedJobs: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    totalItems: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    totalSpend: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    totalImpressions: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    catalogItemsUpdated: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    catalogErrors: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(Enum("running", "completed", "partial", "failed", name="schedule_run_status"), default="running", nullable=False)
    errorMessage: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    retryCount: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    maxRetries: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    nextRetryAt: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    lastErrorType: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    jobIds: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    startedAt: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    completedAt: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    durationMs: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    createdAt: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class ProductSetMonitor(Base):
    __tablename__ = "mpi_product_set_monitors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    userId: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    productSetId: Mapped[str] = mapped_column(String(64), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    runHour: Mapped[int] = mapped_column(Integer, default=8, nullable=False)
    runMinute: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Taipei", nullable=False)
    lastRunAt: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    lastRunStatus: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    lastProductCount: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    lastErrorMessage: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    nextRunAt: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    createdAt: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updatedAt: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class ProductSetSnapshot(Base):
    __tablename__ = "mpi_product_set_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    monitorId: Mapped[int] = mapped_column(Integer, nullable=False)
    takenAt: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    triggerType: Mapped[str] = mapped_column(String(32), default="auto", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="completed", nullable=False)
    productCount: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    products: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    addedProducts: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    removedProducts: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    errorMessage: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    durationMs: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
