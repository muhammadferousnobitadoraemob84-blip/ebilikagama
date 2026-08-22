// Simple pub/sub for channel change events
// Used by SSE endpoint to push updates to all connected clients

type Listener = () => void;

let listeners: Listener[] = [];

export function subscribe(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function notifyChannelChange(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  }
}
