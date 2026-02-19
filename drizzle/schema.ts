import { bigint, int, json, longtext, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean } from "drizzle-orm/mysql-core";

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

// Background batch jobs table for async processing
export const batchJobs = mysqlTable("batch_jobs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  
  // Job type and configuration
  jobType: mysqlEnum("jobType", ["catalog_update", "catalog_delete", "report_generation"]).notNull(),
  
  // Job configuration (all parameters needed to execute the job)
  config: json("config").$type<{
    // For catalog jobs
    catalogId?: string;
    accessToken?: string;
    retailerIds?: string[];
    customLabel4?: string;
    customNumberField?: string;
    customNumberValue?: string;
    updateCriteria?: {
      sourceField?: string;
      targetField?: string;
      condition?: string;
      description?: string;
    };
    // For report generation jobs
    adAccountId?: string;
    dateStart?: string;
    dateEnd?: string;
    level?: string;
    breakdown?: string;
    minSpend?: string;
    minCTR?: string;
    // Schedule tracking
    scheduleId?: number;
    scheduleName?: string;
    scheduleRunId?: number;
    configIndex?: number;
    configName?: string;
    // Combined workflow flags
    updateToCatalog?: boolean;
    catalogAccessToken?: string;
    dateRangeType?: string;
    customNumbers?: Record<string, string>;
    customLabels?: Record<string, string>;
  }>().notNull(),
  
  // Progress tracking
  status: mysqlEnum("status", ["queued", "running", "completed", "failed", "cancelled"]).default("queued").notNull(),
  progress: int("progress").default(0), // 0-100 percentage
  currentBatch: int("currentBatch").default(0),
  totalBatches: int("totalBatches").default(0),
  processedItems: int("processedItems").default(0),
  totalItems: int("totalItems").default(0),
  
  // Results
  successCount: int("successCount").default(0),
  errorCount: int("errorCount").default(0),
  warningCount: int("warningCount").default(0),
  
  // Facebook API handles for async tracking
  handles: json("handles").$type<string[]>(),
  
  // Error/warning details
  errors: json("errors").$type<Array<{ retailerId?: string; message: string; batchIndex?: number }>>(),
  
  // Status message for UI display
  statusMessage: text("statusMessage"),
  
  // Timing
  queuedAt: timestamp("queuedAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  
  // Link to batch history record (created when job completes)
  historyId: int("historyId"),
  
  // Link to saved report (for report_generation jobs)
  reportId: int("reportId"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BatchJob = typeof batchJobs.$inferSelect;
export type InsertBatchJob = typeof batchJobs.$inferInsert;

// Saved reports table for storing generated report data
export const savedReports = mysqlTable("saved_reports", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  
  // Report configuration
  name: varchar("name", { length: 255 }).notNull(),
  adAccountId: varchar("adAccountId", { length: 64 }).notNull(),
  dateStart: varchar("dateStart", { length: 32 }).notNull(),
  dateEnd: varchar("dateEnd", { length: 32 }).notNull(),
  level: varchar("level", { length: 32 }).notNull(),
  breakdown: varchar("breakdown", { length: 32 }),
  
  // Filter settings used
  minSpend: varchar("minSpend", { length: 32 }),
  minCTR: varchar("minCTR", { length: 32 }),
  
  // Report data (stored as LONGTEXT JSON to handle large datasets 70k+ records)
  data: longtext("data"),
  
  // Report statistics
  totalItems: int("totalItems").default(0),
  totalSpend: bigint("totalSpend", { mode: "number" }),
  totalImpressions: bigint("totalImpressions", { mode: "number" }),
  
  // Status
  status: mysqlEnum("status", ["generating", "completed", "failed"]).default("generating").notNull(),
  errorMessage: text("errorMessage"),
  
  // Timing
  generatedAt: timestamp("generatedAt"),
  durationMs: bigint("durationMs", { mode: "number" }),
  
  // Source (manual or scheduled)
  source: mysqlEnum("source", ["manual", "scheduled"]).default("manual").notNull(),
  scheduleId: int("scheduleId"), // Link to scheduled_jobs if from schedule
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SavedReport = typeof savedReports.$inferSelect;
export type InsertSavedReport = typeof savedReports.$inferInsert;

// Scheduled jobs table for recurring tasks
export const scheduledJobs = mysqlTable("scheduled_jobs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  
  // Schedule name and description
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  
  // Job type
  // report_generation: Only fetch report data and save to database
  // catalog_update: Only update catalog with provided data
  // report_and_catalog: Combined workflow - fetch report data AND update to catalog
  jobType: mysqlEnum("jobType", ["report_generation", "catalog_update", "report_and_catalog"]).notNull(),
  
  // Schedule configuration
  cronExpression: varchar("cronExpression", { length: 64 }).notNull(), // e.g., "0 0 9 * * 1" for Monday 9 AM
  timezone: varchar("timezone", { length: 64 }).default("Asia/Taipei").notNull(),
  
  // Job configuration (same as batchJobs.config)
  // For single config (legacy)
  config: json("config").$type<{
    // For report generation
    adAccountId?: string;
    accessToken?: string;
    dateRangeType?: string; // "last_7_days", "last_30_days", "last_week", etc.
    level?: string;
    breakdown?: string;
    minSpend?: string;
    minCTR?: string;
    // For catalog update
    catalogId?: string;
    customLabel4?: string;
    enableCustomLabel4?: boolean;
    customNumberField?: string;
    customNumberValue?: string;
    // For combined workflow (report_and_catalog)
    updateToCatalog?: boolean;  // Whether to update to catalog after report generation
    catalogAccessToken?: string; // Catalog access token (if different from report token)
    customNumbers?: Record<string, string>;
    customLabels?: Record<string, string>;
  }>().notNull(),
  
  // Multi-account configurations (array of report configs)
  // Each config can have different adAccountId and filter parameters
  reportConfigs: json("reportConfigs").$type<Array<{
    name?: string;           // Optional name for this config
    adAccountId: string;     // Required: Ad Account ID
    accessToken?: string;    // Optional: Override access token
    dateRangeType?: string;  // Optional: Override date range
    minSpend?: string;       // Optional: Min spend filter
    minCTR?: string;         // Optional: Min CTR filter
    level?: string;          // Optional: Report level
    breakdown?: string;      // Optional: Breakdown type
  }>>(),
  
  // Status
  enabled: boolean("enabled").default(true).notNull(),
  
  // Execution tracking
  lastRunAt: timestamp("lastRunAt"),
  nextRunAt: timestamp("nextRunAt"),
  lastRunStatus: mysqlEnum("lastRunStatus", ["success", "failed", "running"]),
  lastRunJobId: int("lastRunJobId"), // Link to last batch_jobs record
  runCount: int("runCount").default(0),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ScheduledJob = typeof scheduledJobs.$inferSelect;
export type InsertScheduledJob = typeof scheduledJobs.$inferInsert;

// Schedule execution history table
export const scheduleRuns = mysqlTable("schedule_runs", {
  id: int("id").autoincrement().primaryKey(),
  scheduleId: int("scheduleId").notNull(),
  userId: int("userId").notNull(),
  
  // Trigger info
  triggerType: mysqlEnum("triggerType", ["auto", "manual"]).default("auto").notNull(),
  
  // Job tracking
  totalJobs: int("totalJobs").default(0), // Number of batch jobs created
  completedJobs: int("completedJobs").default(0),
  failedJobs: int("failedJobs").default(0),
  
  // Aggregated results
  totalItems: int("totalItems").default(0), // Total products processed across all jobs
  totalSpend: bigint("totalSpend", { mode: "number" }),
  totalImpressions: bigint("totalImpressions", { mode: "number" }),
  catalogItemsUpdated: int("catalogItemsUpdated").default(0),
  catalogErrors: int("catalogErrors").default(0),
  
  // Status
  status: mysqlEnum("status", ["running", "completed", "partial", "failed"]).default("running").notNull(),
  errorMessage: text("errorMessage"),
  
  // Retry mechanism
  retryCount: int("retryCount").default(0).notNull(),
  maxRetries: int("maxRetries").default(3).notNull(),
  nextRetryAt: timestamp("nextRetryAt"),
  lastErrorType: varchar("lastErrorType", { length: 50 }), // 'transient' | 'permanent' | 'timeout' | 'rate_limit'
  
  // Linked batch job IDs (JSON array)
  jobIds: json("jobIds").$type<number[]>(),
  
  // Timing
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  durationMs: bigint("durationMs", { mode: "number" }),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ScheduleRun = typeof scheduleRuns.$inferSelect;
export type InsertScheduleRun = typeof scheduleRuns.$inferInsert;
