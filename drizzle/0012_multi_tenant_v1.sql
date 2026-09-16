-- Phase 1 multi-tenant migration. Non-destructive: preserves all historical Ojala rows.
CREATE TABLE IF NOT EXISTS `stores` (
  `id` int AUTO_INCREMENT NOT NULL,
  `nombre` varchar(160) NOT NULL,
  `timezone` varchar(64) NOT NULL,
  `horario_apertura` varchar(8),
  `horario_cierre` varchar(8),
  `dueno_email` varchar(320),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `stores_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
INSERT INTO `stores` (`id`,`nombre`,`timezone`,`horario_apertura`,`horario_cierre`,`dueno_email`)
VALUES (1,'Ojala Gelato','America/Mazatlan',NULL,NULL,NULL)
ON DUPLICATE KEY UPDATE `nombre`=VALUES(`nombre`),`timezone`=VALUES(`timezone`);
--> statement-breakpoint
ALTER TABLE `users` ADD `storeId` int NOT NULL DEFAULT 1;
ALTER TABLE `checklistQuestions` ADD `storeId` int NOT NULL DEFAULT 1;
ALTER TABLE `openingChecklists` ADD `storeId` int NOT NULL DEFAULT 1;
ALTER TABLE `closingChecklists` ADD `storeId` int NOT NULL DEFAULT 1;
ALTER TABLE `endOfDayReports` ADD `storeId` int NOT NULL DEFAULT 1;
ALTER TABLE `inventoryItems` ADD `storeId` int NOT NULL DEFAULT 1;
ALTER TABLE `readyMadeGelatoWeights` ADD `storeId` int NOT NULL DEFAULT 1;
ALTER TABLE `submissionHistoryEntries` ADD `storeId` int NOT NULL DEFAULT 1;
ALTER TABLE `staffAttendance` ADD `storeId` int NOT NULL DEFAULT 1;
ALTER TABLE `frigateCupCounts` ADD `storeId` int NOT NULL DEFAULT 1;
ALTER TABLE `recipes` ADD `storeId` int NOT NULL DEFAULT 1;
ALTER TABLE `recipeIngredients` ADD `storeId` int NOT NULL DEFAULT 1;
--> statement-breakpoint
UPDATE `users` SET `storeId`=1 WHERE `storeId` IS NULL;
UPDATE `checklistQuestions` SET `storeId`=1 WHERE `storeId` IS NULL;
UPDATE `openingChecklists` SET `storeId`=1 WHERE `storeId` IS NULL;
UPDATE `closingChecklists` SET `storeId`=1 WHERE `storeId` IS NULL;
UPDATE `endOfDayReports` SET `storeId`=1 WHERE `storeId` IS NULL;
UPDATE `inventoryItems` SET `storeId`=1 WHERE `storeId` IS NULL;
UPDATE `readyMadeGelatoWeights` SET `storeId`=1 WHERE `storeId` IS NULL;
UPDATE `submissionHistoryEntries` SET `storeId`=1 WHERE `storeId` IS NULL;
UPDATE `staffAttendance` SET `storeId`=1 WHERE `storeId` IS NULL;
UPDATE `frigateCupCounts` SET `storeId`=1 WHERE `storeId` IS NULL;
UPDATE `recipes` SET `storeId`=1 WHERE `storeId` IS NULL;
UPDATE `recipeIngredients` SET `storeId`=1 WHERE `storeId` IS NULL;
--> statement-breakpoint
ALTER TABLE `frigateCupCounts` DROP INDEX `frigateCupCounts_businessDate_cameraName`;
ALTER TABLE `frigateCupCounts` ADD CONSTRAINT `frigateCupCounts_store_date_camera_unique` UNIQUE (`storeId`,`businessDate`,`cameraName`);
ALTER TABLE `recipes` DROP INDEX `recipes_name_unique`;
ALTER TABLE `recipes` ADD CONSTRAINT `recipes_store_name_unique` UNIQUE (`storeId`,`name`);
--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `checklistQuestions` ADD CONSTRAINT `checklistQuestions_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `openingChecklists` ADD CONSTRAINT `openingChecklists_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `closingChecklists` ADD CONSTRAINT `closingChecklists_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `endOfDayReports` ADD CONSTRAINT `endOfDayReports_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `inventoryItems` ADD CONSTRAINT `inventoryItems_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `readyMadeGelatoWeights` ADD CONSTRAINT `readyMadeGelatoWeights_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `submissionHistoryEntries` ADD CONSTRAINT `submissionHistoryEntries_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `staffAttendance` ADD CONSTRAINT `staffAttendance_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `frigateCupCounts` ADD CONSTRAINT `frigateCupCounts_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `recipes` ADD CONSTRAINT `recipes_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `recipeIngredients` ADD CONSTRAINT `recipeIngredients_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
CREATE INDEX `idx_users_storeId` ON `users` (`storeId`);
CREATE INDEX `idx_openingChecklists_storeId` ON `openingChecklists` (`storeId`);
CREATE INDEX `idx_closingChecklists_storeId` ON `closingChecklists` (`storeId`);
CREATE INDEX `idx_endOfDayReports_storeId` ON `endOfDayReports` (`storeId`);
CREATE INDEX `idx_inventoryItems_storeId` ON `inventoryItems` (`storeId`);
CREATE INDEX `idx_readyMadeGelatoWeights_storeId` ON `readyMadeGelatoWeights` (`storeId`);
CREATE INDEX `idx_submissionHistoryEntries_storeId` ON `submissionHistoryEntries` (`storeId`);
CREATE INDEX `idx_staffAttendance_storeId` ON `staffAttendance` (`storeId`);
CREATE INDEX `idx_frigateCupCounts_storeId` ON `frigateCupCounts` (`storeId`);
