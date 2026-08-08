import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { api, connectSocket, emitSocket, updateLocalUser } from '../api.js';
import {
  importPublicKeyRaw,
  encryptDm,
  encryptGroup,
  decryptDm,
  decryptGroup,
} from '../crypto.js';
import Sidebar from './Sidebar.jsx';
import Conversation from './Conversation.jsx';
import { NewChatModal, NewGroupModal, GroupInfoModal } from './Modals.jsx';

export function dmRoomId(a, b) {
  return [a, b].sort().join(':');
}

export default function ChatApp({ session, keyPair, myPub, onLogout }) {
  const me = session.user;
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [active, setActive] = useState(null);          // conversation object
  const [messagesByRoom, setMessagesByRoom] = useState({});
  const [typingByRoom, setTypingByRoom] = useState({});
  const [toasts, setToasts] = useState([]);
  const [modal, setModal] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [statusDraft, setStatusDraft] = useState(me.statusMessage || '');
  const socketRef = useRef(null);
  const pubKeyCache = useRef({});
  const lastText = useRef({});
  const messagesByRoomRef = useRef({});

  const pubKeys = useMemo(() => {
    const map = {};
    for (const u of users) map[u.id] = u.pubKey;
    for (const g of groups) {
      for (const m of g.members) map[m.id] = m.pubKey;
    }
    return map;
  }, [users, groups]);

  const getPublicKey = useCallback((id) => pubKeys[id] || null, [pubKeys]);

  const toast = useCallback((message, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const refreshUsers = useCallback(async () => {
    try { setUsers((await api.users()).users); } catch { /* noop */ }
  }, []);

  const refreshGroups = useCallback(async () => {
    try { setGroups((await api.groups()).groups); } catch { /* noop */ }
  }, []);

  const refreshConversations = useCallback(async () => {
    try { setConversations((await api.conversations()).conversations); } catch { /* noop */ }
  }, []);

  const setMessagesForRoom = useCallback((roomId, fn) => {
    setMessagesByRoom((prev) => {
      const next = { ...prev, [roomId]: fn(prev[roomId] || []) };
      messagesByRoomRef.current = next;
      return next;
    });
  }, []);

  /* ---------------- decryption ---------------- */

  const decryptMessage = useCallback(async (msg) => {
    const fromKey = getPublicKey(msg.from);
    const mine = msg.from === me.id;
    try {
      if (!fromKey) throw new Error('no sender key');
      const theirPub = await importPublicKeyRaw(fromKey);
      const text = msg.type === 'dm'
        ? await decryptDm(msg.payload, keyPair.privateKey, theirPub)
        : await decryptGroup(msg.payload, keyPair.privateKey, theirPub, me.id);
      return { ...msg, text, mine, decrypted: true };
    } catch {
      return { ...msg, text: '🔒 Undecryptable message', mine, decrypted: false };
    }
  }, [getPublicKey, keyPair, me.id]);

  const ingestMessage = useCallback(async (msg, opts = {}) => {
    const { broadcast = false } = opts;
    const decrypted = await decryptMessage(msg);
    const roomId = msg.roomId;
    if (broadcast) lastText.current[roomId] = decrypted.text;
    setMessagesForRoom(roomId, (list) => [...list, decrypted]);

    const isActive = activeRef.current && activeRef.current.id === roomId;
    if (msg.from !== me.id && isActive) {
      emitSocket('msg:read', { roomId });
    } else if (msg.from !== me.id) {
      setConversations((cs) => cs.map((c) =>
        c.id === roomId ? { ...c, unread: (c.unread || 0) + 1, lastText: decrypted.text } : c
      ));
    } else {
      setConversations((cs) => cs.map((c) =>
        c.id === roomId ? { ...c, lastText: decrypted.text } : c
      ));
    }
  }, [decryptMessage, me.id, setMessagesForRoom]);

  /* keep active in a ref for socket handlers */
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);

  /* ---------------- socket wiring ---------------- */

  const handleEventRef = useRef(handleEvent);
  useEffect(() => { handleEventRef.current = handleEvent; }, [handleEvent]);

  useEffect(() => {
    socketRef.current = connectSocket((ev, data) => handleEventRef.current(ev, data));
    return () => { socketRef.current?.disconnect(); socketRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEvent = useCallback((ev, data) => {
    switch (ev) {
      case 'connect':
        refreshConversations();
        refreshUsers();
        break;

      case 'presence': {
        const { userId, online } = data;
        setUsers((us) => us.map((u) => (u.id === userId ? { ...u, online } : u)));
        setConversations((cs) => cs.map((c) =>
          c.type === 'dm' && c.otherId === userId ? { ...c, online } : c
        ));
        break;
      }

      case 'msg:new':
        ingestMessage(data, { broadcast: true });
        break;

      case 'msg:read':
        setMessagesForRoom(data.roomId, (list) =>
          list.map((m) =>
            data.ids.includes(m.id) && !m.readBy.includes(data.by)
              ? { ...m, readBy: [...m.readBy, data.by] }
              : m
          )
        );
        break;

      case 'typing':
        setTypingByRoom((t) => ({
          ...t,
          [data.roomId]: [...new Set([...(t[data.roomId] || []), data.username])],
        }));
        break;

      case 'typing:stop':
        setTypingByRoom((t) => ({
          ...t,
          [data.roomId]: (t[data.roomId] || []).filter((u) => u !== data.username),
        }));
        break;

      case 'group:updated':
      case 'group:created':
        refreshGroups();
        refreshConversations();
        if (activeRef.current?.id === data.group.id) {
          setActive((a) => (a && a.id === data.group.id ? { ...a, members: data.group.members } : a));
        }
        break;

      case 'group:removed':
        setGroups((gs) => gs.filter((g) => g.id !== data.groupId));
        setConversations((cs) => cs.filter((c) => c.id !== data.groupId));
        setMessagesByRoom((prev) => {
          const next = { ...prev };
          delete next[data.groupId];
          return next;
        });
        if (activeRef.current?.id === data.groupId) setActive(null);
        break;

      case 'user:updated':
        setUsers((us) => us.map((u) =>
          u.id === data.userId ? { ...u, statusMessage: data.statusMessage } : u
        ));
        setConversations((cs) => cs.map((c) =>
          c.type === 'dm' && c.otherId === data.userId ? { ...c, statusMessage: data.statusMessage } : c
        ));
        break;

      case 'error:app':
        toast(data.message || 'Something went wrong', 'err');
        break;

      default:
        break;
    }
  }, [ingestMessage, refreshConversations, refreshUsers, refreshGroups, setMessagesForRoom, toast]);

  /* ---------------- initial load ---------------- */

  useEffect(() => {
    refreshUsers();
    refreshGroups();
    refreshConversations();
  }, [refreshUsers, refreshGroups, refreshConversations]);

  /* ---------------- conversation management ---------------- */

  const openConversation = useCallback(async (conv) => {
    let resolved = conv;
    if (conv.type === 'group') {
      const group = groupsRef.current.find((g) => g.id === conv.id);
      if (group) resolved = { ...conv, members: group.members };
    }
    setActive(resolved);
    emitSocket('join:room', { roomId: resolved.id });
    emitSocket('msg:read', { roomId: resolved.id });

    if (messagesByRoomRef.current[resolved.id]) {
      return;
    }

    let list = [];
    try {
      if (resolved.type === 'dm') {
        list = (await api.dmHistory(resolved.otherId)).messages;
      } else {
        list = (await api.groupHistory(resolved.id)).messages;
      }
    } catch {
      /* ignore */
    }

    const decrypted = [];
    for (const m of list) {
      decrypted.push(await decryptMessage(m));
      if (m.from === me.id) lastText.current[resolved.id] = decrypted[decrypted.length - 1].text;
    }
    setMessagesForRoom(resolved.id, () => decrypted);
    setConversations((cs) => cs.map((c) => (c.id === resolved.id ? { ...c, unread: 0 } : c)));
    emitSocket('msg:read', { roomId: resolved.id });
  }, [decryptMessage, me.id, setMessagesForRoom]);

  const groupsRef = useRef(groups);
  useEffect(() => { groupsRef.current = groups; }, [groups]);

  const loadOlder = useCallback(async () => {
    const conv = activeRef.current;
    const list = messagesByRoomRef.current[conv.id] || [];
    if (!list.length) return;
    const before = list[0].id;
    let older = [];
    try {
      older = conv.type === 'dm'
        ? (await api.dmHistory(conv.otherId, before)).messages
        : (await api.groupHistory(conv.id, before)).messages;
    } catch { /* ignore */ }
    if (!older.length) return;
    const decrypted = [];
    for (const m of older) decrypted.push(await decryptMessage(m));
    setMessagesForRoom(conv.id, (cur) => [...decrypted, ...cur]);
  }, [decryptMessage, setMessagesForRoom]);

  /* ---------------- sending ---------------- */

  const sendMessage = useCallback(async (text) => {
    const conv = activeRef.current;
    if (!conv || !text.trim()) return;
    const roomId = conv.id;
    const sender = me;
    const now = new Date().toISOString();

    try {
      let payload;
      let type;
      if (conv.type === 'dm') {
        const otherKey = getPublicKey(conv.otherId);
        if (!otherKey) throw new Error('Recipient public key unavailable — they may need to log in again.');
        const theirPub = await importPublicKeyRaw(otherKey);
        payload = await encryptDm(text, keyPair.privateKey, theirPub);
        type = 'dm';
      } else {
        const group = groups.find((g) => g.id === conv.id);
        if (!group) throw new Error('Group not found');
        const memberPubs = group.members
          .filter((m) => m.id !== me.id)
          .map((m) => ({ id: m.id, pubKey: getPublicKey(m.id) }))
          .filter((m) => m.pubKey);
        if (!memberPubs.length) throw new Error('No other members have available keys.');
        payload = await encryptGroup(text, keyPair.privateKey, memberPubs);
        type = 'group';
      }

      emitSocket('msg:send', { type, to: conv.type === 'dm' ? conv.otherId : conv.id, payload });

      const local = {
        id: `local-${Date.now()}`,
        type,
        roomId,
        from: sender.id,
        to: conv.type === 'dm' ? conv.otherId : conv.id,
        payload,
        ts: now,
        text,
        mine: true,
        decrypted: true,
        readBy: [],
        optimistic: true,
      };
      lastText.current[roomId] = text;
      setMessagesForRoom(roomId, (list) => [...list, local]);
      setConversations((cs) => cs.map((c) =>
        c.id === roomId ? { ...c, lastText: text } : c
      ));
    } catch (err) {
      toast(err.message || 'Failed to send', 'err');
    }
  }, [activeRef, getPublicKey, groups, keyPair, me, setMessagesForRoom, toast]);

  /* ---------------- presence/status ---------------- */

  const saveStatus = useCallback(() => {
    const next = statusDraft.trim();
    emitSocket('status:set', { statusMessage: next });
    updateLocalUser({ statusMessage: next });
    toast('Status updated', 'ok');
  }, [statusDraft, toast]);

  const activeGroup = active?.type === 'group'
    ? groups.find((g) => g.id === active.id)
    : null;
  const activeMembers = activeGroup?.members || [];
  const myRole = activeMembers.find((m) => m.id === me.id)?.role;
  const canManageGroup = myRole === 'owner' || myRole === 'admin';

  return (
    <div className="app">
      <div className="shell">
        <Sidebar
          me={me}
          myPub={myPub}
          conversations={conversations}
          activeId={active?.id || null}
          onSelect={(conv) => {
            setSidebarOpen(false);
            openConversation(conv);
          }}
          onNewChat={() => { setModal({ type: 'newchat' }); setSidebarOpen(false); }}
          onNewGroup={() => { setModal({ type: 'newgroup' }); setSidebarOpen(false); }}
          onLogout={onLogout}
          statusDraft={statusDraft}
          onStatusChange={setStatusDraft}
          onSaveStatus={saveStatus}
          sidebarOpen={sidebarOpen}
        />

        <Conversation
          conv={active}
          messages={active ? (messagesByRoom[active.id] || []) : []}
          typingUsers={active ? (typingByRoom[active.id] || []) : []}
          members={activeMembers}
          onSend={sendMessage}
          onLoadOlder={loadOlder}
          onOpenGroupInfo={activeGroup ? () => setModal({ type: 'groupinfo', group: activeGroup }) : null}
          memberCount={activeMembers.length}
          onBack={() => setSidebarOpen(true)}
          onTypingStart={active ? () => emitSocket('typing:start', { roomId: active.id }) : null}
          onTypingStop={active ? () => emitSocket('typing:stop', { roomId: active.id }) : null}
        />
      </div>

      {modal?.type === 'newchat' && (
        <NewChatModal
          users={users}
          meId={me.id}
          onClose={() => setModal(null)}
          onSelect={(user) => {
            setModal(null);
            const conv = {
              type: 'dm',
              id: dmRoomId(me.id, user.id),
              otherId: user.id,
              name: user.username,
              avatar: user.avatar,
              online: user.online,
              statusMessage: user.statusMessage,
            };
            openConversation(conv);
          }}
        />
      )}

      {modal?.type === 'newgroup' && (
        <NewGroupModal
          users={users}
          meId={me.id}
          onClose={() => setModal(null)}
          onCreate={async (payload) => {
            try {
              const res = await api.createGroup(payload);
              await refreshGroups();
              await refreshConversations();
              setModal(null);
              openConversation({
                type: 'group',
                id: res.group.id,
                name: res.group.name,
                avatar: res.group.avatar,
                members: res.group.members,
              });
            } catch (err) {
              toast(err.message, 'err');
            }
          }}
        />
      )}

      {modal?.type === 'groupinfo' && activeGroup && (
        <GroupInfoModal
          group={activeGroup}
          myRole={myRole}
          users={users}
          onClose={() => setModal(null)}
          onAddMember={async (userId) => {
            try {
              await api.addGroupMember(activeGroup.id, userId);
              await refreshGroups();
              toast('Member added', 'ok');
            } catch (err) {
              toast(err.message, 'err');
            }
          }}
          onRemoveMember={async (userId) => {
            try {
              await api.removeGroupMember(activeGroup.id, userId);
              await refreshGroups();
              toast('Member removed', 'ok');
            } catch (err) {
              toast(err.message, 'err');
            }
          }}
        />
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type === 'ok' ? 'ok' : t.type === 'err' ? 'err' : ''}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
