import { buildConfig } from '../config.js';
import { openDatabase, runMigrations, seedDemoData } from '../database.js';

const config = buildConfig();
const db = openDatabase(config.databasePath);
try {
  runMigrations(db);
  const result = seedDemoData(db);
  console.log(`演示数据初始化完成，团队ID：${result.teamId}`);
} finally {
  db.close();
}

