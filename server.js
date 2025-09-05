const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// ✅ Use env PORT if available (important for hosting)
const PORT = process.env.PORT || 3000;

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// In-memory store (temporary, for demo only)
const rooms = new Map(); // roomName -> { users: Map(socketId -> username), messages: [] }

function ensureRoom(room) {
  if (!rooms.has(room)) {
    rooms.set(room, { users: new Map(), messages: [] });
  }
  return rooms.get(room);
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let username = null;

  // Join a room with username
  socket.on('join', ({ room, name }) => {
    if (!room || !name) return;

    currentRoom = room;
    username = name;

    socket.join(room);
    const r = ensureRoom(room);
    r.users.set(socket.id, username);

    // Send last 20 messages as history
    socket.emit('history', r.messages.slice(-20));

    socket.to(room).emit('system', `${username} joined`);
    io.to(room).emit('presence', Array.from(r.users.values()));
  });

  // Incoming message
  socket.on('message', (text) => {
    if (!currentRoom || !username || !text?.trim()) return;

    const msg = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      user: username,
      text: String(text).slice(0, 2000),
      ts: Date.now()
    };

    const r = ensureRoom(currentRoom);
    r.messages.push(msg);

    // Keep only last 200 messages per room
    if (r.messages.length > 200) r.messages.shift();

    io.to(currentRoom).emit('message', msg);
  });

  // Typing indicator
  socket.on('typing', (isTyping) => {
    if (!currentRoom || !username) return;
    socket.to(currentRoom).emit('typing', { user: username, isTyping: !!isTyping });
  });

  // Switch room
  socket.on('switchRoom', (room) => {
    if (!room || room === currentRoom) return;

    if (currentRoom) {
      socket.leave(currentRoom);
      const r = ensureRoom(currentRoom);
      r.users.delete(socket.id);
      socket.to(currentRoom).emit('system', `${username} left`);
      io.to(currentRoom).emit('presence', Array.from(r.users.values()));
    }

    currentRoom = null;

    // Reset client state
    socket.emit('clearchat');
    socket.emit('presence', []);
    socket.emit('system', 'Switching...');
    socket.emit('history', []);
    socket.emit('ready');
    socket.emit('joinRequest', room);
  });

  // Disconnect cleanup
  socket.on('disconnect', () => {
    if (currentRoom) {
      const r = ensureRoom(currentRoom);
      r.users.delete(socket.id);
      socket.to(currentRoom).emit('system', `${username ?? 'Someone'} left`);
      io.to(currentRoom).emit('presence', Array.from(r.users.values()));
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Chat server running on port ${PORT}`);
});
