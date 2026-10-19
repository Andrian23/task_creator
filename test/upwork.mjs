import assert from 'node:assert';
import { eventFingerprint, findProjectCandidates, validateUpworkEvent } from '../lib/upwork.js';

const event = validateUpworkEvent({ roomId: 'room_1', author: 'Client', topic: 'Project Alpha', message: 'Hello', url: 'https://www.upwork.com/ab/messages/rooms/room_1' });
assert.ok(event);
assert.strictEqual(event.discovery, false);
assert.strictEqual(validateUpworkEvent({ roomId: 'room_2', message: 'Existing', discovery: true }).discovery, true);
assert.strictEqual(validateUpworkEvent({ roomId: '', message: 'Hello' }), null);
assert.strictEqual(validateUpworkEvent({ roomId: 'room_fake', author: 'Maxime est vitae', message: 'Quisque fringilla risus nec tortor dignissim semper incidunt lectus pharetra' }), null);
assert.strictEqual(validateUpworkEvent({ roomId: 'room_1', message: 'Hello', url: 'https://evil.example' }).url, '');
assert.strictEqual(eventFingerprint(event), eventFingerprint({ ...event }));
assert.deepStrictEqual(findProjectCandidates(event, [{ id: '1', name: 'Project Alpha' }, { id: '2', name: 'Other' }]).map(({ id }) => id), ['1']);
console.log('OK - Upwork assertions passed');
