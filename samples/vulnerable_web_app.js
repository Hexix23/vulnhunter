// Sample vulnerable web application for testing VulnHunter
// This code contains intentional vulnerabilities for demonstration

const express = require('express');
const app = express();

// VULNERABILITY 1: SQL Injection
app.get('/user/:id', (req, res) => {
    const userId = req.params.id;
    // Directly concatenating user input into SQL query
    const query = `SELECT * FROM users WHERE id = ${userId}`;
    db.query(query, (err, result) => {
        if (err) res.send('Error');
        res.json(result);
    });
});

// VULNERABILITY 2: Cross-Site Scripting (XSS)
app.get('/search', (req, res) => {
    const searchTerm = req.query.q;
    // User input reflected without sanitization
    res.send(`<h1>Results for: ${searchTerm}</h1>`);
});

// VULNERABILITY 3: IDOR (Insecure Direct Object Reference)
app.get('/profile/:userId', (req, res) => {
    const userId = req.params.userId;
    const currentUser = req.user; // Assume authenticated

    // No check that currentUser can access userId's profile
    db.query('SELECT * FROM profiles WHERE user_id = ?', [userId], (err, result) => {
        res.json(result);
    });
});

// VULNERABILITY 4: Insecure Deserialization
app.post('/restore', (req, res) => {
    const data = req.body.serialized;
    // Dangerous deserialization without validation
    try {
        const obj = JSON.parse(data);
        // Or worse: eval(data)
        res.json({ success: true });
    } catch (e) {
        res.status(400).send('Invalid data');
    }
});

// VULNERABILITY 5: Missing CSRF Protection
app.post('/transfer', (req, res) => {
    const amount = req.body.amount;
    const recipient = req.body.recipient;

    // No CSRF token validation
    db.query('UPDATE accounts SET balance = balance - ? WHERE user_id = ?',
             [amount, req.user.id]);
    db.query('UPDATE accounts SET balance = balance + ? WHERE user_id = ?',
             [amount, recipient]);

    res.json({ success: true });
});

// VULNERABILITY 6: SSRF (Server-Side Request Forgery)
app.post('/fetch-url', (req, res) => {
    const url = req.body.url;
    // No validation - could fetch internal services
    fetch(url).then(r => r.text()).then(data => {
        res.send(data);
    });
});

// VULNERABILITY 7: Hardcoded Credentials
const API_KEY = 'sk-1234567890abcdef';
const DB_PASSWORD = 'admin123';

// VULNERABILITY 8: Path Traversal
app.get('/download/:file', (req, res) => {
    const file = req.params.file;
    // No validation - could access /etc/passwd or other files
    res.download(`./uploads/${file}`);
});

app.listen(3000, () => {
    console.log('App running on port 3000');
});
