# Sprint 10: Security Hardening (HIGH Priority Issues)

**Sprint ID:** 10 (Global)
**Local Label:** sprint-10
**Cycle:** cycle-001 (WYSIWYG Theme Builder MVP)
**Priority:** HIGH
**Estimated Duration:** 3-5 days
**Dependencies:** Sprint 9 (CRITICAL vulnerabilities remediated)

---

## Sprint Overview

This sprint addresses the remaining **HIGH severity** security issues identified in the security audit. These issues do not block production deployment but represent significant security risks that should be addressed immediately post-launch.

**Scope:** 5 confirmed HIGH priority security issues focusing on authentication hardening, API protection, and operational security.

**Success Criteria:**
- All HIGH severity issues remediated
- Test coverage for all security fixes
- Security re-audit passes without HIGH findings
- No new vulnerabilities introduced

---

## Security Issues to Address

### Issue Group 1: Authentication Security

#### HIGH-1: Missing Rate Limiting on Auth Endpoint

**Severity:** HIGH
**CVSS Score:** 7.5
**CWE:** CWE-307 (Improper Restriction of Excessive Authentication Attempts)

**Issue Description:**
The `/api/auth/verify` endpoint has no rate limiting, allowing unlimited authentication attempts. This enables brute force attacks against API keys.

**Attack Vector:**
```bash
# Attacker can attempt unlimited API key guesses
for key in $(cat wordlist.txt); do
  curl -H "x-api-key: $key" https://api.victim.com/auth/verify
done
```

**Files Affected:**
- `src/api/routes/auth.routes.ts` - Add rate limiting middleware
- `src/api/middleware.ts` - Create rate limiter
- `package.json` - Add `express-rate-limit` dependency

**Remediation Steps:**

1. Install rate limiting library:
```bash
npm install express-rate-limit
```

2. Create rate limiting middleware:
```typescript
// src/api/middleware/rate-limit.ts
import rateLimit from 'express-rate-limit';

export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per IP
  message: {
    success: false,
    error: 'Too many authentication attempts. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Store in memory (use Redis for production)
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
});

export const strictAuthRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 failed attempts
  message: {
    success: false,
    error: 'Account temporarily locked. Try again in 15 minutes.',
  },
  skip: (req) => {
    // Only rate limit failed attempts
    return req.authSuccess === true;
  },
});
```

3. Apply to auth routes:
```typescript
// src/api/routes/auth.routes.ts
import { authRateLimiter, strictAuthRateLimiter } from '../middleware/rate-limit.js';

authRouter.get('/verify', authRateLimiter, strictAuthRateLimiter, requireApiKeyAsync, ...);
```

**Acceptance Criteria:**
- [ ] Rate limiter limits to 10 requests/minute per IP
- [ ] Strict limiter blocks after 5 failed attempts for 15 minutes
- [ ] Rate limit headers included in response (`X-RateLimit-*`)
- [ ] Failed authentication attempts tracked separately
- [ ] Configuration via environment variables
- [ ] Unit tests for rate limiting logic
- [ ] Integration tests for brute force scenarios

**Estimated Effort:** 4 hours

---

#### HIGH-2: Lack of Audit Logging for Authentication Events

**Severity:** HIGH
**CVSS Score:** 6.8
**CWE:** CWE-778 (Insufficient Logging)

**Issue Description:**
No audit trail exists for authentication events (login, logout, failed attempts). This prevents detection of credential stuffing, brute force attacks, or compromised accounts.

**Security Impact:**
- Cannot detect ongoing attacks
- Cannot investigate security incidents
- Cannot comply with SOC 2, GDPR, PCI-DSS requirements
- No forensic evidence for breach response

**Files Affected:**
- `src/api/routes/auth.routes.ts` - Add audit logging
- `src/utils/audit-logger.ts` - NEW: Create audit logger
- `src/db/schema/audit-log.schema.ts` - NEW: Audit log schema

**Remediation Steps:**

1. Create audit log database schema:
```typescript
// src/db/schema/audit-log.schema.ts
export interface AuthAuditLog {
  id: string;
  event: 'login' | 'logout' | 'verify_success' | 'verify_failed' | 'token_refresh' | 'session_expired';
  admin_name: string | null;
  api_key_id: string | null;
  ip_address: string;
  user_agent: string;
  success: boolean;
  failure_reason: string | null;
  request_id: string;
  timestamp: Date;
}

// SQLite table creation
CREATE TABLE IF NOT EXISTS auth_audit_log (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  admin_name TEXT,
  api_key_id TEXT,
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  success INTEGER NOT NULL,
  failure_reason TEXT,
  request_id TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE INDEX idx_auth_audit_timestamp ON auth_audit_log(timestamp);
CREATE INDEX idx_auth_audit_ip ON auth_audit_log(ip_address);
CREATE INDEX idx_auth_audit_admin ON auth_audit_log(admin_name);
CREATE INDEX idx_auth_audit_event ON auth_audit_log(event);
```

2. Create audit logger utility:
```typescript
// src/utils/audit-logger.ts
import { db } from '../db/connection.js';
import { logger } from './logger.js';
import crypto from 'crypto';

export interface AuditEventData {
  event: string;
  adminName: string | null;
  apiKeyId: string | null;
  ipAddress: string;
  userAgent: string;
  success: boolean;
  failureReason?: string;
  requestId: string;
}

export function logAuthEvent(data: AuditEventData): void {
  try {
    db.prepare(`
      INSERT INTO auth_audit_log (
        id, event, admin_name, api_key_id, ip_address,
        user_agent, success, failure_reason, request_id, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      data.event,
      data.adminName,
      data.apiKeyId,
      data.ipAddress,
      data.userAgent,
      data.success ? 1 : 0,
      data.failureReason || null,
      data.requestId,
      new Date().toISOString()
    );

    logger.info({
      event: data.event,
      adminName: data.adminName,
      success: data.success,
      ipAddress: data.ipAddress,
      requestId: data.requestId,
    }, 'Authentication event logged');
  } catch (error) {
    logger.error({ error, data }, 'Failed to log audit event');
  }
}

export function getRecentFailures(ipAddress: string, windowMinutes: number = 15): number {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  const result = db.prepare(`
    SELECT COUNT(*) as count
    FROM auth_audit_log
    WHERE ip_address = ?
      AND success = 0
      AND timestamp > ?
  `).get(ipAddress, since) as { count: number };

  return result.count;
}
```

3. Integrate into auth routes:
```typescript
// src/api/routes/auth.routes.ts
import { logAuthEvent, getRecentFailures } from '../../utils/audit-logger.js';

authRouter.get('/verify', authRateLimiter, async (req: Request, res: Response) => {
  const apiKey = req.headers['x-api-key'];
  const ipAddress = req.ip || req.socket.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  const requestId = req.id || crypto.randomUUID();

  if (!apiKey || typeof apiKey !== 'string') {
    logAuthEvent({
      event: 'verify_failed',
      adminName: null,
      apiKeyId: null,
      ipAddress,
      userAgent,
      success: false,
      failureReason: 'Missing API key',
      requestId,
    });

    res.status(401).json({
      success: false,
      error: 'API key required',
    });
    return;
  }

  // Check for excessive failures
  const recentFailures = getRecentFailures(ipAddress, 15);
  if (recentFailures >= 10) {
    logAuthEvent({
      event: 'verify_failed',
      adminName: null,
      apiKeyId: null,
      ipAddress,
      userAgent,
      success: false,
      failureReason: 'Too many failed attempts',
      requestId,
    });

    res.status(429).json({
      success: false,
      error: 'Too many failed attempts. Account temporarily locked.',
    });
    return;
  }

  // Verify API key (existing logic)
  const validApiKey = process.env.SIETCH_API_KEY ?? process.env.API_KEY;
  const isValid = constantTimeCompare(apiKey, validApiKey);

  if (!isValid) {
    logAuthEvent({
      event: 'verify_failed',
      adminName: null,
      apiKeyId: hashApiKey(apiKey).slice(0, 8),
      ipAddress,
      userAgent,
      success: false,
      failureReason: 'Invalid API key',
      requestId,
    });

    res.status(403).json({
      success: false,
      error: 'Invalid API key',
    });
    return;
  }

  // Success
  logAuthEvent({
    event: 'verify_success',
    adminName: req.adminName || 'admin',
    apiKeyId: req.apiKeyId || hashApiKey(apiKey).slice(0, 8),
    ipAddress,
    userAgent,
    success: true,
    requestId,
  });

  res.json({
    success: true,
    message: 'API key verified',
  });
});
```

4. Add audit log query endpoints (admin only):
```typescript
// GET /api/admin/audit-logs
adminRouter.get('/audit-logs', requireApiKeyAsync, (req: AuthenticatedRequest, res: Response) => {
  const { limit = 100, offset = 0, event, adminName, startDate, endDate } = req.query;

  let sql = 'SELECT * FROM auth_audit_log WHERE 1=1';
  const params: any[] = [];

  if (event) {
    sql += ' AND event = ?';
    params.push(event);
  }

  if (adminName) {
    sql += ' AND admin_name = ?';
    params.push(adminName);
  }

  if (startDate) {
    sql += ' AND timestamp >= ?';
    params.push(startDate);
  }

  if (endDate) {
    sql += ' AND timestamp <= ?';
    params.push(endDate);
  }

  sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const logs = db.prepare(sql).all(...params);

  res.json({
    success: true,
    data: logs,
    pagination: {
      limit,
      offset,
      total: db.prepare('SELECT COUNT(*) as count FROM auth_audit_log').get().count,
    },
  });
});
```

**Acceptance Criteria:**
- [ ] All authentication events logged to database
- [ ] Logs include: timestamp, IP, user agent, success/failure, reason
- [ ] Failed attempts tracked with failure reason
- [ ] Audit logs queryable via admin API
- [ ] Logs retained for 90 days minimum
- [ ] PII handling complies with GDPR (IP anonymization option)
- [ ] Automated alerts for suspicious patterns (10+ failures from single IP)
- [ ] Unit tests for audit logging
- [ ] Integration tests for audit log queries

**Estimated Effort:** 6 hours

---

#### HIGH-3: No Session Expiration

**Severity:** HIGH
**CVSS Score:** 6.5
**CWE:** CWE-613 (Insufficient Session Expiration)

**Issue Description:**
API keys stored in localStorage remain valid indefinitely. If a device is compromised, stolen, or shared, there's no automatic session expiration.

**Security Impact:**
- Stolen API keys remain valid forever
- No way to invalidate compromised sessions
- Shared devices retain access indefinitely
- Cannot enforce "logout after inactivity"

**Files Affected:**
- `src/api/routes/auth.routes.ts` - Implement JWT tokens
- `src/ui/builder/src/hooks/useAuth.ts` - Handle token refresh
- `src/utils/jwt.ts` - NEW: JWT utilities
- `package.json` - Add `jsonwebtoken` dependency

**Remediation Steps:**

1. Install JWT library:
```bash
npm install jsonwebtoken @types/jsonwebtoken
```

2. Create JWT utilities:
```typescript
// src/utils/jwt.ts
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRATION = '8h'; // 8 hour session
const REFRESH_TOKEN_EXPIRATION = '7d'; // 7 day refresh token

export interface TokenPayload {
  adminName: string;
  apiKeyId: string;
  sessionId: string;
  iat: number;
  exp: number;
}

export function generateAccessToken(adminName: string, apiKeyId: string, sessionId: string): string {
  return jwt.sign(
    { adminName, apiKeyId, sessionId },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRATION, issuer: 'sietch-builder' }
  );
}

export function generateRefreshToken(sessionId: string): string {
  return jwt.sign(
    { sessionId, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRATION, issuer: 'sietch-builder' }
  );
}

export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET, { issuer: 'sietch-builder' }) as TokenPayload;
  } catch (error) {
    return null;
  }
}

export function verifyRefreshToken(token: string): { sessionId: string; type: string } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET, { issuer: 'sietch-builder' }) as any;
    if (payload.type !== 'refresh') {
      return null;
    }
    return payload;
  } catch (error) {
    return null;
  }
}
```

3. Create session storage:
```typescript
// src/db/schema/session.schema.ts
export interface Session {
  id: string;
  admin_name: string;
  api_key_id: string;
  created_at: Date;
  last_activity: Date;
  expires_at: Date;
  ip_address: string;
  user_agent: string;
  is_active: boolean;
}

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  admin_name TEXT NOT NULL,
  api_key_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_activity TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_sessions_admin ON sessions(admin_name);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE INDEX idx_sessions_active ON sessions(is_active);
```

4. Update auth routes to use JWT:
```typescript
// src/api/routes/auth.routes.ts
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../../utils/jwt.js';

// POST /api/auth/login - New login endpoint
authRouter.post('/login', authRateLimiter, async (req: Request, res: Response) => {
  const { apiKey } = req.body;
  const ipAddress = req.ip || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';

  // Verify API key
  const validApiKey = process.env.SIETCH_API_KEY ?? process.env.API_KEY;
  if (!constantTimeCompare(apiKey, validApiKey)) {
    logAuthEvent({
      event: 'login_failed',
      adminName: null,
      apiKeyId: null,
      ipAddress,
      userAgent,
      success: false,
      failureReason: 'Invalid API key',
      requestId: req.id,
    });

    res.status(403).json({
      success: false,
      error: 'Invalid API key',
    });
    return;
  }

  // Create session
  const sessionId = crypto.randomUUID();
  const adminName = 'admin'; // Or derive from API key
  const apiKeyId = hashApiKey(apiKey).slice(0, 8);
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours

  db.prepare(`
    INSERT INTO sessions (
      id, admin_name, api_key_id, created_at, last_activity,
      expires_at, ip_address, user_agent, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    sessionId,
    adminName,
    apiKeyId,
    new Date().toISOString(),
    new Date().toISOString(),
    expiresAt.toISOString(),
    ipAddress,
    userAgent
  );

  // Generate tokens
  const accessToken = generateAccessToken(adminName, apiKeyId, sessionId);
  const refreshToken = generateRefreshToken(sessionId);

  logAuthEvent({
    event: 'login',
    adminName,
    apiKeyId,
    ipAddress,
    userAgent,
    success: true,
    requestId: req.id,
  });

  res.json({
    success: true,
    accessToken,
    refreshToken,
    expiresIn: 8 * 60 * 60, // seconds
    user: { adminName, apiKeyId },
  });
});

// POST /api/auth/refresh - Refresh access token
authRouter.post('/refresh', authRateLimiter, (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(401).json({
      success: false,
      error: 'Refresh token required',
    });
    return;
  }

  // Verify refresh token
  const payload = verifyRefreshToken(refreshToken);
  if (!payload) {
    res.status(403).json({
      success: false,
      error: 'Invalid or expired refresh token',
    });
    return;
  }

  // Check session still active
  const session = db.prepare(`
    SELECT * FROM sessions WHERE id = ? AND is_active = 1
  `).get(payload.sessionId) as Session | undefined;

  if (!session) {
    res.status(403).json({
      success: false,
      error: 'Session expired or revoked',
    });
    return;
  }

  // Update last activity
  db.prepare(`
    UPDATE sessions SET last_activity = ? WHERE id = ?
  `).run(new Date().toISOString(), session.id);

  // Generate new access token
  const newAccessToken = generateAccessToken(
    session.admin_name,
    session.api_key_id,
    session.id
  );

  res.json({
    success: true,
    accessToken: newAccessToken,
    expiresIn: 8 * 60 * 60,
  });
});

// POST /api/auth/logout - Revoke session
authRouter.post('/logout', requireJwtAuth, (req: AuthenticatedRequest, res: Response) => {
  const sessionId = req.sessionId;

  db.prepare(`
    UPDATE sessions SET is_active = 0 WHERE id = ?
  `).run(sessionId);

  logAuthEvent({
    event: 'logout',
    adminName: req.adminName,
    apiKeyId: req.apiKeyId,
    ipAddress: req.ip || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown',
    success: true,
    requestId: req.id,
  });

  res.json({
    success: true,
    message: 'Logged out successfully',
  });
});
```

5. Update frontend to handle tokens:
```typescript
// src/ui/builder/src/hooks/useAuth.ts
const login = async (apiKey: string) => {
  try {
    // Exchange API key for JWT
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });

    if (!response.ok) {
      throw new Error('Invalid API key');
    }

    const data = await response.json();

    // Store tokens in localStorage
    localStorage.setItem('access_token', data.accessToken);
    localStorage.setItem('refresh_token', data.refreshToken);
    localStorage.setItem('token_expires_at', (Date.now() + data.expiresIn * 1000).toString());

    setState({
      isAuthenticated: true,
      isLoading: false,
      user: data.user,
      error: null,
    });

    // Setup token refresh
    setupTokenRefresh(data.expiresIn);
  } catch (error) {
    setState({
      isAuthenticated: false,
      isLoading: false,
      user: null,
      error: error.message,
    });
    throw error;
  }
};

// Auto-refresh token before expiration
function setupTokenRefresh(expiresIn: number) {
  // Refresh 5 minutes before expiration
  const refreshTime = (expiresIn - 5 * 60) * 1000;

  setTimeout(async () => {
    try {
      const refreshToken = localStorage.getItem('refresh_token');
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        // Refresh failed - require re-login
        logout();
        return;
      }

      const data = await response.json();
      localStorage.setItem('access_token', data.accessToken);
      localStorage.setItem('token_expires_at', (Date.now() + data.expiresIn * 1000).toString());

      // Setup next refresh
      setupTokenRefresh(data.expiresIn);
    } catch (error) {
      console.error('Token refresh failed:', error);
      logout();
    }
  }, refreshTime);
}
```

**Acceptance Criteria:**
- [ ] JWT access tokens expire after 8 hours
- [ ] Refresh tokens expire after 7 days
- [ ] Tokens auto-refresh 5 minutes before expiration
- [ ] Failed refresh triggers re-login
- [ ] Sessions stored in database
- [ ] Logout endpoint revokes session
- [ ] Expired sessions cleaned up (daily cron job)
- [ ] Inactivity timeout (30 minutes) optional
- [ ] Unit tests for JWT generation/verification
- [ ] Integration tests for token refresh flow

**Estimated Effort:** 8 hours

---

### Issue Group 2: API Security

#### HIGH-4: Missing CORS Configuration

**Severity:** HIGH
**CVSS Score:** 6.3
**CWE:** CWE-942 (Overly Permissive Cross-Origin Resource Sharing)

**Issue Description:**
No CORS policy is configured, allowing any origin to make requests to the API. This enables CSRF attacks and unauthorized cross-origin access.

**Attack Vector:**
```html
<!-- Attacker hosts this on evil.com -->
<script>
  // User visits evil.com while logged into builder.example.com
  fetch('https://api.builder.example.com/themes', {
    method: 'DELETE',
    headers: {
      'x-api-key': 'stolen_key_from_xss',
    },
    credentials: 'include',
  })
  .then(() => alert('All themes deleted!'));
</script>
```

**Files Affected:**
- `src/api/server.ts` - Configure CORS middleware
- `package.json` - Add `cors` dependency

**Remediation Steps:**

1. Install CORS library:
```bash
npm install cors @types/cors
```

2. Configure strict CORS policy:
```typescript
// src/api/server.ts
import cors from 'cors';

// CORS configuration
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      callback(null, true);
      return;
    }

    // Whitelist of allowed origins
    const allowedOrigins = [
      process.env.BUILDER_URL || 'http://localhost:5173', // Frontend dev
      process.env.PRODUCTION_URL, // Production frontend
      'https://builder.sietch.app', // Production domain
      'https://preview.sietch.app', // Preview domain
    ].filter(Boolean);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn({ origin }, 'CORS: Origin not allowed');
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // Allow cookies and authorization headers
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-api-key',
    'x-request-id',
  ],
  exposedHeaders: [
    'x-request-id',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
  ],
  maxAge: 86400, // 24 hours - cache preflight requests
};

// Apply CORS middleware BEFORE routes
app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));
```

3. Add environment variables:
```bash
# .env
BUILDER_URL=http://localhost:5173
PRODUCTION_URL=https://builder.sietch.app
CORS_ALLOWED_ORIGINS=https://builder.sietch.app,https://preview.sietch.app
```

4. Add CORS configuration validation:
```typescript
// src/config/cors.config.ts
import { logger } from '../utils/logger.js';

export function validateCorsConfig(): void {
  const requiredEnvVars = ['BUILDER_URL', 'PRODUCTION_URL'];
  const missing = requiredEnvVars.filter((envVar) => !process.env[envVar]);

  if (missing.length > 0) {
    logger.warn(
      { missing },
      'CORS configuration incomplete - some origins not configured'
    );
  }

  if (!process.env.PRODUCTION_URL && process.env.NODE_ENV === 'production') {
    logger.error('PRODUCTION_URL must be set in production environment');
    throw new Error('CORS configuration invalid for production');
  }
}
```

**Acceptance Criteria:**
- [ ] CORS whitelist enforced for all routes
- [ ] Only configured origins allowed
- [ ] Credentials (cookies, auth headers) only sent to whitelisted origins
- [ ] Preflight (OPTIONS) requests handled correctly
- [ ] Environment-specific configuration (dev vs production)
- [ ] Warning logged for rejected origins
- [ ] Unit tests for CORS validation logic
- [ ] Integration tests for cross-origin requests

**Estimated Effort:** 3 hours

---

#### HIGH-5: No API Key Rotation Mechanism

**Severity:** HIGH
**CVSS Score:** 6.1
**CWE:** CWE-798 (Use of Hard-coded Credentials)

**Issue Description:**
API keys are set via environment variables with no rotation mechanism. If a key is compromised, there's no easy way to invalidate it without restarting the service and updating all clients.

**Security Impact:**
- Compromised keys remain valid indefinitely
- No graceful key rotation
- Service downtime required to change keys
- Cannot support multiple concurrent keys
- No key expiration or versioning

**Files Affected:**
- `src/api/middleware.ts` - Support multiple API keys
- `src/db/schema/api-keys.schema.ts` - NEW: API key storage
- `src/api/routes/admin.routes.ts` - NEW: Key management endpoints
- `src/utils/api-keys.ts` - NEW: Key generation utilities

**Remediation Steps:**

1. Create API key schema:
```typescript
// src/db/schema/api-keys.schema.ts
export interface ApiKey {
  id: string;
  key_hash: string; // bcrypt hash of actual key
  key_prefix: string; // First 8 chars for identification (sk_12345678...)
  admin_name: string;
  description: string;
  created_at: Date;
  expires_at: Date | null;
  last_used_at: Date | null;
  is_active: boolean;
  permissions: string[]; // ['themes:read', 'themes:write', etc.]
}

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  admin_name TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  permissions TEXT NOT NULL
);

CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX idx_api_keys_admin ON api_keys(admin_name);
CREATE INDEX idx_api_keys_active ON api_keys(is_active);
```

2. Create key generation utilities:
```typescript
// src/utils/api-keys.ts
import crypto from 'crypto';
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

export interface GeneratedKey {
  id: string;
  key: string; // Full key (only shown once!)
  prefix: string;
  hash: string;
}

export function generateApiKey(): GeneratedKey {
  // Generate random key: sk_64_random_hex_chars
  const randomBytes = crypto.randomBytes(32);
  const key = `sk_${randomBytes.toString('hex')}`;
  const prefix = key.slice(0, 11); // sk_12345678
  const hash = bcrypt.hashSync(key, SALT_ROUNDS);

  return {
    id: crypto.randomUUID(),
    key,
    prefix,
    hash,
  };
}

export function verifyApiKey(key: string, hash: string): boolean {
  return bcrypt.compareSync(key, hash);
}

export function maskApiKey(key: string): string {
  if (key.length < 15) return '***';
  return `${key.slice(0, 11)}...${key.slice(-4)}`;
}
```

3. Create key management endpoints:
```typescript
// src/api/routes/admin.routes.ts
export const adminRouter = Router();

// POST /api/admin/keys - Generate new API key
adminRouter.post('/keys', requireMasterKey, async (req: AuthenticatedRequest, res: Response) => {
  const { adminName, description, expiresInDays, permissions } = req.body;

  // Validate inputs
  if (!adminName || !description) {
    res.status(400).json({
      success: false,
      error: 'adminName and description required',
    });
    return;
  }

  // Generate key
  const generated = generateApiKey();
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  // Store in database
  db.prepare(`
    INSERT INTO api_keys (
      id, key_hash, key_prefix, admin_name, description,
      created_at, expires_at, is_active, permissions
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    generated.id,
    generated.hash,
    generated.prefix,
    adminName,
    description,
    new Date().toISOString(),
    expiresAt?.toISOString() || null,
    JSON.stringify(permissions || ['*'])
  );

  logger.info({
    keyId: generated.id,
    prefix: generated.prefix,
    adminName,
  }, 'New API key generated');

  // Return full key (ONLY TIME IT'S SHOWN)
  res.json({
    success: true,
    message: 'API key generated. Store this securely - it will not be shown again.',
    key: generated.key,
    keyId: generated.id,
    prefix: generated.prefix,
    expiresAt,
  });
});

// GET /api/admin/keys - List API keys (without secrets)
adminRouter.get('/keys', requireMasterKey, (req: AuthenticatedRequest, res: Response) => {
  const keys = db.prepare(`
    SELECT
      id, key_prefix, admin_name, description,
      created_at, expires_at, last_used_at, is_active, permissions
    FROM api_keys
    ORDER BY created_at DESC
  `).all();

  res.json({
    success: true,
    data: keys.map((key: any) => ({
      ...key,
      permissions: JSON.parse(key.permissions),
    })),
  });
});

// DELETE /api/admin/keys/:keyId - Revoke API key
adminRouter.delete('/keys/:keyId', requireMasterKey, (req: AuthenticatedRequest, res: Response) => {
  const { keyId } = req.params;

  const result = db.prepare(`
    UPDATE api_keys SET is_active = 0 WHERE id = ?
  `).run(keyId);

  if (result.changes === 0) {
    res.status(404).json({
      success: false,
      error: 'API key not found',
    });
    return;
  }

  logger.info({ keyId }, 'API key revoked');

  res.json({
    success: true,
    message: 'API key revoked',
  });
});

// POST /api/admin/keys/:keyId/rotate - Rotate API key
adminRouter.post('/keys/:keyId/rotate', requireMasterKey, (req: AuthenticatedRequest, res: Response) => {
  const { keyId } = req.params;

  // Get existing key details
  const existingKey = db.prepare(`
    SELECT * FROM api_keys WHERE id = ?
  `).get(keyId) as ApiKey | undefined;

  if (!existingKey) {
    res.status(404).json({
      success: false,
      error: 'API key not found',
    });
    return;
  }

  // Generate new key
  const generated = generateApiKey();

  // Update database (atomic)
  db.prepare(`
    UPDATE api_keys
    SET key_hash = ?, key_prefix = ?, created_at = ?
    WHERE id = ?
  `).run(
    generated.hash,
    generated.prefix,
    new Date().toISOString(),
    keyId
  );

  logger.info({
    keyId,
    oldPrefix: existingKey.key_prefix,
    newPrefix: generated.prefix,
  }, 'API key rotated');

  res.json({
    success: true,
    message: 'API key rotated. Update your applications with the new key.',
    key: generated.key,
    keyId,
    prefix: generated.prefix,
  });
});
```

4. Update authentication middleware to support database keys:
```typescript
// src/api/middleware.ts
export async function requireApiKeyAsync(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || typeof apiKey !== 'string') {
    res.status(401).json({
      success: false,
      error: 'API key required',
    });
    return;
  }

  // Check environment variable (legacy support)
  const envApiKey = process.env.SIETCH_API_KEY ?? process.env.API_KEY;
  if (envApiKey && constantTimeCompare(apiKey, envApiKey)) {
    req.adminName = 'admin';
    req.apiKeyId = 'env-key';
    next();
    return;
  }

  // Check database keys
  const prefix = apiKey.slice(0, 11);
  const storedKey = db.prepare(`
    SELECT * FROM api_keys
    WHERE key_prefix = ? AND is_active = 1
  `).get(prefix) as ApiKey | undefined;

  if (!storedKey) {
    res.status(403).json({
      success: false,
      error: 'Invalid API key',
    });
    return;
  }

  // Check expiration
  if (storedKey.expires_at && new Date(storedKey.expires_at) < new Date()) {
    res.status(403).json({
      success: false,
      error: 'API key expired',
    });
    return;
  }

  // Verify key hash
  if (!verifyApiKey(apiKey, storedKey.key_hash)) {
    res.status(403).json({
      success: false,
      error: 'Invalid API key',
    });
    return;
  }

  // Update last used timestamp
  db.prepare(`
    UPDATE api_keys SET last_used_at = ? WHERE id = ?
  `).run(new Date().toISOString(), storedKey.id);

  // Set request metadata
  req.adminName = storedKey.admin_name;
  req.apiKeyId = storedKey.id;
  req.permissions = JSON.parse(storedKey.permissions);

  next();
}
```

**Acceptance Criteria:**
- [ ] Multiple API keys supported
- [ ] Keys stored as bcrypt hashes (not plaintext)
- [ ] Key generation endpoint creates cryptographically secure keys
- [ ] Key revocation endpoint immediately invalidates keys
- [ ] Key rotation endpoint generates new key while preserving metadata
- [ ] Keys have optional expiration dates
- [ ] Last used timestamp tracked
- [ ] List keys endpoint shows all keys (without secrets)
- [ ] Master key required for key management operations
- [ ] Migration path from environment variable to database keys
- [ ] Unit tests for key generation and verification
- [ ] Integration tests for key rotation workflow

**Estimated Effort:** 10 hours

---

## Additional HIGH Priority Issues

### HIGH-6: Sensitive Data Exposure in Error Messages

**Severity:** HIGH
**CWE:** CWE-209 (Information Exposure Through Error Message)

**Issue Description:**
Error messages may leak sensitive information (file paths, stack traces, database structure).

**Files Affected:**
- `src/api/middleware/error-handler.ts` - Sanitize error responses

**Remediation Steps:**
- Create production-safe error handler
- Never expose stack traces in production
- Log detailed errors server-side only
- Return generic messages to clients

**Acceptance Criteria:**
- [ ] Production errors return generic messages
- [ ] Development errors include stack traces
- [ ] Sensitive paths/data never exposed
- [ ] All errors logged server-side

**Estimated Effort:** 2 hours

---

### HIGH-7: Missing Input Length Limits

**Severity:** HIGH
**CWE:** CWE-770 (Allocation of Resources Without Limits)

**Issue Description:**
No size limits on request bodies, enabling DoS via large payloads.

**Files Affected:**
- `src/api/server.ts` - Add body size limits

**Remediation Steps:**
```typescript
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
```

**Acceptance Criteria:**
- [ ] Request body limited to 1MB
- [ ] Theme size limited to 500KB
- [ ] Component props limited to 100KB
- [ ] 413 status code for oversized requests

**Estimated Effort:** 1 hour

---

## Sprint Summary

**Total Issues:** 7 HIGH severity security issues

**Estimated Total Effort:** 34 hours (~4-5 days with testing)

**Risk Reduction:**
- Authentication hardening (rate limiting, audit logging, session expiration)
- API security (CORS, key rotation)
- Data protection (error sanitization, input limits)

**Testing Strategy:**
- Unit tests for all security utilities
- Integration tests for auth flows
- Manual penetration testing
- Automated security scanning (npm audit, Snyk)

**Success Metrics:**
- All HIGH findings remediated
- No new vulnerabilities introduced
- Security re-audit passes
- Zero HIGH/CRITICAL findings in production

---

## Next Steps

1. **Sprint Planning:**
   - Review and approve sprint scope
   - Assign tasks to engineers
   - Set up branch: `feature/sprint-10-security-hardening`

2. **Implementation:**
   - Follow remediation steps for each issue
   - Write tests for all security fixes
   - Document configuration changes

3. **Validation:**
   - Run security test suite
   - Perform manual penetration testing
   - Update security documentation

4. **Security Re-Audit:**
   - Request security re-audit after implementation
   - Address any new findings
   - Obtain approval for production deployment

5. **Sprint 11:**
   - Address MEDIUM priority issues
   - Implement additional security enhancements
   - Add monitoring and alerting

---

**Sprint Owner:** Security Engineering Team
**Reviewers:** Tech Lead, Security Auditor
**Target Completion:** 2026-01-26
**Security Re-Audit:** 2026-01-27
