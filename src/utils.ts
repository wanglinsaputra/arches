export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomString(len: number, alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'): string {
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

const NAME_PARTS = [
  'Alex', 'Sam', 'Chris', 'Jordan', 'Morgan', 'Casey', 'Riley', 'Quinn',
  'Avery', 'Blake', 'Dana', 'Eden', 'Finn', 'Harper', 'Indigo', 'Jade',
  'Kai', 'Luna', 'Max', 'Nico', 'Olive', 'Parker', 'Reed', 'Sky',
  'Toby', 'Vale', 'Wolf', 'Xander', 'Yuki', 'Zane', 'Rio', 'Ash',
  'Emery', 'Frankie', 'Kendall', 'Rowan', 'Sage', 'Ellis', 'Haven',
];

export function randName(): string {
  return `${randomChoice(NAME_PARTS)}${randomInt(100, 9999)}`;
}