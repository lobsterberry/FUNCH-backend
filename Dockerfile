FROM node:20-alpine

# Install OpenSSL and libc compat required by Prisma on Alpine Linux
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Copy dependency definitions
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy Prisma schema and generate client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy project files
COPY . .

# Expose backend API port
EXPOSE 5000

# Default command for development with hot reload
CMD ["npm", "run", "dev"]

