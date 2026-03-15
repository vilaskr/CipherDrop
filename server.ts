import express from "express";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";

async function startServer() {
  const app = express();
  const PORT = 3000;

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // In-memory storage for rooms and messages
  // roomCode -> { users: { socketId: name }, messages: [] }
  const rooms = new Map<string, {
    users: Map<string, string>;
    messages: any[];
  }>();

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("join-room", ({ roomCode, name }) => {
      socket.join(roomCode);
      
      if (!rooms.has(roomCode)) {
        rooms.set(roomCode, { users: new Map(), messages: [] });
      }
      
      const room = rooms.get(roomCode)!;
      room.users.set(socket.id, name);
      
      // Send current users and messages to the new user
      const usersList = Array.from(room.users.values());
      socket.emit("room-state", {
        users: usersList,
        messages: room.messages
      });
      
      // Notify others
      socket.to(roomCode).emit("user-joined", { name, users: usersList });
    });

    socket.on("send-message", ({ roomCode, message }) => {
      const room = rooms.get(roomCode);
      if (room) {
        // message contains: sender, timestamp, ciphertext, iv, salt, expiresAt
        room.messages.push(message);
        
        // Broadcast to everyone in the room including sender
        io.to(roomCode).emit("new-message", message);
        
        // Auto-delete message from memory when it expires
        const timeUntilExpiry = message.expiresAt - Date.now();
        if (timeUntilExpiry > 0) {
          setTimeout(() => {
            if (rooms.has(roomCode)) {
              const currentRoom = rooms.get(roomCode)!;
              currentRoom.messages = currentRoom.messages.filter(m => m.timestamp !== message.timestamp || m.sender !== message.sender);
              io.to(roomCode).emit("message-expired", { timestamp: message.timestamp, sender: message.sender });
            }
          }, timeUntilExpiry);
        }
      }
    });

    socket.on("leave-room", (roomCode) => {
      socket.leave(roomCode);
      const room = rooms.get(roomCode);
      if (room) {
        const name = room.users.get(socket.id);
        room.users.delete(socket.id);
        
        if (room.users.size === 0) {
          rooms.delete(roomCode);
        } else {
          socket.to(roomCode).emit("user-left", { name, users: Array.from(room.users.values()) });
        }
      }
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
      rooms.forEach((room, roomCode) => {
        if (room.users.has(socket.id)) {
          const name = room.users.get(socket.id);
          room.users.delete(socket.id);
          if (room.users.size === 0) {
            rooms.delete(roomCode);
          } else {
            socket.to(roomCode).emit("user-left", { name, users: Array.from(room.users.values()) });
          }
        }
      });
    });
  });

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
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
  });
}

startServer();
