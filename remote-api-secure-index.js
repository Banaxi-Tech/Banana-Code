import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import crypto, { webcrypto } from 'crypto';

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_CODE_LENGTH = 8;
const PAIRING_TTL_MS = 5 * 60 * 1000;
const rateLimits = new Map();

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

app.use((err, req, res, next) => {
  console.error('[API Error]:', err);
  res.status(500).json({ error: 'Internal Server Error' });
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

  if (socket.uuid) socket.leave(socket.uuid);
  socket.join(auth.account_uuid);
  socket.role = role;
  socket.uuid = auth.account_uuid;
  socket.deviceTokenId = auth.id;

  if (role === 'cli') {
    socket.to(auth.account_uuid).emit('cli_authorized', { message: 'CLI got authorized' });
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
      socket.to(socket.uuid).emit('ai_message', { text, turnId, final });
    } catch (err) {
      console.error('[Socket AI Message Error]:', err);
    }
  });

  socket.on('turn_end', async (data) => {
    try {
      if (socket.role !== 'cli' || !socket.uuid) return;
      const { turnId } = data || {};
      if (!turnId) return;
      socket.to(socket.uuid).emit('turn_end', { turnId });
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
      socket.to(socket.uuid).emit('tool_request', { id, actionType, details: details || '' });
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
      socket.to(socket.uuid).emit('tool_cancel', { id });
    } catch (err) {
      console.error('[Socket Tool Cancel Error]:', err);
    }
  });

  socket.on('tool_event', async (data) => {
    try {
      if (socket.role !== 'cli' || !socket.uuid) return;
      const { id, actionType, details, status, timestamp } = data || {};
      if (!id || !actionType) return;

      socket.to(socket.uuid).emit('tool_event', { id, actionType, details: details || '', status, timestamp });
    } catch (err) {
      console.error('[Socket Tool Event Error]:', err);
    }
  });

  socket.on('imagegen_event', async (data) => {
    try {
      if (socket.role !== 'cli' || !socket.uuid) return;
      const { type, payload, turnId, timestamp } = data || {};
      if (!type || !turnId) return;

      socket.to(socket.uuid).emit(type, {
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
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Remote API Server running on port ${PORT}`);
});
