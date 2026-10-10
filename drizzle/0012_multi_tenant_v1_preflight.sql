-- READ-ONLY preflight for Phase 1 migration.
-- Run before 0012_multi_tenant_v1.sql and save the output for comparison.
SELECT 'users' AS table_name, COUNT(*) AS rows_before FROM `users`
UNION ALL SELECT 'checklistQuestions', COUNT(*) FROM `checklistQuestions`
UNION ALL SELECT 'openingChecklists', COUNT(*) FROM `openingChecklists`
UNION ALL SELECT 'closingChecklists', COUNT(*) FROM `closingChecklists`
UNION ALL SELECT 'endOfDayReports', COUNT(*) FROM `endOfDayReports`
UNION ALL SELECT 'inventoryItems', COUNT(*) FROM `inventoryItems`
UNION ALL SELECT 'readyMadeGelatoWeights', COUNT(*) FROM `readyMadeGelatoWeights`
UNION ALL SELECT 'submissionHistoryEntries', COUNT(*) FROM `submissionHistoryEntries`
UNION ALL SELECT 'staffAttendance', COUNT(*) FROM `staffAttendance`
UNION ALL SELECT 'frigateCupCounts', COUNT(*) FROM `frigateCupCounts`
UNION ALL SELECT 'recipes', COUNT(*) FROM `recipes`
UNION ALL SELECT 'recipeIngredients', COUNT(*) FROM `recipeIngredients`;
