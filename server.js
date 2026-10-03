require('dotenv').config(); // Load environment variables from .env
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const pool = require('./db'); // Clean DB connection client
const config = require('./config');
const ledgerRoutes = require('./routes/ledger');

const app = express();
app.locals.site = config;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');

app.use(session({
  secret: 'sf_portal_secret_key',
  resave: false,
  saveUninitialized: false
}));

// Mount Ledger Router
app.use('/ledger', ledgerRoutes);

// Auth Middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.redirect('/login');
}

// Root Route Redirect
app.get('/', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard');
  }
  res.redirect('/login');
});

// Login Routes
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    const user = result.rows[0];
    if (user && bcrypt.compareSync(password, user.password)) {
      req.session.userId = user.id;
      req.session.username = user.username;
      return res.redirect('/dashboard');
    }
    res.render('login', { error: 'Invalid username or password' });
  } catch (err) {
    res.render('login', { error: 'Database connection error: ' + err.message });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// 1. Expense Dashboard Route
app.get('/dashboard', requireAuth, async (req, res) => {
  const currentMonth = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
  const selectedMonth = req.query.month || currentMonth;

  try {
    const accountsRes = await pool.query("SELECT * FROM payment_accounts ORDER BY name ASC");
    const monthRowsRes = await pool.query("SELECT DISTINCT month FROM expense_entries ORDER BY month DESC");
    
    let availableMonths = monthRowsRes.rows.map(m => m.month);
    if (!availableMonths.includes(currentMonth)) {
      availableMonths.unshift(currentMonth);
    }

    let query = `
      SELECT 
        e.id, e.month, e.date, e.amount, e.notes,
        p.name AS account_name
      FROM expense_entries e
      JOIN payment_accounts p ON e.account_id = p.id
    `;
    let params = [];

    if (selectedMonth !== 'ALL') {
      query += ` WHERE e.month = $1`;
      params.push(selectedMonth);
    }
    query += ` ORDER BY e.id DESC`;

    const entriesRes = await pool.query(query, params);
    const summaryMap = {};
    let grandTotal = 0;

    entriesRes.rows.forEach(entry => {
      const numericAmount = parseFloat(entry.amount);
      grandTotal += numericAmount;
      const key = `${entry.month}_${entry.account_name}`;
      if (!summaryMap[key]) {
        summaryMap[key] = {
          month: entry.month,
          account_name: entry.account_name,
          total_amount: 0,
          sub_amounts: [],
          notes: entry.notes || ''
        };
      }
      summaryMap[key].total_amount += numericAmount;
      summaryMap[key].sub_amounts.push(numericAmount);
    });

    res.render('dashboard', {
      activePortal: 'sf-expenses',
      accounts: accountsRes.rows,
      entries: entriesRes.rows,
      summaryList: Object.values(summaryMap),
      grandTotal,
      availableMonths,
      selectedMonth,
      defaultMonth: currentMonth,
      defaultDate: new Date().toISOString().split('T')[0]
    });
  } catch (err) {
    res.status(500).send("Database query error: " + err.message);
  }
});

// 2. Sub-portal: COD Received Management
app.get('/cod-portal', requireAuth, async (req, res) => {
  const currentMonth = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
  try {
    const accountsRes = await pool.query("SELECT * FROM cod_accounts ORDER BY name ASC");
    const query = `
      SELECT e.id, e.amount, e.month, e.date, e.notes, p.name AS account_name
      FROM cod_entries e
      JOIN cod_accounts p ON e.account_id = p.id
      ORDER BY e.id DESC
    `;
    const entriesRes = await pool.query(query);
    
    let totalCodReceived = 0;
    entriesRes.rows.forEach(row => {
      totalCodReceived += parseFloat(row.amount);
    });

    res.render('cod_portal', {
      accounts: accountsRes.rows,
      entries: entriesRes.rows,
      totalCodReceived,
      defaultMonth: currentMonth,
      defaultDate: new Date().toISOString().split('T')[0]
    });
  } catch (err) {
    res.status(500).send("Error fetching COD entries: " + err.message);
  }
});

// Actions: Create COD Account & Entry
app.post('/cod-accounts/create', requireAuth, async (req, res) => {
  const { name } = req.body;
  if (name) {
    await pool.query("INSERT INTO cod_accounts (name) VALUES ($1)", [name.trim()]);
  }
  res.redirect('/cod-portal');
});

app.post('/cod-entries/create', requireAuth, async (req, res) => {
  const { account_id, amount, month, date, notes } = req.body;
  await pool.query(
    "INSERT INTO cod_entries (account_id, amount, month, date, notes) VALUES ($1, $2, $3, $4, $5)",
    [account_id, parseFloat(amount), month, date, notes]
  );
  res.redirect('/cod-portal');
});

// 3. Month-Wise Totals (Expenses vs. COD Received vs. Profit/Loss)
app.get('/monthly-totals', requireAuth, async (req, res) => {
  try {
    const query = `
      SELECT 
        months.month,
        COALESCE(exp.total_expenses, 0) AS total_expenses,
        COALESCE(cod.total_received, 0) AS total_received,
        (COALESCE(cod.total_received, 0) - COALESCE(exp.total_expenses, 0)) AS profit_loss
      FROM (
        SELECT month FROM expense_entries
        UNION
        SELECT month FROM cod_entries
      ) months
      LEFT JOIN (
        SELECT month, SUM(amount) AS total_expenses FROM expense_entries GROUP BY month
      ) exp ON months.month = exp.month
      LEFT JOIN (
        SELECT month, SUM(amount) AS total_received FROM cod_entries GROUP BY month
      ) cod ON months.month = cod.month
      ORDER BY months.month DESC
    `;
    const result = await pool.query(query);

    let overallExpenses = 0;
    let overallReceived = 0;

    result.rows.forEach(row => {
      overallExpenses += parseFloat(row.total_expenses);
      overallReceived += parseFloat(row.total_received);
    });

    res.render('monthly_totals', {
      monthlySummaries: result.rows,
      overallExpenses,
      overallReceived,
      overallProfitLoss: overallReceived - overallExpenses
    });
  } catch (err) {
    res.status(500).send("Error generating monthly totals: " + err.message);
  }
});

// Actions: Expense Account & Entry Creation
app.post('/accounts/create', requireAuth, async (req, res) => {
  const { name } = req.body;
  if (name) {
    await pool.query("INSERT INTO payment_accounts (name) VALUES ($1)", [name.trim()]);
  }
  res.redirect('/dashboard');
});

app.post('/entries/create', requireAuth, async (req, res) => {
  const { account_id, amount, month, date, notes } = req.body;
  await pool.query(
    "INSERT INTO expense_entries (account_id, amount, month, date, notes) VALUES ($1, $2, $3, $4, $5)",
    [account_id, parseFloat(amount), month, date, notes]
  );
  res.redirect('/dashboard');
});

// 4. Sub-page: Manage All Entries (Expenses AND COD Received)
app.get('/entries', requireAuth, async (req, res) => {
  try {
    const expenseAccountsRes = await pool.query("SELECT * FROM payment_accounts ORDER BY name ASC");
    const expenseEntriesRes = await pool.query(`
      SELECT e.id, e.account_id, e.amount, e.month, e.date, e.notes, p.name AS account_name
      FROM expense_entries e
      JOIN payment_accounts p ON e.account_id = p.id
      ORDER BY e.id DESC
    `);

    const codAccountsRes = await pool.query("SELECT * FROM cod_accounts ORDER BY name ASC");
    const codEntriesRes = await pool.query(`
      SELECT e.id, e.account_id, e.amount, e.month, e.date, e.notes, p.name AS account_name
      FROM cod_entries e
      JOIN cod_accounts p ON e.account_id = p.id
      ORDER BY e.id DESC
    `);

    res.render('entries', {
      accounts: expenseAccountsRes.rows,
      entries: expenseEntriesRes.rows,
      codAccounts: codAccountsRes.rows,
      codEntries: codEntriesRes.rows
    });
  } catch (err) {
    res.status(500).send("Error fetching entries: " + err.message);
  }
});

// Expense Actions
app.post('/entries/edit/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { account_id, amount, month, date, notes } = req.body;
  await pool.query(
    "UPDATE expense_entries SET account_id = $1, amount = $2, month = $3, date = $4, notes = $5 WHERE id = $6",
    [account_id, parseFloat(amount), month, date, notes, id]
  );
  res.redirect('/entries');
});

app.post('/entries/delete/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM expense_entries WHERE id = $1", [id]);
  res.redirect('/entries');
});

// COD Actions (Edit / Delete)
app.post('/cod-entries/edit/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { account_id, amount, month, date, notes } = req.body;
  await pool.query(
    "UPDATE cod_entries SET account_id = $1, amount = $2, month = $3, date = $4, notes = $5 WHERE id = $6",
    [account_id, parseFloat(amount), month, date, notes, id]
  );
  res.redirect('/entries');
});

app.post('/cod-entries/delete/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM cod_entries WHERE id = $1", [id]);
  res.redirect('/entries');
});

// Settings & Password Reset
app.get('/settings', requireAuth, (req, res) => res.render('settings', { message: null, error: null }));
app.post('/settings/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userRes = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
  const user = userRes.rows[0];
  if (user && bcrypt.compareSync(currentPassword, user.password)) {
    const newHash = bcrypt.hashSync(newPassword, 10);
    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [newHash, user.id]);
    res.render('settings', { message: 'Password updated successfully!', error: null });
  } else {
    res.render('settings', { message: null, error: 'Incorrect current password' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));