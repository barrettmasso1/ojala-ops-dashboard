import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set.");
}

const connection = await mysql.createConnection(databaseUrl);

try {
  const [result] = await connection.execute(
    `UPDATE checklistQuestions SET prompt = ? WHERE prompt = ?`,
    ["All trash is emptied", "Trash emptied"]
  );

  const updatedRows = Number(result?.affectedRows ?? 0);
  console.log(JSON.stringify({ updatedRows }));
} finally {
  await connection.end();
}
