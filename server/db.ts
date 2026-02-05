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
