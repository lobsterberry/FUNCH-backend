FROM node:20-alpine

WORKDIR /app

# Copy dependency definitions
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy project files
COPY . .

# Expose backend API port
EXPOSE 5000

# Default command for development with hot reload
CMD ["npm", "run", "dev"]

