FROM node:22-slim

# ffmpeg for clipping, python3/pip for yt-dlp
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3-pip curl && \
    pip3 install --no-cache-dir --break-system-packages yt-dlp && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY public ./public

ENV PORT=3000
ENV DATA_DIR=/data/sessions
RUN mkdir -p /data/sessions
VOLUME /data/sessions

EXPOSE 3000
CMD ["node", "server.js"]
