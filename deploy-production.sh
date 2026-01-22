#!/bin/bash

# Deploy qslcardgenerator to Synology NAS
# Usage: ./deploy-production.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load environment variables
if [ -f "$SCRIPT_DIR/.env.production" ]; then
  export $(grep -v '^#' "$SCRIPT_DIR/.env.production" | xargs)
else
  echo "ERROR: .env.production not found"
  echo "Copy .env.production.example to .env.production and configure it"
  exit 1
fi

echo "=========================================="
echo "Deploying $CONTAINER_NAME to Synology"
echo "=========================================="

# Pull latest changes
echo ""
echo "[1/4] Pulling latest changes from GitHub..."
ssh $SYNOLOGY_HOST "cd $REMOTE_DIR && git pull"

# Build Docker image
echo ""
echo "[2/4] Building Docker image..."
ssh $SYNOLOGY_HOST "/usr/local/bin/docker build -t $IMAGE_NAME $REMOTE_DIR"

# Stop and remove old container
echo ""
echo "[3/4] Restarting container..."
ssh $SYNOLOGY_HOST "/usr/local/bin/docker stop $CONTAINER_NAME 2>/dev/null || true"
ssh $SYNOLOGY_HOST "/usr/local/bin/docker rm $CONTAINER_NAME 2>/dev/null || true"

# Start new container
ssh $SYNOLOGY_HOST "/usr/local/bin/docker run -d \
  --name $CONTAINER_NAME \
  --restart unless-stopped \
  -p $CONTAINER_PORT \
  -e PORT=3400 \
  -v /volume1/docker/qslcardgenerator/data:/app/data \
  --health-cmd='wget -q -O /dev/null http://localhost:3400/health || exit 1' \
  --health-interval=30s \
  --health-timeout=10s \
  --health-retries=3 \
  --health-start-period=10s \
  $IMAGE_NAME"

# Verify
echo ""
echo "[4/4] Verifying deployment..."
sleep 5
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$SITE_URL")

if [ "$HTTP_CODE" = "200" ]; then
  echo ""
  echo "=========================================="
  echo "Deployment successful!"
  echo "$SITE_URL is responding (HTTP $HTTP_CODE)"
  echo "=========================================="
else
  echo ""
  echo "WARNING: Site returned HTTP $HTTP_CODE"
  echo "Check logs: ssh $SYNOLOGY_HOST '/usr/local/bin/docker logs $CONTAINER_NAME'"
fi
