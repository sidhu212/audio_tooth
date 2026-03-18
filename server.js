const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

// Configuration
const PORT = process.env.PORT || 3000;

// Initialize Express
const app = express();
app.use(cors());

// Serve static files from the current directory (serves index.html)
app.use(express.static(__dirname));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Create HTTP Server
const server = http.createServer(app);

// Initialize WebSocket Server
const wss = new WebSocket.Server({ server });

/**
 * Room structure:
 * rooms: Map<roomId, { sender: WebSocket, receiver: WebSocket }>
 */
const rooms = new Map();

/**
 * Generate a unique 6-digit room code
 */
function generateRoomCode() {
  let code;
  do {
    code = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms.has(code));
  return code;
}

/**
 * Clean up a room and notify remaining participants
 */
function handleDisconnect(ws) {
  const { roomId, role } = ws;
  if (!roomId || !rooms.has(roomId)) return;

  const room = rooms.get(roomId);

  if (role === 'sender') {
    console.log(`[Server] Sender left room ${roomId}. Deleting room.`);
    // If sender leaves, notify receiver and delete room
    if (room.receiver && room.receiver.readyState === WebSocket.OPEN) {
      room.receiver.send(JSON.stringify({ type: 'sender-disconnected' }));
    }
    rooms.delete(roomId);
  } else if (role === 'receiver') {
    console.log(`[Server] Receiver left room ${roomId}.`);
    // If receiver leaves, keep room and notify sender
    room.receiver = null;
    if (room.sender && room.sender.readyState === WebSocket.OPEN) {
      room.sender.send(JSON.stringify({ type: 'receiver-disconnected' }));
    }
  }
}

wss.on('connection', (ws) => {
  console.log('[Server] New client connected');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const { type } = data;

      switch (type) {
        case 'create-room': {
          const roomId = generateRoomCode();
          rooms.set(roomId, { sender: ws, receiver: null });
          ws.roomId = roomId;
          ws.role = 'sender';
          
          ws.send(JSON.stringify({ type: 'room-created', roomId }));
          console.log(`[Server] Room created: ${roomId} (Sender connected)`);
          break;
        }

        case 'join-room': {
          const { roomId } = data;
          if (!rooms.has(roomId)) {
            ws.send(JSON.stringify({ type: 'error', message: 'Room does not exist' }));
            return;
          }

          const room = rooms.get(roomId);
          if (room.receiver) {
            ws.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
            return;
          }

          room.receiver = ws;
          ws.roomId = roomId;
          ws.role = 'receiver';

          // Acknowledge receiver join
          ws.send(JSON.stringify({ type: 'room-joined', roomId }));
          
          // Notify sender that receiver joined
          if (room.sender && room.sender.readyState === WebSocket.OPEN) {
            room.sender.send(JSON.stringify({ type: 'receiver-joined' }));
          }

          console.log(`[Server] Receiver joined room: ${roomId}`);
          break;
        }

        case 'offer':
        case 'answer':
        case 'ice-candidate': {
          const { roomId } = ws;
          if (!roomId || !rooms.has(roomId)) return;

          const room = rooms.get(roomId);
          const target = (ws.role === 'sender') ? room.receiver : room.sender;

          if (target && target.readyState === WebSocket.OPEN) {
            target.send(JSON.stringify(data));
            console.log(`[Server] Relaying ${type} for room ${roomId} from ${ws.role}`);
          }
          break;
        }

        case 'leave-room': {
          handleDisconnect(ws);
          ws.roomId = null;
          ws.role = null;
          break;
        }

        default:
          console.warn(`[Server] Unknown event type: ${type}`);
      }
    } catch (error) {
      console.error('[Server] Error processing message:', error);
    }
  });

  ws.on('close', () => {
    handleDisconnect(ws);
  });

  ws.on('error', (err) => {
    console.error('[Server] WebSocket error:', err);
    handleDisconnect(ws);
  });
});

server.listen(PORT, () => {
  console.log(`[Server] Signaling server running on port ${PORT}`);
});
