import assert from 'node:assert/strict';
import test from 'node:test';

import { EventHub } from './eventHub.js';

test('EventHub publishes incremental events and keeps a bounded replay history', () => {
  const hub = new EventHub({ historyLimit: 2 });
  const received = [];
  const unsubscribe = hub.subscribe((event) => received.push(event));
  hub.publish({ type: 'job.updated', job: { id: 'j1' } });
  hub.publish({ type: 'job.updated', job: { id: 'j2' } });
  hub.publish({ type: 'job.updated', job: { id: 'j3' } });
  unsubscribe();
  assert.equal(received.length, 3);
  assert.deepEqual(hub.history.map((event) => event.job.id), ['j2', 'j3']);
});
