const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || '';
const ROOM_TTL_MS = 10 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const MAX_MESSAGES_PER_SECOND = 25;
const ROOM_ID_REGEX = /^\d{6}$/;
const VALID_TYPES = new Set([
  'create-room',
  'join-room',
  'offer',
  'answer',
  'ice-candidate',
  'leave-room',
]);

const app = express();
app.use(
  cors({
    origin(origin, callback) {
      // Allow server-to-server requests without Origin header.
      if (!origin) {
        callback(null, true);
        return;
      }
      if (!FRONTEND_URL) {
        callback(new Error('CORS not configured. Set FRONTEND_URL.'));
        return;
      }
      callback(null, origin === FRONTEND_URL);
    },
  }),
);

app.use(express.static(__dirname));
app.get('/health', (req, res) => {
  res.status(200).type('text/plain').send('OK');
});

const server = http.createServer(app);
const rooms = new Map();

function sendError(ws, message) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'error', message }));
}

function isValidRoomId(roomId) {
  return typeof roomId === 'string' && ROOM_ID_REGEX.test(roomId);
}

function touchRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.lastActivity = Date.now();
}

function generateRoomCode() {
  let code;
  do {
    code = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms.has(code));
  return code;
}

function removeRoom(roomId, reason) {
  const room = rooms.get(roomId);
  if (!room) return;

  if (room.sender && room.sender.readyState === WebSocket.OPEN) {
    room.sender.roomId = null;
    room.sender.role = null;
  }
  if (room.receiver && room.receiver.readyState === WebSocket.OPEN) {
    room.receiver.roomId = null;
    room.receiver.role = null;
  }
  rooms.delete(roomId);
  console.log(`[Server] room deleted ${roomId} (${reason})`);
}

function handleDisconnect(ws) {
  const { roomId, role } = ws;
  if (!roomId || !rooms.has(roomId)) return;

  const room = rooms.get(roomId);
  touchRoom(roomId);

  if (role === 'sender') {
    if (room.receiver && room.receiver.readyState === WebSocket.OPEN) {
      room.receiver.send(JSON.stringify({ type: 'sender-disconnected' }));
    }
    console.log(`[Server] user left room ${roomId} (sender)`);
    removeRoom(roomId, 'sender-left');
  } else if (role === 'receiver') {
    room.receiver = null;
    if (room.sender && room.sender.readyState === WebSocket.OPEN) {
      room.sender.send(JSON.stringify({ type: 'receiver-disconnected' }));
    }
    console.log(`[Server] user left room ${roomId} (receiver)`);
  }

  ws.roomId = null;
  ws.role = null;
}

function validateMessage(ws, data) {
  if (!data || typeof data !== 'object') {
    sendError(ws, 'Invalid message payload');
    return false;
  }
  if (!data.type || typeof data.type !== 'string') {
    sendError(ws, 'Message type is required');
    return false;
  }
  if (!VALID_TYPES.has(data.type)) {
    // Ignore unknown message types (basic abuse hardening).
    console.warn(`[Server] ignored unknown message type: ${data.type}`);
    return false;
  }
  if (data.type !== 'create-room' && data.type !== 'leave-room') {
    if (!isValidRoomId(data.roomId)) {
      sendError(ws, 'Invalid room code');
      return false;
    }
  }
  return true;
}

function isRateLimited(ws) {
  const now = Date.now();
  if (!ws.rateWindowStart || now - ws.rateWindowStart >= 1000) {
    ws.rateWindowStart = now;
    ws.rateMessageCount = 0;
  }
  ws.rateMessageCount += 1;
  return ws.rateMessageCount > MAX_MESSAGES_PER_SECOND;
}

const wss = new WebSocket.Server({
  server,
  verifyClient: (info, done) => {
    const origin = info.origin || '';
    if (!FRONTEND_URL) {
      done(false, 403, 'FRONTEND_URL is not configured');
      return;
    }
    if (origin !== FRONTEND_URL) {
      done(false, 403, 'Forbidden origin');
      return;
    }
    done(true);
  },
});

wss.on('connection', (ws) => {
  console.log('[Server] client connected');
  ws.roomId = null;
  ws.role = null;
  ws.rateWindowStart = 0;
  ws.rateMessageCount = 0;

  ws.on('message', (rawMessage) => {
    if (isRateLimited(ws)) {
      console.warn('[Server] rate limited message');
      return;
    }

    let data;
    try {
      data = JSON.parse(rawMessage);
    } catch (error) {
      sendError(ws, 'Invalid JSON');
      return;
    }

    if (!validateMessage(ws, data)) return;
    const { type } = data;

    try {
      switch (type) {
        case 'create-room': {
          const roomId = generateRoomCode();
          rooms.set(roomId, { sender: ws, receiver: null, lastActivity: Date.now() });
          ws.roomId = roomId;
          ws.role = 'sender';
          ws.send(JSON.stringify({ type: 'room-created', roomId }));
          console.log(`[Server] room created ${roomId}`);
          break;
        }
        case 'join-room': {
          const { roomId } = data;
          if (!rooms.has(roomId)) {
            sendError(ws, 'Invalid room');
            return;
          }
          const room = rooms.get(roomId);
          if (!room.sender || room.sender.readyState !== WebSocket.OPEN) {
            removeRoom(roomId, 'sender-offline');
            sendError(ws, 'Room is unavailable');
            return;
          }
          if (room.receiver && room.receiver.readyState === WebSocket.OPEN) {
            sendError(ws, 'Room is full');
            return;
          }

          room.receiver = ws;
          room.lastActivity = Date.now();
          ws.roomId = roomId;
          ws.role = 'receiver';
          ws.send(JSON.stringify({ type: 'room-joined', roomId }));
          room.sender.send(JSON.stringify({ type: 'receiver-joined' }));
          console.log(`[Server] user joined room ${roomId} (receiver)`);
          break;
        }
        case 'offer':
        case 'answer':
        case 'ice-candidate': {
          const activeRoomId = ws.roomId;
          if (!activeRoomId || !rooms.has(activeRoomId)) {
            sendError(ws, 'Room not found');
            return;
          }
          if (data.roomId !== activeRoomId) {
            sendError(ws, 'Cross-room signaling blocked');
            return;
          }

          const room = rooms.get(activeRoomId);
          const target = ws.role === 'sender' ? room.receiver : room.sender;
          room.lastActivity = Date.now();
          if (target && target.readyState === WebSocket.OPEN) {
            target.send(JSON.stringify(data));
            console.log(`[Server] signaling ${type} room=${activeRoomId} role=${ws.role}`);
          }
          break;
        }
        case 'leave-room': {
          handleDisconnect(ws);
          break;
        }
        default: {
          // Unreachable due to validation.
          break;
        }
      }
    } catch (error) {
      console.error('[Server] failed to process message:', error);
      sendError(ws, 'Server failed to process message');
    }
  });

  ws.on('close', () => {
    handleDisconnect(ws);
  });

  ws.on('error', (error) => {
    console.error('[Server] websocket error:', error);
    handleDisconnect(ws);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    if (now - room.lastActivity > ROOM_TTL_MS) {
      if (room.sender && room.sender.readyState === WebSocket.OPEN) {
        room.sender.send(JSON.stringify({ type: 'error', message: 'Room expired due to inactivity' }));
      }
      if (room.receiver && room.receiver.readyState === WebSocket.OPEN) {
        room.receiver.send(JSON.stringify({ type: 'error', message: 'Room expired due to inactivity' }));
      }
      removeRoom(roomId, 'inactive-timeout');
    }
  }
}, CLEANUP_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`[Server] signaling server running on port ${PORT}`);
  console.log(`[Server] allowed frontend origin: ${FRONTEND_URL || '(not set)'}`);
});
