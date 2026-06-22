# Stage 1: Build the frontend React app
FROM node:20-slim AS frontend-builder

WORKDIR /frontend

COPY frontend/package.json frontend/pnpm-lock.yaml* frontend/package-lock.json* ./

RUN npm install -g pnpm && pnpm install --no-frozen-lockfile || npm install

COPY frontend/ .

RUN pnpm build || npm run build

# Stage 2: Build the backend server
FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/package.json server/pnpm-lock.yaml* server/package-lock.json* ./

RUN npm install -g pnpm && pnpm install --frozen-lockfile --ignore-scripts || npm install --ignore-scripts

COPY server/ ./

RUN pnpm rebuild || npm rebuild

# Copy built frontend assets to the location expected by the routing module
COPY --from=frontend-builder /frontend/dist /frontend/dist

RUN pnpm prisma:generate || npm run prisma:generate

EXPOSE 17000

CMD ["pnpm", "start"]
