#!/usr/bin/env node

const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const SALT_ROUNDS = 12;
const DATA_DIR = path.join(__dirname, '../data');
const DB_FILE = path.join(DATA_DIR, 'users.db');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize database
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

// Create tables if not exist
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    callsign TEXT,
    is_admin INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_login TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise(resolve => {
    rl.question(prompt, resolve);
  });
}

async function main() {
  console.log('\n=== QSL Card Generator - Admin Setup ===\n');

  // Check existing admins
  const existingAdmins = db.prepare('SELECT username FROM users WHERE is_admin = 1').all();
  if (existingAdmins.length > 0) {
    console.log('Existing admin users:');
    existingAdmins.forEach(a => console.log(`  - ${a.username}`));
    console.log('');
  }

  const username = await question('Enter admin username: ');
  if (!username.trim()) {
    console.log('Username cannot be empty');
    process.exit(1);
  }

  // Check if username exists
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase());
  if (existing) {
    console.log('Username already exists!');
    process.exit(1);
  }

  const password = await question('Enter admin password (min 8 chars): ');
  if (password.length < 8) {
    console.log('Password must be at least 8 characters');
    process.exit(1);
  }

  const confirmPassword = await question('Confirm password: ');
  if (password !== confirmPassword) {
    console.log('Passwords do not match');
    process.exit(1);
  }

  // Create admin user
  console.log('\nCreating admin user...');
  const hash = await bcrypt.hash(password, SALT_ROUNDS);

  db.prepare(`
    INSERT INTO users (username, password_hash, is_admin)
    VALUES (?, ?, 1)
  `).run(username.toLowerCase(), hash);

  console.log(`\nAdmin user '${username}' created successfully!`);
  console.log('You can now log in at /admin.html\n');

  rl.close();
  db.close();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
