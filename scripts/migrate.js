#!/usr/bin/env node
/**
 * Migration script to import callsigns from the old qslgeneratorold directory
 * Run: node scripts/migrate.js /path/to/qslgeneratorold
 */

const fs = require('fs');
const path = require('path');

const SOURCE_DIR = process.argv[2] || '/home/oe8yml/qslgeneratorold';
const DATA_DIR = path.join(__dirname, '../data');
const CARDS_DIR = path.join(DATA_DIR, 'cards');
const CALLSIGNS_FILE = path.join(DATA_DIR, 'callsigns.json');

// Default text positions (from oe8cni.htm)
const DEFAULT_POSITIONS = {
  callsign: { x: 3368, y: 2026 },
  utcDateTime: { x: 2623, y: 2499 },
  frequency: { x: 3398, y: 2499 },
  mode: { x: 3906, y: 2499 },
  rst: { x: 4353, y: 2499 },
  additional: { x: 2027, y: 2760 }
};

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CARDS_DIR)) fs.mkdirSync(CARDS_DIR, { recursive: true });

// Load existing callsigns
let callsignsData = { callsigns: [] };
if (fs.existsSync(CALLSIGNS_FILE)) {
  callsignsData = JSON.parse(fs.readFileSync(CALLSIGNS_FILE, 'utf8'));
}

// Get all directories in source
const entries = fs.readdirSync(SOURCE_DIR, { withFileTypes: true });
const callsignDirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));

console.log(`Found ${callsignDirs.length} potential callsign directories\n`);

let migrated = 0;
let skipped = 0;

for (const dir of callsignDirs) {
  const sourcePath = path.join(SOURCE_DIR, dir.name);

  // Extract callsign from directory name (format: callsign_hash)
  const callsignMatch = dir.name.match(/^([a-z0-9]+)_/i);
  if (!callsignMatch) {
    // Try without underscore (like oe0test)
    if (!dir.name.match(/^[a-z0-9]+$/i)) {
      console.log(`Skipping ${dir.name} - invalid format`);
      skipped++;
      continue;
    }
  }

  const callsignId = callsignMatch ? callsignMatch[1].toLowerCase() : dir.name.toLowerCase();

  // Check if card.png exists (or similar)
  const cardFiles = fs.readdirSync(sourcePath).filter(f =>
    f.toLowerCase().includes('card') && f.endsWith('.png')
  );

  if (cardFiles.length === 0) {
    console.log(`Skipping ${dir.name} - no card template found`);
    skipped++;
    continue;
  }

  // Check if already exists
  if (callsignsData.callsigns.find(c => c.id === callsignId)) {
    console.log(`Skipping ${callsignId} - already exists`);
    skipped++;
    continue;
  }

  console.log(`Migrating ${callsignId}...`);

  // Create destination directory
  const destPath = path.join(CARDS_DIR, callsignId);
  const bgDestPath = path.join(destPath, 'backgrounds');
  if (!fs.existsSync(bgDestPath)) {
    fs.mkdirSync(bgDestPath, { recursive: true });
  }

  // Copy card template (use first found)
  const cardSource = path.join(sourcePath, cardFiles[0]);
  const cardDest = path.join(destPath, 'card.png');
  fs.copyFileSync(cardSource, cardDest);
  console.log(`  - Copied card template: ${cardFiles[0]}`);

  // Copy backgrounds
  const bgSourcePath = path.join(sourcePath, 'background');
  const bgSourcePath2 = path.join(sourcePath, 'backgrounds');
  const actualBgPath = fs.existsSync(bgSourcePath) ? bgSourcePath :
                       fs.existsSync(bgSourcePath2) ? bgSourcePath2 : null;

  let bgCount = 0;
  if (actualBgPath) {
    const bgFiles = fs.readdirSync(actualBgPath).filter(f =>
      /\.(jpg|jpeg|png|gif|webp)$/i.test(f)
    );

    for (const bgFile of bgFiles) {
      const bgSrc = path.join(actualBgPath, bgFile);
      const bgDst = path.join(bgDestPath, bgFile.toLowerCase());
      fs.copyFileSync(bgSrc, bgDst);
      bgCount++;
    }
    console.log(`  - Copied ${bgCount} backgrounds`);
  }

  // Add to callsigns.json
  callsignsData.callsigns.push({
    id: callsignId,
    name: callsignId.toUpperCase(),
    qrzLink: `https://www.qrz.com/db/${callsignId.toUpperCase()}`,
    textPositions: DEFAULT_POSITIONS,
    createdAt: new Date().toISOString(),
    migratedFrom: dir.name
  });

  migrated++;
  console.log(`  - Done!\n`);
}

// Save callsigns.json
fs.writeFileSync(CALLSIGNS_FILE, JSON.stringify(callsignsData, null, 2));

console.log(`\n========================================`);
console.log(`Migration complete!`);
console.log(`  Migrated: ${migrated}`);
console.log(`  Skipped: ${skipped}`);
console.log(`  Total callsigns: ${callsignsData.callsigns.length}`);
console.log(`========================================\n`);
