import { chooseCommand } from '../ai/index.js';
import { bootEngine } from './boot.js';
import type { AiChooseRequest, AiChooseResponse } from './ai-protocol.js';

const engine = bootEngine();

function reply(response: AiChooseResponse): void {
  self.postMessage(response);
}

self.addEventListener('message', (event: MessageEvent<AiChooseRequest>) => {
  const request = event.data;
  try {
    const command = chooseCommand(request.state, request.playerId, {
      engine,
      difficulty: request.difficulty,
      seed: request.seed,
    });
    reply({ id: request.id, ok: true, command });
  } catch (err) {
    reply({
      id: request.id,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
