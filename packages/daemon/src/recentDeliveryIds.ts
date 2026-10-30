/**
 * Delivery ids this daemon has recently acked (task #1295). When the server
 * re-sends one (its ack was late, not lost), the daemon answers with the ack
 * at once instead of building a span, logging and routing the copy again.
 * Bounded by count and age; insertion order is age order.
 */
export class RecentDeliveryIds {
  private readonly ackedAt = new Map<string, number>();

  constructor(
    private readonly maxEntries = 4096,
    private readonly maxAgeMs = 10 * 60_000,
  ) {}

  remember(deliveryId: string, nowMs: number): void {
    this.ackedAt.delete(deliveryId);
    this.ackedAt.set(deliveryId, nowMs);
    this.prune(nowMs);
  }

  has(deliveryId: string, nowMs: number): boolean {
    this.prune(nowMs);
    return this.ackedAt.has(deliveryId);
  }

  get size(): number {
    return this.ackedAt.size;
  }

  private prune(nowMs: number): void {
    for (const [id, at] of this.ackedAt) {
      if (this.ackedAt.size <= this.maxEntries && nowMs - at < this.maxAgeMs) break;
      this.ackedAt.delete(id);
    }
  }
}
