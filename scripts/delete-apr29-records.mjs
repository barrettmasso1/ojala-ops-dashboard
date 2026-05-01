import mysql from "mysql2/promise";

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const businessDate = "2026-04-29";
const tables = [
  "readyMadeGelatoWeights",
  "endOfDayReports",
  "closingChecklists",
  "openingChecklists",
];

try {
  await connection.beginTransaction();

  for (const table of tables) {
    await connection.query(`DELETE FROM \`${table}\` WHERE businessDate = ?`, [businessDate]);
  }

  await connection.commit();

  for (const table of ["openingChecklists", "closingChecklists", "endOfDayReports", "readyMadeGelatoWeights"]) {
    const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM \`${table}\` WHERE businessDate = ?`, [businessDate]);
    console.log(`${table}\t${rows[0].count}`);
  }
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}
