import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

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