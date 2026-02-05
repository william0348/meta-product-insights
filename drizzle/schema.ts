import { bigint, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// User tokens table for storing Facebook access tokens
export const userTokens = mysqlTable("user_tokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tokenType: mysqlEnum("tokenType", ["ads_management", "catalog_management"]).notNull(),
  accessToken: text("accessToken").notNull(),
  catalogId: varchar("catalogId", { length: 64 }), // Only for catalog tokens
  adAccountId: varchar("adAccountId", { length: 64 }), // Only for ads tokens
  minSpend: varchar("minSpend", { length: 32 }), // Default min spend filter
  minCTR: varchar("minCTR", { length: 32 }), // Default min CTR filter
  batchSize: int("batchSize"), // Catalog batch upload size (1000-2000)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserToken = typeof userTokens.$inferSelect;
export type InsertUserToken = typeof userTokens.$inferInsert;

// Catalog batch operation history table
export const catalogBatchHistory = mysqlTable("catalog_batch_history", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  catalogId: varchar("catalogId", { length: 64 }).notNull(),
  
  // Operation details
  operationType: mysqlEnum("operationType", ["UPDATE", "DELETE", "CREATE"]).notNull(),
  totalItems: int("totalItems").notNull(), // Total number of items processed
  batchCount: int("batchCount").notNull(), // Number of batches used
  
  // Updated fields info (JSON array of field names that were updated)
  updatedFields: json("updatedFields").$type<string[]>(),
  
  // Update conditions/criteria (JSON object describing the update logic)
  updateCriteria: json("updateCriteria").$type<{
    sourceField?: string;      // e.g., "custom_label_4"
    targetField?: string;      // e.g., "custom_number_0"
    condition?: string;        // e.g., "copy value", "increment", etc.
    description?: string;      // Human-readable description
  }>(),
  
  // Status and results
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
  successCount: int("successCount").default(0),
  errorCount: int("errorCount").default(0),
  warningCount: int("warningCount").default(0),
  
  // Facebook API handles for async tracking
  handles: json("handles").$type<string[]>(),
  
  // Error details (JSON array of error messages)
  errors: json("errors").$type<Array<{ retailerId: string; message: string }>>(),
  
  // Timing
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  durationMs: bigint("durationMs", { mode: "number" }), // Duration in milliseconds
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CatalogBatchHistory = typeof catalogBatchHistory.$inferSelect;
export type InsertCatalogBatchHistory = typeof catalogBatchHistory.$inferInsert;
