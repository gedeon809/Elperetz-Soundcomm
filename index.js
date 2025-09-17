// backend/server.js
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const serverless = require("serverless-http");

const app = express();
app.use(cors({ origin: "*" }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket"],
});

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

io.on("connection", (socket) => {
  let currentRoom = null;
  let role = "A";

  socket.on("join-room", ({ room, role: r }) => {
    try {
      if (currentRoom) socket.leave(currentRoom);
      currentRoom = String(room || "main");
      role = r === "B" ? "B" : "A";
      socket.join(currentRoom);
      const st = ensureRoom(currentRoom);
      socket.emit("state:levels", st.levels);
      io.to(currentRoom).emit("log:append", { id: mkId(), at: nowTime(), from: "B", text: `Joined room ${currentRoom}`, senderId: socket.id });
    } catch {}
  });

  socket.on("state:requestLevels", ({ room }) => {
    const st = ensureRoom(room || currentRoom || "main");
    socket.emit("state:levels", st.levels);
  });

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

  socket.on("reset-levels", ({ room }) => {
    const r = String(room || currentRoom || "main");
    const st = ensureRoom(r);
    st.levels = Object.fromEntries(INSTRUMENTS.map(i => [i.key, INITIAL_LEVEL]));
    rooms.set(r, st);
    io.to(r).emit("state:levels", st.levels);
    io.to(r).emit("log:append", { id: mkId(), at: nowTime(), from: "B", text: "Levels reset", senderId: socket.id });
  });

  socket.on("disconnect", () => {});
});

// Endpoint to keep server alive and serve basic info
app.get("/", (_req, res) => res.send("SoundComm Socket server running"));

// Export the server for Vercel to use
module.exports.handler = serverless(server);
