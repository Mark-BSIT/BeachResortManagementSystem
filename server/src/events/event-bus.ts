import { EventEmitter } from 'node:events';

export type DomainEventName =
  | 'userRegistered' | 'userLoggedIn' | 'userLoggedOut'
  | 'bookingSubmitted' | 'bookingApproved' | 'bookingRejected' | 'bookingCancelled'
  | 'paymentSubmitted' | 'paymentVerified' | 'paymentRejected'
  | 'accommodationCreated' | 'accommodationUpdated' | 'accommodationDeactivated'
  | 'notificationCreated' | 'notificationRead' | 'customerCheckedIn' | 'customerCheckedOut'
  | 'reviewSubmitted' | "cashPaymentCollected"
  | 'functionHallBookingSubmitted'
  | 'functionHallPaymentSubmitted'
  | 'functionHallBookingApproved'
  | 'functionHallBookingRejected'
  | 'functionHallBookingCancelled'
  | "functionHallPaymentVerified"
  | "functionHallPaymentRejected"
  | "functionHallCashPaymentCollected"
export interface DomainEvent<T = Record<string, unknown>> {
  eventId: string;
  name: DomainEventName;
  occurredAt: string;
  payload: T;
}

class TypedEventBus {
  private readonly emitter = new EventEmitter();
  on<T>(name: DomainEventName, listener: (event: DomainEvent<T>) => void | Promise<void>): void {
    this.emitter.on(name, listener);
  }
  emit<T>(event: DomainEvent<T>): void {
    this.emitter.emit(event.name, event);
  }
}
export const eventBus = new TypedEventBus();
