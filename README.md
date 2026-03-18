# Audio Tooth Signaling Server

A production-ready Node.js signaling server for WebRTC audio streaming, designed to enable browser-to-browser connections via a 6-digit room code.

## 🚀 Features

-   **Room System:** Simple 6-digit numeric room codes.
-   **WebRTC Support:** Relays `offer`, `answer`, and `ice-candidate` events.
-   **Production Ready:** Express-based with WebSocket support (`ws`).
-   **CORS Enabled:** Supports connections from all origins.
-   **Lightweight:** Built with zero client-side dependencies (for the server).

---

## 🛠️ Local Development

### 1. Prerequisites
-   [Node.js](https://nodejs.org/) (v18 or higher recommended)
-   `npm` or `yarn`

### 2. Installation
Clone or download the project and install the dependencies:
```bash
npm install
```

### 3. Running the Server
Start the server in production mode:
```bash
npm start
```

For development (with hot-reload):
```bash
npm run dev
```

The server will be available at `http://localhost:3000`.

---

## 📡 WebSocket API

### Client Events
The server expects JSON messages through the WebSocket connection using the following structure:

| Event             | Description                                                                 | Payload Example                                |
| ----------------- | --------------------------------------------------------------------------- | ---------------------------------------------- |
| `create-room`    | Sender creates a new room.                                                  | `{ "type": "create-room" }`                    |
| `join-room`      | Receiver joins an existing room using a code.                               | `{ "type": "join-room", "roomId": "123456" }` |
| `offer`           | Relay a WebRTC offer to the peer.                                           | `{ "type": "offer", "sdp": "..." }`           |
| `answer`          | Relay a WebRTC answer to the peer.                                          | `{ "type": "answer", "sdp": "..." }`          |
| `ice-candidate`   | Relay a WebRTC ICE candidate to the peer.                                   | `{ "type": "ice-candidate", "candidate": ... }`|
| `leave-room`     | Manually disconnect from a room.                                            | `{ "type": "leave-room" }`                     |

### Server Responses
-   `room-created`: Sent back to the sender with the 6-digit `roomId`.
-   `room-joined`: Sent back to the receiver upon successful join.
-   `receiver-joined`: Sent to the sender when a receiver connects.
-   `sender-disconnected`: Sent to the receiver when the sender leaves.
-   `receiver-disconnected`: Sent to the sender when the receiver leaves.
-   `error`: Sent to clients for invalid rooms, full rooms, etc.

---

## 🌍 Deployment (Render)

This server is pre-configured for deployment on [Render](https://render.com/).

1.  Connect your GitHub repository to Render.
2.  Choose **Web Service**.
3.  Set the following fields:
    -   **Runtime:** Node
    -   **Build Command:** `npm install`
    -   **Start Command:** `npm start`
4.  Render will automatically provide a `PORT` environment variable.

---

## 🔗 Health Check
You can verify the server is running by visiting:
`https://your-server-url.com/health`
