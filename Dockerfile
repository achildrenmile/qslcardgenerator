FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source files
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# Install Python and Pillow for card template generation
RUN apk add --no-cache python3 py3-pillow font-dejavu font-freefont

# Create data directory
RUN mkdir -p /app/data/cards

EXPOSE 3400

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:3400/health || exit 1

CMD ["node", "src/server.js"]
