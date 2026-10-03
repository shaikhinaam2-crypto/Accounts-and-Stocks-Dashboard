require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const initDb = async () => {
  try {
    console.log("Connecting to Neon PostgreSQL...");

    // 1. Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL
      )
    `);

    // 2. Expense Payment Accounts table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payment_accounts (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL
      )
    `);

    // 3. Expense Entries table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS expense_entries (
        id SERIAL PRIMARY KEY,
        account_id INT REFERENCES payment_accounts(id) ON DELETE CASCADE,
        amount NUMERIC NOT NULL,
        month VARCHAR(100) NOT NULL,
        date VARCHAR(100) NOT NULL,
        notes TEXT
      )
    `);

    // 4. COD Accounts table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cod_accounts (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL
      )
    `);

    // 5. COD Entries table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cod_entries (
        id SERIAL PRIMARY KEY,
        account_id INT REFERENCES cod_accounts(id) ON DELETE CASCADE,
        amount NUMERIC NOT NULL,
        month VARCHAR(100) NOT NULL,
        date VARCHAR(100) NOT NULL,
        notes TEXT
      )
    `);

    // 6. Credit/Debit Ledger Accounts
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ledger_accounts (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL
      )
    `);

    // 7. Credit/Debit Ledger Transactions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ledger_entries (
        id SERIAL PRIMARY KEY,
        account_id INT REFERENCES ledger_accounts(id) ON DELETE CASCADE,
        type VARCHAR(10) NOT NULL CHECK (type IN ('CREDIT', 'DEBIT')),
        amount NUMERIC NOT NULL,
        date VARCHAR(100) NOT NULL,
        notes TEXT
      )
    `);

    // Seed default admin (sf-admin / sf-admin)
    const userRes = await pool.query("SELECT * FROM users WHERE username = 'sf-admin'");
    if (userRes.rows.length === 0) {
      const hash = bcrypt.hashSync('sf-admin', 10);
      await pool.query("INSERT INTO users (username, password) VALUES ($1, $2)", ['sf-admin', hash]);
    }

    console.log("Neon PostgreSQL Database initialized successfully!");
  } catch (err) {
    console.error("Error initializing database:", err.message);
  } finally {
    await pool.end();
    process.exit(0);
  }
};

initDb();