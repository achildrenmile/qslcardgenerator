FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source files
COPY src ./src
COPY public ./public

# Create data directory
RUN mkdir -p /app/data/cards

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S qslgen -u 1001 -G nodejs && \
    chown -R qslgen:nodejs /app

USER qslgen

EXPOSE 3400

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3400/api/callsigns || exit 1

CMD ["node", "src/server.js"]
