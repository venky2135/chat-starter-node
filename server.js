const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;

// ==================================
// In-memory stores (for demo only)
// ==================================
/**
 * users: Map<username, { socketId: string, lastSeen: number }>
 * groups: Map<groupName, { members: Set<username>, messages: Message[] }>
 * privateChats: Map<threadKey, { messages: Message[] }>
 * Message = { id, user, text, ts, system?, kind?, to?, group? }
 */
const users = new Map();
const groups = new Map();
const privateChats = new Map();

// Create default group
ensureGroup('General');

function ensureGroup(name) {
  if (!groups.has(name)) groups.set(name, { members: new Set(), messages: [] });
  return groups.get(name);
}

function threadKey(a, b) {
  return [a, b].sort((x, y) => x.localeCompare(y)).join('::');
}

function trimPush(arr, item, max = 500) {
  arr.push(item);
  if (arr.length > max) arr.shift();
}

function publicUserList() {
  return Array.from(users.keys());
}

function id() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

io.on('connection', (socket) => {
  let username = null;

  // 1) Join with username; auto-join "General" group
  socket.on('join', ({ name }) => {
    if (!name || typeof name !== 'string') return;
    username = name.trim();
    if (!username) return;

    users.set(username, { socketId: socket.id, lastSeen: Date.now() });

    const general = ensureGroup('General');
    general.members.add(username);
    socket.join('General');

    emitChatList(socket); // initial lists

    io.emit('presence', publicUserList());
    io.emit('chat_list_update');

    const sysMsg = { id: id(), user: 'system', text: `${username} joined`, ts: Date.now(), system: true };
    trimPush(general.messages, sysMsg);
    io.to('General').emit('group_message', { group: 'General', ...sysMsg });
  });

  // 2) Load chat histories
  socket.on('load_private', ({ withUser }) => {
    if (!username || !withUser) return;
    const key = threadKey(username, withUser);
    const thread = privateChats.get(key) || { messages: [] };
    socket.emit('history', { type: 'private', id: withUser, messages: thread.messages.slice(-100) });
  });

  socket.on('load_group', ({ group }) => {
    if (!username || !group) return;
    const g = ensureGroup(group);
    socket.emit('history', { type: 'group', id: group, messages: g.messages.slice(-100) });
  });

  // 3) Create & join groups
  socket.on('create_group', ({ name }) => {
    if (!username) return;
    const group = String(name || '').trim();
    if (!group) return;
    if (groups.has(group)) {
      socket.emit('toast', `Group "${group}" already exists.`);
      return;
    }
    ensureGroup(group).members.add(username);
    socket.join(group);
    io.emit('chat_list_update');
    socket.emit('toast', `Created group "${group}"`);
  });

  socket.on('join_group', ({ name }) => {
    if (!username) return;
    const group = String(name || '').trim();
    if (!group || !groups.has(group)) return;
    const g = ensureGroup(group);
    g.members.add(username);
    socket.join(group);
    io.emit('chat_list_update');
    io.to(group).emit('toast', `${username} joined ${group}`);
  });

  // 4) Send messages
  socket.on('send_private', ({ to, text }) => {
    if (!username || !to || !text?.trim()) return;
    const msg = {
      id: id(),
      user: username,
      text: String(text).slice(0, 2000),
      ts: Date.now(),
      kind: 'private',
      to
    };
    const key = threadKey(username, to);
    const thread = privateChats.get(key) || { messages: [] };
    privateChats.set(key, thread);
    trimPush(thread.messages, msg);

    // To sender
    socket.emit('private_message', { ...msg, mine: true });

    // To recipient (if online)
    const rec = users.get(to);
    if (rec?.socketId) io.to(rec.socketId).emit('private_message', msg);

    io.emit('chat_list_update');
  });

  socket.on('send_group', ({ group, text }) => {
    if (!username || !group || !text?.trim()) return;
    const g = ensureGroup(group);
    if (!g.members.has(username)) return; // must be a member

    const msg = {
      id: id(),
      user: username,
      text: String(text).slice(0, 2000),
      ts: Date.now(),
      kind: 'group',
      group
    };
    trimPush(g.messages, msg);
    io.to(group).emit('group_message', msg);
    io.emit('chat_list_update');
  });

  // 5) Typing indicators
  socket.on('typing', ({ chat, isTyping }) => {
    if (!username || !chat) return;
    if (chat.type === 'private') {
      const rec = users.get(chat.id);
      if (rec?.socketId) io.to(rec.socketId).emit('typing', { chat, user: username, isTyping: !!isTyping });
    } else if (chat.type === 'group') {
      socket.to(chat.id).emit('typing', { chat, user: username, isTyping: !!isTyping });
    }
  });

  // 6) Ask for latest chat list
  socket.on('get_chat_list', () => emitChatList(socket));

  // 7) Disconnect
  socket.on('disconnect', () => {
    if (!username) return;
    users.delete(username);
    io.emit('presence', publicUserList());
    io.emit('chat_list_update');
  });
});

function emitChatList(socket) {
  // Contacts (online users except me)
  const contacts = publicUserList();
  const me = Array.from(users.entries()).find(([name, v]) => v.socketId === socket.id)?.[0];
  const filteredContacts = me ? contacts.filter((u) => u !== me) : contacts;

  // All groups (show member count)
  const groupList = Array.from(groups.entries()).map(([name, g]) => ({ name, members: g.members.size }));

  socket.emit('chat_list', { contacts: filteredContacts, groups: groupList });
}

server.listen(PORT, () => {
  console.log(`✅ Chat server running on http://localhost:${PORT}`);
});
