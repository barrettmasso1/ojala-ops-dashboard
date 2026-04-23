ALTER TABLE `readyMadeGelatoWeights` ADD `readyMadeGelatoShiftType` enum('opening','closing') DEFAULT 'opening' NOT NULL;--> statement-breakpoint
ALTER TABLE `readyMadeGelatoWeights` ADD `grossWeightKg` decimal(10,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `readyMadeGelatoWeights` ADD `smallPanCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `readyMadeGelatoWeights` ADD `largePanCount` int DEFAULT 0 NOT NULL;