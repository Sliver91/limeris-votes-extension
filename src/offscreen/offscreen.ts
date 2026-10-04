import { playSound } from '../lib/sound';
import type { VoteSound } from '../store/types';

/** Page invisible ouverte par le service worker le temps de jouer le son d'un rappel. */
chrome.runtime.onMessage.addListener((message: { type?: string; sound?: VoteSound; volume?: number }) => {
  if (message?.type !== 'limeris-play-sound' || !message.sound) return;
  playSound(message.sound, message.volume ?? 0.6);
});
