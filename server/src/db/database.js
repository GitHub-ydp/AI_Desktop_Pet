const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

const schemaPath = path.resolve(__dirname, 'schema.sql');

let databaseInstance = null;

function initializeDatabase() {
  if (databaseInstance) {
    return databaseInstance;
  }

  const directory = path.dirname(config.dbPath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  databaseInstance = new Database(config.dbPath);
  databaseInstance.pragma('journal_mode = WAL');
  databaseInstance.pragma('foreign_keys = ON');
  databaseInstance.pragma('synchronous = NORMAL');

  const schema = fs.readFileSync(schemaPath, 'utf8');
  databaseInstance.exec(schema);

  return databaseInstance;
}

function getDatabase() {
  return initializeDatabase();
}

function closeDatabase() {
  if (databaseInstance) {
    databaseInstance.close();
    databaseInstance = null;
  }
}

module.exports = {
  initializeDatabase,
  getDatabase,
  closeDatabase,
};
