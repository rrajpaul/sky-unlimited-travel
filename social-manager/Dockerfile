FROM node:20-bookworm-slim

# Install fontconfig plus DejaVu and Liberation fonts so Sharp/librsvg can
# actually render text onto the generated images. Without this, every piece
# of text in a post's image renders as empty boxes (missing glyphs) because
# the base Node image ships with no fonts at all.
#
# ffmpeg is for Reel generation (see videoGenerator.js) — the Ken Burns
# zoom effect and the silent audio track muxed into every Reel both run
# through it via a plain child_process call, not any npm package.
RUN apt-get update && apt-get install -y --no-install-recommends \
    fontconfig \
    fonts-dejavu-core \
    fonts-liberation \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 8080

CMD ["node", "src/index.js"]
