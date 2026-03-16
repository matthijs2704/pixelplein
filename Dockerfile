FROM node:20-slim

# sharp needs libvips; ffmpeg is required for .mov/.m4v → .mp4 transcoding
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      libvips-dev \
      ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# install deps first (layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# copy application code
COPY server/ server/
COPY public/ public/
COPY themes/ themes/

# persistent data lives in these directories — mount as volumes
VOLUME ["/app/photos", "/app/data", "/app/cache", \
        "/app/slide-assets", "/app/submission-assets"]

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server/index.js"]
