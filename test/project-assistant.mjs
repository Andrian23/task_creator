import assert from 'node:assert';
import { extractAssistantQuestion } from '../lib/project-assistant.js';

assert.strictEqual(extractAssistantQuestion('/ai Які ризики?', ''), 'Які ризики?');
assert.strictEqual(extractAssistantQuestion('/project@AVC_taskCreator_bot Статус?', ''), 'Статус?');
assert.strictEqual(extractAssistantQuestion('@AVC_taskCreator_bot Порівняй проєкти', 'AVC_taskCreator_bot'), 'Порівняй проєкти');
assert.strictEqual(extractAssistantQuestion('звичайне повідомлення', 'AVC_taskCreator_bot'), null);
assert.strictEqual(extractAssistantQuestion('@іншийбот питання', 'AVC_taskCreator_bot'), null);

console.log('OK - project assistant assertions passed');
