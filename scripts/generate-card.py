#!/usr/bin/env python3
"""
QSL Card Template Generator

Generates a card.png template for a callsign from a JSON config file.
The template contains the QSO data section layout, callsign text,
operator info, optional logo, and optional signature text.

Usage:
    python3 scripts/generate-card.py --config scripts/card-configs/oe8kks.json
    python3 scripts/generate-card.py --config scripts/card-configs/oe8kks.json --output /tmp/card.png
"""

import argparse
import glob
import json
import os
import sys
from datetime import datetime

from PIL import Image, ImageDraw, ImageFont

# --- Constants ---
CANVAS_W = 4837
CANVAS_H = 3078

# Default text positions (must match server.js defaults)
DEFAULT_TEXT_POSITIONS = {
    "callsign": {"x": 3368, "y": 2026},
    "utcDateTime": {"x": 2623, "y": 2499},
    "frequency": {"x": 3398, "y": 2499},
    "mode": {"x": 3906, "y": 2499},
    "rst": {"x": 4353, "y": 2499},
    "additional": {"x": 2027, "y": 2760},
}

# --- QSO Section Layout (fixed positions) ---
# Semi-transparent background for QSO section (right half, lower portion)
QSO_BG_RECT = (1900, 1580, 4720, 3000)
QSO_BG_COLOR = (255, 255, 255, 80)

# "QSO DATA" heading
QSO_HEADING_POS = (3310, 1650)
QSO_HEADING_FONT_SIZE = 150
QSO_HEADING_COLOR = (0, 0, 0, 255)

# "Your callsign" label box
CALLSIGN_LABEL_RECT = (2720, 1830, 3530, 1920)
CALLSIGN_LABEL_TEXT = "Your callsign"
CALLSIGN_LABEL_POS = (3125, 1875)
CALLSIGN_LABEL_FONT_SIZE = 60

# Callsign data entry area (white, higher alpha)
CALLSIGN_DATA_RECT = (2720, 1930, 3530, 2120)
CALLSIGN_DATA_COLOR = (255, 255, 255, 120)

# UTC DATE/TIME label box
UTC_LABEL_RECT = (2120, 2300, 2900, 2420)
UTC_LABEL_TEXT_LINE1 = "UTC DATE/TIME"
UTC_LABEL_TEXT_LINE2 = "DD.MM.YYYY HH:MM"
UTC_LABEL_POS = (2510, 2340)
UTC_LABEL_POS2 = (2510, 2390)
UTC_LABEL_FONT_SIZE = 55
UTC_LABEL_FONT_SIZE2 = 35

# Frequency label box
FREQ_LABEL_RECT = (2930, 2300, 3530, 2420)
FREQ_LABEL_TEXT = "Frequency MHz"
FREQ_LABEL_POS = (3230, 2360)
FREQ_LABEL_FONT_SIZE = 55

# Mode label box
MODE_LABEL_RECT = (3560, 2300, 4020, 2420)
MODE_LABEL_TEXT = "Mode"
MODE_LABEL_POS = (3790, 2360)
MODE_LABEL_FONT_SIZE = 55

# RST label box
RST_LABEL_RECT = (4050, 2300, 4510, 2420)
RST_LABEL_TEXT = "R-S-T"
RST_LABEL_POS = (4280, 2360)
RST_LABEL_FONT_SIZE = 55

# Data entry areas below labels (white, higher alpha)
UTC_DATA_RECT = (2120, 2430, 2900, 2620)
FREQ_DATA_RECT = (2930, 2430, 3530, 2620)
MODE_DATA_RECT = (3560, 2430, 4020, 2620)
RST_DATA_RECT = (4050, 2430, 4510, 2620)
DATA_ENTRY_COLOR = (255, 255, 255, 120)

# Remarks box (opaque white, left side of bottom)
REMARKS_RECT = (1900, 2700, 3300, 3000)
REMARKS_COLOR = (255, 255, 255, 200)

# Signature box (opaque white, right side of bottom)
SIGNATURE_RECT = (3350, 2700, 4720, 3000)
SIGNATURE_COLOR = (255, 255, 255, 200)

# --- Operator info section ---
OPERATOR_BG_RECT = (40, 1000, 1200, 1500)
OPERATOR_BG_COLOR = (255, 255, 255, 160)
OPERATOR_TEXT_X = 80
OPERATOR_TEXT_Y = 1040
OPERATOR_LINE_SPACING = 117
OPERATOR_FONT_SIZE = 86
OPERATOR_EMAIL_GAP = 40  # extra gap before email

# --- Callsign text (large, top right) ---
CALLSIGN_TEXT_X_RIGHT_MARGIN = 240  # from right edge
CALLSIGN_TEXT_Y = 62
CALLSIGN_FONT_SIZE = 370

# --- Logo position (top left) ---
LOGO_X = 80
LOGO_Y = 60

# --- Signature text position ---
SIGNATURE_TEXT_X = 4400
SIGNATURE_TEXT_Y = 2880
SIGNATURE_FONT_SIZE = 120


def find_font(name_patterns, style=""):
    """Find a font file by searching common locations."""
    search_dirs = []

    # Nix store (for nix-shell usage)
    nix_globs = glob.glob("/nix/store/*/share/fonts/truetype/")
    search_dirs.extend(nix_globs)

    # Standard Linux paths
    search_dirs.extend([
        "/usr/share/fonts/truetype/dejavu/",
        "/usr/share/fonts/truetype/freefont/",
        "/usr/share/fonts/truetype/",
        "/usr/share/fonts/TTF/",
        "/usr/share/fonts/",
    ])

    for d in search_dirs:
        for pattern in name_patterns:
            matches = glob.glob(os.path.join(d, "**", pattern), recursive=True)
            if matches:
                return matches[0]

    return None


def load_font(size, bold=False, italic=False, serif=False):
    """Load a font with the given properties, falling back gracefully."""
    if serif:
        if italic and bold:
            patterns = ["FreeSerifBoldItalic.ttf", "DejaVuSerif-BoldItalic.ttf"]
        elif italic:
            patterns = ["FreeSerifItalic.ttf", "DejaVuSerif-Italic.ttf"]
        elif bold:
            patterns = ["FreeSerifBold.ttf", "DejaVuSerif-Bold.ttf"]
        else:
            patterns = ["FreeSerif.ttf", "DejaVuSerif.ttf"]
    else:
        if bold and italic:
            patterns = ["DejaVuSans-BoldOblique.ttf", "FreeSansBoldOblique.ttf"]
        elif bold:
            patterns = ["DejaVuSans-Bold.ttf", "FreeSansBold.ttf"]
        elif italic:
            patterns = ["DejaVuSans-Oblique.ttf", "FreeSansOblique.ttf"]
        else:
            patterns = ["DejaVuSans.ttf", "FreeSans.ttf"]

    font_path = find_font(patterns)
    if font_path:
        return ImageFont.truetype(font_path, size)

    print(f"  Warning: Could not find TTF font, using Pillow default")
    return ImageFont.load_default()


def hex_to_rgba(hex_color, alpha=255):
    """Convert hex color string to RGBA tuple."""
    hex_color = hex_color.lstrip("#")
    r = int(hex_color[0:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    return (r, g, b, alpha)


def draw_qso_section(draw):
    """Draw the standard QSO data section (same for all cards)."""
    # 1. Semi-transparent background
    draw.rectangle(QSO_BG_RECT, fill=QSO_BG_COLOR)

    # 2. Data entry areas (white, semi-transparent)
    draw.rectangle(CALLSIGN_DATA_RECT, fill=DATA_ENTRY_COLOR)
    draw.rectangle(UTC_DATA_RECT, fill=DATA_ENTRY_COLOR)
    draw.rectangle(FREQ_DATA_RECT, fill=DATA_ENTRY_COLOR)
    draw.rectangle(MODE_DATA_RECT, fill=DATA_ENTRY_COLOR)
    draw.rectangle(RST_DATA_RECT, fill=DATA_ENTRY_COLOR)

    # 3. Remarks and Signature boxes (more opaque)
    draw.rectangle(REMARKS_RECT, fill=REMARKS_COLOR)
    draw.rectangle(SIGNATURE_RECT, fill=SIGNATURE_COLOR)

    # 4. Black label boxes
    draw.rectangle(CALLSIGN_LABEL_RECT, fill=(0, 0, 0, 255))
    draw.rectangle(UTC_LABEL_RECT, fill=(0, 0, 0, 255))
    draw.rectangle(FREQ_LABEL_RECT, fill=(0, 0, 0, 255))
    draw.rectangle(MODE_LABEL_RECT, fill=(0, 0, 0, 255))
    draw.rectangle(RST_LABEL_RECT, fill=(0, 0, 0, 255))

    # 5. White text inside label boxes
    label_font = load_font(CALLSIGN_LABEL_FONT_SIZE)
    utc_font_small = load_font(UTC_LABEL_FONT_SIZE2)
    label_font_main = load_font(UTC_LABEL_FONT_SIZE)

    draw.text(CALLSIGN_LABEL_POS, CALLSIGN_LABEL_TEXT, fill=(255, 255, 255, 255),
              font=label_font, anchor="mm")

    draw.text(UTC_LABEL_POS, UTC_LABEL_TEXT_LINE1, fill=(255, 255, 255, 255),
              font=label_font_main, anchor="mm")
    draw.text(UTC_LABEL_POS2, UTC_LABEL_TEXT_LINE2, fill=(255, 255, 255, 255),
              font=utc_font_small, anchor="mm")

    draw.text(FREQ_LABEL_POS, FREQ_LABEL_TEXT, fill=(255, 255, 255, 255),
              font=label_font_main, anchor="mm")
    draw.text(MODE_LABEL_POS, MODE_LABEL_TEXT, fill=(255, 255, 255, 255),
              font=label_font_main, anchor="mm")
    draw.text(RST_LABEL_POS, RST_LABEL_TEXT, fill=(255, 255, 255, 255),
              font=label_font_main, anchor="mm")

    # 6. "QSO DATA" heading
    heading_font = load_font(QSO_HEADING_FONT_SIZE, bold=True)
    draw.text(QSO_HEADING_POS, "QSO DATA", fill=QSO_HEADING_COLOR,
              font=heading_font, anchor="mm")


def draw_callsign_text(draw, config):
    """Draw the large callsign text at top right."""
    callsign = config["callsign"].upper()
    color = hex_to_rgba(config.get("callsignColor", "#FF0000"))
    font = load_font(CALLSIGN_FONT_SIZE, bold=True)

    x = CANVAS_W - CALLSIGN_TEXT_X_RIGHT_MARGIN
    y = CALLSIGN_TEXT_Y

    draw.text((x, y), callsign, fill=color, font=font, anchor="rt")


def draw_operator_info(draw, config):
    """Draw operator name, address, and optional email."""
    operator = config.get("operator", {})
    name = operator.get("name", "")
    address = operator.get("address", [])
    email = operator.get("email")

    lines = [name] + address
    total_lines = len(lines) + (1 if email else 0)

    # Calculate background box height
    bg_bottom = OPERATOR_TEXT_Y + total_lines * OPERATOR_LINE_SPACING + (OPERATOR_EMAIL_GAP if email else 0) + 30

    # Find longest line to set width
    font = load_font(OPERATOR_FONT_SIZE)
    max_width = 0
    for line in lines + ([email] if email else []):
        bbox = draw.textbbox((0, 0), line, font=font)
        max_width = max(max_width, bbox[2] - bbox[0])

    bg_right = OPERATOR_TEXT_X + max_width + 80

    # Draw semi-transparent background
    draw.rectangle(
        (OPERATOR_BG_RECT[0], OPERATOR_TEXT_Y - 40, max(bg_right, OPERATOR_BG_RECT[2]), bg_bottom),
        fill=OPERATOR_BG_COLOR,
    )

    # Draw text lines
    y = OPERATOR_TEXT_Y
    for line in lines:
        draw.text((OPERATOR_TEXT_X, y), line, fill=(0, 0, 0, 255), font=font)
        y += OPERATOR_LINE_SPACING

    if email:
        y += OPERATOR_EMAIL_GAP
        draw.text((OPERATOR_TEXT_X, y), email, fill=(0, 0, 0, 255), font=font)


def draw_logo(img, config):
    """Draw the club logo with circular mask."""
    logo_cfg = config.get("logo", {})
    logo_file = logo_cfg.get("file")
    if not logo_file:
        return

    if not os.path.isabs(logo_file):
        # Resolve relative to project root
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(script_dir)
        logo_file = os.path.join(project_root, logo_file)

    if not os.path.exists(logo_file):
        print(f"  Warning: Logo file not found: {logo_file}")
        return

    logo_size = logo_cfg.get("size", 900)
    logo = Image.open(logo_file).convert("RGBA")
    logo = logo.resize((logo_size, logo_size), Image.LANCZOS)

    # Create circular mask
    mask = Image.new("L", (logo_size, logo_size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.ellipse((0, 0, logo_size - 1, logo_size - 1), fill=255)

    # Paste with mask
    img.paste(logo, (LOGO_X, LOGO_Y), mask)


def draw_signature(draw, config):
    """Draw signature text in italic serif font."""
    sig_cfg = config.get("signature", {})
    sig_text = sig_cfg.get("text")
    if not sig_text:
        return

    sig_color = hex_to_rgba(sig_cfg.get("color", "#000000"))
    font = load_font(SIGNATURE_FONT_SIZE, bold=True, italic=True, serif=True)

    draw.text((SIGNATURE_TEXT_X, SIGNATURE_TEXT_Y), sig_text, fill=sig_color,
              font=font, anchor="mm")


def register_callsign(config):
    """Add callsign to callsigns.json and create directory structure."""
    callsign_id = config["callsign"].lower()
    callsign_name = config["callsign"].upper()
    qrz_link = config.get("qrzLink", f"https://www.qrz.com/db/{callsign_name}")

    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    data_dir = os.path.join(project_root, "data")
    callsigns_file = os.path.join(data_dir, "callsigns.json")

    # Load existing callsigns
    if os.path.exists(callsigns_file):
        with open(callsigns_file, "r") as f:
            data = json.load(f)
    else:
        data = {"callsigns": []}

    # Check if already exists
    existing = [c for c in data["callsigns"] if c["id"].lower() == callsign_id]
    if existing:
        print(f"  Callsign {callsign_name} already exists in callsigns.json, skipping registration")
        return

    # Add new entry
    new_entry = {
        "id": callsign_id,
        "name": callsign_name,
        "qrzLink": qrz_link,
        "textPositions": DEFAULT_TEXT_POSITIONS,
        "createdAt": datetime.utcnow().isoformat() + "Z",
    }

    data["callsigns"].append(new_entry)

    with open(callsigns_file, "w") as f:
        json.dump(data, f, indent=2)

    print(f"  Added {callsign_name} to callsigns.json")

    # Create directory structure
    cards_dir = os.path.join(data_dir, "cards", callsign_id)
    bg_dir = os.path.join(cards_dir, "backgrounds")
    os.makedirs(bg_dir, exist_ok=True)
    print(f"  Created directory: {cards_dir}/backgrounds/")


def main():
    parser = argparse.ArgumentParser(description="Generate QSL card template from config")
    parser.add_argument("--config", required=True, help="Path to JSON config file")
    parser.add_argument("--output", help="Output path (default: data/cards/<callsign>/card.png)")
    args = parser.parse_args()

    # Load config
    with open(args.config, "r") as f:
        config = json.load(f)

    callsign = config["callsign"].upper()
    print(f"Generating card template for {callsign}...")

    # Determine output path
    if args.output:
        output_path = args.output
    else:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(script_dir)
        callsign_dir = os.path.join(project_root, "data", "cards", callsign.lower())
        os.makedirs(callsign_dir, exist_ok=True)
        output_path = os.path.join(callsign_dir, "card.png")

    # Create transparent canvas
    img = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Draw in order (back to front)
    print("  Drawing QSO section...")
    draw_qso_section(draw)

    print("  Drawing operator info...")
    draw_operator_info(draw, config)

    print("  Drawing callsign text...")
    draw_callsign_text(draw, config)

    print("  Drawing logo...")
    draw_logo(img, config)

    print("  Drawing signature...")
    draw_signature(draw, config)

    # Save
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    img.save(output_path, "PNG")
    print(f"  Saved: {output_path}")

    # Register callsign if requested
    if config.get("registerCallsign", True):
        print("  Registering callsign...")
        register_callsign(config)

    print("Done!")


if __name__ == "__main__":
    main()
