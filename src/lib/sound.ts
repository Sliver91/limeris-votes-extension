import { assetUrl } from '../platform';
import type { VoteSound } from '../store/types';

/** Sons de rappel, livrés avec l'extension dans public/sounds, dans l'ordre de la liste des Réglages. */
export const SOUNDS: { id: VoteSound; label: string; file: string }[] = [
  { id: 'votes-commencent', label: 'Les votes commencent', file: 'sounds/votes-commencent.mp3' },
  { id: 'whatsapp-web', label: 'WhatsApp', file: 'sounds/whatsapp-web.mp3' },
  { id: 'fears-to-fathom', label: 'Fears to Fathom', file: 'sounds/fears-to-fathom.mp3' },
  { id: 'follow', label: 'Follow', file: 'sounds/follow.mp3' },
  { id: 'western-whistle', label: 'Sifflet western', file: 'sounds/western-whistle.mp3' },
];

/** Son en cours de lecture : coupé quand un autre démarre (essais successifs). */
let playing: HTMLAudioElement | null = null;

export function playSound(sound: VoteSound, volume: number) {
  if (volume <= 0) return;
  playing?.pause();
  playing = null;

  const file = SOUNDS.find((s) => s.id === sound)?.file;
  if (!file) return;
  const audio = new Audio(assetUrl(file));
  audio.volume = Math.min(1, volume);
  playing = audio;
  audio.play().catch(() => {});
}
