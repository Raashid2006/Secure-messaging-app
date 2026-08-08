const online = new Set();

export function setOnline(userId) {
  online.add(userId);
}

export function setOffline(userId) {
  online.delete(userId);
}

export function isOnline(userId) {
  return online.has(userId);
}

export function onlineIds() {
  return new Set(online);
}
