import { describe, expect, it } from 'vitest';
import { isLoopbackHost, roomShareUrl, sameOriginSyncUrl, sidecarSyncUrl, syncUrlCandidates } from './sync-url.js';

describe('same-origin sync url', () => {
  it('uses the page host and switches to wss on https', () => {
    expect(sameOriginSyncUrl('http://localhost:5173/2d?seed=2')).toBe('ws://localhost:5173/sync');
    expect(sameOriginSyncUrl('http://192.168.1.9:5173/2d?seed=4')).toBe('ws://192.168.1.9:5173/sync');
    expect(sameOriginSyncUrl('https://duel.example/2d?seed=1')).toBe('wss://duel.example/sync');
  });

  it('builds a share URL with only the seed', () => {
    expect(roomShareUrl(4242, 'http://192.168.1.9:5173/')).toBe('http://192.168.1.9:5173/2d?seed=4242');
    expect(roomShareUrl(2, 'https://duel.example/2d?relay=ws://nope')).toBe('https://duel.example/2d?seed=2');
  });

  it('points the Vite sidecar at the page hostname, not a user-facing relay query', () => {
    expect(sidecarSyncUrl('http://192.168.1.9:5173/2d?seed=1')).toBe('ws://192.168.1.9:8787/sync');
    expect(sidecarSyncUrl('http://localhost:5173/2d', 8788)).toBe('ws://localhost:8788/sync');
    expect(isLoopbackHost('192.168.1.9')).toBe(false);
  });

  it('uses only the sidecar on Vite, never the flaky /sync proxy', () => {
    expect(syncUrlCandidates('http://192.168.1.9:5173/2d?seed=1', { dev: true })).toEqual([
      'ws://192.168.1.9:8787/sync',
    ]);
    expect(syncUrlCandidates('http://localhost:5173/2d?seed=1', { dev: true })).toEqual([
      'ws://localhost:8787/sync',
    ]);
    expect(syncUrlCandidates('http://192.168.1.9:4173/2d?seed=1', { dev: false })).toEqual([
      'ws://192.168.1.9:4173/sync',
    ]);
  });
});
