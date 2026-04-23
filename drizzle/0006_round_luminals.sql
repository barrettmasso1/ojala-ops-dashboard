CREATE TABLE `readyMadeGelatoWeights` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessDate` varchar(10) NOT NULL,
	`flavor` varchar(160) NOT NULL,
	`weightKg` decimal(10,2) NOT NULL DEFAULT '0.00',
	`submittedByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `readyMadeGelatoWeights_id` PRIMARY KEY(`id`)
);
