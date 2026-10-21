import type { GameState, StatusSnapshot } from './game/state';

export type Block =
  | { type: 'narration'; text: string }
  | { type: 'speech'; speaker: string; text: string };

// AI返答には、その時点のステータスを持たせる。過去ログには当時のステータスを出す
export type Message =
  | { id: number; role: 'player'; text: string }
  | { id: number; role: 'ai'; blocks: Block[]; state: StatusSnapshot; notice?: string; applied?: AppliedChanges };

// AIの変更案のうち、実際に反映したもの。「取り消す」ときは before(反映前の状態)に戻す
export type AppliedChanges = { labels: string[]; before: GameState; undone?: boolean };
