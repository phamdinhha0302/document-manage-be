# Use Node.js LTS version (Alpine for security)
FROM node:20.8.1-alpine

# Install curl for health checks
RUN apk add --no-cache curl

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

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
CMD ["yarn", "start"]
