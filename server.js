const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const express = require('express');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const DEFAULT_NODE_RED_URL = 'http://127.0.0.1:1880/radar';
const NODE_RED_RETRY_COOLDOWN_MS = process.env.NODE_RED_RETRY_COOLDOWN_MS
  ? Number(process.env.NODE_RED_RETRY_COOLDOWN_MS)
  : 10_000;
const HTTPS_PORT_INPUT = process.env.HTTPS_PORT;
const HTTPS_PORT = HTTPS_PORT_INPUT ? Number(HTTPS_PORT_INPUT) : 3443;
const MIN_POST_INTERVAL_MS = 50;
const POST_TIMEOUT_MS = 5_000;

let radarState = {
  distance_mm: 0,
  angle_deg: 0,
  x_mm: 0,
  y_mm: 0,
  ts: new Date().toISOString(),
};

const sseClients = new Set();
let keepAliveTimer = null;

let nodeRedUrlInput = process.env.NODE_RED_HTTP_URL || DEFAULT_NODE_RED_URL;
let nodeRedUrl = null;
let nodeRedEnabled = false;
try {
  const parsed = new URL(nodeRedUrlInput);
  nodeRedUrl = parsed.toString();
  nodeRedEnabled = true;
} catch (error) {
  console.warn('[Node-RED] Disabled: invalid NODE_RED_HTTP_URL');
}

let scheduledNodeRedPush = null;
let nodeRedDirty = false;
let nodeRedInFlight = false;
let nodeRedCooldownUntil = 0;
let lastNodeRedPostTime = 0;
let nodeRedErrorLogged = false;

const app = express();
app.use(express.json());

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write('retry: 2000\n\n');
  res.write(`data: ${JSON.stringify({ type: 'state', data: radarState })}\n\n`);
  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });

  ensureKeepAlive();
});

app.post('/update', (req, res) => {
  const { distance_mm, angle_deg } = req.body || {};

  if (!isNumber(distance_mm) || !isNumber(angle_deg)) {
    return res.status(400).json({ error: 'distance_mm and angle_deg must be numeric' });
  }

  updateRadarState(Number(distance_mm), Number(angle_deg));
  res.json({ status: 'ok', state: radarState });
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const httpServer = http.createServer(app);

httpServer.listen(PORT, () => {
  console.log(`Radar server listening on http://0.0.0.0:${PORT}`);
  logNodeRedStatus();
});

let httpsServer = null;
initializeHttpsServer();

process.on('SIGINT', () => {
  clearInterval(keepAliveTimer);
  httpServer.close(() => {
    if (httpsServer) {
      httpsServer.close(() => process.exit(0));
    } else {
      process.exit(0);
    }
  });
});

function initializeHttpsServer() {
  const keyPath = process.env.HTTPS_KEY_PATH;
  const certPath = process.env.HTTPS_CERT_PATH;

  if (!keyPath || !certPath) {
    if (process.env.HTTPS_PORT || process.env.HTTPS_KEY_PATH || process.env.HTTPS_CERT_PATH) {
      console.warn('[HTTPS] Disabled: HTTPS_KEY_PATH and HTTPS_CERT_PATH must both be set');
    }
    return;
  }

  try {
    const credentials = {
      key: fs.readFileSync(path.resolve(keyPath)),
      cert: fs.readFileSync(path.resolve(certPath)),
    };

    if (process.env.HTTPS_PASSPHRASE) {
      credentials.passphrase = process.env.HTTPS_PASSPHRASE;
    }

    const httpsPort = Number.isFinite(HTTPS_PORT) ? HTTPS_PORT : 3443;
    if (!Number.isFinite(HTTPS_PORT) && HTTPS_PORT_INPUT) {
      console.warn(
        `[HTTPS] Invalid HTTPS_PORT value "${HTTPS_PORT_INPUT}" – falling back to ${httpsPort}`,
      );
    }

    httpsServer = https.createServer(credentials, app);
    httpsServer.listen(httpsPort, () => {
      console.log(`Radar server listening on https://0.0.0.0:${httpsPort}`);
      logNodeRedStatus();
    });
  } catch (error) {
    console.error(`[HTTPS] Failed to start HTTPS server: ${error.message}`);
    httpsServer = null;
  }
}

function logNodeRedStatus() {
  if (nodeRedEnabled) {
    console.log(`[Node-RED] Forwarding enabled to ${nodeRedUrl}`);
  } else {
    console.log('[Node-RED] Forwarding disabled');
  }
}

function updateRadarState(distanceMm, angleDeg) {
  const angleRad = (angleDeg * Math.PI) / 180;
  const x = Number((distanceMm * Math.cos(angleRad)).toFixed(3));
  const y = Number((distanceMm * Math.sin(angleRad)).toFixed(3));
  radarState = {
    distance_mm: Number(distanceMm.toFixed(3)),
    angle_deg: Number(angleDeg.toFixed(3)),
    x_mm: x,
    y_mm: y,
    ts: new Date().toISOString(),
  };

  broadcastState();
  scheduleNodeRedPush();
}

function broadcastState() {
  const payload = `data: ${JSON.stringify({ type: 'state', data: radarState })}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

function ensureKeepAlive() {
  if (keepAliveTimer) {
    return;
  }
  keepAliveTimer = setInterval(() => {
    for (const client of sseClients) {
      if (!client.writableEnded) {
        client.write(': keep-alive\n\n');
      }
    }
    if (!sseClients.size) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  }, 25_000);
}

function scheduleNodeRedPush() {
  if (!nodeRedEnabled) {
    return;
  }
  nodeRedDirty = true;
  if (scheduledNodeRedPush) {
    return;
  }
  scheduledNodeRedPush = setTimeout(executeNodeRedPush, 0);
}

function executeNodeRedPush() {
  scheduledNodeRedPush = null;
  if (!nodeRedEnabled) {
    nodeRedDirty = false;
    return;
  }
  if (!nodeRedDirty) {
    return;
  }
  const now = Date.now();
  if (nodeRedInFlight) {
    scheduledNodeRedPush = setTimeout(executeNodeRedPush, MIN_POST_INTERVAL_MS);
    return;
  }
  if (nodeRedCooldownUntil && now < nodeRedCooldownUntil) {
    scheduledNodeRedPush = setTimeout(executeNodeRedPush, nodeRedCooldownUntil - now);
    return;
  }
  const sinceLast = now - lastNodeRedPostTime;
  if (sinceLast < MIN_POST_INTERVAL_MS) {
    scheduledNodeRedPush = setTimeout(executeNodeRedPush, MIN_POST_INTERVAL_MS - sinceLast);
    return;
  }

  nodeRedDirty = false;
  nodeRedInFlight = true;
  const snapshot = { ...radarState };
  postToNodeRed(snapshot)
    .then(() => {
      lastNodeRedPostTime = Date.now();
      nodeRedInFlight = false;
      if (nodeRedDirty) {
        scheduleNodeRedPush();
      }
    })
    .catch(() => {
      nodeRedInFlight = false;
      nodeRedDirty = true;
      const nowTs = Date.now();
      const wait = nodeRedCooldownUntil > nowTs ? nodeRedCooldownUntil - nowTs : NODE_RED_RETRY_COOLDOWN_MS;
      scheduledNodeRedPush = setTimeout(executeNodeRedPush, wait);
    });
}

async function postToNodeRed(snapshot) {
  if (!nodeRedEnabled || !nodeRedUrl) {
    return;
  }

  const payload = {
    distance_mm: snapshot.distance_mm,
    angle_deg: snapshot.angle_deg,
    x_mm: snapshot.x_mm,
    y_mm: snapshot.y_mm,
    ts: snapshot.ts,
    source: 'radar-ui',
  };

  if (typeof fetch !== 'function') {
    throw new Error('Fetch API not available in this Node.js runtime');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);

  try {
    const response = await fetch(nodeRedUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Unexpected response ${response.status}`);
    }

    nodeRedCooldownUntil = 0;
    nodeRedErrorLogged = false;
  } catch (error) {
    nodeRedCooldownUntil = Date.now() + NODE_RED_RETRY_COOLDOWN_MS;
    if (!nodeRedErrorLogged) {
      console.error(`[Node-RED] POST failed: ${error.message}`);
      nodeRedErrorLogged = true;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

module.exports = {
  app,
  updateRadarState,
  get httpServer() {
    return httpServer;
  },
  get httpsServer() {
    return httpsServer;
  },
  get radarState() {
    return radarState;
  },
};
