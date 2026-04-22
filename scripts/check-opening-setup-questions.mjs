import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set.");

const connection = await mysql.createConnection(databaseUrl);

try {
  const [rows] = await connection.execute(
    `SELECT id, checklistType, sectionTitle, prompt, detailPrompt, detailTrigger, displayOrder, isActive
     FROM checklistQuestions
     WHERE checklistType = 'opening'
     ORDER BY displayOrder, id`
  );
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await connection.end();
}
