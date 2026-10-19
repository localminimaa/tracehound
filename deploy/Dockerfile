# tracehound: one image for the web server, the live watch and the scheduled jobs
FROM node:24.13.1-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY seed ./seed
COPY tsconfig.json ./
# data/ is a volume from the host: labels from the repo plus everything the app collects
CMD ["node", "src/server.ts"]
