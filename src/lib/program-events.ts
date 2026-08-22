// Simple pub/sub for program change events
// Used by SSE endpoint to push updates to all connected clients

type Listener = () => void;

let listeners: Listener[] = [];

export function subscribeProgram(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function notifyProgramChange(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  }
}
