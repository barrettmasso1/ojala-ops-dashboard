import mysql from "mysql2/promise";

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const businessDate = "2026-04-29";
const tables = [
  "openingChecklists",
  "closingChecklists",
  "endOfDayReports",
  "readyMadeGelatoWeights",
];

for (const table of tables) {
  const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM \`${table}\` WHERE businessDate = ?`, [businessDate]);
  console.log(`${table}\t${rows[0].count}`);
}

await connection.end();
