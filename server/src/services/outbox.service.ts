import { randomUUID } from 'node:crypto';
import { db } from '../database/connection.js';
import { eventBus, type DomainEventName } from '../events/event-bus.js';

export function enqueueEvent(name: DomainEventName, payload: Record<string, unknown>): void {
  db.prepare('INSERT INTO event_outbox(id,event_name,payload) VALUES(?,?,?)')
    .run(randomUUID(), name, JSON.stringify(payload));
}

export function dispatchOutbox(): void {
  const rows = db.prepare('SELECT id,event_name,payload FROM event_outbox WHERE processed_at IS NULL ORDER BY created_at LIMIT 100').all() as Array<{id:string;event_name:DomainEventName;payload:string}>;
  for (const row of rows) {
    try {
      const event = { eventId: row.id, name: row.event_name, occurredAt: new Date().toISOString(), payload: JSON.parse(row.payload) as Record<string, unknown> };
      eventBus.emit(event);
      db.prepare('UPDATE event_outbox SET processed_at=CURRENT_TIMESTAMP, attempts=attempts+1 WHERE id=?').run(row.id);
    } catch {
      db.prepare('UPDATE event_outbox SET attempts=attempts+1 WHERE id=?').run(row.id);
    }
  }
}
