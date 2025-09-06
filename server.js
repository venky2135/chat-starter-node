const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ===== Storage =====
const DATA_FILE = path.join(__dirname, 'data.json');

let users = new Map(); // online users only: name -> { socketId }
let groups = new Map(); // groupName -> { members:Set, messages:[] }
let privateChats = new Map(); // key "a::b" -> { messages:[] }

// ---- Load data from file ----
function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const obj = JSON.parse(raw);

      groups = new Map(
        Object.entries(obj.groups || {}).map(([name, g]) => [
          name,
          { members: new Set(g.members), messages: g.messages || [] },
        ])
      );

      privateChats = new Map(
        Object.entries(obj.privateChats || {}).map(([key, t]) => [
          key,
          { messages: t.messages || [] },
        ])
      );

      console.log('✅ Data loaded from file');
    } catch (err) {
      console.error('❌ Failed to load data:', err);
    }
  } else {
    // default General group
    groups.set('General', { members: new Set(), messages: [] });
  }
}

// ---- Save data to file ----
function saveData() {
  const obj = {
    groups: Object.fromEntries(
      Array.from(groups.entries()).map(([name, g]) => [
        name,
        { members: Array.from(g.members), messages: g.messages },
      ])
    ),
    privateChats: Object.fromEntries(
      Array.from(privateChats.entries()).map(([key, t]) => [
        key,
        { messages: t.messages },
      ])
    ),
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2));
}

// Load at startup
loadData();

// ===== Helpers =====
function publicUserList() {
  return Array.from(users.keys());
}

function emitChatList(socket) {
  const contacts = publicUserList();
  const me = Array.from(users.entries()).find(([name, v]) => v.socketId === socket.id)?.[0];
  const filteredContacts = me ? contacts.filter((u) => u !== me) : contacts;

  const groupList = Array.from(groups.entries()).map(([name, g]) => ({
    name,
    members: g.members.size,
    joined: me ? g.members.has(me) : false,
  }));

  socket.emit('chat_list', { contacts: filteredContacts, groups: groupList });
}

function threadKey(a, b) {
  return [a, b].sort((x, y) => x.localeCompare(y)).join('::');
}

// ===== Socket.io =====
io.on('connection', (socket) => {
  console.log('New connection', socket.id);

  socket.on('join', ({ name }) => {
    users.set(name, { socketId: socket.id });
    socket.data.name = name;

    console.log(`${name} joined`);

    io.emit('presence', publicUserList());
    emitChatList(socket);

    // Auto-join General
    groups.get('General').members.add(name);
    saveData();
    socket.emit('toast', 'Joined General group automatically');
  });

  socket.on('get_chat_list', () => {
    emitChatList(socket);
  });

  socket.on('create_group', ({ name }) => {
    if (!groups.has(name)) {
      groups.set(name, { members: new Set(), messages: [] });
      saveData();
      console.log('Group created:', name);
      io.emit('chat_list_update');
    }
  });

  socket.on('join_group', ({ name }) => {
    const group = groups.get(name);
    if (group) {
      group.members.add(socket.data.name);
      saveData();
      socket.emit('toast', `You joined ${name}`);
      emitChatList(socket);
    }
  });

  socket.on('send_private', ({ to, text }) => {
    const from = socket.data.name;
    if (!from || !to || !text?.trim()) return;

    const key = threadKey(from, to);
    if (!privateChats.has(key)) privateChats.set(key, { messages: [] });

    const msg = { user: from, to, text, ts: Date.now() };
    privateChats.get(key).messages.push(msg);
    saveData();

    const target = users.get(to);
    if (target) io.to(target.socketId).emit('private_message', msg);
    io.to(socket.id).emit('private_message', { ...msg, mine: true });
  });

  socket.on('send_group', ({ group, text }) => {
    const g = groups.get(group);
    if (!g) return;
    const from = socket.data.name;
    if (!g.members.has(from)) return;

    const msg = { user: from, group, text, ts: Date.now() };
    g.messages.push(msg);
    saveData();

    g.members.forEach((m) => {
      const u = users.get(m);
      if (u) io.to(u.socketId).emit('group_message', msg);
    });
  });

  socket.on('load_group', ({ group }) => {
    const g = groups.get(group);
    if (!g) return;
    socket.emit('history', { type: 'group', id: group, messages: g.messages });
  });

  socket.on('load_private', ({ withUser }) => {
    const from = socket.data.name;
    if (!from || !withUser) return;
    const key = threadKey(from, withUser);
    const thread = privateChats.get(key) || { messages: [] };
    socket.emit('history', { type: 'private', id: withUser, messages: thread.messages });
  });

  socket.on('typing', ({ chat, isTyping }) => {
    const from = socket.data.name;
    if (!chat || !from) return;

    if (chat.type === 'private') {
      const target = users.get(chat.id);
      if (target) {
        io.to(target.socketId).emit('typing', { chat, user: from, isTyping });
      }
    } else if (chat.type === 'group') {
      const g = groups.get(chat.id);
      if (!g) return;
      g.members.forEach((m) => {
        if (m === from) return;
        const u = users.get(m);
        if (u) io.to(u.socketId).emit('typing', { chat, user: from, isTyping });
      });
    }
  });

  socket.on('disconnect', () => {
    const name = socket.data.name;
    if (name) {
      users.delete(name);
      io.emit('presence', publicUserList());
    }
    console.log('Disconnected', socket.id);
  });
});

server.listen(3000, () => console.log('Server running on http://localhost:3000'));
