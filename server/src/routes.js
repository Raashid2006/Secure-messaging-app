import { Router } from 'express';
import {
  verifyToken,
  hashPassword as hashPasswordLocal,
  verifyPassword as verifyPasswordLocal,
  signToken as signTokenLocal,
} from './auth.js';
import * as store from './store.js';
import { onlineIds } from './presence.js';

export function createRouter({ io }) {
  const router = Router();
  function auth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = verifyToken(token);
    if (!payload || !payload.sub) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const user = store.findUserById(payload.sub);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    req.user = user;
    next();
  }

  /* ---------------- auth ---------------- */

  router.post('/register', (req, res) => {
    const { username, password, pubKey, avatar } = req.body || {};
    if (typeof username !== 'string' || !/^[A-Za-z0-9_.-]{2,24}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 2-24 chars (letters, numbers, _ . -)' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (typeof pubKey !== 'string' || pubKey.length < 16) {
      return res.status(400).json({ error: 'A valid public key is required' });
    }
    if (store.findUserByUsername(username)) {
      return res.status(409).json({ error: 'Username already taken' });
    }
    const user = store.createUser({
      username,
      passwordHash: hashPasswordLocal(password),
      pubKey,
      avatar: typeof avatar === 'string' && avatar ? avatar : '👤',
    });
    res.status(201).json({
      token: signTokenLocal({ sub: user.id, name: user.username }),
      user: store.publicUser(user, onlineIds()),
      pubKey: user.pubKey,
    });
  });

  router.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    const user = store.findUserByUsername(username || '');
    if (!user || !verifyPasswordLocal(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    res.json({
      token: signTokenLocal({ sub: user.id, name: user.username }),
      user: store.publicUser(user, onlineIds()),
      pubKey: user.pubKey,
    });
  });

  router.get('/me', auth, (req, res) => {
    res.json({ user: store.publicUser(req.user, onlineIds()), pubKey: req.user.pubKey });
  });

  /* ---------------- users & keys ---------------- */

  router.get('/users', auth, (req, res) => {
    res.json({ users: store.listUsers().map((u) => ({
      ...u,
      online: onlineIds().has(u.id),
    })) });
  });

  /* ---------------- groups ---------------- */

  router.get('/groups', auth, (req, res) => {
    const groups = store.listGroupsForUser(req.user.id).map((g) => ({
      ...g,
      members: g.members.map((m) => store.publicUser(store.findUserById(m.userId), onlineIds())),
    }));
    res.json({ groups });
  });

  router.post('/groups', auth, (req, res) => {
    const { name, avatar, memberIds = [] } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Group name is required' });
    }
    const ids = new Set(memberIds.filter((id) => store.findUserById(id)));
    ids.add(req.user.id);
    if (ids.size < 2) {
      return res.status(400).json({ error: 'Add at least one other member' });
    }
    const group = store.createGroup({
      name: name.trim().slice(0, 40),
      avatar: typeof avatar === 'string' && avatar ? avatar : '💬',
      ownerId: req.user.id,
      members: [...ids].filter((id) => id !== req.user.id),
    });
    const full = {
      ...group,
      members: group.members.map((m) => store.publicUser(store.findUserById(m.userId), onlineIds())),
    };
    emitToMembers(io, group, 'group:created', { group: full });
    res.status(201).json({ group: full });
  });

  router.post('/groups/:id/members', auth, (req, res) => {
    const group = store.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const me = group.members.find((m) => m.userId === req.user.id);
    if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
      return res.status(403).json({ error: 'Only the owner or admin can add members' });
    }
    const { userId } = req.body || {};
    if (!store.findUserById(userId)) return res.status(404).json({ error: 'User not found' });
    if (group.members.some((m) => m.userId === userId)) {
      return res.status(400).json({ error: 'Already a member' });
    }
    const updated = store.addGroupMember(group.id, userId);
    const full = {
      ...updated,
      members: updated.members.map((m) => store.publicUser(store.findUserById(m.userId), onlineIds())),
    };
    emitToMembers(io, updated, 'group:updated', { group: full });
    res.json({ group: full });
  });

  router.delete('/groups/:id/members/:userId', auth, (req, res) => {
    const group = store.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const me = group.members.find((m) => m.userId === req.user.id);
    if (!me || me.role !== 'owner') {
      return res.status(403).json({ error: 'Only the owner can remove members' });
    }
    if (req.params.userId === group.ownerId) {
      return res.status(400).json({ error: 'Cannot remove the owner' });
    }
    const updated = store.removeGroupMember(group.id, req.params.userId);
    const full = {
      ...updated,
      members: updated.members.map((m) => store.publicUser(store.findUserById(m.userId), onlineIds())),
    };
    emitToMembers(io, updated, 'group:updated', { group: full });
    io.to(`user:${req.params.userId}`).emit('group:removed', { groupId: group.id });
    res.json({ group: full });
  });

  /* ---------------- messages ---------------- */

  router.get('/messages/dm/:userId', auth, (req, res) => {
    const other = store.findUserById(req.params.userId);
    if (!other) return res.status(404).json({ error: 'User not found' });
    const roomId = store.dmRoomId(req.user.id, other.id);
    const before = req.query.before || undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    res.json({ messages: store.getMessages(roomId, { before, limit }) });
  });

  router.get('/messages/group/:groupId', auth, (req, res) => {
    const group = store.getGroup(req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!group.members.some((m) => m.userId === req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }
    const before = req.query.before || undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    res.json({ messages: store.getMessages(group.id, { before, limit }) });
  });

  /* ---------------- conversations (sidebar) ---------------- */

  router.get('/conversations', auth, (req, res) => {
    const me = req.user.id;
    const all = store.getAllUsers();
    const byId = Object.fromEntries(all.map((u) => [u.id, u]));
    const groups = store.listGroupsForUser(me);

    const dmRooms = {};
    for (const m of store.allMessages()) {
      if (m.type !== 'dm') continue;
      if (m.from !== me && m.to !== me) continue;
      const otherId = m.from === me ? m.to : m.from;
      const other = byId[otherId];
      if (!other) continue;
      const roomId = store.dmRoomId(me, otherId);
      if (!dmRooms[roomId] || m.ts > dmRooms[roomId].last.ts) {
        dmRooms[roomId] = {
          type: 'dm',
          id: roomId,
          other: {
            id: other.id,
            username: other.username,
            avatar: other.avatar,
            statusMessage: other.statusMessage,
            online: onlineIds().has(other.id),
          },
          last: m,
        };
      }
    }

    const dmList = Object.values(dmRooms).map((c) => ({
      type: 'dm',
      id: c.id,
      otherId: c.other.id,
      name: c.other.username,
      avatar: c.other.avatar,
      online: c.other.online,
      statusMessage: c.other.statusMessage,
      last: c.last,
      unread: store.allMessages().filter(
        (m) => m.roomId === c.id && m.from !== me && !m.readBy.includes(me)
      ).length,
    }));

    const groupList = groups.map((g) => {
      const memberIds = g.members.map((m) => m.userId);
      const msgs = store.allMessages().filter(
        (m) => m.roomId === g.id && m.from !== me && !m.readBy.includes(me)
      );
      const last = [...store.allMessages()]
        .filter((m) => m.roomId === g.id)
        .sort((a, b) => b.ts.localeCompare(a.ts))[0];
      return {
        type: 'group',
        id: g.id,
        name: g.name,
        avatar: g.avatar,
        online: true,
        memberCount: memberIds.length,
        last,
        unread: msgs.length,
      };
    });

    const allConv = [...dmList, ...groupList].sort((a, b) =>
      (b.last?.ts || '').localeCompare(a.last?.ts || '')
    );
    res.json({ conversations: allConv });
  });

  return router;
}

function emitToMembers(io, group, event, payload) {
  for (const m of group.members) {
    io.to(`user:${m.userId}`).emit(event, payload);
  }
}
