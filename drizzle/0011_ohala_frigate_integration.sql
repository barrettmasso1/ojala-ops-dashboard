ALTER TABLE `endOfDayReports` ADD COLUMN `sampleOunces` decimal(10,2) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `endOfDayReports` ADD COLUMN `wasteOunces` decimal(10,2) NOT NULL DEFAULT '0.00';--> statement-breakpoint
CREATE TABLE `frigateCupCounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessDate` varchar(10) NOT NULL,
	`cameraName` varchar(64) NOT NULL DEFAULT 'handoff',
	`cupsDetected` int NOT NULL DEFAULT 0,
	`peopleEntries` int NOT NULL DEFAULT 0,
	`sourceDetail` text,
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `frigateCupCounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `frigateCupCounts_businessDate_cameraName` UNIQUE(`businessDate`, `cameraName`)
);
