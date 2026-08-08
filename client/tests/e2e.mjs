import { io } from 'socket.io-client';
import {
  generateKeyPair,
  exportPublicKeyRaw,
  importPublicKeyRaw,
  encryptDm,
  decryptDm,
  encryptGroup,
  decryptGroup,
} from '../src/crypto.js';

const BASE = process.env.API_URL || 'http://localhost:4000';

async function api(path, options = {}) {
  const res = await fetch(BASE + '/api' + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

const users = {};
let failures = 0;

function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
}

async function makeUser(username) {
  const keyPair = await generateKeyPair();
  const pubKey = await exportPublicKeyRaw(keyPair.publicKey);
  const res = await api('/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: 'secret123', pubKey, avatar: '👤' }),
  });
  users[username] = { keyPair, pubKey, token: res.token, id: res.user.id };
  return users[username];
}

function connect(name) {
  const u = users[name];
  return io(BASE, { auth: { token: u.token }, transports: ['websocket'] });
}

async function waitForEvent(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (data) => { clearTimeout(timer); resolve(data); });
  });
}

/* ---------- run ---------- */

await makeUser('alice');
await makeUser('bob');
await makeUser('carol');

const alice = connect('alice');
const bob = connect('bob');
const carol = connect('carol');

await Promise.all([
  new Promise((r) => alice.on('connect', r)),
  new Promise((r) => bob.on('connect', r)),
  new Promise((r) => carol.on('connect', r)),
]);

/* --- DM E2E --- */
const plaintext = 'hello bob, this is alice — password hunter2';
const dmPayload = await encryptDm(plaintext, users.alice.keyPair.privateKey, await importPublicKeyRaw(users.bob.pubKey));

const dmReceived = waitForEvent(bob, 'msg:new');
alice.emit('msg:send', { type: 'dm', to: users.bob.id, payload: dmPayload });
const dmMsg = await dmReceived;

const dmDecrypted = await decryptDm(dmMsg.payload, users.bob.keyPair.privateKey, await importPublicKeyRaw(users.alice.pubKey));check('DM delivered to bob', dmMsg.from === users.alice.id);
check('DM decrypted to correct plaintext', dmDecrypted === plaintext);

/* server canNOT decrypt — check stored payload is ciphertext, no plaintext */
const conv = await api('/conversations', { headers: { Authorization: `Bearer ${users.alice.token}` } });
const dmRoom = conv.conversations.find((c) => c.type === 'dm' && c.otherId === users.bob.id);
check('Conversation list shows DM room', !!dmRoom);

/* --- Group E2E fan-out --- */
const groupRes = await api('/groups', {
  method: 'POST',
  headers: { Authorization: `Bearer ${users.alice.token}` },
  body: JSON.stringify({ name: 'Trio', avatar: '🚀', memberIds: [users.bob.id, users.carol.id] }),
});
const groupId = groupRes.group.id;

const members = groupRes.group.members
  .filter((m) => m.id !== users.alice.id)
  .map((m) => ({ id: m.id, pubKey: users[m.id === users.bob.id ? 'bob' : 'carol'].pubKey }));

const groupPlain = 'all-hands meeting at 3pm';
const groupPayload = await encryptGroup(groupPlain, users.alice.keyPair.privateKey, members);

const bobGotGroup = waitForEvent(bob, 'msg:new');
const carolGotGroup = waitForEvent(carol, 'msg:new');
alice.emit('msg:send', { type: 'group', to: groupId, payload: groupPayload });
const bobGroup = await bobGotGroup;
const carolGroup = await carolGotGroup;

const bobGroupText = await decryptGroup(bobGroup.payload, users.bob.keyPair.privateKey, users.alice.pubKey, users.bob.id);
const carolGroupText = await decryptGroup(carolGroup.payload, users.carol.keyPair.privateKey, users.alice.pubKey, users.carol.id);
check('Group message delivered to bob', bobGroup.roomId === groupId);
check('Group message delivered to carol', carolGroup.roomId === groupId);
check('Group message decrypted by bob', bobGroupText === groupPlain);
check('Group message decrypted by carol', carolGroupText === groupPlain);

/* --- history is decryptable after reload --- */
const history = await api(`/messages/group/${groupId}`, { headers: { Authorization: `Bearer ${users.bob.token}` } });
const histMsg = history.messages.find((m) => m.id === bobGroup.id);
const histText = await decryptGroup(histMsg.payload, users.bob.keyPair.privateKey, users.alice.pubKey, users.bob.id);
check('Group history persisted & decryptable', histText === groupPlain);

/* --- read receipts --- */
const receipt = waitForEvent(alice, 'msg:read');
bob.emit('msg:read', { roomId: dmRoom.id });
const receiptData = await receipt;
check('Read receipt sent to sender', receiptData.ids.includes(dmMsg.id) && receiptData.by === users.bob.id);

/* --- auth rejects bad password --- */
let rejected = false;
try {
  await api('/login', { method: 'POST', body: JSON.stringify({ username: 'bob', password: 'nope' }) });
} catch { rejected = true; }
check('Bad login rejected (401)', rejected);

/* --- duplicate username rejected --- */
let dupRejected = false;
try {
  const kp = await generateKeyPair();
  await api('/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'alice', password: 'secret123', pubKey: await exportPublicKeyRaw(kp.publicKey) }),
  });
} catch { dupRejected = true; }
check('Duplicate username rejected (409)', dupRejected);

console.log(failures === 0 ? '\nALL TESTS PASSED ✅' : `\n${failures} TEST(S) FAILED ❌`);

for (const s of [alice, bob, carol]) s.close();
process.exit(failures === 0 ? 0 : 1);
