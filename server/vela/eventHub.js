import crypto from 'node:crypto';

export class EventHub {
  constructor({ historyLimit = 100 } = {}) {
    this.historyLimit = historyLimit;
    this.history = [];
    this.listeners = new Set();
  }

  publish(event) {
    const normalized = {
      id: event.id || crypto.randomUUID(),
      createdAt: event.createdAt || new Date().toISOString(),
      ...event
    };
    this.history.push(normalized);
    this.history.splice(0, Math.max(0, this.history.length - this.historyLimit));
    for (const listener of this.listeners) listener(normalized);
    return normalized;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  createSseHandler() {
    return (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive'
      });
      res.write(`event: ready\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString() })}\n\n`);
      const unsubscribe = this.subscribe((event) => {
        res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      });
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    };
  }
}
