ALTER TABLE `schedule_runs` ADD `retryCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `schedule_runs` ADD `maxRetries` int DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `schedule_runs` ADD `nextRetryAt` timestamp;--> statement-breakpoint
ALTER TABLE `schedule_runs` ADD `lastErrorType` varchar(50);