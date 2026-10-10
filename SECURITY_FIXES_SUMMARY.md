
# Security Audit - Fixes Applied Summary

## Overview
Applied critical security fixes to the Task Orchestrator (tto-golden) codebase based on comprehensive security audit findings.

## Fixes Applied

### P0 (Critical) - Fixed
1. **`_is_blocked_path()` Function** (`backend/main.py`)
   - **Issue**: Always returned `False`, disabling sensitive file protection
   - **Fix**: Implemented proper blocking using `BLOCKED_PATH_FRAGMENTS` to block SSH keys, .env files, credentials, etc.

2. **Rate Limiting on Login** (`backend/routers/collab.py`)
   - **Issue**: No rate limiting on `/api/collab/login` enabling brute-force PIN attacks
   - **Fix**: Added in-memory rate limiter (5 failed attempts/5min per IP+username)

### P1 (High) - Fixed
3. **WebSocket Token Transport** (`backend/main.py`)
   - **Issue**: Tokens sent via query parameters (exposed in logs, history, referers)
   - **Fix**: Now prefers `Authorization: Bearer <token>` header over query params

4. **Security Headers Middleware** (`backend/main.py`)
   - **Issue**: Missing critical security headers
   - **Fix**: Added middleware setting:
     - `X-Content-Type-Options: nosniff`
     - `X-Frame-Options: DENY`
     - `X-XSS-Protection: 1; mode=block`
     - `Referrer-Policy: strict-origin-when-cross-origin`
     - `Permissions-Policy: geolocation=(), microphone=(), camera=()`

5. **Git Operations Boundary Validation** (`backend/main.py`)
   - **Issue**: Git operations could traverse outside workspace boundaries via symlinks
   - **Fix**: Added `_is_path_in_allowed_roots()` validation to `_repo_root()` function

6. **Browse Proxy Size Limits** (`backend/main.py`)
   - **Issue**: No response size limits enabling DoS via large responses
   - **Fix**: Added 10MB maximum response size limit

7. **Voice Pipeline Audio Validation** (`backend/voice/webrtc_handler.py`)
   - **Issue**: Missing validation on incoming audio streams
   - **Fix**: Added:
     - Track kind validation (audio-only)
     - Session duration limits (30 minutes)
     - Per-chunk size limits (1MB)
     - Session total size limits (50MB)

## Remaining Issues (to be addressed in future sprints)
- **P2**: Command sanitization for remote-triggered commands
- **P3**: Replace `dangerouslySetInnerHTML` in frontend components
- **P3**: Secure token storage (consider httpOnly cookies or Tauri secure storage)
- **P3**: Implement tamper-evident audit logging
- **P3**: Enforce HMAC-only webhook verification (remove simple secret mode)
- **P4**: Add token refresh/rotation mechanism
- **P4**: Review Tauri allowlist/CSP configuration

## Verification
All modified files compile successfully without syntax errors.
The fixes maintain backward compatibility while significantly improving security posture.
