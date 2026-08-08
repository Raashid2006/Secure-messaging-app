import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DB_FILE = join(DATA_DIR, 'db.json');

const EMPTY = { users: {}, groups: {}, messages: [] };

export function loadDb() {
  if (!existsSync(DB_FILE)) {
    mkdirSync(DATA_DIR, { recursive: true });
    saveDb(EMPTY);
    return structuredClone(EMPTY);
  }
  try {
    return JSON.parse(readFileSync(DB_FILE, 'utf8'));
  } catch {
    return structuredClone(EMPTY);
  }
}

export function saveDb(db) {
  const tmp = DB_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  renameSync(tmp, DB_FILE);
}

const db = loadDb();

function persist() {
  saveDb(db);
}

export function newId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/* ---------------- users ---------------- */

export function createUser({ username, passwordHash, pubKey, avatar }) {
  const user = {
    id: newId('u'),
    username,
    passwordHash,
    pubKey,
    avatar,
    statusMessage: '',
    createdAt: new Date().toISOString(),
  };
  db.users[user.id] = user;
  persist();
  return user;
}

export function findUserByUsername(username) {
  const key = username.toLowerCase();
  return Object.values(db.users).find((u) => u.username.toLowerCase() === key) || null;
}

export function findUserById(id) {
  return db.users[id] || null;
}

export function updateUser(id, patch) {
  const user = db.users[id];
  if (!user) return null;
  Object.assign(user, patch);
  persist();
  return user;
}

export function listUsers() {
  return Object.values(db.users)
    .map(({ id, username, avatar, statusMessage, createdAt }) => ({
      id, username, avatar, statusMessage, createdAt,
    }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

export function publicUser(user, onlineIds = new Set()) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    statusMessage: user.statusMessage,
    pubKey: user.pubKey,
    online: onlineIds.has(user.id),
  };
}

/* ---------------- groups ---------------- */

export function createGroup({ name, avatar, ownerId, members = [] }) {
  const group = {
    id: newId('g'),
    name,
    avatar,
    ownerId,
    members: [
      { userId: ownerId, role: 'owner', joinedAt: new Date().toISOString() },
      ...members.map((userId) => ({
        userId,
        role: 'member',
        joinedAt: new Date().toISOString(),
      })),
    ],
    createdAt: new Date().toISOString(),
  };
  db.groups[group.id] = group;
  persist();
  return group;
}

export function getGroup(id) {
  return db.groups[id] || null;
}

export function listGroupsForUser(userId) {
  return Object.values(db.groups)
    .filter((g) => g.members.some((m) => m.userId === userId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function addGroupMember(groupId, userId) {
  const group = db.groups[groupId];
  if (!group || group.members.some((m) => m.userId === userId)) return group;
  group.members.push({ userId, role: 'member', joinedAt: new Date().toISOString() });
  persist();
  return group;
}

export function removeGroupMember(groupId, userId) {
  const group = db.groups[groupId];
  if (!group) return null;
  group.members = group.members.filter((m) => m.userId !== userId);
  persist();
  return group;
}

export function setGroupMemberRole(groupId, userId, role) {
  const group = db.groups[groupId];
  if (!group) return null;
  const member = group.members.find((m) => m.userId === userId);
  if (member) member.role = role;
  persist();
  return group;
}

/* ---------------- messages ---------------- */

export function dmRoomId(a, b) {
  return [a, b].sort().join(':');
}

export function addMessage({ type, roomId, from, to, payload }) {
  const message = {
    id: newId('m'),
    type,
    roomId,
    from,
    to,
    payload,
    ts: new Date().toISOString(),
    readBy: [],
  };
  db.messages.push(message);
  persist();
  return message;
}

export function getMessages(roomId, { before, limit = 50 } = {}) {
  let list = db.messages.filter((m) => m.roomId === roomId);
  if (before) {
    list = list.filter((m) => m.id < before);
  }
  return list
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .slice(-limit);
}

export function markDelivered(messageId, userId) {
  const m = db.messages.find((x) => x.id === messageId);
  if (m && !m.readBy.includes(userId)) {
    m.readBy.push(userId);
    persist();
    return true;
  }
  return false;
}

export function markRead(messageIds, userId) {
  const changed = [];
  for (const id of messageIds) {
    const m = db.messages.find((x) => x.id === id);
    if (m && !m.readBy.includes(userId)) {
      m.readBy.push(userId);
      changed.push(id);
    }
  }
  if (changed.length) persist();
  return changed;
}

/* ---------------- misc ---------------- */

export function allMessages() {
  return db.messages;
}

export function getAllUsers() {
  return Object.values(db.users);
}
