const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

// Use cloud persistent storage path if available, otherwise write locally
const dbDir = process.env.RENDER_DISK_PATH || __dirname;

// Create directory if it doesn't exist
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'sf_dashboard.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
  )`);

  // Payment Accounts / Vendors
  db.run(`CREATE TABLE IF NOT EXISTS payment_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  )`);

  // Expense Entries
  db.run(`CREATE TABLE IF NOT EXISTS expense_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER,
    amount REAL NOT NULL,
    month TEXT NOT NULL,
    date TEXT NOT NULL,
    notes TEXT,
    FOREIGN KEY(account_id) REFERENCES payment_accounts(id)
  )`);

  // Seed default admin (sf-admin / sf-admin)
  db.get("SELECT * FROM users WHERE username = 'sf-admin'", (err, row) => {
    if (!row) {
      const hash = bcrypt.hashSync('sf-admin', 10);
      db.run("INSERT INTO users (username, password) VALUES (?, ?)", ['sf-admin', hash]);
    }
  });
});

module.exports = db;