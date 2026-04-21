CREATE TABLE `checklistQuestions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`checklistType` enum('opening','closing') NOT NULL,
	`sectionTitle` varchar(80) NOT NULL,
	`prompt` text NOT NULL,
	`detailPrompt` text,
	`detailTrigger` enum('Yes','No','Never') NOT NULL DEFAULT 'Never',
	`displayOrder` int NOT NULL DEFAULT 0,
	`isActive` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `checklistQuestions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `closingChecklists` ADD `responseJson` text;--> statement-breakpoint
ALTER TABLE `openingChecklists` ADD `responseJson` text;