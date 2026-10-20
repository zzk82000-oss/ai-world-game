import type { GameState } from './game/state';

export type Block =
  | { type: 'narration'; text: string }
  | { type: 'speech'; speaker: string; text: string };

// AI返答には、その時点のゲーム状態(ステータス表示用)を持たせる。過去ログには当時のステータスを出す
export type Message =
  | { id: number; role: 'player'; text: string }
  | { id: number; role: 'ai'; blocks: Block[]; state: GameState; notice?: string };
