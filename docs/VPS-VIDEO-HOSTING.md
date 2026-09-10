# VPS Video Hosting Guide

This document describes how to host tutorial videos on the Ashbi VPS instead of using third-party services like YouTube or Vimeo.

## Overview

**VPS-First Philosophy:** Cameron prefers self-hosted solutions. Tutorial videos can be served as static MP4/WebM files from the VPS via Caddy or nginx. No YouTube/Vimeo account required for pilot.

## Setup

### 1. Prepare Video Files

Convert your screen recordings to web-optimized formats:

```bash
# Convert to MP4 (H.264 + AAC, widely supported)
ffmpeg -i recording.mov \
  -c:v libx264 -preset slow -crf 22 \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  quickstart.mp4

# Optional: Create WebM (VP9 + Opus, smaller file size)
ffmpeg -i recording.mov \
  -c:v libvpx-vp9 -crf 30 -b:v 0 \
  -c:a libopus -b:a 128k \
  quickstart.webm
```

**Target specs:**
- Resolution: 1920×1080 or 1280×720 (HD)
- Bitrate: 2-4 Mbps for 1080p, 1-2 Mbps for 720p
- Duration: 5-15 minutes per tutorial
- File size: ~50-150 MB per video (acceptable for VPS serving)

### 2. Upload to VPS

Create a static media directory on the VPS:

```bash
# SSH into the VPS
ssh coolify@187.77.26.99

# Create media directory
sudo mkdir -p /opt/bowin/public/media/tutorials
sudo chown -R coolify:coolify /opt/bowin/public

# Upload videos from local machine
scp quickstart.mp4 coolify@187.77.26.99:/opt/bowin/public/media/tutorials/
scp import-competitors.mp4 coolify@187.77.26.99:/opt/bowin/public/media/tutorials/
scp run-tournament.mp4 coolify@187.77.26.99:/opt/bowin/public/media/tutorials/
```

### 3. Configure Caddy to Serve Static Files

Add a static file handler to the Caddyfile:

```caddyfile
tkd.ashbi.ca {
    # Existing reverse proxy for the app
    reverse_proxy localhost:18301

    # Static media files (videos, images, etc.)
    handle /media/* {
        root * /opt/bowin/public
        file_server
        
        # Cache videos for 7 days
        header Cache-Control "public, max-age=604800"
        
        # CORS for video embeds (if needed)
        header Access-Control-Allow-Origin "*"
    }
}
```

Reload Caddy:

```bash
sudo systemctl reload caddy
# or if using Docker:
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

### 4. Update Environment Variables

Set the tutorial URLs in `.env` (production) or build-time env (if using Docker):

```bash
# Same-origin paths (recommended for VPS hosting)
VITE_TUTORIAL_QUICKSTART_URL=/media/tutorials/quickstart.mp4
VITE_TUTORIAL_IMPORT_URL=/media/tutorials/import-competitors.mp4
VITE_TUTORIAL_RUN_EVENT_URL=/media/tutorials/run-tournament.mp4
```

Rebuild the client bundle if these are build-time env vars:

```bash
npm run build
```

### 5. Verify

Test the video URLs:

```bash
# Direct access
curl -I https://tkd.ashbi.ca/media/tutorials/quickstart.mp4

# Should return:
# HTTP/2 200
# content-type: video/mp4
# cache-control: public, max-age=604800
```

Open the app and visit `/tutorials` — videos should load and play.

---

## Alternative: Nginx Setup

If using nginx instead of Caddy:

```nginx
server {
    listen 443 ssl http2;
    server_name tkd.ashbi.ca;

    # Existing reverse proxy
    location / {
        proxy_pass http://localhost:18301;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Static media files
    location /media/ {
        alias /opt/bowin/public/media/;
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
        add_header Access-Control-Allow-Origin "*";
    }
}
```

Reload nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## Bandwidth & Storage Considerations

**File sizes:**
- 1080p MP4 (10 min): ~100 MB
- 720p MP4 (10 min): ~50 MB
- 3 tutorials: ~150-300 MB total

**Bandwidth:**
- 100 views/month: ~15-30 GB/month
- 1,000 views/month: ~150-300 GB/month

**Recommendation:** Start with VPS hosting. If bandwidth exceeds VPS limits or costs become prohibitive, migrate to a CDN (Cloudflare R2, Backblaze B2, DigitalOcean Spaces) or YouTube/Vimeo.

---

## Migration to CDN (Future)

If VPS bandwidth becomes a concern:

1. Upload videos to Cloudflare R2 or Backblaze B2 (S3-compatible)
2. Enable public access or signed URLs
3. Update `VITE_TUTORIAL_*_URL` env vars to CDN URLs
4. Rebuild client bundle

No code changes required — the VideoTutorials.tsx component already supports any URL.

---

## Third-Party Alternatives (Optional)

If Cameron prefers third-party hosting after all:

- **YouTube:** Embed URLs (`https://www.youtube.com/embed/VIDEO_ID`)
- **Vimeo:** Embed URLs (`https://player.vimeo.com/video/VIDEO_ID`)
- **Wistia:** Embed URLs (`https://fast.wistia.net/embed/iframe/VIDEO_ID`)

Set `VITE_TUTORIAL_*_URL` to the embed URL and the app will display it in an iframe.

---

## References

- [Caddy File Server](https://caddyserver.com/docs/caddyfile/directives/file_server)
- [FFmpeg Video Encoding Guide](https://trac.ffmpeg.org/wiki/Encode/H.264)
- [Web Video Best Practices](https://web.dev/fast-playback-with-preload/)
