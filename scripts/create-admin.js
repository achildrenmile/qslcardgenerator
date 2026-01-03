#!/usr/bin/env node

const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

const SALT_ROUNDS = 12;
const DATA_DIR = path.join(__dirname, '../data');
const DB_FILE = path.join(DATA_DIR, 'users.db');

// Get args
const username = process.argv[2];
const password = process.argv[3];

if (!username || !password) {
  console.log('Usage: node create-admin.js <username> <password>');
  process.exit(1);
}

if (password.length < 8) {
  console.log('Password must be at least 8 characters');
  process.exit(1);
}

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

// Check if username exists
const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase());
if (existing) {
  console.log('Username already exists!');
  process.exit(1);
}

// Create admin user
const hash = bcrypt.hashSync(password, SALT_ROUNDS);
db.prepare(`
  INSERT INTO users (username, password_hash, is_admin)
  VALUES (?, ?, 1)
`).run(username.toLowerCase(), hash);

console.log(`Admin user '${username}' created successfully!`);
db.close();
