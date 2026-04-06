FROM oven/bun:1-alpine

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

ENV DATABASE_URL=postgres://postgres:password@localhost:5432/microservices

EXPOSE 3000
CMD ["bun", "run", "src/http/index.ts"]
