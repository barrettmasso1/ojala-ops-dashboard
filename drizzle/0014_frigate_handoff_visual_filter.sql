CREATE TABLE `frigateHandoffVisualEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`businessDate` varchar(10) NOT NULL,
	`cameraName` varchar(64) NOT NULL DEFAULT 'handoff',
	`cupEventId` varchar(128) NOT NULL,
	`capturedAt` timestamp NOT NULL,
	`imageKey` varchar(512),
	`imageMimeType` varchar(64) NOT NULL,
	`sourceDetail` text,
	`analysisStatus` enum('pending_review','approved_by_ai','discarded','approved_by_manager','discarded_by_manager') NOT NULL DEFAULT 'pending_review',
	`analysisModel` varchar(96) NOT NULL DEFAULT 'platform-default-vision',
	`personPresent` int NOT NULL DEFAULT 0,
	`gelatoCupPresent` int NOT NULL DEFAULT 0,
	`cupInHandoffZone` int NOT NULL DEFAULT 0,
	`visibleCupCount` int NOT NULL DEFAULT 0,
	`confidence` enum('high','medium','low') NOT NULL DEFAULT 'low',
	`analysisReason` text,
	`analysisAttempts` int NOT NULL DEFAULT 0,
	`nextRetryAt` timestamp,
	`analysisLeaseUntil` timestamp,
	`lastAnalysisError` text,
	`reviewedAt` timestamp,
	`reviewedByUserId` int,
	`reviewNotes` text,
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `frigateHandoffVisualEvents_id` PRIMARY KEY(`id`),
	CONSTRAINT `frigateHandoffVisualEvents_store_camera_event_unique` UNIQUE(`storeId`,`cameraName`,`cupEventId`)
);
--> statement-breakpoint
ALTER TABLE `frigateHandoffVisualEvents` ADD CONSTRAINT `frigateHandoffVisualEvents_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX `idx_frigateHandoffVisualEvents_storeId` ON `frigateHandoffVisualEvents` (`storeId`);
--> statement-breakpoint
CREATE INDEX `idx_frigateHandoffVisualEvents_review_queue` ON `frigateHandoffVisualEvents` (`storeId`,`analysisStatus`,`nextRetryAt`);
--> statement-breakpoint
CREATE INDEX `idx_frigateHandoffVisualEvents_capturedAt` ON `frigateHandoffVisualEvents` (`storeId`,`capturedAt`);
