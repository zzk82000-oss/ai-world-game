export type Block =
  | { type: 'narration'; text: string }
  | { type: 'speech'; speaker: string; text: string };

export type Status = {
  datetime: string;
  place: string;
  money: string;
  items: string[];
};

export type Message =
  | { id: number; role: 'player'; text: string }
  | { id: number; role: 'ai'; blocks: Block[]; status: Status };
