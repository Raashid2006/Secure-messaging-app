import { verifyToken } from './auth.js';
import * as store from './store.js';
import { setOnline, setOffline } from './presence.js';

const MAX_PAYLOAD = 256 * 1024;

export function setupSocket(io) {
  io.use((socket, next) => {
    const payload = verifyToken(socket.handshake.auth?.token);
    if (!payload || !payload.sub) return next(new Error('Unauthorized'));
    const user = store.findUserById(payload.sub);
    if (!user) return next(new Error('Unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    const userId = user.id;

    socket.join(`user:${userId}`);
    setOnline(userId);
    io.emit('presence', { userId, online: true, username: user.username });

    socket.on('msg:send', (data) => {
      try {
        handleMessage(io, socket, data);
      } catch (err) {
        socket.emit('error:app', { message: err.message || 'Failed to send message' });
      }
    });

    socket.on('msg:read', (data) => {
      const roomId = String(data?.roomId || '');
      if (!roomId) return;
      const ids = store.allMessages()
        .filter((m) => m.roomId === roomId && m.from !== userId && !m.readBy.includes(userId))
        .map((m) => m.id);
      if (!ids.length) return;
      store.markRead(ids, userId);
      const senders = new Set(
        store.allMessages().filter((m) => ids.includes(m.id)).map((m) => m.from)
      );
      for (const senderId of senders) {
        io.to(`user:${senderId}`).emit('msg:read', { roomId, by: userId, ids });
      }
    });

    socket.on('typing:start', (data) => {
      const roomId = String(data?.roomId || '');
      if (!roomId) return;
      socket.to(`room:${roomId}`).emit('typing', { roomId, userId, username: user.username });
    });

    socket.on('typing:stop', (data) => {
      const roomId = String(data?.roomId || '');
      if (!roomId) return;
      socket.to(`room:${roomId}`).emit('typing:stop', { roomId, userId });
    });

    socket.on('join:room', (data) => {
      const roomId = String(data?.roomId || '');
      if (roomId) socket.join(`room:${roomId}`);
    });

    socket.on('leave:room', (data) => {
      const roomId = String(data?.roomId || '');
      if (roomId) socket.leave(`room:${roomId}`);
    });

    socket.on('status:set', (data) => {
      const statusMessage = String(data?.statusMessage || '').slice(0, 120);
      store.updateUser(userId, { statusMessage });
      socket.to(`user:${userId}`).emit('user:updated', { userId, statusMessage });
    });

    socket.on('disconnect', () => {
      setOffline(userId);
      io.emit('presence', { userId, online: false });
    });
  });
}

function handleMessage(io, socket, data) {
  const user = socket.data.user;
  const { type, to, payload } = data || {};

  if (!payload || typeof payload.iv !== 'string' || typeof payload.data !== 'string') {
    throw new Error('Malformed encrypted payload');
  }
  if (JSON.stringify(payload).length > MAX_PAYLOAD) {
    throw new Error('Message payload too large');
  }

  if (type === 'dm') {
    const other = store.findUserById(String(to || ''));
    if (!other) throw new Error('Recipient not found');
    const roomId = store.dmRoomId(user.id, other.id);
    const message = store.addMessage({ type: 'dm', roomId, from: user.id, to: other.id, payload });
    const deliverable = { ...message, fromUser: publicBrief(user), toUser: publicBrief(other) };
    io.to(`user:${other.id}`).emit('msg:new', deliverable);
    return message;
  }

  if (type === 'group') {
    const group = store.getGroup(String(to || ''));
    if (!group) throw new Error('Group not found');
    const me = group.members.find((m) => m.userId === user.id);
    if (!me) throw new Error('Not a member of this group');
    const message = store.addMessage({ type: 'group', roomId: group.id, from: user.id, to: group.id, payload });
    const deliverable = { ...message, fromUser: publicBrief(user), groupName: group.name };
    for (const m of group.members) {
      if (m.userId === user.id) continue;
      io.to(`user:${m.userId}`).emit('msg:new', deliverable);
    }
    return message;
  }

  throw new Error('Unknown message type');
}

function publicBrief(user) {
  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    statusMessage: user.statusMessage,
  };
}
