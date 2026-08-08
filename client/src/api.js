import { io } from 'socket.io-client';

const TOKEN_KEY = 'sm:token';
const USER_KEY = 'sm:user';

export function saveSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function loadSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  const rawUser = localStorage.getItem(USER_KEY);
  if (!token || !rawUser) return null;
  try {
    return { token, user: JSON.parse(rawUser) };
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function updateLocalUser(patch) {
  const session = loadSession();
  if (!session) return;
  saveSession(session.token, { ...session.user, ...patch });
}

async function request(path, options = {}) {
  const session = loadSession();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (session) headers.Authorization = `Bearer ${session.token}`;
  const res = await fetch(`/api${path}`, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const api = {
  register: (payload) => request('/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload) => request('/login', { method: 'POST', body: JSON.stringify(payload) }),
  me: () => request('/me'),
  users: () => request('/users'),
  conversations: () => request('/conversations'),
  createGroup: (payload) => request('/groups', { method: 'POST', body: JSON.stringify(payload) }),
  groups: () => request('/groups'),
  addGroupMember: (groupId, userId) =>
    request(`/groups/${groupId}/members`, { method: 'POST', body: JSON.stringify({ userId }) }),
  removeGroupMember: (groupId, userId) =>
    request(`/groups/${groupId}/members/${userId}`, { method: 'DELETE' }),
  dmHistory: (userId, before) =>
    request(`/messages/dm/${userId}${before ? `?before=${before}` : ''}`),
  groupHistory: (groupId, before) =>
    request(`/messages/group/${groupId}${before ? `?before=${before}` : ''}`),
};

/* ---------------- socket ---------------- */

let socket = null;

export function connectSocket(onEvent) {
  const session = loadSession();
  if (!session) return null;

  socket = io({
    auth: { token: session.token },
    transports: ['websocket', 'polling'],
  });

  const events = [
    'connect', 'disconnect', 'presence',
    'msg:new', 'msg:read', 'typing', 'typing:stop',
    'group:updated', 'group:created', 'user:updated', 'error:app',
  ];
  for (const ev of events) {
    socket.on(ev, (data) => onEvent(ev, data));
  }
  return socket;
}

export function getSocket() {
  return socket;
}

export function emitSocket(event, data) {
  if (socket) socket.emit(event, data);
}
