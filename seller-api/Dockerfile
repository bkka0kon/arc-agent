# Arc Agentic seller API — for Fly.io / Railway / any container host.
FROM node:20-slim

WORKDIR /app

# Install deps first for layer caching.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# App source.
COPY . .

ENV PORT=3000
EXPOSE 3000

# SELLER_WALLET_ADDRESS must be provided at runtime:
#   docker run -e SELLER_WALLET_ADDRESS=0x... -p 3000:3000 <image>
#   fly secrets set SELLER_WALLET_ADDRESS=0x...
CMD ["node", "server.js"]
