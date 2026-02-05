CREATE TABLE `saved_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`adAccountId` varchar(64) NOT NULL,
	`dateStart` varchar(32) NOT NULL,
	`dateEnd` varchar(32) NOT NULL,
	`level` varchar(32) NOT NULL,
	`breakdown` varchar(32),
	`minSpend` varchar(32),
	`minCTR` varchar(32),
	`data` json,
	`totalItems` int DEFAULT 0,
	`totalSpend` bigint,
	`totalImpressions` bigint,
	`status` enum('generating','completed','failed') NOT NULL DEFAULT 'generating',
	`errorMessage` text,
	`generatedAt` timestamp,
	`durationMs` bigint,
	`source` enum('manual','scheduled') NOT NULL DEFAULT 'manual',
	`scheduleId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `saved_reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scheduled_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`jobType` enum('report_generation','catalog_update') NOT NULL,
	`cronExpression` varchar(64) NOT NULL,
	`timezone` varchar(64) NOT NULL DEFAULT 'Asia/Taipei',
	`config` json NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`lastRunAt` timestamp,
	`nextRunAt` timestamp,
	`lastRunStatus` enum('success','failed','running'),
	`lastRunJobId` int,
	`runCount` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scheduled_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `batch_jobs` ADD `reportId` int;