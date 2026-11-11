const { DatabaseSync } = require("node:sqlite");
let database;
try {
  database = new DatabaseSync(process.argv[2], { readOnly: true });
  database.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 3000;");
  const result = database.prepare(process.argv[3]).all();
  process.stdout.write(JSON.stringify(result, (_, value) => (typeof value === "bigint" ? Number(value) : value)));
} catch (error) {
  process.stderr.write(error.message);
  process.exitCode = 1;
} finally {
  database?.close();
}
