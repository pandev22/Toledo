# Stage 1: Build the frontend React app
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend

COPY ../frontend/package.json ../frontend/pnpm-lock.yaml* ../frontend/package-lock.json* ./

RUN npm install -g pnpm && pnpm install --frozen-lockfile || npm install

COPY ../frontend/ .

RUN pnpm build || npm run build

# Stage 2: Build the backend server
FROM node:20-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json pnpm-lock.yaml* package-lock.json* ./

RUN npm install -g pnpm && pnpm install --frozen-lockfile --ignore-scripts || npm install --ignore-scripts

COPY . .

# Copy built frontend assets to the location expected by the routing module
COPY --from=frontend-builder /frontend/dist /frontend/dist

RUN pnpm prisma:generate || npm run prisma:generate

EXPOSE 17000

CMD ["pnpm", "start"]
