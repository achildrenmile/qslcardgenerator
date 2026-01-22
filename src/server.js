const express = require('express');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3400;
const SALT_ROUNDS = 12;

// Paths
const DATA_DIR = path.join(__dirname, '../data');
const CARDS_DIR = path.join(DATA_DIR, 'cards');
const CALLSIGNS_FILE = path.join(DATA_DIR, 'callsigns.json');
const DB_FILE = path.join(DATA_DIR, 'users.db');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CARDS_DIR)) fs.mkdirSync(CARDS_DIR, { recursive: true });

// Initialize callsigns.json if not exists
if (!fs.existsSync(CALLSIGNS_FILE)) {
  fs.writeFileSync(CALLSIGNS_FILE, JSON.stringify({ callsigns: [] }, null, 2));
}

// Initialize SQLite database
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

// Create users table
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

  CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
  CREATE INDEX IF NOT EXISTS idx_users_callsign ON users(callsign);

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
    user_id INTEGER,
    username TEXT,
    callsign TEXT,
    action TEXT NOT NULL,
    details TEXT,
    ip_address TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
  CREATE INDEX IF NOT EXISTS idx_audit_callsign ON audit_log(callsign);
`);

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Parse JSON bodies
app.use(express.json());

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per 15 min
  message: { error: 'Too many login attempts, try again later' }
});

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const callsign = req.params.callsign.toLowerCase();
    const type = req.params.type;
    let dir;

    if (type === 'card') {
      dir = path.join(CARDS_DIR, callsign);
    } else {
      dir = path.join(CARDS_DIR, callsign, 'backgrounds');
    }

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    if (req.params.type === 'card') {
      cb(null, 'card.png');
    } else {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
      cb(null, safeName);
    }
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only images allowed'), false);
    }
  }
});

// ============================================
// Helper functions
// ============================================

function loadCallsigns() {
  try {
    return JSON.parse(fs.readFileSync(CALLSIGNS_FILE, 'utf8'));
  } catch {
    return { callsigns: [] };
  }
}

function saveCallsigns(data) {
  fs.writeFileSync(CALLSIGNS_FILE, JSON.stringify(data, null, 2));
}

function getCallsignConfig(callsign) {
  const data = loadCallsigns();
  return data.callsigns.find(c => c.id.toLowerCase() === callsign.toLowerCase());
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createSession(userId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  return token;
}

function validateSession(token) {
  if (!token) return null;

  const session = db.prepare(`
    SELECT s.*, u.username, u.callsign, u.is_admin
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).get(token);

  return session;
}

function cleanExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}

// Clean expired sessions periodically
setInterval(cleanExpiredSessions, 60 * 60 * 1000); // Every hour

// Audit logging
function logAudit(req, action, details = null) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const userId = req.user?.user_id || null;
  const username = req.user?.username || null;
  const callsign = req.user?.callsign || req.params?.callsign || null;

  db.prepare(`
    INSERT INTO audit_log (user_id, username, callsign, action, details, ip_address)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, username, callsign, action, details, ip);
}

// ============================================
// Authentication middleware
// ============================================

function requireAuth(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  const session = validateSession(token);

  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.user = session;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function requireCallsignAccess(req, res, next) {
  const targetCallsign = req.params.callsign?.toLowerCase();

  // Admins can access all callsigns
  if (req.user.is_admin) {
    return next();
  }

  // Users can only access their own callsign
  if (req.user.callsign?.toLowerCase() !== targetCallsign) {
    return res.status(404).json({ error: 'Not found' });
  }

  next();
}

// ============================================
// Health check endpoint
// ============================================

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// Static files
// ============================================

app.use(express.static(path.join(__dirname, '../public')));
// Note: /cards is NOT served statically - protected endpoints below

// ============================================
// Public API Routes (limited)
// ============================================

// Get specific callsign configuration (used by admin)
app.get('/api/callsigns/:callsign', apiLimiter, (req, res) => {
  const callsign = req.params.callsign.toLowerCase();
  const config = getCallsignConfig(callsign);

  if (!config) {
    return res.status(404).json({ error: 'Callsign not found' });
  }

  res.json(config);
});

// Get backgrounds for a callsign
app.get('/api/callsigns/:callsign/backgrounds', apiLimiter, (req, res) => {
  const callsign = req.params.callsign.toLowerCase();
  const bgDir = path.join(CARDS_DIR, callsign, 'backgrounds');

  if (!fs.existsSync(bgDir)) {
    return res.json([]);
  }

  try {
    const files = fs.readdirSync(bgDir)
      .filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f))
      .map(f => {
        const name = path.parse(f).name;
        const displayName = name
          .replace(/[_-]/g, ' ')
          .replace(/\d+$/, m => ' ' + m)
          .split(' ')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ')
          .trim();
        return { filename: f, displayName };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    res.json(files);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list backgrounds' });
  }
});

// ============================================
// Authentication API
// ============================================

// Login
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Update last login
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(new Date().toISOString(), user.id);

  const token = createSession(user.id);

  res.json({
    token,
    user: {
      username: user.username,
      callsign: user.callsign,
      isAdmin: !!user.is_admin
    }
  });
});

// Logout
app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ success: true });
});

// Get current user
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    username: req.user.username,
    callsign: req.user.callsign,
    isAdmin: !!req.user.is_admin
  });
});

// Change password
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password required' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.user_id);
  const valid = await bcrypt.compare(currentPassword, user.password_hash);

  if (!valid) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);

  // Invalidate all sessions except current
  const token = req.headers['authorization']?.replace('Bearer ', '');
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(user.id, token);

  res.json({ success: true });
});

// ============================================
// User Management API (for own callsign)
// ============================================

// Get own callsign config
app.get('/api/manage/callsign', requireAuth, (req, res) => {
  if (!req.user.callsign) {
    return res.status(403).json({ error: 'No callsign assigned to your account' });
  }

  const config = getCallsignConfig(req.user.callsign);
  if (!config) {
    return res.status(404).json({ error: 'Callsign not found' });
  }

  res.json(config);
});

// Get own backgrounds
app.get('/api/manage/backgrounds', requireAuth, (req, res) => {
  if (!req.user.callsign) {
    return res.status(403).json({ error: 'No callsign assigned to your account' });
  }

  const bgDir = path.join(CARDS_DIR, req.user.callsign.toLowerCase(), 'backgrounds');

  if (!fs.existsSync(bgDir)) {
    return res.json([]);
  }

  try {
    const files = fs.readdirSync(bgDir)
      .filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f))
      .map(f => {
        const name = path.parse(f).name;
        const displayName = name
          .replace(/[_-]/g, ' ')
          .replace(/\d+$/, m => ' ' + m)
          .split(' ')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ')
          .trim();
        return { filename: f, displayName };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    res.json(files);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list backgrounds' });
  }
});

// Update own callsign config
app.put('/api/manage/callsign', requireAuth, (req, res) => {
  if (!req.user.callsign) {
    return res.status(403).json({ error: 'No callsign assigned to your account' });
  }

  const callsign = req.user.callsign.toLowerCase();
  const data = loadCallsigns();
  const index = data.callsigns.findIndex(c => c.id.toLowerCase() === callsign);

  if (index === -1) {
    return res.status(404).json({ error: 'Callsign not found' });
  }

  const { name, qrzLink, textPositions } = req.body;

  if (name) data.callsigns[index].name = name;
  if (qrzLink) data.callsigns[index].qrzLink = qrzLink;
  if (textPositions) data.callsigns[index].textPositions = textPositions;
  data.callsigns[index].updatedAt = new Date().toISOString();

  saveCallsigns(data);
  res.json(data.callsigns[index]);
});

// Upload card for own callsign
app.post('/api/manage/upload/:type', requireAuth, (req, res, next) => {
  if (!req.user.callsign) {
    return res.status(403).json({ error: 'No callsign assigned to your account' });
  }
  req.params.callsign = req.user.callsign;
  next();
}, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({
    success: true,
    filename: req.file.filename,
    path: `/cards/${req.user.callsign}/${req.params.type === 'card' ? 'card.png' : 'backgrounds/' + req.file.filename}`
  });
});

// Delete own background
app.delete('/api/manage/backgrounds/:filename', requireAuth, (req, res) => {
  if (!req.user.callsign) {
    return res.status(403).json({ error: 'No callsign assigned to your account' });
  }

  const filename = req.params.filename;
  const filePath = path.join(CARDS_DIR, req.user.callsign.toLowerCase(), 'backgrounds', filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  fs.unlinkSync(filePath);
  res.json({ success: true });
});

// ============================================
// Admin API Routes
// ============================================

// List all users (admin only)
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT id, username, callsign, is_admin, created_at, last_login
    FROM users ORDER BY username
  `).all();

  res.json(users.map(u => ({
    ...u,
    isAdmin: !!u.is_admin
  })));
});

// Create user (admin only)
app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, callsign, isAdmin } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  // If callsign specified, verify it exists
  if (callsign) {
    const csConfig = getCallsignConfig(callsign);
    if (!csConfig) {
      return res.status(400).json({ error: 'Callsign does not exist. Create it first.' });
    }

    // Check if callsign is already assigned
    const assigned = db.prepare('SELECT id FROM users WHERE callsign = ?').get(callsign.toLowerCase());
    if (assigned) {
      return res.status(409).json({ error: 'Callsign already assigned to another user' });
    }
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = db.prepare(`
    INSERT INTO users (username, password_hash, callsign, is_admin)
    VALUES (?, ?, ?, ?)
  `).run(username.toLowerCase(), hash, callsign?.toLowerCase() || null, isAdmin ? 1 : 0);

  res.status(201).json({
    id: result.lastInsertRowid,
    username: username.toLowerCase(),
    callsign: callsign?.toLowerCase() || null,
    isAdmin: !!isAdmin
  });
});

// Update user (admin only)
app.put('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.id);
  const { password, callsign, isAdmin } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (password) {
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
  }

  if (callsign !== undefined) {
    if (callsign) {
      // Check if callsign is assigned to another user
      const assigned = db.prepare('SELECT id FROM users WHERE callsign = ? AND id != ?').get(callsign.toLowerCase(), userId);
      if (assigned) {
        return res.status(409).json({ error: 'Callsign already assigned to another user' });
      }
    }
    db.prepare('UPDATE users SET callsign = ? WHERE id = ?').run(callsign?.toLowerCase() || null, userId);
  }

  if (isAdmin !== undefined) {
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, userId);
  }

  const updated = db.prepare('SELECT id, username, callsign, is_admin FROM users WHERE id = ?').get(userId);
  res.json({ ...updated, isAdmin: !!updated.is_admin });
});

// Delete user (admin only)
app.delete('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id);

  // Prevent self-deletion
  if (userId === req.user.user_id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  const result = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Delete user sessions
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);

  res.json({ success: true });
});

// List all callsigns (admin only)
app.get('/api/admin/callsigns', requireAuth, requireAdmin, (req, res) => {
  const data = loadCallsigns();
  res.json(data.callsigns.map(c => ({
    id: c.id,
    name: c.name,
    qrzLink: c.qrzLink
  })));
});

// Create callsign (admin only)
app.post('/api/admin/callsigns', requireAuth, requireAdmin, (req, res) => {
  const { id, name, qrzLink, textPositions } = req.body;

  if (!id || !name) {
    return res.status(400).json({ error: 'id and name are required' });
  }

  const data = loadCallsigns();
  const callsignId = id.toLowerCase();

  if (data.callsigns.find(c => c.id.toLowerCase() === callsignId)) {
    return res.status(409).json({ error: 'Callsign already exists' });
  }

  const defaultPositions = {
    callsign: { x: 3368, y: 2026 },
    utcDateTime: { x: 2623, y: 2499 },
    frequency: { x: 3398, y: 2499 },
    mode: { x: 3906, y: 2499 },
    rst: { x: 4353, y: 2499 },
    additional: { x: 2027, y: 2760 }
  };

  const newCallsign = {
    id: callsignId,
    name,
    qrzLink: qrzLink || `https://www.qrz.com/db/${id.toUpperCase()}`,
    textPositions: textPositions || defaultPositions,
    createdAt: new Date().toISOString()
  };

  data.callsigns.push(newCallsign);
  saveCallsigns(data);

  const callsignDir = path.join(CARDS_DIR, callsignId);
  const bgDir = path.join(callsignDir, 'backgrounds');
  if (!fs.existsSync(bgDir)) {
    fs.mkdirSync(bgDir, { recursive: true });
  }

  res.status(201).json(newCallsign);
});

// Update callsign (admin only)
app.put('/api/admin/callsigns/:callsign', requireAuth, requireAdmin, (req, res) => {
  const callsign = req.params.callsign.toLowerCase();
  const data = loadCallsigns();
  const index = data.callsigns.findIndex(c => c.id.toLowerCase() === callsign);

  if (index === -1) {
    return res.status(404).json({ error: 'Callsign not found' });
  }

  const { name, qrzLink, textPositions } = req.body;

  if (name) data.callsigns[index].name = name;
  if (qrzLink) data.callsigns[index].qrzLink = qrzLink;
  if (textPositions) data.callsigns[index].textPositions = textPositions;
  data.callsigns[index].updatedAt = new Date().toISOString();

  saveCallsigns(data);
  res.json(data.callsigns[index]);
});

// Delete callsign (admin only)
app.delete('/api/admin/callsigns/:callsign', requireAuth, requireAdmin, (req, res) => {
  const callsign = req.params.callsign.toLowerCase();
  const data = loadCallsigns();
  const index = data.callsigns.findIndex(c => c.id.toLowerCase() === callsign);

  if (index === -1) {
    return res.status(404).json({ error: 'Callsign not found' });
  }

  data.callsigns.splice(index, 1);
  saveCallsigns(data);

  res.json({ success: true });
});

// Upload for any callsign (admin only)
app.post('/api/admin/callsigns/:callsign/upload/:type', requireAuth, requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({
    success: true,
    filename: req.file.filename,
    path: `/cards/${req.params.callsign}/${req.params.type === 'card' ? 'card.png' : 'backgrounds/' + req.file.filename}`
  });
});

// Delete background (admin only)
app.delete('/api/admin/callsigns/:callsign/backgrounds/:filename', requireAuth, requireAdmin, (req, res) => {
  const callsign = req.params.callsign.toLowerCase();
  const filename = req.params.filename;
  const filePath = path.join(CARDS_DIR, callsign, 'backgrounds', filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  fs.unlinkSync(filePath);
  res.json({ success: true });
});

// ============================================
// Generator Access API (protected)
// ============================================

// Verify generator access - returns config if authorized
app.get('/api/generator/:callsign/access', requireAuth, (req, res) => {
  const callsign = req.params.callsign.toLowerCase();

  // Check if user owns this callsign or is admin
  if (!req.user.is_admin && req.user.callsign?.toLowerCase() !== callsign) {
    logAudit(req, 'generator_access_denied', `Attempted access to ${callsign}`);
    return res.status(404).json({ error: 'Not found' });
  }

  const config = getCallsignConfig(callsign);
  if (!config) {
    return res.status(404).json({ error: 'Callsign not found' });
  }

  logAudit(req, 'generator_access', `Accessed generator for ${callsign}`);
  res.json(config);
});

// Get generator backgrounds (protected)
app.get('/api/generator/:callsign/backgrounds', requireAuth, (req, res) => {
  const callsign = req.params.callsign.toLowerCase();

  // Check if user owns this callsign or is admin
  if (!req.user.is_admin && req.user.callsign?.toLowerCase() !== callsign) {
    return res.status(404).json({ error: 'Not found' });
  }

  const bgDir = path.join(CARDS_DIR, callsign, 'backgrounds');
  if (!fs.existsSync(bgDir)) {
    return res.json([]);
  }

  try {
    const files = fs.readdirSync(bgDir)
      .filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f))
      .map(f => {
        const name = path.parse(f).name;
        const displayName = name
          .replace(/[_-]/g, ' ')
          .replace(/\d+$/, m => ' ' + m)
          .split(' ')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ')
          .trim();
        return { filename: f, displayName };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    res.json(files);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list backgrounds' });
  }
});

// Log card download
app.post('/api/generator/:callsign/download', requireAuth, (req, res) => {
  const callsign = req.params.callsign.toLowerCase();
  const { targetCallsign } = req.body;

  // Check if user owns this callsign or is admin
  if (!req.user.is_admin && req.user.callsign?.toLowerCase() !== callsign) {
    return res.status(404).json({ error: 'Not found' });
  }

  logAudit(req, 'card_generated', `Generated card for ${targetCallsign || 'unknown'}`);
  res.json({ success: true });
});

// Get audit log (admin only)
app.get('/api/admin/audit', requireAuth, requireAdmin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
  const logs = db.prepare(`
    SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?
  `).all(limit);
  res.json(logs);
});

// ============================================
// Protected Card Image Routes
// ============================================

// Serve card template (protected)
app.get('/api/cards/:callsign/card.png', requireAuth, (req, res) => {
  const callsign = req.params.callsign.toLowerCase();

  // Check ownership (user owns callsign or is admin)
  if (!req.user.is_admin && req.user.callsign?.toLowerCase() !== callsign) {
    return res.status(404).json({ error: 'Not found' });
  }

  const filePath = path.join(CARDS_DIR, callsign, 'card.png');
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Card template not found' });
  }

  res.sendFile(filePath);
});

// Serve background image (protected)
app.get('/api/cards/:callsign/backgrounds/:filename', requireAuth, (req, res) => {
  const callsign = req.params.callsign.toLowerCase();
  const filename = req.params.filename;

  // Check ownership (user owns callsign or is admin)
  if (!req.user.is_admin && req.user.callsign?.toLowerCase() !== callsign) {
    return res.status(404).json({ error: 'Not found' });
  }

  // Sanitize filename to prevent directory traversal
  const sanitizedFilename = path.basename(filename);
  const filePath = path.join(CARDS_DIR, callsign, 'backgrounds', sanitizedFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Background not found' });
  }

  res.sendFile(filePath);
});

// ============================================
// Dynamic callsign routes
// ============================================

app.get('/:callsign', (req, res) => {
  const callsign = req.params.callsign.toLowerCase();

  // Skip if it's a known static file
  if (['admin.html', 'index.html', '404.html', 'generator.html', 'demo.html'].includes(req.params.callsign)) {
    return res.sendFile(path.join(__dirname, '../public', req.params.callsign));
  }

  // Handle demo route - serves public demo without authentication
  if (callsign === 'demo') {
    return res.sendFile(path.join(__dirname, '../public/demo.html'));
  }

  const config = getCallsignConfig(callsign);

  if (!config) {
    return res.status(404).sendFile(path.join(__dirname, '../public/404.html'));
  }

  res.sendFile(path.join(__dirname, '../public/generator.html'));
});

// ============================================
// Start Server
// ============================================

app.listen(PORT, () => {
  console.log(`QSL Card Generator running on http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api/callsigns`);

  const data = loadCallsigns();
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  console.log(`Loaded ${data.callsigns.length} callsigns, ${userCount} users`);

  if (userCount === 0) {
    console.log('\n⚠️  No users found! Run: npm run init-admin to create an admin user\n');
  }
});
