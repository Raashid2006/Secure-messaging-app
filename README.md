# 🔒 SecureMessenger — Advanced End-to-End Encrypted Chat

An advanced, production-minded rewrite of the original [Secure-messaging-app](https://github.com/Raashid2006/Secure-messaging-app) WebSocket demo. The original was a plain, unencrypted two-user demo; this version is a full-stack app with **real end-to-end encryption**, authentication, profiles, group chats, and persistent history.

## Stack

| Layer | Tech |
| ----- | ---- |
| Frontend | React 18 + Vite, Socket.io-client, Lucide icons |
| Backend | Node.js + Express + Socket.io |
| Storage | JSON-file data store (`server/data/db.json`, atomic writes) |
| Crypto | WebCrypto: ECDH P-256 + AES-GCM, PBKDF2-SHA256 (100k iterations) |
| Auth | scrypt password hashing, hand-rolled HS256 JWTs |

## Features

- **End-to-end encryption (E2EE)** — the server only ever sees ciphertext and cannot read messages.
  - Each browser generates an ECDH P-256 keypair.
  - **DMs**: a shared AES-GCM key is derived per pair via ECDH.
  - **Group chats**: each message is encrypted with a random session key; the session key is individually wrapped for every member using their ECDH shared secret (fan-out).
  - Private keys never leave the device. They are stored in `localStorage` **encrypted with a key derived from your password** (PBKDF2), so re-logging in requires your password — and a lost password means lost keys (there is no backdoor).
- **Auth + profiles** — username/password registration & login, scrypt-hashed passwords, JWT sessions, avatars, status messages, online/offline presence.
- **Group chats** — create groups, add/remove members, owner/admin/member roles.
- **Message history** — messages are persisted server-side (encrypted) and loadable with scroll-back pagination. Encrypted messages can be decrypted later because recipients' wrapped keys are stored with each message.
- **Realtime polish** — typing indicators, read receipts (✓ sent / ✓✓ read), unread badges, live presence.

## Quick start

```bash
# 1. install everything
npm run install:all

# 2. terminal A — API + WebSocket server
npm run dev:server        # http://localhost:4000

# 3. terminal B — React client (dev, proxies /api & sockets to :4000)
npm run dev:client        # http://localhost:5173
```

Register two users in two browser tabs (or incognito + normal window) and message each other.

### Production

```bash
npm run build             # builds client/ -> client/dist
npm start                 # server serves the built app on :4000
```

### Tests

Spin up the server, then run the end-to-end integration suite (real sockets + real WebCrypto):

```bash
npm run dev:server
npm test                  # in client/: DM + group E2E, history, receipts, auth
```

## How the encryption works

1. **Key generation** — on registration the browser creates an ECDH P-256 keypair and sends only the public key to the server.
2. **Direct messages** — both parties derive the *same* AES-GCM key via `ECDH(myPrivateKey, theirPublicKey)`. Each message uses a fresh random 12-byte IV.
3. **Group messages** — the sender generates a random 256-bit session key, encrypts the message with it, then wraps the session key for **each** recipient: `AES-GCM(ECDH(senderPriv, memberPub), sessionKey)`. The message payload stores the ciphertext plus a `wrapped` map keyed by user id.
4. **Offline/history** — wrapped keys are stored with every message, so members can decrypt history anytime their keypair is unlocked.

> **Trust model**: public keys are fetched from the server (trust-on-first-use). A malicious server could substitute keys — the **key fingerprint** shown in the sidebar is how you verify you're really talking to the right person. In production this would be paired with an out-of-band key verification (like Signal's safety numbers).

## Project structure

```
secure-messaging-app/
├─ server/
│  ├─ src/
│  │  ├─ index.js       # Express + Socket.io bootstrap, static serving
│  │  ├─ routes.js      # REST: auth, users, groups, conversations, history
│  │  ├─ socket.js      # Realtime: send/read receipts, typing, presence
│  │  ├─ store.js       # JSON persistence (users, groups, messages)
│  │  ├─ auth.js        # scrypt + JWT signing/verification
│  │  └─ presence.js    # online status tracking
│  └─ data/             # created at runtime
└─ client/
   └─ src/
      ├─ crypto.js      # WebCrypto E2EE primitives (keys, encrypt, decrypt)
      ├─ api.js         # REST + socket helpers
      ├─ App.jsx        # session/unlock state machine
      ├─ styles.css     # full design system (light + dark)
      └─ components/    # Auth, Sidebar, Conversation, Bubble, Modals
```

## Security notes / production hardening

- Set a strong `JWT_SECRET` env var before deploying.
- Use HTTPS/WSS behind a reverse proxy (mkcert is already used by the portfolio dev setup; add TLS here for production).
- Passwords are never stored in plaintext (scrypt with per-user salt).
- Message payloads on the server are ciphertext only — the server cannot decrypt, even with DB access.
- Rate-limit the login/register endpoints and add CSRF protection if you extend the REST surface.
- The JSON-file store is simple and durable but not built for scale; swap in PostgreSQL/SQLite for real deployments.

## What's different from the original

| Original | Advanced version |
| -------- | ---------------- |
| Plaintext messages over the wire | E2E encrypted (ECDH + AES-GCM) |
| No auth at all | Register/login, scrypt, JWT |
| Single room, broadcast-style | DMs, group chats, roles |
| No persistence | Encrypted history + pagination |
| No presence/typing/receipts | Online status, typing, read receipts, unread counts |
| Vanilla JS single file | React + Vite client, Node + Socket.io server |
