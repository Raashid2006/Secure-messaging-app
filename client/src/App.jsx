import { useState } from 'react';
import AuthScreen, { UnlockScreen } from './components/AuthScreen.jsx';
import ChatApp from './components/ChatApp.jsx';
import { loadSession, clearSession } from './api.js';

export default function App() {
  const [session, setSession] = useState(() => loadSession());
  const [keyPair, setKeyPair] = useState(null);
  const [myPub, setMyPub] = useState(null);

  function handleAuth({ session: nextSession, keyPair: kp, myPub: pub }) {
    setSession(nextSession);
    setKeyPair(kp);
    setMyPub(pub);
  }

  function handleLogout() {
    clearSession();
    setSession(null);
    setKeyPair(null);
    setMyPub(null);
  }

  // Fresh visit (no saved token) -> auth screen
  if (!session) {
    return <AuthScreen onAuth={handleAuth} />;
  }

  // Saved token but private key not unlocked yet -> unlock screen
  if (!keyPair || !myPub) {
    return <UnlockScreen username={session.user.username} onUnlock={(kp, pub) => {
      setKeyPair(kp);
      setMyPub(pub);
    }} />;
  }

  return (
    <ChatApp
      session={session}
      keyPair={keyPair}
      myPub={myPub}
      onLogout={handleLogout}
    />
  );
}
