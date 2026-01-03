const express = require('express');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3400;

// Paths
const DATA_DIR = path.join(__dirname, '../data');
const CARDS_DIR = path.join(DATA_DIR, 'cards');
const CALLSIGNS_FILE = path.join(DATA_DIR, 'callsigns.json');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CARDS_DIR)) fs.mkdirSync(CARDS_DIR, { recursive: true });

// Initialize callsigns.json if not exists
if (!fs.existsSync(CALLSIGNS_FILE)) {
  fs.writeFileSync(CALLSIGNS_FILE, JSON.stringify({ callsigns: [] }, null, 2));
}

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

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const callsign = req.params.callsign.toLowerCase();
    const type = req.params.type; // 'card' or 'background'
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
      // Sanitize filename
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
      cb(null, safeName);
    }
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only images allowed'), false);
    }
  }
});

// Helper functions
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

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Serve card assets (card.png, backgrounds)
app.use('/cards', express.static(CARDS_DIR));

// ============================================
// API Routes
// ============================================

// List all callsigns
app.get('/api/callsigns', apiLimiter, (req, res) => {
  const data = loadCallsigns();
  const publicData = data.callsigns.map(c => ({
    id: c.id,
    name: c.name,
    qrzLink: c.qrzLink
  }));
  res.json(publicData);
});

// Get specific callsign configuration
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
// Admin API Routes (Simple token auth)
// ============================================
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'changeme';

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Create new callsign
app.post('/api/admin/callsigns', adminAuth, (req, res) => {
  const { id, name, qrzLink, textPositions } = req.body;

  if (!id || !name) {
    return res.status(400).json({ error: 'id and name are required' });
  }

  const data = loadCallsigns();
  const callsignId = id.toLowerCase();

  if (data.callsigns.find(c => c.id.toLowerCase() === callsignId)) {
    return res.status(409).json({ error: 'Callsign already exists' });
  }

  // Default text positions (can be customized per callsign)
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

  // Create directory structure
  const callsignDir = path.join(CARDS_DIR, callsignId);
  const bgDir = path.join(callsignDir, 'backgrounds');
  if (!fs.existsSync(bgDir)) {
    fs.mkdirSync(bgDir, { recursive: true });
  }

  res.status(201).json(newCallsign);
});

// Update callsign
app.put('/api/admin/callsigns/:callsign', adminAuth, (req, res) => {
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

// Delete callsign
app.delete('/api/admin/callsigns/:callsign', adminAuth, (req, res) => {
  const callsign = req.params.callsign.toLowerCase();
  const data = loadCallsigns();
  const index = data.callsigns.findIndex(c => c.id.toLowerCase() === callsign);

  if (index === -1) {
    return res.status(404).json({ error: 'Callsign not found' });
  }

  data.callsigns.splice(index, 1);
  saveCallsigns(data);

  // Optionally delete files (commented out for safety)
  // const callsignDir = path.join(CARDS_DIR, callsign);
  // if (fs.existsSync(callsignDir)) {
  //   fs.rmSync(callsignDir, { recursive: true });
  // }

  res.json({ success: true });
});

// Upload card template
app.post('/api/admin/callsigns/:callsign/upload/:type', adminAuth, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({
    success: true,
    filename: req.file.filename,
    path: `/cards/${req.params.callsign}/${req.params.type === 'card' ? 'card.png' : 'backgrounds/' + req.file.filename}`
  });
});

// Delete background
app.delete('/api/admin/callsigns/:callsign/backgrounds/:filename', adminAuth, (req, res) => {
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
// Dynamic callsign routes
// ============================================

// Serve the generator page for any callsign
app.get('/:callsign', (req, res) => {
  const callsign = req.params.callsign.toLowerCase();
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
  console.log(`Loaded ${data.callsigns.length} callsigns`);
});
