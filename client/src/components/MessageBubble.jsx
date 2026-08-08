import { Check, CheckCheck, Clock, Lock } from 'lucide-react';

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function MessageBubble({ msg, mine, showSender, senderName, senderAvatar, isGroup }) {
  const isSending = msg.optimistic;
  const read = msg.readBy && msg.readBy.length > 0;

  return (
    <div className={`msg-row ${mine ? 'me' : 'them'}`}>
      {!mine && (
        <div className="msg-avatar">{senderAvatar || '👤'}</div>
      )}
      <div className="bubble">
        {showSender && <div className="sender">{senderName}</div>}
        {msg.text}
        <div className="bubble-meta">
          <span>{fmtTime(msg.ts)}</span>
          {mine && (
            isSending ? <Clock size={11} /> : read ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                <CheckCheck size={13} />
                {isGroup && read ? msg.readBy.length : null}
              </span>
            ) : <Check size={12} />
          )}
          {!msg.decrypted && <Lock size={10} />}
        </div>
      </div>
    </div>
  );
}
