import { useMemo, useState } from 'react';
import { X, Check, Plus, Shield, Trash2 } from 'lucide-react';

function search(users, query) {
  const q = query.trim().toLowerCase();
  if (!q) return users;
  return users.filter((u) => u.username.toLowerCase().includes(q) || (u.statusMessage || '').toLowerCase().includes(q));
}

function UserPick({ user, selected, onClick, badge }) {
  return (
    <div className={`user-pick ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="conv-avatar" style={{ width: 38, height: 38, fontSize: 18 }}>
        {user.avatar || '👤'}
        <span className={`dot ${user.online ? 'online' : ''}`} />
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{user.username}</div>
        {badge && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{badge}</div>}
      </div>
      {selected && <Check size={18} className="check" />}
    </div>
  );
}

/* ---------------- new chat ---------------- */

export function NewChatModal({ users, meId, onClose, onSelect }) {
  const [query, setQuery] = useState('');
  const others = useMemo(() => users.filter((u) => u.id !== meId), [users, meId]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>New chat</h2>
        <p className="sub">Pick someone to start an encrypted conversation.</p>
        <input className="input" placeholder="Search users…" value={query} autoFocus
          onChange={(e) => setQuery(e.target.value)} />
        <div style={{ marginTop: 14, maxHeight: 320, overflowY: 'auto' }}>
          {search(others, query).length === 0 && (
            <div style={{ color: 'var(--muted)', fontSize: 13, padding: 20, textAlign: 'center' }}>
              No users found.
            </div>
          )}
          {search(others, query).map((u) => (
            <UserPick key={u.id} user={u} onClick={() => onSelect(u)} badge={u.online ? 'Online' : 'Offline'} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- new group ---------------- */

const GROUP_AVATARS = ['👥', '🚀', '🎯', '🔥', '🎮', '💻', '🎨', '🏆', '📚', '🌊'];

export function NewGroupModal({ users, meId, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(GROUP_AVATARS[0]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const others = useMemo(() => users.filter((u) => u.id !== meId), [users, meId]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function create() {
    if (!name.trim() || selected.size === 0) return;
    setBusy(true);
    await onCreate({ name: name.trim(), avatar, memberIds: [...selected] });
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>New group</h2>
        <p className="sub">Encrypted for every member — pick at least one other person.</p>

        <div className="field">
          <label>Group name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Team Alpha" autoFocus maxLength={40} />
        </div>

        <div className="field">
          <label>Icon</label>
          <div className="avatar-row">
            {GROUP_AVATARS.map((a) => (
              <button key={a} type="button"
                className={`avatar-opt ${avatar === a ? 'selected' : ''}`}
                onClick={() => setAvatar(a)}>{a}</button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Members ({selected.size} selected)</label>
          <input className="input" placeholder="Search users…" value={query}
            onChange={(e) => setQuery(e.target.value)} />
        </div>

        <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 12, padding: 6 }}>
          {search(others, query).length === 0 && (
            <div style={{ color: 'var(--muted)', fontSize: 13, padding: 16, textAlign: 'center' }}>
              No users found.
            </div>
          )}
          {search(others, query).map((u) => (
            <UserPick key={u.id} user={u} selected={selected.has(u.id)} onClick={() => toggle(u.id)} />
          ))}
        </div>

        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy || !name.trim() || selected.size === 0} onClick={create}>
            <Plus size={16} /> Create group
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- group info ---------------- */

export function GroupInfoModal({ group, myRole, users, onClose, onAddMember, onRemoveMember }) {
  const [query, setQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const memberIds = useMemo(() => new Set(group.members.map((m) => m.id)), [group]);
  const candidates = useMemo(
    () => users.filter((u) => !memberIds.has(u.id)),
    [users, memberIds]
  );

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>{group.name}</h2>
        <p className="sub">Managed by the group owner. {group.members.length} members.</p>

        {group.members.map((m) => {
          const isOwner = m.role === 'owner';
          return (
            <div key={m.id} className="member-row">
              <div className="conv-avatar" style={{ width: 38, height: 38, fontSize: 18 }}>
                {m.avatar || '👤'}
                <span className={`dot ${m.online ? 'online' : ''}`} />
              </div>
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{m.username}</span>{' '}
                <span className="role-tag">{m.role}</span>
                {isOwner && <Shield size={13} style={{ marginLeft: 4, color: 'var(--accent)' }} />}
              </div>
              {!isOwner && (myRole === 'owner') && (
                <button className="btn icon danger-ghost" title="Remove member"
                  onClick={() => onRemoveMember(m.id)}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          );
        })}

        {showAdd ? (
          <div style={{ marginTop: 12 }}>
            <input className="input" placeholder="Search users to add…" value={query}
              autoFocus onChange={(e) => setQuery(e.target.value)} />
            <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 8 }}>
              {candidates.length === 0 && (
                <div style={{ color: 'var(--muted)', fontSize: 13, padding: 12, textAlign: 'center' }}>
                  No users left to add.
                </div>
              )}
              {search(candidates, query).map((u) => (
                <UserPick key={u.id} user={u}
                  onClick={async () => { await onAddMember(u.id); setShowAdd(false); }} />
              ))}
            </div>
          </div>
        ) : (
          (myRole === 'owner' || myRole === 'admin') && (
            <button className="btn ghost block" style={{ marginTop: 14 }} onClick={() => setShowAdd(true)}>
              <Plus size={16} /> Add member
            </button>
          )
        )}
      </div>
    </div>
  );
}
