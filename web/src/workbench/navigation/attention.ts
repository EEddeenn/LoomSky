export type AttentionToken = Readonly<{ visitId: number; revision: number }>;

let visitId = 0;
let revision = 0;

export function beginVisit(next: number): void {
  visitId = next;
  revision++;
}

export function noteInteraction(): void { revision++; }

export function captureAttention(): AttentionToken { return { visitId, revision }; }

export function hasAttention(token: AttentionToken): boolean {
  return token.visitId === visitId && token.revision === revision;
}
