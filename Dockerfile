FROM mcr.microsoft.com/playwright:v1.46.0-jammy

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY courses.json.example ./courses.json.example
COPY .env.example ./.env.example

RUN npm run build

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
