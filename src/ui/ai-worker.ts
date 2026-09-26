import { chooseCommand } from '../ai/index.js';
import { bootEngine } from './boot.js';
import type { Engine } from '../engine/index.js';
import type { AiChooseRequest, AiChooseResponse } from './ai-protocol.js';

let engine: Engine | null = null;
const ready = bootEngine().then((next) => {
  engine = next;
});

function reply(response: AiChooseResponse): void {
  self.postMessage(response);
}

self.addEventListener('message', (event: MessageEvent<AiChooseRequest>) => {
  const request = event.data;
  void ready
    .then(() => {
      if (engine === null) throw new Error('AI engine failed to boot');
      const command = chooseCommand(request.state, request.playerId, {
        engine,
        difficulty: request.difficulty,
        seed: request.seed,
      });
      reply({ id: request.id, ok: true, command });
    })
    .catch((err: unknown) => {
      reply({
        id: request.id,
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    });
});
