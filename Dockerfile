FROM ubuntu:22.04

# Install Node.js 23 and all dependencies
RUN apt-get update && apt-get install -y \
    curl \
    python3 \
    python3-pip \
    build-essential \
    sqlite3 \
    ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_23.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies and build
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Clean up dev dependencies
RUN npm ci --only=production && npm cache clean --force

# Create data directory for database
RUN mkdir -p /app/data

# Set default environment variables
ENV DB_PATH="/app/data/ontology.db"
ENV SPARQL_ENDPOINT="https://dbpedia.org/sparql"
ENV LOG_LEVEL="info"
ENV EMBEDDING_BATCH_SIZE="32"
# Force ONNX Runtime to use CPU only (avoids CUDA provider issues)
ENV ORT_EXECUTION_PROVIDERS="CPUExecutionProvider"

# Create non-root user for security
RUN groupadd -g 1001 nodejs && \
    useradd -r -u 1001 -g nodejs mcp

# Change ownership of app directory
RUN chown -R mcp:nodejs /app

# Switch to non-root user
USER mcp

# Expose volume for persistent data
VOLUME ["/app/data"]

# Set the entrypoint
ENTRYPOINT ["node", "dist/index.js"]