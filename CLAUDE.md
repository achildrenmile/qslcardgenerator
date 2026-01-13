# QSL Card Generator - Claude Context

## Project Overview

Web application for generating personalized QSL cards for amateur radio operators.

- **URL:** https://qsl.oeradio.at
- **Repository:** https://github.com/achildrenmile/qslcardgenerator

## Tech Stack

- **Backend:** Node.js + Express
- **Database:** SQLite (users, sessions, audit log)
- **Frontend:** Vanilla JS with Canvas API
- **Auth:** bcrypt password hashing, session tokens
- **Deployment:** Docker on Synology NAS

## Project Structure

```
├── src/
│   └── server.js           # Express backend
├── public/
│   ├── index.html          # Login page
│   ├── generator.html      # QSL card generator
│   ├── admin.html          # Admin interface
│   ├── js/                 # Client-side JavaScript
│   └── css/                # Stylesheets
├── scripts/
│   ├── create-admin.js     # Create admin user
│   └── migrate.js          # Migration tools
├── data/                   # Runtime data (NOT in git)
│   ├── callsigns.json      # Callsign configurations
│   ├── users.db            # User database
│   └── cards/              # Card templates and backgrounds
├── Dockerfile
├── deploy-production.sh    # Synology deployment script
└── .gitignore              # Excludes all user data
```

## Deployment

### Production (Synology NAS)

```bash
# Deploy to production
./deploy-production.sh
```

**Requirements:**
- Copy `.env.production.example` to `.env.production` and configure
- SSH access to Synology configured

**Infrastructure:**
- **Host**: Synology NAS
- **Container**: `qslcardgenerator` on port 3400
- **Tunnel**: `cloudflared-oeradio` (shared with other oeradio.at services)
- **Data**: `/volume1/docker/qslcardgenerator/data/`

### Local Development

```bash
# Install dependencies
npm install

# Create admin user
node scripts/create-admin.js admin yourpassword

# Start server
npm start
```

## Key Features

- **Multi-user auth**: Secure login with bcrypt
- **Role-based access**: Admin and callsign-owner roles
- **Dynamic routing**: Access via `/{callsign}` (e.g., `/oe8yml`)
- **Real-time preview**: Canvas-based rendering
- **Custom backgrounds**: Upload multiple background images
- **Audit logging**: Track all sensitive operations

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Current user info

### User Management (own callsign)
- `GET /api/manage/callsign` - Get own callsign config
- `PUT /api/manage/callsign` - Update own callsign config
- `POST /api/manage/upload/:type` - Upload card/background

### Admin Only
- `GET/POST /api/admin/users` - User management
- `GET/POST /api/admin/callsigns` - Callsign management
- `GET /api/admin/audit` - View audit log

## Data Privacy

All user data is stored in `data/` directory which is:
- **Never committed to git** (.gitignore configured)
- Mounted as Docker volume for persistence
- Contains: callsigns.json, users.db, card images

## Maintenance

### Check logs on Synology
```bash
ssh straliadmin@<SYNOLOGY_IP> '/usr/local/bin/docker logs qslcardgenerator'
```

### Create new admin user
```bash
ssh straliadmin@<SYNOLOGY_IP> '/usr/local/bin/docker exec qslcardgenerator node scripts/create-admin.js username password'
```

### Verify deployment
```bash
curl -s -o /dev/null -w "%{http_code}" https://qsl.oeradio.at/
```

## Related Services

All oeradio.at services share the `cloudflared-oeradio` tunnel:
- https://qsl.oeradio.at (this service)
- https://wavelog.oeradio.at
- https://dobratschrunde.oeradio.at
- https://dmrrunde.oeradio.at
