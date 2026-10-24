FROM node:20-alpine

# Install Python3, pip, FFmpeg, and ca-certificates
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg \
    ca-certificates

WORKDIR /app

# 1. Install Python dependencies (using --break-system-packages for Alpine PEP 668 compatibility)
COPY python_engine/requirements.txt ./python_engine/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages --upgrade -r ./python_engine/requirements.txt

# 2. Install Node.js dependencies
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm install --omit=dev

# 3. Copy source code
WORKDIR /app
COPY python_engine/ ./python_engine/
COPY backend/ ./backend/

# Set working directory to backend and expose Cloud Run default port
WORKDIR /app/backend
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
