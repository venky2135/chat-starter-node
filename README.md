# Chat Starter (Node.js + Socket.io)

Minimal WhatsApp-like chat starter to try locally.

## Prerequisites
- Node.js 18+ (check with `node -v`)
- npm (comes with Node)

## Run
```bash
cd chat-starter-node
npm install
npm run start
```

Open http://localhost:3000 in two browser tabs, enter different usernames, and chat in the same room name (default: `general`).

## Features
- Rooms
- Presence list
- Typing indicator
- Message history (last 20 per room; in-memory only)

## Notes
This is a demo starter. For production, add a database (e.g., MongoDB, Postgres), auth (JWT), and message persistence with pagination.
