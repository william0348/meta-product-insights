import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, userTokens, InsertUserToken, UserToken } from "../drizzle/schema";
import { and } from "drizzle-orm";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// Token management functions
export async function saveUserToken(
  userId: number,
  tokenType: "ads_management" | "catalog_management",
  accessToken: string,
  options?: { catalogId?: string; adAccountId?: string; minSpend?: string; minCTR?: string; batchSize?: number }
): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot save token: database not available");
    return;
  }

  try {
    // Check if token already exists for this user and type
    const existing = await db
      .select()
      .from(userTokens)
      .where(and(eq(userTokens.userId, userId), eq(userTokens.tokenType, tokenType)))
      .limit(1);

    if (existing.length > 0) {
      // Update existing token
      await db
        .update(userTokens)
        .set({
          accessToken,
          catalogId: options?.catalogId || null,
          adAccountId: options?.adAccountId || null,
          minSpend: options?.minSpend || null,
          minCTR: options?.minCTR || null,
          batchSize: options?.batchSize || null,
        })
        .where(and(eq(userTokens.userId, userId), eq(userTokens.tokenType, tokenType)));
    } else {
      // Insert new token
      await db.insert(userTokens).values({
        userId,
        tokenType,
        accessToken,
        catalogId: options?.catalogId || null,
        adAccountId: options?.adAccountId || null,
        minSpend: options?.minSpend || null,
        minCTR: options?.minCTR || null,
        batchSize: options?.batchSize || null,
      });
    }
  } catch (error) {
    console.error("[Database] Failed to save token:", error);
    throw error;
  }
}

export async function getUserToken(
  userId: number,
  tokenType: "ads_management" | "catalog_management"
): Promise<UserToken | undefined> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get token: database not available");
    return undefined;
  }

  try {
    const result = await db
      .select()
      .from(userTokens)
      .where(and(eq(userTokens.userId, userId), eq(userTokens.tokenType, tokenType)))
      .limit(1);

    return result.length > 0 ? result[0] : undefined;
  } catch (error) {
    console.error("[Database] Failed to get token:", error);
    return undefined;
  }
}

export async function deleteUserToken(
  userId: number,
  tokenType: "ads_management" | "catalog_management"
): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot delete token: database not available");
    return;
  }

  try {
    await db
      .delete(userTokens)
      .where(and(eq(userTokens.userId, userId), eq(userTokens.tokenType, tokenType)));
  } catch (error) {
    console.error("[Database] Failed to delete token:", error);
    throw error;
  }
}


// Catalog Batch History functions
import { catalogBatchHistory, InsertCatalogBatchHistory, CatalogBatchHistory } from "../drizzle/schema";
import { desc } from "drizzle-orm";

export async function createBatchHistoryRecord(
  record: Omit<InsertCatalogBatchHistory, "id" | "createdAt">
): Promise<number | null> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot create batch history: database not available");
    return null;
  }

  try {
    const result = await db.insert(catalogBatchHistory).values(record);
    // MySQL returns insertId for auto-increment columns
    return (result as any)[0]?.insertId || null;
  } catch (error) {
    console.error("[Database] Failed to create batch history:", error);
    throw error;
  }
}

export async function updateBatchHistoryRecord(
  id: number,
  updates: Partial<Omit<CatalogBatchHistory, "id" | "createdAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot update batch history: database not available");
    return;
  }

  try {
    await db
      .update(catalogBatchHistory)
      .set(updates)
      .where(eq(catalogBatchHistory.id, id));
  } catch (error) {
    console.error("[Database] Failed to update batch history:", error);
    throw error;
  }
}

export async function getBatchHistoryByUser(
  userId: number,
  limit: number = 50
): Promise<CatalogBatchHistory[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get batch history: database not available");
    return [];
  }

  try {
    const result = await db
      .select()
      .from(catalogBatchHistory)
      .where(eq(catalogBatchHistory.userId, userId))
      .orderBy(desc(catalogBatchHistory.startedAt))
      .limit(limit);

    return result;
  } catch (error) {
    console.error("[Database] Failed to get batch history:", error);
    return [];
  }
}

export async function getBatchHistoryByCatalog(
  catalogId: string,
  limit: number = 50
): Promise<CatalogBatchHistory[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get batch history: database not available");
    return [];
  }

  try {
    const result = await db
      .select()
      .from(catalogBatchHistory)
      .where(eq(catalogBatchHistory.catalogId, catalogId))
      .orderBy(desc(catalogBatchHistory.startedAt))
      .limit(limit);

    return result;
  } catch (error) {
    console.error("[Database] Failed to get batch history:", error);
    return [];
  }
}

export async function getAllBatchHistory(
  limit: number = 100
): Promise<CatalogBatchHistory[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get batch history: database not available");
    return [];
  }

  try {
    const result = await db
      .select()
      .from(catalogBatchHistory)
      .orderBy(desc(catalogBatchHistory.startedAt))
      .limit(limit);

    return result;
  } catch (error) {
    console.error("[Database] Failed to get batch history:", error);
    return [];
  }
}


// Batch Jobs functions
import { batchJobs, InsertBatchJob, BatchJob } from "../drizzle/schema";

export async function createBatchJob(
  job: Omit<InsertBatchJob, "id" | "createdAt" | "updatedAt" | "queuedAt">
): Promise<number | null> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot create batch job: database not available");
    return null;
  }

  try {
    const result = await db.insert(batchJobs).values({
      ...job,
      status: "queued",
      progress: 0,
      currentBatch: 0,
      totalBatches: 0,
      processedItems: 0,
      successCount: 0,
      errorCount: 0,
      warningCount: 0,
    });
    return (result as any)[0]?.insertId || null;
  } catch (error) {
    console.error("[Database] Failed to create batch job:", error);
    throw error;
  }
}

export async function updateBatchJob(
  id: number,
  updates: Partial<Omit<BatchJob, "id" | "createdAt" | "queuedAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot update batch job: database not available");
    return;
  }

  try {
    await db
      .update(batchJobs)
      .set(updates)
      .where(eq(batchJobs.id, id));
  } catch (error) {
    console.error("[Database] Failed to update batch job:", error);
    throw error;
  }
}

export async function getBatchJob(id: number): Promise<BatchJob | undefined> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get batch job: database not available");
    return undefined;
  }

  try {
    const result = await db
      .select()
      .from(batchJobs)
      .where(eq(batchJobs.id, id))
      .limit(1);

    return result.length > 0 ? result[0] : undefined;
  } catch (error) {
    console.error("[Database] Failed to get batch job:", error);
    return undefined;
  }
}

export async function getBatchJobsByUser(
  userId: number,
  limit: number = 50
): Promise<BatchJob[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get batch jobs: database not available");
    return [];
  }

  try {
    const result = await db
      .select()
      .from(batchJobs)
      .where(eq(batchJobs.userId, userId))
      .orderBy(desc(batchJobs.queuedAt))
      .limit(limit);

    return result;
  } catch (error) {
    console.error("[Database] Failed to get batch jobs:", error);
    return [];
  }
}

export async function getQueuedJobs(limit: number = 10): Promise<BatchJob[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get queued jobs: database not available");
    return [];
  }

  try {
    const result = await db
      .select()
      .from(batchJobs)
      .where(eq(batchJobs.status, "queued"))
      .orderBy(batchJobs.queuedAt)
      .limit(limit);

    return result;
  } catch (error) {
    console.error("[Database] Failed to get queued jobs:", error);
    return [];
  }
}

export async function getRunningJobs(): Promise<BatchJob[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get running jobs: database not available");
    return [];
  }

  try {
    const result = await db
      .select()
      .from(batchJobs)
      .where(eq(batchJobs.status, "running"));

    return result;
  } catch (error) {
    console.error("[Database] Failed to get running jobs:", error);
    return [];
  }
}


// Saved Reports functions
import { savedReports, InsertSavedReport, SavedReport, scheduledJobs, InsertScheduledJob, ScheduledJob } from "../drizzle/schema";
import { lte } from "drizzle-orm";

export async function createSavedReport(
  report: Omit<InsertSavedReport, "id" | "createdAt" | "updatedAt">
): Promise<number | null> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot create saved report: database not available");
    return null;
  }

  try {
    const result = await db.insert(savedReports).values(report);
    return (result as any)[0]?.insertId || null;
  } catch (error) {
    console.error("[Database] Failed to create saved report:", error);
    throw error;
  }
}

export async function updateSavedReport(
  id: number,
  updates: Partial<Omit<SavedReport, "id" | "createdAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot update saved report: database not available");
    return;
  }

  try {
    await db
      .update(savedReports)
      .set(updates)
      .where(eq(savedReports.id, id));
  } catch (error) {
    console.error("[Database] Failed to update saved report:", error);
    throw error;
  }
}

export async function getSavedReport(id: number): Promise<SavedReport | undefined> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get saved report: database not available");
    return undefined;
  }

  try {
    const result = await db
      .select()
      .from(savedReports)
      .where(eq(savedReports.id, id))
      .limit(1);

    return result.length > 0 ? result[0] : undefined;
  } catch (error) {
    console.error("[Database] Failed to get saved report:", error);
    return undefined;
  }
}

export async function getSavedReportsByUser(
  userId: number,
  limit: number = 50
): Promise<SavedReport[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get saved reports: database not available");
    return [];
  }

  try {
    const result = await db
      .select()
      .from(savedReports)
      .where(eq(savedReports.userId, userId))
      .orderBy(desc(savedReports.createdAt))
      .limit(limit);

    return result;
  } catch (error) {
    console.error("[Database] Failed to get saved reports:", error);
    return [];
  }
}

export async function deleteSavedReport(id: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot delete saved report: database not available");
    return;
  }

  try {
    await db.delete(savedReports).where(eq(savedReports.id, id));
  } catch (error) {
    console.error("[Database] Failed to delete saved report:", error);
    throw error;
  }
}

// Scheduled Jobs functions
export async function createScheduledJob(
  job: Omit<InsertScheduledJob, "id" | "createdAt" | "updatedAt">
): Promise<number | null> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot create scheduled job: database not available");
    return null;
  }

  try {
    const result = await db.insert(scheduledJobs).values(job);
    return (result as any)[0]?.insertId || null;
  } catch (error) {
    console.error("[Database] Failed to create scheduled job:", error);
    throw error;
  }
}

export async function updateScheduledJob(
  id: number,
  updates: Partial<Omit<ScheduledJob, "id" | "createdAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot update scheduled job: database not available");
    return;
  }

  try {
    await db
      .update(scheduledJobs)
      .set(updates)
      .where(eq(scheduledJobs.id, id));
  } catch (error) {
    console.error("[Database] Failed to update scheduled job:", error);
    throw error;
  }
}

export async function getScheduledJob(id: number): Promise<ScheduledJob | undefined> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get scheduled job: database not available");
    return undefined;
  }

  try {
    const result = await db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.id, id))
      .limit(1);

    return result.length > 0 ? result[0] : undefined;
  } catch (error) {
    console.error("[Database] Failed to get scheduled job:", error);
    return undefined;
  }
}

export async function getScheduledJobsByUser(
  userId: number,
  limit: number = 50
): Promise<ScheduledJob[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get scheduled jobs: database not available");
    return [];
  }

  try {
    const result = await db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.userId, userId))
      .orderBy(desc(scheduledJobs.createdAt))
      .limit(limit);

    return result;
  } catch (error) {
    console.error("[Database] Failed to get scheduled jobs:", error);
    return [];
  }
}

export async function getEnabledScheduledJobs(): Promise<ScheduledJob[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get enabled scheduled jobs: database not available");
    return [];
  }

  try {
    const result = await db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.enabled, true));

    return result;
  } catch (error) {
    console.error("[Database] Failed to get enabled scheduled jobs:", error);
    return [];
  }
}

export async function getDueScheduledJobs(): Promise<ScheduledJob[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get due scheduled jobs: database not available");
    return [];
  }

  try {
    const now = new Date();
    const result = await db
      .select()
      .from(scheduledJobs)
      .where(and(
        eq(scheduledJobs.enabled, true),
        lte(scheduledJobs.nextRunAt, now)
      ));

    return result;
  } catch (error) {
    console.error("[Database] Failed to get due scheduled jobs:", error);
    return [];
  }
}

export async function deleteScheduledJob(id: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot delete scheduled job: database not available");
    return;
  }

  try {
    await db.delete(scheduledJobs).where(eq(scheduledJobs.id, id));
  } catch (error) {
    console.error("[Database] Failed to delete scheduled job:", error);
    throw error;
  }
}


// Schedule Runs (Execution History) functions
import { scheduleRuns, InsertScheduleRun, ScheduleRun } from "../drizzle/schema";

export async function createScheduleRun(
  run: Omit<InsertScheduleRun, "id" | "createdAt">
): Promise<number | null> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot create schedule run: database not available");
    return null;
  }

  try {
    const result = await db.insert(scheduleRuns).values(run);
    return (result as any)[0]?.insertId || null;
  } catch (error) {
    console.error("[Database] Failed to create schedule run:", error);
    throw error;
  }
}

export async function updateScheduleRun(
  id: number,
  updates: Partial<Omit<ScheduleRun, "id" | "createdAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot update schedule run: database not available");
    return;
  }

  try {
    await db
      .update(scheduleRuns)
      .set(updates)
      .where(eq(scheduleRuns.id, id));
  } catch (error) {
    console.error("[Database] Failed to update schedule run:", error);
    throw error;
  }
}

export async function getScheduleRunsByScheduleId(
  scheduleId: number,
  limit: number = 50
): Promise<ScheduleRun[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get schedule runs: database not available");
    return [];
  }

  try {
    const result = await db
      .select()
      .from(scheduleRuns)
      .where(eq(scheduleRuns.scheduleId, scheduleId))
      .orderBy(desc(scheduleRuns.startedAt))
      .limit(limit);

    return result;
  } catch (error) {
    console.error("[Database] Failed to get schedule runs:", error);
    return [];
  }
}

export async function getScheduleRun(id: number): Promise<ScheduleRun | undefined> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get schedule run: database not available");
    return undefined;
  }

  try {
    const result = await db
      .select()
      .from(scheduleRuns)
      .where(eq(scheduleRuns.id, id))
      .limit(1);

    return result.length > 0 ? result[0] : undefined;
  } catch (error) {
    console.error("[Database] Failed to get schedule run:", error);
    return undefined;
  }
}

export async function getLatestScheduleRun(scheduleId: number): Promise<ScheduleRun | undefined> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get latest schedule run: database not available");
    return undefined;
  }

  try {
    const result = await db
      .select()
      .from(scheduleRuns)
      .where(eq(scheduleRuns.scheduleId, scheduleId))
      .orderBy(desc(scheduleRuns.startedAt))
      .limit(1);

    return result.length > 0 ? result[0] : undefined;
  } catch (error) {
    console.error("[Database] Failed to get latest schedule run:", error);
    return undefined;
  }
}
