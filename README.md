# QSL Card Generator

A secure web application for generating personalized QSL cards for amateur radio operators.

## Features

- **Multi-user authentication**: Secure login with bcrypt password hashing
- **Role-based access**: Admin and callsign-owner roles with strict isolation
- **Dynamic routing**: Access via `/{callsign}` (e.g., `/oe8yml`)
- **Real-time preview**: Canvas-based rendering with instant updates
- **Custom backgrounds**: Upload and select from multiple background images
- **Admin interface**: Manage callsigns, users, upload templates, configure text positions
- **Audit logging**: Track all sensitive operations
- **Responsive design**: Works on desktop and mobile

## Data Handling & Privacy

**IMPORTANT**: This application handles personal data (callsigns, QSL card content). The following safeguards are in place:

### What is NOT stored in the repository

The `.gitignore` is configured to exclude all user data:

- `data/` - All runtime data (callsigns.json, user uploads, generated cards)
- `*.db` - SQLite databases (user accounts, sessions, audit logs)
- All image files (`*.png`, `*.jpg`, etc.)

### Data storage at runtime

All user data is stored in the `data/` directory which is:
- Created automatically on first run
- Mounted as a Docker volume for persistence
- **Never committed to git**

```
data/
├── callsigns.json      # Callsign configurations (runtime only)
├── users.db            # User accounts, sessions, audit log
└── cards/              # Uploaded card templates and backgrounds
    └── {callsign}/
        ├── card.png
        └── backgrounds/
```

### Logging policy

- Console logs only show aggregate counts (e.g., "Loaded 17 callsigns")
- No personal data, callsigns, or card content is logged to stdout
- Audit logs are stored in the SQLite database, not in files
- Error messages never expose user data

### Security measures

- Passwords hashed with bcrypt (12 salt rounds)
- Session tokens are cryptographically random (32 bytes)
- Sessions expire after 7 days
- Rate limiting on authentication endpoints
- Card images served through authenticated API endpoints only
- 404 responses for unauthorized access (prevents callsign enumeration)

## Quick Start

### Using Docker (Recommended)

```bash
# Build and run
docker compose up -d

# Create initial admin user
docker exec -it qslcardgenerator node scripts/create-admin.js admin yourpassword

# Access at http://localhost:3400
```

### Manual Installation

```bash
# Install dependencies
npm install

# Create admin user
node scripts/create-admin.js admin yourpassword

# Start server
npm start
```

## API Endpoints

### Authentication

- `POST /api/auth/login` - Login with username/password
- `POST /api/auth/logout` - Logout (invalidate session)
- `GET /api/auth/me` - Get current user info
- `POST /api/auth/change-password` - Change own password

### User Management (own callsign)

- `GET /api/manage/callsign` - Get own callsign config
- `PUT /api/manage/callsign` - Update own callsign config
- `GET /api/manage/backgrounds` - List own backgrounds
- `POST /api/manage/upload/:type` - Upload card/background
- `DELETE /api/manage/backgrounds/:filename` - Delete background

### Admin Only

- `GET /api/admin/users` - List all users
- `POST /api/admin/users` - Create user
- `PUT /api/admin/users/:id` - Update user
- `DELETE /api/admin/users/:id` - Delete user
- `GET /api/admin/callsigns` - List all callsigns
- `POST /api/admin/callsigns` - Create callsign
- `PUT /api/admin/callsigns/:callsign` - Update callsign
- `DELETE /api/admin/callsigns/:callsign` - Delete callsign
- `GET /api/admin/audit` - View audit log

### Protected Resources

- `GET /api/cards/:callsign/card.png` - Get card template (auth required)
- `GET /api/cards/:callsign/backgrounds/:filename` - Get background (auth required)

## Directory Structure

```
qslcardgenerator/
├── src/
│   └── server.js           # Express backend
├── public/
│   ├── index.html          # Login page
│   ├── generator.html      # QSL card generator
│   ├── admin.html          # Admin interface
│   ├── logo.svg            # Application logo
│   └── 404.html            # Not found page
├── scripts/
│   ├── create-admin.js     # Create admin user
│   └── migrate.js          # Migration from old system
├── data/                   # Runtime data (NOT in git)
├── Dockerfile
├── docker-compose.yml
└── .gitignore              # Excludes all user data
```

## Card Template Requirements

- **Format**: PNG with transparency
- **Resolution**: 4837 x 3078 pixels (recommended)
- **Scale factor**: 0.4x for display

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3400 | Server port |

## Contributing

When contributing, ensure:
1. Never commit any files from `data/`
2. Never log personal data or callsign content
3. Test with sample data, not real user data
4. Run `git status` before committing to verify no data files are staged

## License

MIT
