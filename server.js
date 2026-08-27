const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const db = require('./database');
const path = require('path');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');

app.use(session({
  secret: 'sf_portal_secret_key',
  resave: false,
  saveUninitialized: false
}));

// Auth Middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.redirect('/login');
}

// Login Routes
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
    if (user && bcrypt.compareSync(password, user.password)) {
      req.session.userId = user.id;
      req.session.username = user.username;
      return res.redirect('/dashboard');
    }
    res.render('login', { error: 'Invalid username or password' });
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Dashboard Route (Main Portal Breakdown View)
app.get('/dashboard', requireAuth, (req, res) => {
  const currentMonth = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
  const selectedMonth = req.query.month || currentMonth;

  db.all("SELECT * FROM payment_accounts ORDER BY name ASC", [], (err, accounts) => {
    db.all("SELECT DISTINCT month FROM expense_entries ORDER BY date DESC", [], (err, monthRows) => {
      let availableMonths = monthRows ? monthRows.map(m => m.month) : [];
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
        query += ` WHERE e.month = ?`;
        params.push(selectedMonth);
      }
      query += ` ORDER BY e.id DESC`;

      db.all(query, params, (err, entries) => {
        const summaryMap = {};
        let grandTotal = 0;

        if (entries) {
          entries.forEach(entry => {
            grandTotal += entry.amount;
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
            summaryMap[key].total_amount += entry.amount;
            summaryMap[key].sub_amounts.push(entry.amount);
          });
        }

        res.render('dashboard', {
          activePortal: 'sf-expenses',
          accounts: accounts || [],
          entries: entries || [],
          summaryList: Object.values(summaryMap),
          grandTotal,
          availableMonths,
          selectedMonth,
          defaultMonth: currentMonth,
          defaultDate: new Date().toISOString().split('T')[0]
        });
      });
    });
  });
});

// Action: Create Payment Account
app.post('/accounts/create', requireAuth, (req, res) => {
  const { name } = req.body;
  if (name) {
    db.run("INSERT INTO payment_accounts (name) VALUES (?)", [name.trim()], () => {
      res.redirect('/dashboard');
    });
  } else {
    res.redirect('/dashboard');
  }
});

// Action: Create Expense Entry
app.post('/entries/create', requireAuth, (req, res) => {
  const { account_id, amount, month, date, notes } = req.body;
  db.run(
    "INSERT INTO expense_entries (account_id, amount, month, date, notes) VALUES (?, ?, ?, ?, ?)",
    [account_id, parseFloat(amount), month, date, notes],
    () => res.redirect('/dashboard')
  );
});

// Sub-page: Manage All Entries (View, Edit & Delete)
app.get('/entries', requireAuth, (req, res) => {
  db.all("SELECT * FROM payment_accounts ORDER BY name ASC", [], (err, accounts) => {
    const query = `
      SELECT e.id, e.account_id, e.amount, e.month, e.date, e.notes, p.name AS account_name
      FROM expense_entries e
      JOIN payment_accounts p ON e.account_id = p.id
      ORDER BY e.id DESC
    `;
    db.all(query, [], (err, entries) => {
      res.render('entries', {
        accounts: accounts || [],
        entries: entries || []
      });
    });
  });
});

// Action: Modify/Edit Entry
app.post('/entries/edit/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const { account_id, amount, month, date, notes } = req.body;
  db.run(
    "UPDATE expense_entries SET account_id = ?, amount = ?, month = ?, date = ?, notes = ? WHERE id = ?",
    [account_id, parseFloat(amount), month, date, notes, id],
    () => res.redirect('/entries')
  );
});

// Action: Delete Entry
app.post('/entries/delete/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM expense_entries WHERE id = ?", [id], () => {
    res.redirect('/entries');
  });
});

// Settings & Password Reset
app.get('/settings', requireAuth, (req, res) => res.render('settings', { message: null, error: null }));
app.post('/settings/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  db.get("SELECT * FROM users WHERE id = ?", [req.session.userId], (err, user) => {
    if (user && bcrypt.compareSync(currentPassword, user.password)) {
      const newHash = bcrypt.hashSync(newPassword, 10);
      db.run("UPDATE users SET password = ? WHERE id = ?", [newHash, user.id], () => {
        res.render('settings', { message: 'Password updated successfully!', error: null });
      });
    } else {
      res.render('settings', { message: null, error: 'Incorrect current password' });
    }
  });
});

// Replace static port 3000 with process.env.PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));