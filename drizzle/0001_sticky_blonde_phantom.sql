CREATE TABLE `user_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tokenType` enum('ads_management','catalog_management') NOT NULL,
	`accessToken` text NOT NULL,
	`catalogId` varchar(64),
	`adAccountId` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_tokens_id` PRIMARY KEY(`id`)
);
