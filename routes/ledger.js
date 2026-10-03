const express = require('express');
const router = express.Router();
const pool = require('../db'); // Clean DB connection client

// Auth Middleware Check
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.redirect('/login');
}

// 1. Ledger Overview Page (/ledger)
router.get('/', requireAuth, async (req, res) => {
  try {
    const accountsRes = await pool.query("SELECT * FROM ledger_accounts ORDER BY name ASC");
    
    const entriesRes = await pool.query(`
      SELECT l.id, l.account_id, l.type, l.amount, l.date, l.notes, a.name AS account_name
      FROM ledger_entries l
      JOIN ledger_accounts a ON l.account_id = a.id
      ORDER BY l.id DESC
    `);

    const balanceMap = {};
    accountsRes.rows.forEach(acc => {
      balanceMap[acc.id] = { id: acc.id, name: acc.name, balance: 0, totalCredit: 0, totalDebit: 0 };
    });

    entriesRes.rows.forEach(entry => {
      const amt = parseFloat(entry.amount);
      if (balanceMap[entry.account_id]) {
        if (entry.type === 'CREDIT') {
          balanceMap[entry.account_id].totalCredit += amt;
          balanceMap[entry.account_id].balance += amt;
        } else if (entry.type === 'DEBIT') {
          balanceMap[entry.account_id].totalDebit += amt;
          balanceMap[entry.account_id].balance -= amt;
        }
      }
    });

    res.render('ledger', {
      accounts: accountsRes.rows,
      entries: entriesRes.rows,
      accountBalances: Object.values(balanceMap),
      defaultDate: new Date().toISOString().split('T')[0]
    });
  } catch (err) {
    res.status(500).send("Error loading ledger: " + err.message);
  }
});

// Action: Create Ledger Account
router.post('/accounts/create', requireAuth, async (req, res) => {
  const { name } = req.body;
  if (name) {
    await pool.query("INSERT INTO ledger_accounts (name) VALUES ($1)", [name.trim()]);
  }
  res.redirect('/ledger');
});

// Action: Add Ledger Entry
router.post('/entries/create', requireAuth, async (req, res) => {
  const { account_id, type, amount, date, notes } = req.body;
  await pool.query(
    "INSERT INTO ledger_entries (account_id, type, amount, date, notes) VALUES ($1, $2, $3, $4, $5)",
    [account_id, type, parseFloat(amount), date, notes]
  );
  res.redirect('/ledger');
});

// 2. Sub-page: Manage All Ledger Entries (/ledger/entries)
router.get('/entries', requireAuth, async (req, res) => {
  try {
    const accountsRes = await pool.query("SELECT * FROM ledger_accounts ORDER BY name ASC");
    const entriesRes = await pool.query(`
      SELECT l.id, l.account_id, l.type, l.amount, l.date, l.notes, a.name AS account_name
      FROM ledger_entries l
      JOIN ledger_accounts a ON l.account_id = a.id
      ORDER BY l.id DESC
    `);

    res.render('ledger_entries', {
      accounts: accountsRes.rows,
      entries: entriesRes.rows
    });
  } catch (err) {
    res.status(500).send("Error loading ledger entries: " + err.message);
  }
});

// Action: Edit Ledger Entry
router.post('/entries/edit/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { account_id, type, amount, date, notes } = req.body;
  await pool.query(
    "UPDATE ledger_entries SET account_id = $1, type = $2, amount = $3, date = $4, notes = $5 WHERE id = $6",
    [account_id, type, parseFloat(amount), date, notes, id]
  );
  res.redirect('/ledger/entries');
});

// Action: Delete Ledger Entry
router.post('/entries/delete/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM ledger_entries WHERE id = $1", [id]);
  res.redirect('/ledger/entries');
});

module.exports = router;