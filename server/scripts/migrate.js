import { buildConfig } from '../config.js';
import { openDatabase, runMigrations } from '../database.js';

const config = buildConfig();
const db = openDatabase(config.databasePath);
try {
  runMigrations(db);
  console.log(`数据库迁移完成：${config.databasePath}`);
} finally {
  db.close();
}

