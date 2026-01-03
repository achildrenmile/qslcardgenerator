# QSL Card Generator

A web application for generating personalized QSL cards for amateur radio operators.

## Features

- **Multi-user support**: Each callsign has its own card template and backgrounds
- **Dynamic routing**: Access via `/{callsign}` (e.g., `/oe8yml`)
- **Real-time preview**: Canvas-based rendering with instant updates
- **Custom backgrounds**: Upload and select from multiple background images
- **Admin interface**: Manage callsigns, upload templates, configure text positions
- **Responsive design**: Works on desktop and mobile

## Quick Start

### Using Docker (Recommended)

```bash
# Set admin token
export ADMIN_TOKEN=your-secure-token

# Build and run
docker compose up -d

# Access at http://localhost:3400
```

### Manual Installation

```bash
# Install dependencies
npm install

# Set admin token
export ADMIN_TOKEN=your-secure-token

# Start server
npm start
```

## Migration from Old System

To migrate existing callsigns from the old WordPress-based system:

```bash
node scripts/migrate.js /path/to/qslgeneratorold
```

## API Endpoints

### Public

- `GET /api/callsigns` - List all callsigns
- `GET /api/callsigns/:callsign` - Get callsign configuration
- `GET /api/callsigns/:callsign/backgrounds` - List available backgrounds

### Admin (requires `X-Admin-Token` header)

- `POST /api/admin/callsigns` - Create new callsign
- `PUT /api/admin/callsigns/:callsign` - Update callsign
- `DELETE /api/admin/callsigns/:callsign` - Delete callsign
- `POST /api/admin/callsigns/:callsign/upload/card` - Upload card template
- `POST /api/admin/callsigns/:callsign/upload/background` - Upload background
- `DELETE /api/admin/callsigns/:callsign/backgrounds/:filename` - Delete background

## Directory Structure

```
qslcardgenerator/
├── src/
│   └── server.js           # Express backend
├── public/
│   ├── index.html          # Home page (callsign list)
│   ├── generator.html      # QSL card generator
│   ├── admin.html          # Admin interface
│   └── 404.html            # Not found page
├── data/
│   ├── callsigns.json      # Callsign configurations
│   └── cards/              # Card templates and backgrounds
│       └── {callsign}/
│           ├── card.png    # Card template (4837x3078 px)
│           └── backgrounds/
├── scripts/
│   └── migrate.js          # Migration script
├── Dockerfile
└── docker-compose.yml
```

## Card Template Requirements

- **Format**: PNG with transparency
- **Resolution**: 4837 x 3078 pixels (recommended)
- **Scale factor**: 0.4x for display

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3400 | Server port |
| `ADMIN_TOKEN` | changeme | Admin authentication token |

## License

MIT
