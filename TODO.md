# TODO - Batch 1 Security Core

- [x] Add API rate limiting middleware for `/api/*` (5 req/min per IP)
- [x] Harden `pages/api/map-layer.js`:
  - [x] Enforce GET-only method
  - [x] Add query size guard (max 2KB)
  - [x] Add strict whitelist validations
  - [x] Add date format/range validations
  - [x] Add numeric clamping and sane bounds
  - [x] Add region whitelist validation from GeoJSON
  - [x] Add singleton GEE authentication
  - [x] Add 60s timeout wrapper for GEE async calls
  - [x] Sanitize error responses
- [x] Update TODO progress
- [x] Run API-focused tests (critical paths)
