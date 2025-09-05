const socket = io();

const els = {
  name: document.getElementById('name'),
  room: document.getElementById('room'),
  joinBtn: document.getElementById('joinBtn'),
  text: document.getElementById('text'),
  send: document.getElementById('send'),
  messages: document.getElementById('messages'),
  members: document.getElementById('members'),
  typing: document.getElementById('typing')
};

function addMsg({ user, text, ts, mine, system }) {
  const div = document.createElement('div');
  div.className = system ? 'bubble system' : mine ? 'bubble mine' : 'bubble';
  const when = ts ? new Date(ts).toLocaleTimeString() : '';
  div.innerHTML = system
    ? `<span class="system">${text}</span>`
    : `<div><strong>${user}</strong> <span class="meta">${when}</span></div><div>${escapeHtml(text)}</div>`;
  els.messages.appendChild(div);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;');
}

function renderMembers(list) {
  els.members.innerHTML = list.map(n => `<div>• ${escapeHtml(n)}</div>`).join('');
}

let joined = false;

els.joinBtn.addEventListener('click', () => {
  if (!els.name.value.trim() || !els.room.value.trim()) return alert('Enter username and room');
  socket.emit('join', { room: els.room.value.trim(), name: els.name.value.trim() });
  joined = true;
  els.text.focus();
});

els.send.addEventListener('click', () => {
  if (!joined) return alert('Join first');
  const text = els.text.value;
  if (!text.trim()) return;
  socket.emit('message', text);
  addMsg({ user: els.name.value, text, ts: Date.now(), mine: true });
  els.text.value = '';
  socket.emit('typing', false);
});

els.text.addEventListener('input', () => {
  if (!joined) return;
  socket.emit('typing', !!els.text.value);
});

socket.on('history', (arr) => {
  els.messages.innerHTML = '';
  arr.forEach(m => addMsg(m));
});

socket.on('message', (m) => addMsg(m));
socket.on('system', (t) => addMsg({ text: t, system: true }));
socket.on('presence', (list) => renderMembers(list));
socket.on('typing', ({ user, isTyping }) => {
  els.typing.textContent = isTyping ? `${user} is typing...` : '';
});
