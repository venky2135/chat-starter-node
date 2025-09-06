const socket = io();

// Elements
const els = {
  name: document.getElementById('name'),
  joinBtn: document.getElementById('joinBtn'),
  newGroupName: document.getElementById('newGroupName'),
  createGroupBtn: document.getElementById('createGroupBtn'),
  people: document.getElementById('people'),
  groups: document.getElementById('groups'),
  presence: document.getElementById('presence'),
  chatTitle: document.getElementById('chatTitle'),
  chatAvatar: document.getElementById('chatAvatar'),
  messages: document.getElementById('messages'),
  typing: document.getElementById('typing'),
  text: document.getElementById('text'),
  send: document.getElementById('send'),
};

let me = null;
let activeChat = null; // { type: 'private'|'group', id: string }

// Helpers
function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function renderChatItem(name, type, joined) {
  const div = document.createElement('div');
  div.className = 'chat-item';
  div.dataset.chatType = type;
  div.dataset.chatId = name;
  div.innerHTML = `
    <div class="avatar">${escapeHtml(name.charAt(0).toUpperCase())}</div>
    <div class="meta">
      <div class="name">${escapeHtml(name)}</div>
      <div class="sub">${
        type === 'group'
          ? (joined ? 'Group' : 'Not a member — click to join')
          : 'Direct message'
      }</div>
    </div>
  `;

  div.addEventListener('click', () => {
    if (type === 'group' && !joined) {
      socket.emit('join_group', { name });
    } else {
      selectChat({ type, id: name }, div);
    }
  });

  return div;
}

function setActiveTile(tile) {
  document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
  tile?.classList.add('active');
}

function selectChat(chat, tileEl) {
  activeChat = chat;
  setActiveTile(tileEl);

  // Update header
  els.chatTitle.textContent = chat.id;
  els.chatAvatar.textContent = chat.id.charAt(0).toUpperCase();

  // Load history
  if (chat.type === 'private') socket.emit('load_private', { withUser: chat.id });
  else socket.emit('load_group', { group: chat.id });

  els.typing.textContent = '';
}

function clearMessages() {
  els.messages.innerHTML = '';
}

function addMsg({ user, text, ts, system, mine }) {
  const div = document.createElement('div');
  div.className = system ? 'bubble system' : 'bubble' + (mine ? ' mine' : '');
  const when = ts ? new Date(ts).toLocaleTimeString() : '';
  div.innerHTML = system
    ? `<span>${escapeHtml(text)}</span>`
    : `<div>${escapeHtml(text)}</div><div class="meta-time">${escapeHtml(user)} • ${when}</div>`;
  els.messages.appendChild(div);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function toast(t) {
  const d = document.createElement('div');
  d.className = 'toast';
  d.textContent = t;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2200);
}

// UI Events
els.joinBtn.addEventListener('click', () => {
  const name = els.name.value.trim();
  if (!name) return alert('Enter your name');
  me = name;
  socket.emit('join', { name });
  socket.emit('get_chat_list');
  els.text.focus();
});

els.createGroupBtn.addEventListener('click', () => {
  const name = els.newGroupName.value.trim();
  if (!name) return;
  socket.emit('create_group', { name });
  els.newGroupName.value = '';
});

els.send.addEventListener('click', sendMessage);
els.text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

els.text.addEventListener('input', () => {
  if (!activeChat) return;
  socket.emit('typing', { chat: activeChat, isTyping: !!els.text.value });
});

function sendMessage() {
  if (!activeChat) return alert('Select a chat first');
  const text = els.text.value;
  if (!text.trim()) return;

  if (activeChat.type === 'private') {
    socket.emit('send_private', { to: activeChat.id, text });
  } else {
    socket.emit('send_group', { group: activeChat.id, text });
  }
  els.text.value = '';
  socket.emit('typing', { chat: activeChat, isTyping: false });
}

// Socket listeners
socket.on('chat_list', ({ contacts, groups }) => {
  els.people.innerHTML = '';
  contacts.forEach((name) => {
    const item = renderChatItem(name, 'private', true);
    els.people.appendChild(item);
  });

  els.groups.innerHTML = '';
  groups.forEach((g) => {
    const item = renderChatItem(g.name, 'group', g.joined);
    els.groups.appendChild(item);
  });
});

socket.on('chat_list_update', () => socket.emit('get_chat_list'));

socket.on('history', ({ type, id, messages }) => {
  if (!activeChat || activeChat.type !== type || activeChat.id !== id) return;
  clearMessages();
  messages.forEach((m) => addMsg({ ...m, mine: m.user === me }));
});

socket.on('private_message', (m) => {
  const isCurrent =
    activeChat &&
    activeChat.type === 'private' &&
    (activeChat.id === m.user || activeChat.id === m.to);

  if (isCurrent) {
    addMsg({ ...m, mine: m.user === me });
  } else {
    toast(`New message from ${m.user}`);
  }
});

socket.on('group_message', (m) => {
  const isCurrent =
    activeChat && activeChat.type === 'group' && activeChat.id === m.group;

  if (isCurrent) {
    addMsg({ ...m, mine: m.user === me });
  } else {
    toast(`New message in ${m.group} from ${m.user}`);
  }
});

socket.on('typing', ({ chat, user, isTyping }) => {
  if (!activeChat || activeChat.type !== chat.type || activeChat.id !== chat.id) return;
  if (user === me) return;
  els.typing.textContent = isTyping ? `${user} is typing…` : '';
});

socket.on('presence', (list) => {
  els.presence.textContent = `Online: ${list.length} — ${list.join(', ')}`;
});

socket.on('toast', (t) => toast(t));
