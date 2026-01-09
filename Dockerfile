# Use Node.js LTS version (Alpine for security)
FROM node:20.8.1-alpine

# Install curl for health checks
RUN apk add --no-cache curl

# Enable pnpm via corepack (Best practice for Node 16+)
RUN corepack enable

# Set working directory
WORKDIR /app

# Copy package files
# LƯU Ý: Bạn cần đảm bảo đã có file pnpm-lock.yaml thay vì yarn.lock
COPY package.json pnpm-lock.yaml ./

# Install dependencies using pnpm
# --frozen-lockfile tương đương với yarn --frozen-lockfile (đảm bảo đúng version)
RUN pnpm install --frozen-lockfile

# Copy application code
COPY . .

# Create uploads directory
RUN mkdir -p uploads/news uploads/team uploads/users uploads/projects uploads/products uploads/contacts uploads/general

# Set proper permissions for uploads directory
RUN chmod -R 755 uploads

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

# Start the application
CMD ["pnpm", "start"]