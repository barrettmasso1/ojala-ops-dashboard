CREATE TABLE `closingChecklists` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessDate` varchar(10) NOT NULL,
	`staffName` varchar(160) NOT NULL,
	`cashCounted` decimal(10,2) NOT NULL,
	`cashMatchesSystem` varchar(3) NOT NULL,
	`cleaningStatus` text NOT NULL,
	`productStorageStatus` text NOT NULL,
	`storeClosedStatus` varchar(3) NOT NULL,
	`notes` text,
	`submittedByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `closingChecklists_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `endOfDayReports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessDate` varchar(10) NOT NULL,
	`shift` varchar(16) NOT NULL,
	`staffName` varchar(160) NOT NULL,
	`cups4oz` int NOT NULL DEFAULT 0,
	`cups8oz` int NOT NULL DEFAULT 0,
	`cupsPint` int NOT NULL DEFAULT 0,
	`cupsLiter` int NOT NULL DEFAULT 0,
	`cashTotal` decimal(10,2) NOT NULL DEFAULT '0.00',
	`cardTotal` decimal(10,2) NOT NULL DEFAULT '0.00',
	`zelleTotal` decimal(10,2) NOT NULL DEFAULT '0.00',
	`venmoTotal` decimal(10,2) NOT NULL DEFAULT '0.00',
	`wasteNotes` text,
	`lowItemNotes` text,
	`generalNotes` text,
	`submittedByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `endOfDayReports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inventoryItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category` varchar(32) NOT NULL,
	`itemName` varchar(160) NOT NULL,
	`unitLabel` varchar(64) NOT NULL,
	`currentQuantity` decimal(10,2) NOT NULL DEFAULT '0.00',
	`parLevel` decimal(10,2) NOT NULL DEFAULT '0.00',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `inventoryItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `openingChecklists` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessDate` varchar(10) NOT NULL,
	`staffName` varchar(160) NOT NULL,
	`equipmentStatus` text NOT NULL,
	`cleanlinessStatus` text NOT NULL,
	`setupStatus` text NOT NULL,
	`startingCash` decimal(10,2) NOT NULL,
	`cashMatchesSystem` varchar(3) NOT NULL,
	`storeReadyStatus` varchar(3) NOT NULL,
	`notes` text,
	`submittedByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `openingChecklists_id` PRIMARY KEY(`id`)
);
