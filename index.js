const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();

// Enable CORS for all origins (adjust as needed for tighter security)
app.use(cors({ origin: "*" }));

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO server with WebSocket and Polling transports
const io = new Server(server, {
  cors: { origin: "*" }, // Allow all origins (adjust as needed)
  transports: ["websocket", "polling"], // Allow both WebSocket and Polling (fallback to Polling)
});

// Constants and Instrument Configuration
const INITIAL_LEVEL = 5;
const INSTRUMENTS = [
  { key: "keyboard", label: "Keyboard" },
  { key: "organ", label: "Organ" },
  { key: "guitar", label: "Guitar" },
  { key: "drum", label: "Drums" },
  { key: "conga", label: "Conga Drum" },
  { key: "monitor", label: "Monitor Speaker" },
  { key: "songleader", label: "Song Leader" },
];
const LABEL = Object.fromEntries(INSTRUMENTS.map(i => [i.key, i.label]));
const clamp = (n) => Math.max(0, Math.min(10, n));
const nowTime = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const mkId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// In-memory room state
const rooms = new Map(); // roomId -> { levels: {key: num} }

function ensureRoom(room) {
  if (!rooms.has(room)) {
    const levels = Object.fromEntries(INSTRUMENTS.map(i => [i.key, INITIAL_LEVEL]));
    rooms.set(room, { levels });
  }
  return rooms.get(room);
}

// Handle WebSocket connections
io.on("connection", (socket) => {
  let currentRoom = null;
  let role = "A";

  // Join Room
  socket.on("join-room", ({ room, role: r }) => {
    try {
      if (currentRoom) socket.leave(currentRoom);
      currentRoom = String(room || "main");
      role = r === "B" ? "B" : "A";
      socket.join(currentRoom);
      const st = ensureRoom(currentRoom);
      socket.emit("state:levels", st.levels);

      // Optional join message
      io.to(currentRoom).emit("log:append", { id: mkId(), at: nowTime(), from: "B", text: `Joined room ${currentRoom}`, senderId: socket.id });
    } catch (error) {
      console.error("Error joining room:", error);
    }
  });

  // Request Levels
  socket.on("state:requestLevels", ({ room }) => {
    const st = ensureRoom(room || currentRoom || "main");
    socket.emit("state:levels", st.levels);
  });

  // Handle 'a:request' events
  socket.on("a:request", ({ room, instrumentKey, action, text }) => {
    const r = String(room || currentRoom || "main");
    const payload = {
      id: mkId(),
      at: nowTime(),
      from: "A",
      text: text || `${LABEL[instrumentKey] || "Unknown"} – ${action}`,
      senderId: socket.id
    };
    io.to(r).emit("log:append", payload);
  });

  // Handle 'b:adjust' events
  socket.on("b:adjust", ({ room, instrumentKey, delta, text }) => {
    const r = String(room || currentRoom || "main");
    const st = ensureRoom(r);
    const prev = st.levels[instrumentKey] ?? INITIAL_LEVEL;
    const next = clamp(prev + (delta || 0));
    st.levels[instrumentKey] = next;

    io.to(r).emit("state:levels", st.levels);

    const verb = (delta || 0) > 0 ? "Increased" : "Lowered";
    const code = (delta || 0) > 0 ? "IC" : "LV";
    io.to(r).emit("log:append", {
      id: mkId(),
      at: nowTime(),
      from: "B",
      text: text || `${LABEL[instrumentKey] || "Unknown"} – ${verb} to ${next} (${code})`,
      senderId: socket.id
    });
  });

  // Handle 'b:ack' events
  socket.on("b:ack", ({ room, instrumentKey, text }) => {
    const r = String(room || currentRoom || "main");
    const label = LABEL[instrumentKey] || null;
    io.to(r).emit("log:append", {
      id: mkId(),
      at: nowTime(),
      from: "B",
      text: text || (label ? `${label} – Received ✅` : "RECEIVED ✅"),
      senderId: socket.id
    });
  });

  // Reset levels in room
  socket.on("reset-levels", ({ room }) => {
    const r = String(room || currentRoom || "main");
    const st = ensureRoom(r);
    st.levels = Object.fromEntries(INSTRUMENTS.map(i => [i.key, INITIAL_LEVEL]));
    rooms.set(r, st);
    io.to(r).emit("state:levels", st.levels);
    io.to(r).emit("log:append", { id: mkId(), at: nowTime(), from: "B", text: "Levels reset", senderId: socket.id });
  });

  // Disconnect
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

// Simple GET route to confirm server is up
app.get("/", (_req, res) => res.send("SoundComm Socket server running"));

// Set the port from environment variables (Railway will provide this) or fallback to 4000
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Socket server on http://localhost:${PORT}`));
