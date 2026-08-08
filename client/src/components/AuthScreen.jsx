import { useState } from 'react';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { api, saveSession } from '../api.js';
import {
  generateKeyPair,
  exportPublicKeyRaw,
  wrapPrivateKeyWithPassword,
  unwrapPrivateKeyWithPassword,
  saveWrappedKey,
  loadWrappedKey,
} from '../crypto.js';

const AVATARS = ['🙂', '😎', '🤠', '🦊', '🐼', '🚀', '⚡', '🌟', '🎧', '🍀'];

export default function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', password: '', avatar: AVATARS[0] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function set(key) {
    return (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    const { username, password, avatar } = form;
    if (!username || !password) return setError('Enter a username and password');
    setBusy(true);
    try {
      if (mode === 'login') {
        const res = await api.login({ username, password });
        const wrapped = loadWrappedKey(res.user.username);
        if (!wrapped) {
          throw new Error('No encryption keys for this account on this device. Register from a new device or log in with the original one.');
        }
        const keyPair = await unwrapPrivateKeyWithPassword(wrapped, password);
        const myPub = await exportPublicKeyRaw(keyPair.publicKey);
        saveSession(res.token, res.user);
        onAuth({ session: { token: res.token, user: res.user }, keyPair, myPub });
      } else {
        const keyPair = await generateKeyPair();
        const myPub = await exportPublicKeyRaw(keyPair.publicKey);
        const wrapped = await wrapPrivateKeyWithPassword(keyPair.privateKey, password);
        saveWrappedKey(username.toLowerCase(), wrapped);
        const res = await api.register({ username, password, pubKey: myPub, avatar });
        saveSession(res.token, res.user);
        onAuth({ session: { token: res.token, user: res.user }, keyPair, myPub });
      }
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-logo">🔐</div>
        <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="sub">
          <strong>End-to-end encrypted</strong> — your private key never leaves this
          device, and even the server cannot read your messages.
        </p>

        {error && <div className="error-box">{error}</div>}

        <div className="field">
          <label>Username</label>
          <input className="input" value={form.username} onChange={set('username')}
            placeholder="alice" autoComplete="username" autoFocus />
        </div>

        <div className="field">
          <label>Password</label>
          <input className="input" type="password" value={form.password}
            onChange={set('password')} placeholder="••••••••"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 5 }}>
            {mode === 'register' ? 'Used to encrypt your private key. Don\'t lose it — it can\'t be recovered.' : ''}
          </div>
        </div>

        {mode === 'register' && (
          <div className="field">
            <label>Avatar</label>
            <div className="avatar-row">
              {AVATARS.map((a) => (
                <button key={a} type="button"
                  className={`avatar-opt ${form.avatar === a ? 'selected' : ''}`}
                  onClick={() => setForm((f) => ({ ...f, avatar: a }))}>{a}</button>
              ))}
            </div>
          </div>
        )}

        <button className="btn block" disabled={busy}>
          {busy ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}
          {busy ? 'Working…' : mode === 'login' ? 'Log in & unlock keys' : 'Register'}
        </button>

        <div className="auth-switch">
          {mode === 'login' ? "New here?" : 'Already have an account?'}{' '}
          <button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}>
            {mode === 'login' ? 'Create an account' : 'Log in'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function UnlockScreen({ username, onUnlock }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const wrapped = loadWrappedKey(username);
      if (!wrapped) throw new Error('No encryption keys found for this account on this device.');
      const keyPair = await unwrapPrivateKeyWithPassword(wrapped, password);
      const myPub = await exportPublicKeyRaw(keyPair.publicKey);
      onUnlock(keyPair, myPub);
    } catch (err) {
      setError(err.message || 'Wrong password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-logo">🔐</div>
        <h1>Unlock your keys</h1>
        <p className="sub">
          Your encryption keys for <strong>{username}</strong> are locked on this
          device. Enter your password to decrypt them.
        </p>
        {error && <div className="error-box">{error}</div>}
        <div className="field">
          <label>Password</label>
          <input className="input" type="password" value={password}
            onChange={(e) => setPassword(e.target.value)} autoFocus
            autoComplete="current-password" placeholder="••••••••" />
        </div>
        <button className="btn block" disabled={busy || !password}>
          {busy ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
