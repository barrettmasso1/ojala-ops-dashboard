CREATE TABLE `recipeIngredients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recipeId` int NOT NULL,
	`inventoryItemId` int,
	`ingredientName` varchar(160) NOT NULL,
	`quantity` decimal(10,2) NOT NULL DEFAULT '0.00',
	`unitType` varchar(64) NOT NULL DEFAULT 'units',
	`costPerUnit` decimal(10,2) NOT NULL DEFAULT '0.00',
	`totalCost` decimal(10,2) NOT NULL DEFAULT '0.00',
	`sortOrder` int NOT NULL DEFAULT 0,
	`processSteps` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `recipeIngredients_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`batchYieldOunces` decimal(10,2) NOT NULL DEFAULT '0.00',
	`notes` text,
	`processSteps` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `recipes_id` PRIMARY KEY(`id`),
	CONSTRAINT `recipes_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
ALTER TABLE `inventoryItems` RENAME COLUMN `unitLabel` TO `unitType`;--> statement-breakpoint
ALTER TABLE `inventoryItems` MODIFY COLUMN `category` varchar(48) NOT NULL;--> statement-breakpoint
ALTER TABLE `inventoryItems` MODIFY COLUMN `unitType` varchar(64) NOT NULL DEFAULT 'units';--> statement-breakpoint
ALTER TABLE `inventoryItems` ADD `department` varchar(48) DEFAULT 'Ingredients' NOT NULL;--> statement-breakpoint
ALTER TABLE `inventoryItems` ADD `packSize` varchar(128) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `inventoryItems` ADD `costPerUnit` decimal(10,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `inventoryItems` ADD `reorderQuantity` decimal(10,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `inventoryItems` ADD `supplier` varchar(160) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `inventoryItems` ADD `supplierContact` varchar(160) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `inventoryItems` ADD `lastCountDate` varchar(10) DEFAULT '' NOT NULL;