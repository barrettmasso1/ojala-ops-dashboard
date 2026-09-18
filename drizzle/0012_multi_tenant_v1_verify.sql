-- READ-ONLY post-migration verification for Phase 1.
SELECT id,nombre,timezone FROM `stores` WHERE id=1;

SELECT 'users' AS table_name, COUNT(*) AS null_store_ids FROM `users` WHERE `storeId` IS NULL
UNION ALL SELECT 'checklistQuestions', COUNT(*) FROM `checklistQuestions` WHERE `storeId` IS NULL
UNION ALL SELECT 'openingChecklists', COUNT(*) FROM `openingChecklists` WHERE `storeId` IS NULL
UNION ALL SELECT 'closingChecklists', COUNT(*) FROM `closingChecklists` WHERE `storeId` IS NULL
UNION ALL SELECT 'endOfDayReports', COUNT(*) FROM `endOfDayReports` WHERE `storeId` IS NULL
UNION ALL SELECT 'inventoryItems', COUNT(*) FROM `inventoryItems` WHERE `storeId` IS NULL
UNION ALL SELECT 'readyMadeGelatoWeights', COUNT(*) FROM `readyMadeGelatoWeights` WHERE `storeId` IS NULL
UNION ALL SELECT 'submissionHistoryEntries', COUNT(*) FROM `submissionHistoryEntries` WHERE `storeId` IS NULL
UNION ALL SELECT 'staffAttendance', COUNT(*) FROM `staffAttendance` WHERE `storeId` IS NULL
UNION ALL SELECT 'frigateCupCounts', COUNT(*) FROM `frigateCupCounts` WHERE `storeId` IS NULL
UNION ALL SELECT 'recipes', COUNT(*) FROM `recipes` WHERE `storeId` IS NULL
UNION ALL SELECT 'recipeIngredients', COUNT(*) FROM `recipeIngredients` WHERE `storeId` IS NULL;
