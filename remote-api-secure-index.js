import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import crypto, { webcrypto } from 'crypto';
import fs from 'fs';

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '12mb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 12 * 1024 * 1024
});

const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_CODE_LENGTH = 8;
const PAIRING_TTL_MS = 5 * 60 * 1000;
const MAX_USER_MESSAGE_TEXT_LENGTH = 32000;
const MAX_REMOTE_IMAGES = 4;
const MAX_REMOTE_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_REMOTE_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024;
const REMOTE_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const rateLimits = new Map();
const GITHUB_CONNECT_TTL_MS = 5 * 60 * 1000;
const GITHUB_APP_ID = process.env.GITHUB_APP_ID || '3678959';
const GITHUB_APP_SLUG = process.env.GITHUB_APP_SLUG || process.env.GITHUB_APP_NAME || '';
const GITHUB_APP_PRIVATE_KEY_PATH = process.env.GITHUB_APP_PRIVATE_KEY_PATH || '';
const GITHUB_APP_PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY || '';
const githubInstallationTokenCache = new Map();
let githubAppSlugCache = GITHUB_APP_SLUG;

let db;

(async () => {
  try {
    db = await open({
      filename: './remote_tooling.db',
      driver: sqlite3.Database
    });

    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS accounts (
        uuid TEXT PRIMARY KEY,
        api_key TEXT
      );
      CREATE TABLE IF NOT EXISTS device_tokens (
        id TEXT PRIMARY KEY,
        account_uuid TEXT NOT NULL,
        device_type TEXT NOT NULL,
        token_hash TEXT UNIQUE NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER,
        revoked_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS pairing_codes (
        code TEXT PRIMARY KEY,
        uuid TEXT,
        expires_at INTEGER,
        account_uuid TEXT,
        used_at INTEGER,
        created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT,
        role TEXT,
        content TEXT,
        timestamp INTEGER
      );
      CREATE TABLE IF NOT EXISTS tool_requests (
        id TEXT PRIMARY KEY,
        uuid TEXT,
        action_type TEXT,
        details TEXT,
        status TEXT,
        timestamp INTEGER
      );
      CREATE TABLE IF NOT EXISTS github_connect_sessions (
        state_hash TEXT PRIMARY KEY,
        poll_token_hash TEXT NOT NULL,
        client_name TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        installation_id INTEGER,
        account_login TEXT,
        account_type TEXT,
        connected_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS github_installations (
        installation_id INTEGER PRIMARY KEY,
        account_login TEXT,
        account_type TEXT,
        connected_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS github_integration_tokens (
        id TEXT PRIMARY KEY,
        installation_id INTEGER NOT NULL,
        token_hash TEXT UNIQUE NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        revoked_at INTEGER
      );
    `);

    await ensureColumn('accounts', 'user_id', 'TEXT');
    await ensureColumn('accounts', 'created_at', 'INTEGER');
    await ensureColumn('pairing_codes', 'account_uuid', 'TEXT');
    await ensureColumn('pairing_codes', 'used_at', 'INTEGER');
    await ensureColumn('pairing_codes', 'created_at', 'INTEGER');

    console.log('Database initialized.');
  } catch (err) {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  }
})();

const ALLOWED_MIGRATIONS = {
  accounts: {
    user_id: 'TEXT',
    created_at: 'INTEGER'
  },
  pairing_codes: {
    account_uuid: 'TEXT',
    used_at: 'INTEGER',
    created_at: 'INTEGER'
  }
};

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

async function ensureColumn(table, column, definition) {
  const allowedTable = ALLOWED_MIGRATIONS[table];
  if (!allowedTable) {
    throw new Error(`Refusing migration on unknown table: ${table}`);
  }

  const expectedDefinition = allowedTable[column];
  if (!expectedDefinition || expectedDefinition !== definition) {
    throw new Error(`Refusing migration with unknown column or definition: ${table}.${column} ${definition}`);
  }

  if (!SAFE_IDENTIFIER.test(table) || !SAFE_IDENTIFIER.test(column) || !SAFE_IDENTIFIER.test(definition)) {
    throw new Error('Refusing migration with unsafe identifier');
  }

  const columns = await db.all(`PRAGMA table_info(${table})`);
  if (!columns.some((col) => col.name === column)) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function timingSafeStringEqual(a, b) {
  try {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${key}`;
}

function verifyPassword(password, storedHash) {
  const [scheme, salt, storedKey] = String(storedHash || '').split(':');
  if (scheme !== 'scrypt' || !salt || !storedKey) return false;
  const key = crypto.scryptSync(password, salt, 64).toString('hex');
  return timingSafeStringEqual(key, storedKey);
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function validateUsername(username) {
  return /^[a-z0-9_-]{3,32}$/.test(username);
}

function validatePassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 256;
}

function createOpaqueToken(prefix) {
  return `${prefix}_${crypto.randomBytes(32).toString('base64url')}`;
}

async function issueDeviceToken(accountUuid, deviceType) {
  const token = createOpaqueToken(deviceType === 'cli' ? 'bcli' : 'bapp');
  await db.run(
    'INSERT INTO device_tokens (id, account_uuid, device_type, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
    uuidv4(),
    accountUuid,
    deviceType,
    sha256(token),
    Date.now(),
    Date.now()
  );
  return token;
}

async function authenticateToken(token, allowedTypes = ['app', 'cli']) {
  if (!token || typeof token !== 'string') return null;
  const tokenHash = sha256(token);
  const row = await db.get(
    'SELECT id, account_uuid, device_type FROM device_tokens WHERE token_hash = ? AND revoked_at IS NULL',
    tokenHash
  );
  if (!row || !allowedTypes.includes(row.device_type)) return null;
  await db.run('UPDATE device_tokens SET last_seen_at = ? WHERE id = ?', Date.now(), row.id);
  return row;
}

async function authMiddleware(req, res, next) {
  try {
    const header = req.get('authorization') || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ error: 'Missing bearer token' });

    const token = await authenticateToken(match[1]);
    if (!token) return res.status(401).json({ error: 'Invalid bearer token' });

    req.remoteAuth = token;
    next();
  } catch (err) {
    next(err);
  }
}

function getGitHubPrivateKey() {
  if (GITHUB_APP_PRIVATE_KEY) {
    return GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n');
  }
  if (GITHUB_APP_PRIVATE_KEY_PATH) {
    return fs.readFileSync(GITHUB_APP_PRIVATE_KEY_PATH, 'utf8');
  }
  return '';
}

function getGitHubConfigStatus() {
  const privateKeyAvailable = Boolean(GITHUB_APP_PRIVATE_KEY)
    || Boolean(GITHUB_APP_PRIVATE_KEY_PATH && fs.existsSync(GITHUB_APP_PRIVATE_KEY_PATH));
  return {
    configured: Boolean(GITHUB_APP_ID && privateKeyAvailable),
    appId: GITHUB_APP_ID,
    appSlug: githubAppSlugCache || null,
    privateKeyAvailable
  };
}

function requireGitHubConfigured() {
  const status = getGitHubConfigStatus();
  if (!status.configured) {
    const missing = [];
    if (!GITHUB_APP_ID) missing.push('GITHUB_APP_ID');
    if (!status.privateKeyAvailable) missing.push('GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH');
    const error = new Error(`GitHub App backend is not configured. Missing: ${missing.join(', ')}`);
    error.status = 503;
    throw error;
  }
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createGitHubAppJwt() {
  requireGitHubConfigured();
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' });
  const payload = base64UrlJson({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: GITHUB_APP_ID
  });
  const signingInput = `${header}.${payload}`;
  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(signingInput), getGitHubPrivateKey())
    .toString('base64url');
  return `${signingInput}.${signature}`;
}

async function githubFetch(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Banana-Code-GitHub-App',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const error = new Error(data?.message || `GitHub API returned ${res.status}`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return { status: res.status, data };
}

async function getGitHubAppSlug() {
  if (githubAppSlugCache) return githubAppSlugCache;
  const appJwt = createGitHubAppJwt();
  const response = await githubFetch('/app', { token: appJwt });
  const slug = response.data?.slug || response.data?.html_url?.split('/apps/')[1];
  if (!slug) throw new Error('GitHub did not return an App slug.');
  githubAppSlugCache = slug;
  return slug;
}

async function getGitHubInstallationToken(installationId) {
  const key = String(installationId);
  const cached = githubInstallationTokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60 * 1000) {
    return cached.token;
  }

  const appJwt = createGitHubAppJwt();
  const response = await githubFetch(`/app/installations/${encodeURIComponent(key)}/access_tokens`, {
    method: 'POST',
    token: appJwt
  });
  const token = response.data?.token;
  const expiresAt = Date.parse(response.data?.expires_at || '') || Date.now() + 50 * 60 * 1000;
  if (!token) throw new Error('GitHub did not return an installation token.');

  githubInstallationTokenCache.set(key, { token, expiresAt });
  return token;
}

async function fetchGitHubInstallation(installationId) {
  const appJwt = createGitHubAppJwt();
  const response = await githubFetch(`/app/installations/${encodeURIComponent(String(installationId))}`, {
    token: appJwt
  });
  const account = response.data?.account || {};
  return {
    id: Number(response.data?.id || installationId),
    accountLogin: account.login || '',
    accountType: account.type || ''
  };
}

async function issueGitHubIntegrationToken(installationId) {
  const token = createOpaqueToken('bgh');
  await db.run(
    'INSERT INTO github_integration_tokens (id, installation_id, token_hash, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)',
    uuidv4(),
    installationId,
    sha256(token),
    Date.now(),
    Date.now()
  );
  return token;
}

async function authenticateGitHubIntegrationToken(token) {
  if (!token || typeof token !== 'string') return null;
  const row = await db.get(
    `SELECT t.id, t.installation_id, i.account_login, i.account_type
     FROM github_integration_tokens t
     LEFT JOIN github_installations i ON i.installation_id = t.installation_id
     WHERE t.token_hash = ? AND t.revoked_at IS NULL`,
    sha256(token)
  );
  if (!row) return null;
  await db.run('UPDATE github_integration_tokens SET last_used_at = ? WHERE id = ?', Date.now(), row.id);
  return row;
}

async function githubIntegrationAuthMiddleware(req, res, next) {
  try {
    const header = req.get('authorization') || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ error: 'Missing GitHub integration bearer token' });

    const auth = await authenticateGitHubIntegrationToken(match[1]);
    if (!auth) return res.status(401).json({ error: 'Invalid GitHub integration token' });

    req.githubAuth = auth;
    next();
  } catch (err) {
    next(err);
  }
}

function normalizeGitHubRestPath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.startsWith('/')) {
    throw new Error('GitHub API path must start with /.');
  }
  if (rawPath.startsWith('//') || rawPath.includes('://') || rawPath.includes('..')) {
    throw new Error('GitHub API path is not allowed.');
  }

  const parsed = new URL(rawPath, 'https://api.github.com');
  const path = `${parsed.pathname}${parsed.search}`;
  const allowed = path === '/installation/repositories'
    || path.startsWith('/installation/repositories?')
    || path.startsWith('/repos/');
  if (!allowed) {
    throw new Error('GitHub API path must be /installation/repositories or begin with /repos/.');
  }
  return path;
}

function normalizeGitHubMethod(method) {
  const normalized = String(method || 'GET').trim().toUpperCase();
  if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(normalized)) {
    throw new Error('Unsupported GitHub API method.');
  }
  return normalized;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function rateLimit(name, maxHits, windowMs) {
  return (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    const bucket = rateLimits.get(key) || { count: 0, resetAt: now + windowMs };

    if (bucket.resetAt <= now) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }

    bucket.count += 1;
    rateLimits.set(key, bucket);

    if (bucket.count > maxHits) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    next();
  };
}

function generatePairingCode() {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += PAIRING_ALPHABET[crypto.randomInt(PAIRING_ALPHABET.length)];
  }
  return code;
}

function roleRoom(accountUuid, role) {
  return `${accountUuid}:${role}`;
}

function decodedBase64Bytes(base64) {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function normalizeRemoteImage(image, index) {
  if (!image || typeof image !== 'object') {
    throw new Error(`Image ${index + 1} is invalid.`);
  }

  const mimeType = String(image.mimeType || image.mediaType || '').toLowerCase();
  const base64 = typeof image.base64 === 'string' ? image.base64.trim() : '';

  if (!REMOTE_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error(`Image ${index + 1} has an unsupported type.`);
  }
  if (!base64) {
    throw new Error(`Image ${index + 1} is empty.`);
  }

  const byteLength = decodedBase64Bytes(base64);
  if (!Number.isFinite(byteLength) || byteLength <= 0) {
    throw new Error(`Image ${index + 1} is not valid base64.`);
  }
  if (byteLength > MAX_REMOTE_IMAGE_BYTES) {
    throw new Error(`Image ${index + 1} is larger than 2 MB.`);
  }

  return { base64, mimeType, byteLength };
}

function normalizeUserMessagePayload(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Message payload is required.');
  }

  const id = typeof data.id === 'string' ? data.id.trim() : '';
  const text = typeof data.text === 'string' ? data.text : '';
  const rawImages = Array.isArray(data.images) ? data.images : [];

  if (!id || id.length > 128) {
    throw new Error('Message id is required.');
  }
  if (text.length > MAX_USER_MESSAGE_TEXT_LENGTH) {
    throw new Error('Message text is too long.');
  }
  if (rawImages.length > MAX_REMOTE_IMAGES) {
    throw new Error(`At most ${MAX_REMOTE_IMAGES} images can be attached.`);
  }

  const images = rawImages.map(normalizeRemoteImage);
  const totalImageBytes = images.reduce((sum, image) => sum + image.byteLength, 0);
  if (totalImageBytes > MAX_REMOTE_TOTAL_IMAGE_BYTES) {
    throw new Error('Attached images are larger than 8 MB total.');
  }
  if (!text.trim() && images.length === 0) {
    throw new Error('Message text or an image attachment is required.');
  }

  const createdAt = Number.isFinite(data.createdAt) ? data.createdAt : Date.now();
  return {
    id,
    text,
    images: images.map(({ base64, mimeType }) => ({ base64, mimeType })),
    imageCount: images.length,
    createdAt
  };
}

function sanitizeUserMessage(message) {
  return {
    id: message.id,
    text: message.text,
    imageCount: message.imageCount,
    createdAt: message.createdAt
  };
}

function messageContentForStorage(message) {
  if (!message.imageCount) return message.text;
  const suffix = `[${message.imageCount} image attachment${message.imageCount === 1 ? '' : 's'}]`;
  return message.text.trim() ? `${message.text}\n\n${suffix}` : suffix;
}

async function createUserAccount(username, password) {
  const userId = uuidv4();
  const accountUuid = uuidv4();
  const now = Date.now();

  await db.run('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    userId, username, hashPassword(password), now);
  await db.run('INSERT INTO accounts (uuid, api_key, user_id, created_at) VALUES (?, ?, ?, ?)',
    accountUuid, null, userId, now);

  const token = await issueDeviceToken(accountUuid, 'app');
  return { uuid: accountUuid, token };
}

const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

app.get('/api/remote/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/remote/auth/register', rateLimit('register', 10, 15 * 60 * 1000), asyncHandler(async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const { password } = req.body;

  if (!validateUsername(username)) {
    return res.status(400).json({ error: 'Username must be 3-32 characters and use only letters, numbers, underscores, or dashes.' });
  }
  if (!validatePassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const auth = await createUserAccount(username, password);
    res.json({ username, ...auth });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    throw err;
  }
}));

app.post('/api/remote/auth/login', rateLimit('login', 20, 15 * 60 * 1000), asyncHandler(async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const { password } = req.body;

  const user = await db.get('SELECT id, username, password_hash FROM users WHERE username = ?', username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const account = await db.get('SELECT uuid FROM accounts WHERE user_id = ?', user.id);
  if (!account) return res.status(500).json({ error: 'Account missing' });

  const token = await issueDeviceToken(account.uuid, 'app');
  res.json({ username: user.username, uuid: account.uuid, token });
}));

app.post('/api/remote/auth/logout', authMiddleware, asyncHandler(async (req, res) => {
  await db.run('UPDATE device_tokens SET revoked_at = ? WHERE id = ?', Date.now(), req.remoteAuth.id);
  res.json({ ok: true });
}));

app.post('/api/remote/account', (req, res) => {
  res.status(410).json({ error: 'Anonymous remote accounts are disabled. Please sign up or log in.' });
});

app.post('/api/remote/pair', authMiddleware, rateLimit('pair-create', 30, 15 * 60 * 1000), asyncHandler(async (req, res) => {
  if (req.remoteAuth.device_type !== 'app') {
    return res.status(403).json({ error: 'Only app devices can create pairing codes' });
  }

  let code;
  let codeHash;
  for (let i = 0; i < 5; i++) {
    code = generatePairingCode();
    codeHash = sha256(code);
    const existing = await db.get('SELECT code FROM pairing_codes WHERE code = ?', codeHash);
    if (!existing) break;
  }

  const now = Date.now();
  await db.run(
    'INSERT OR REPLACE INTO pairing_codes (code, uuid, account_uuid, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)',
    codeHash,
    req.remoteAuth.account_uuid,
    req.remoteAuth.account_uuid,
    now + PAIRING_TTL_MS,
    now
  );

  res.json({ pairingCode: code, expiresAt: now + PAIRING_TTL_MS });
}));

app.post('/api/remote/pair/redeem', rateLimit('pair-redeem', 20, 15 * 60 * 1000), asyncHandler(async (req, res) => {
  const rawCode = String(req.body.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (rawCode.length !== PAIRING_CODE_LENGTH) {
    return res.status(400).json({ error: 'Invalid pairing code format' });
  }

  const codeHash = sha256(rawCode);
  const row = await db.get('SELECT account_uuid, uuid, expires_at, used_at FROM pairing_codes WHERE code = ?', codeHash);
  const accountUuid = row?.account_uuid || row?.uuid;

  if (!row || !accountUuid || row.used_at || row.expires_at < Date.now()) {
    return res.status(404).json({ error: 'Invalid or expired pairing code' });
  }

  await db.run('UPDATE pairing_codes SET used_at = ? WHERE code = ? AND used_at IS NULL', Date.now(), codeHash);
  const token = await issueDeviceToken(accountUuid, 'cli');
  res.json({ uuid: accountUuid, token });
}));

app.get('/api/remote/resolve/:code', (req, res) => {
  res.status(410).json({ error: 'Legacy pairing resolve is disabled. Update the CLI and use secure pairing.' });
});

app.get('/api/remote/messages', authMiddleware, asyncHandler(async (req, res) => {
  const msgs = await db.all(
    'SELECT * FROM messages WHERE uuid = ? ORDER BY timestamp ASC',
    req.remoteAuth.account_uuid
  );
  res.json(msgs);
}));

app.get('/api/remote/messages/:uuid', authMiddleware, asyncHandler(async (req, res) => {
  if (req.params.uuid !== req.remoteAuth.account_uuid) return res.status(403).json({ error: 'Forbidden' });
  const msgs = await db.all('SELECT * FROM messages WHERE uuid = ? ORDER BY timestamp ASC', req.params.uuid);
  res.json(msgs);
}));

app.get('/api/remote/tools', authMiddleware, asyncHandler(async (req, res) => {
  const tools = await db.all(
    'SELECT * FROM tool_requests WHERE uuid = ? ORDER BY timestamp DESC',
    req.remoteAuth.account_uuid
  );
  res.json(tools);
}));

app.get('/api/remote/tools/:uuid', authMiddleware, asyncHandler(async (req, res) => {
  if (req.params.uuid !== req.remoteAuth.account_uuid) return res.status(403).json({ error: 'Forbidden' });
  const tools = await db.all('SELECT * FROM tool_requests WHERE uuid = ? ORDER BY timestamp DESC', req.params.uuid);
  res.json(tools);
}));

app.get('/api/github/health', (req, res) => {
  const status = getGitHubConfigStatus();
  res.json({
    status: status.configured ? 'ok' : 'not_configured',
    appId: status.appId,
    appSlug: status.appSlug,
    privateKeyAvailable: status.privateKeyAvailable
  });
});

app.post('/api/github/connect/start', rateLimit('github-connect-start', 30, 15 * 60 * 1000), asyncHandler(async (req, res) => {
  requireGitHubConfigured();

  const state = createOpaqueToken('bghs');
  const pollToken = createOpaqueToken('bghp');
  const now = Date.now();
  const clientName = String(req.body?.clientName || '').slice(0, 120);

  await db.run(
    'INSERT INTO github_connect_sessions (state_hash, poll_token_hash, client_name, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    sha256(state),
    sha256(pollToken),
    clientName,
    now,
    now + GITHUB_CONNECT_TTL_MS
  );

  const appSlug = await getGitHubAppSlug();
  const installUrl = `https://github.com/apps/${encodeURIComponent(appSlug)}/installations/new?state=${encodeURIComponent(state)}`;
  res.json({ state, pollToken, installUrl, expiresAt: now + GITHUB_CONNECT_TTL_MS });
}));

app.get('/api/github/connect/callback', rateLimit('github-connect-callback', 60, 15 * 60 * 1000), asyncHandler(async (req, res) => {
  requireGitHubConfigured();

  const state = String(req.query.state || '');
  const installationId = Number(req.query.installation_id || 0);
  if (!state || !Number.isInteger(installationId) || installationId <= 0) {
    return res.status(400).send('Missing GitHub installation data.');
  }

  const stateHash = sha256(state);
  const session = await db.get('SELECT state_hash, expires_at, connected_at FROM github_connect_sessions WHERE state_hash = ?', stateHash);
  if (!session || session.expires_at < Date.now()) {
    return res.status(400).send('This GitHub connection session is expired. Return to Banana Code and run /github again.');
  }

  const installation = await fetchGitHubInstallation(installationId);
  const now = Date.now();
  await db.run(
    `INSERT INTO github_installations (installation_id, account_login, account_type, connected_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(installation_id) DO UPDATE SET
       account_login = excluded.account_login,
       account_type = excluded.account_type,
       updated_at = excluded.updated_at`,
    installation.id,
    installation.accountLogin,
    installation.accountType,
    now,
    now
  );
  await db.run(
    `UPDATE github_connect_sessions
     SET installation_id = ?, account_login = ?, account_type = ?, connected_at = ?
     WHERE state_hash = ?`,
    installation.id,
    installation.accountLogin,
    installation.accountType,
    now,
    stateHash
  );

  res.type('html').send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Banana Code GitHub Connected</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 680px; margin: 48px auto; line-height: 1.5;">
  <h1>GitHub connected</h1>
  <p>Banana Code is connected to <strong>${escapeHtml(installation.accountLogin)}</strong>. You can close this tab and return to the terminal.</p>
</body>
</html>`);
}));

app.get('/api/github/connect/poll', rateLimit('github-connect-poll', 300, 15 * 60 * 1000), asyncHandler(async (req, res) => {
  const state = String(req.query.state || '');
  const pollToken = String(req.get('X-Banana-GitHub-Poll-Token') || '');
  if (!state || !pollToken) return res.status(400).json({ error: 'Missing state or poll token' });

  const row = await db.get(
    'SELECT * FROM github_connect_sessions WHERE state_hash = ? AND poll_token_hash = ?',
    sha256(state),
    sha256(pollToken)
  );
  if (!row || row.expires_at < Date.now()) {
    return res.status(404).json({ error: 'GitHub connection session expired or not found' });
  }
  if (!row.installation_id || !row.connected_at) {
    return res.status(202).json({ pending: true });
  }

  const token = await issueGitHubIntegrationToken(row.installation_id);
  await db.run('DELETE FROM github_connect_sessions WHERE state_hash = ?', row.state_hash);
  res.json({
    token,
    installation: {
      id: row.installation_id,
      accountLogin: row.account_login,
      accountType: row.account_type
    }
  });
}));

app.get('/api/github/installation', githubIntegrationAuthMiddleware, asyncHandler(async (req, res) => {
  res.json({
    installation: {
      id: req.githubAuth.installation_id,
      accountLogin: req.githubAuth.account_login,
      accountType: req.githubAuth.account_type
    }
  });
}));

app.delete('/api/github/token', githubIntegrationAuthMiddleware, asyncHandler(async (req, res) => {
  await db.run('UPDATE github_integration_tokens SET revoked_at = ? WHERE id = ?', Date.now(), req.githubAuth.id);
  res.json({ ok: true });
}));

app.post('/api/github/rest', githubIntegrationAuthMiddleware, rateLimit('github-rest', 600, 15 * 60 * 1000), asyncHandler(async (req, res) => {
  const method = normalizeGitHubMethod(req.body?.method);
  const path = normalizeGitHubRestPath(req.body?.path);
  const body = req.body?.body === undefined ? undefined : req.body.body;
  const token = await getGitHubInstallationToken(req.githubAuth.installation_id);
  const response = await githubFetch(path, { method, token, body });
  res.status(response.status).json(response);
}));

app.use((err, req, res, next) => {
  console.error('[API Error]:', err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal Server Error' });
});

async function authenticateSocketJoin(socket, role, token) {
  const expectedDeviceType = role === 'cli' ? 'cli' : role === 'app' ? 'app' : null;
  if (!expectedDeviceType) {
    socket.emit('error', 'Invalid socket role');
    return false;
  }

  const auth = await authenticateToken(token, [expectedDeviceType]);
  if (!auth) {
    socket.emit('error', 'Invalid socket token');
    return false;
  }

  if (socket.uuid) {
    socket.leave(socket.uuid);
    if (socket.role) socket.leave(roleRoom(socket.uuid, socket.role));
  }
  socket.join(auth.account_uuid);
  socket.join(roleRoom(auth.account_uuid, role));
  socket.role = role;
  socket.uuid = auth.account_uuid;
  socket.deviceTokenId = auth.id;

  if (role === 'cli') {
    io.to(roleRoom(auth.account_uuid, 'app')).emit('cli_authorized', { message: 'CLI got authorized' });
  }

  socket.emit('join_authorized', { uuid: auth.account_uuid, role });
  return true;
}

io.on('connection', (socket) => {
  socket.on('join', async (data) => {
    try {
      const { role, token } = data || {};
      await authenticateSocketJoin(socket, role, token);
    } catch (err) {
      console.error('[Socket Join Error]:', err);
      socket.emit('error', 'Internal server error during join');
    }
  });

  socket.on('ai_message', async (data) => {
    try {
      if (socket.role !== 'cli' || !socket.uuid) return;
      const { text, turnId, final } = data;
      if (typeof text !== 'string' || !turnId) return;

      await db.run('INSERT INTO messages (uuid, role, content, timestamp) VALUES (?, ?, ?, ?)',
        socket.uuid, 'ai', text, Date.now());
      io.to(roleRoom(socket.uuid, 'app')).emit('ai_message', { text, turnId, final });
    } catch (err) {
      console.error('[Socket AI Message Error]:', err);
    }
  });

  socket.on('turn_end', async (data) => {
    try {
      if (socket.role !== 'cli' || !socket.uuid) return;
      const { turnId } = data || {};
      if (!turnId) return;
      io.to(roleRoom(socket.uuid, 'app')).emit('turn_end', { turnId });
    } catch (err) {
      console.error('[Socket Turn End Error]:', err);
    }
  });

  socket.on('tool_request', async (data) => {
    try {
      if (socket.role !== 'cli' || !socket.uuid) return;
      const { id, actionType, details } = data || {};
      if (!id || !actionType) return;

      await db.run('INSERT INTO tool_requests (id, uuid, action_type, details, status, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        id, socket.uuid, actionType, details || '', 'pending', Date.now());
      io.to(roleRoom(socket.uuid, 'app')).emit('tool_request', { id, actionType, details: details || '' });
    } catch (err) {
      console.error('[Socket Tool Request Error]:', err);
    }
  });

  socket.on('tool_cancel', async (data) => {
    try {
      if (socket.role !== 'cli' || !socket.uuid) return;
      const { id } = data || {};
      if (!id) return;

      await db.run('UPDATE tool_requests SET status = ? WHERE id = ? AND uuid = ? AND status = ?',
        'cancelled', id, socket.uuid, 'pending');
      io.to(roleRoom(socket.uuid, 'app')).emit('tool_cancel', { id });
    } catch (err) {
      console.error('[Socket Tool Cancel Error]:', err);
    }
  });

  socket.on('tool_event', async (data) => {
    try {
      if (socket.role !== 'cli' || !socket.uuid) return;
      const { id, actionType, details, status, timestamp } = data || {};
      if (!id || !actionType) return;

      io.to(roleRoom(socket.uuid, 'app')).emit('tool_event', { id, actionType, details: details || '', status, timestamp });
    } catch (err) {
      console.error('[Socket Tool Event Error]:', err);
    }
  });

  socket.on('imagegen_event', async (data) => {
    try {
      if (socket.role !== 'cli' || !socket.uuid) return;
      const { type, payload, turnId, timestamp } = data || {};
      if (!type || !turnId) return;

      io.to(roleRoom(socket.uuid, 'app')).emit(type, {
        ...(payload && typeof payload === 'object' ? payload : {}),
        turnId,
        timestamp
      });
    } catch (err) {
      console.error('[Socket ImageGen Event Error]:', err);
    }
  });

  socket.on('tool_response', async (data) => {
    try {
      if (socket.role !== 'app' || !socket.uuid) return;
      const { id, approved } = data || {};
      if (!id || typeof approved !== 'boolean') return;

      const result = await db.run(
        'UPDATE tool_requests SET status = ? WHERE id = ? AND uuid = ? AND status = ?',
        approved ? 'approved' : 'denied',
        id,
        socket.uuid,
        'pending'
      );

      if (result.changes > 0) {
        io.to(socket.uuid).emit('tool_response', { id, approved });
      }
    } catch (err) {
      console.error('[Socket Tool Response Error]:', err);
    }
  });

  socket.on('remote_capabilities_request', async () => {
    try {
      if (socket.role !== 'app' || !socket.uuid) return;
      io.to(roleRoom(socket.uuid, 'cli')).emit('remote_capabilities_request', { requestedAt: Date.now() });
    } catch (err) {
      console.error('[Socket Capabilities Request Error]:', err);
    }
  });

  socket.on('remote_capabilities', async (data) => {
    try {
      if (socket.role !== 'cli' || !socket.uuid) return;
      const capabilities = data && typeof data === 'object' ? data : {};
      io.to(roleRoom(socket.uuid, 'app')).emit('remote_capabilities', {
        imageAttachments: capabilities.imageAttachments === true,
        provider: String(capabilities.provider || ''),
        model: String(capabilities.model || ''),
        maxImages: Number.isFinite(capabilities.maxImages) ? capabilities.maxImages : MAX_REMOTE_IMAGES,
        maxImageBytes: Number.isFinite(capabilities.maxImageBytes) ? capabilities.maxImageBytes : MAX_REMOTE_IMAGE_BYTES
      });
    } catch (err) {
      console.error('[Socket Capabilities Error]:', err);
    }
  });

  socket.on('user_message', async (data) => {
    const id = typeof data?.id === 'string' ? data.id : '';
    try {
      if (socket.role !== 'app' || !socket.uuid) return;

      const cliSockets = io.sockets.adapter.rooms.get(roleRoom(socket.uuid, 'cli'));
      if (!cliSockets || cliSockets.size === 0) {
        socket.emit('user_message_status', {
          id,
          status: 'failed',
          error: 'No paired CLI is currently connected.'
        });
        return;
      }

      const message = normalizeUserMessagePayload(data);
      await db.run('INSERT INTO messages (uuid, role, content, timestamp) VALUES (?, ?, ?, ?)',
        socket.uuid, 'user', messageContentForStorage(message), Date.now());

      io.to(roleRoom(socket.uuid, 'cli')).emit('user_message', message);
      io.to(roleRoom(socket.uuid, 'app')).emit('user_message', sanitizeUserMessage(message));
    } catch (err) {
      const payload = { id, error: err.message || 'Invalid message.' };
      socket.emit('user_message_error', payload);
      socket.emit('user_message_status', { ...payload, status: 'failed' });
      console.error('[Socket User Message Error]:', err);
    }
  });

  socket.on('user_message_status', async (data) => {
    try {
      if (socket.role !== 'cli' || !socket.uuid) return;
      const { id, status, error } = data || {};
      if (!id || !['queued', 'running', 'done', 'failed'].includes(status)) return;
      io.to(roleRoom(socket.uuid, 'app')).emit('user_message_status', { id, status, error: error || null });
    } catch (err) {
      console.error('[Socket User Message Status Error]:', err);
    }
  });

  socket.on('user_message_error', async (data) => {
    try {
      if (socket.role !== 'cli' || !socket.uuid) return;
      const { id, error } = data || {};
      if (!id || !error) return;
      io.to(roleRoom(socket.uuid, 'app')).emit('user_message_error', { id, error });
    } catch (err) {
      console.error('[Socket User Message Error Relay Error]:', err);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Remote API Server running on port ${PORT}`);
});
