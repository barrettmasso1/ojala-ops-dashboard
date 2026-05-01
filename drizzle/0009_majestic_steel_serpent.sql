CREATE TABLE `submissionHistoryEntries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessDate` varchar(10) NOT NULL,
	`submissionHistoryType` enum('opening','closing','inventory') NOT NULL,
	`staffName` varchar(160) NOT NULL,
	`payloadJson` text NOT NULL,
	`submittedByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `submissionHistoryEntries_id` PRIMARY KEY(`id`)
);
