import express from "express";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";

interface ChatMessage {
  id: string;
  sender: string;
  senderId: string;
  timestamp: number;
  ciphertext: string;
  iv: string;
  salt: string;
  expiresAt: number;
}

interface Room {
  id: string;
  participants: { id: string; name: string }[];
  messages: ChatMessage[];
}

const rooms = new Map<string, Room>();

// Clean up expired messages periodically
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    const initialCount = room.messages.length;
    room.messages = room.messages.filter(m => m.expiresAt > now);
    if (room.messages.length < initialCount) {
      // Optional: notify clients about deleted messages if needed, 
      // but clients should also auto-delete them locally.
    }
    // Clean up empty rooms
    if (room.participants.length === 0 && room.messages.length === 0) {
      rooms.delete(roomId);
    }
  }
}, 5000);

async function startServer() {
  const app = express();
  const PORT = 3000;
  const httpServer = createServer(app);
  
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['polling', 'websocket']
  });

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // WebSocket Logic
  io.on("connection", (socket) => {
    console.log(`[Socket] New connection: ${socket.id} from ${socket.handshake.address}`);

    socket.on("join-room", (data) => {
      const { roomId, name } = data;
      if (!roomId || !name) {
        console.error(`[Socket] Invalid join-room data from ${socket.id}:`, data);
        return;
      }
      
      socket.join(roomId);
      socket.data.name = name;
      socket.data.roomId = roomId;

      if (!rooms.has(roomId)) {
        rooms.set(roomId, { id: roomId, participants: [], messages: [] });
      }
      
      const room = rooms.get(roomId)!;
      // Remove any existing participant with same socket ID
      room.participants = room.participants.filter(p => p.id !== socket.id);
      room.participants.push({ id: socket.id, name });

      console.log(`[Socket] User ${name} (${socket.id}) joined room ${roomId}`);

      // Broadcast to others in the room
      socket.to(roomId).emit("user-joined", { id: socket.id, name });

      // Send current state to the new user
      socket.emit("room-state", {
        participants: room.participants,
        messages: room.messages.filter(m => m.expiresAt > Date.now())
      });
    });

    socket.on("send-message", (data) => {
      const { roomId, message } = data;
      const room = rooms.get(roomId);
      if (room) {
        room.messages.push(message);
        // Broadcast to everyone in the room including sender? Or just others?
        socket.to(roomId).emit("receive-message", message);
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      const roomId = socket.data.roomId;
      if (roomId) {
        const room = rooms.get(roomId);
        if (room) {
          room.participants = room.participants.filter(p => p.id !== socket.id);
          socket.to(roomId).emit("user-left", { id: socket.id, name: socket.data.name });
        }
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

startServer();
