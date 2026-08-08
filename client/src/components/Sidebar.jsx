import { useMemo, useState } from 'react';
import { MessageSquarePlus, Users, LogOut, Search, Lock } from 'lucide-react';

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function Sidebar({
  me, myPub, conversations, activeId, onSelect,
  onNewChat, onNewGroup, onLogout,
  statusDraft, onStatusChange, onSaveStatus, sidebarOpen,
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.name.toLowerCase().includes(q));
  }, [conversations, query]);

  const fingerprint = myPub ? myPub.slice(0, 16) : '';

  return (
    <aside className={`sidebar ${sidebarOpen ? '' : 'closed'}`}>
      <div className="sidebar-header">
        <div className="me-row">
          <div className="me-avatar">{me.avatar || '👤'}</div>
          <div className="me-info">
            <div className="me-name">
              {me.username}
              <span className="dot online" title="Online" />
            </div>
            <div className="me-sub">
              <input
                value={statusDraft}
                onChange={(e) => onStatusChange(e.target.value)}
                onBlur={onSaveStatus}
                onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                placeholder="Set a status…"
                maxLength={120}
              />
            </div>
          </div>
        </div>

        <div className="sidebar-actions">
          <button className="btn sm" onClick={onNewChat}>
            <MessageSquarePlus size={15} /> New chat
          </button>
          <button className="btn sm ghost" onClick={onNewGroup}>
            <Users size={15} /> New group
          </button>
          <button className="btn sm ghost" onClick={onLogout} title="Log out">
            <LogOut size={15} />
          </button>
        </div>

        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
          <Lock size={13} />
          <span>Key fingerprint <code>{fingerprint}…</code></span>
        </div>
      </div>

      <div className="search-box">
        <input className="input" placeholder="Search conversations…"
          value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="conv-list">
        {filtered.length === 0 && (
          <div className="conv-empty">
            <div className="big">💬</div>
            {query ? 'No conversations match your search.' : (
              <>No conversations yet.<br />Start a new chat to begin!</>
            )}
          </div>
        )}
        {filtered.map((c) => (
          <div key={c.id}
            className={`conv-item ${c.id === activeId ? 'active' : ''}`}
            onClick={() => onSelect(c)}>
            <div className={`conv-avatar ${c.type === 'group' ? 'group' : ''}`}>
              {c.avatar || (c.type === 'group' ? '👥' : '👤')}
              {c.type === 'dm' && (
                <span className={`dot ${c.online ? 'online' : ''}`} />
              )}
            </div>
            <div className="conv-body">
              <div className="conv-top">
                <span className="conv-name">{c.name}</span>
                <span className="conv-time">{timeAgo(c.last?.ts)}</span>
              </div>
              <div className="conv-preview">
                {c.lastText || (c.last ? (c.last.from === me.id ? 'You: ' : '🔒 ') + 'Encrypted message' : c.type === 'group' ? `${c.memberCount || 0} members` : 'Say hello 👋')}
                {c.unread > 0 && <span className="conv-unread">{c.unread}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
