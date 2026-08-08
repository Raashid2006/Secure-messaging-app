import { useEffect, useRef, useState, useCallback } from 'react';
import { Send, ArrowLeft, Users } from 'lucide-react';
import MessageBubble from './MessageBubble.jsx';

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function Conversation({
  conv, messages, typingUsers, onSend, onLoadOlder,
  onOpenGroupInfo, memberCount, onBack, onTypingStart, onTypingStop,
  members,
}) {
  const [draft, setDraft] = useState('');
  const listRef = useRef(null);
  const composerRef = useRef(null);
  const typingTimer = useRef(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    setDraft('');
    stickToBottom.current = true;
  }, [conv?.id]);

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, conv?.id, typingUsers.length]);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  if (!conv) {
    return (
      <section className="main">
        <div className="main-empty">
          <div className="big">🔐</div>
          <h2>Secure, end-to-end encrypted chat</h2>
          <p>
            Messages are encrypted on your device and can only be decrypted by
            the intended recipients. Pick a conversation from the sidebar to get started.
          </p>
        </div>
      </section>
    );
  }

  function handleComposerKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function handleTyping() {
    onTypingStart?.();
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => onTypingStop?.(), 3000);
  }

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
    onTypingStop?.();
    stickToBottom.current = true;
  }

  const memberById = members ? Object.fromEntries(members.map((m) => [m.id, m])) : {};
  let lastDay = '';

  const grouped = [];
  for (const msg of messages) {
    const day = dayLabel(msg.ts);
    if (day !== lastDay) {
      lastDay = day;
      grouped.push({ type: 'divider', label: day, id: `day-${msg.id}` });
    }
    grouped.push(msg);
  }

  return (
    <section className="main">
      <header className="main-header">
        <button className="btn icon ghost back-btn" onClick={onBack} title="Back">
          <ArrowLeft size={18} />
        </button>
        <div className={`conv-avatar ${conv.type === 'group' ? 'group' : ''}`} style={{ width: 42, height: 42, fontSize: 20 }}>
          {conv.avatar || (conv.type === 'group' ? '👥' : '👤')}
          {conv.type === 'dm' && <span className={`dot ${conv.online ? 'online' : ''}`} />}
        </div>
        <div className="main-title">
          <div className="name">{conv.name}</div>
          <div className="sub">
            {conv.type === 'dm'
              ? (conv.online ? 'Online' : 'Offline')
              : `${memberCount} members`}
          </div>
        </div>
        {onOpenGroupInfo && (
          <button className="btn ghost sm" onClick={onOpenGroupInfo} title="Group info">
            <Users size={15} /> Members
          </button>
        )}
      </header>

      <div className="messages" ref={listRef} onScroll={onScroll}>
        {messages.length > 0 && (
          <button className="btn sm ghost" onClick={onLoadOlder} style={{ alignSelf: 'center', marginBottom: 6 }}>
            Load earlier messages
          </button>
        )}
        {grouped.length === 0 && (
          <div className="conv-empty">
            <div className="big">👋</div>
            {conv.type === 'dm'
              ? `Say hi to ${conv.name} — messages here are encrypted end-to-end.`
              : 'No messages yet in this group.'}
          </div>
        )}
        {grouped.map((item) => {
          if (item.type === 'divider') return <div key={item.id} className="day-divider">{item.label}</div>;
          const msg = item;
          return (
            <MessageBubble
              key={msg.id}
              msg={msg}
              mine={msg.mine}
              showSender={conv.type === 'group' && !msg.mine}
              senderName={memberById[msg.from]?.username || 'Unknown'}
              senderAvatar={memberById[msg.from]?.avatar || '👤'}
              isGroup={conv.type === 'group'}
            />
          );
        })}
      </div>

      <div className="typing-banner">
        {typingUsers.length > 0 && `${typingUsers.join(', ')} ${typingUsers.length === 1 ? 'is' : 'are'} typing…`}
      </div>

      <div className="composer">
        <textarea
          ref={composerRef}
          value={draft}
          placeholder={`Message ${conv.name}…`}
          rows={1}
          onChange={(e) => { setDraft(e.target.value); handleTyping(); }}
          onKeyDown={handleComposerKey}
        />
        <button className="btn" onClick={submit} disabled={!draft.trim()} title="Send">
          <Send size={17} />
        </button>
      </div>
    </section>
  );
}
