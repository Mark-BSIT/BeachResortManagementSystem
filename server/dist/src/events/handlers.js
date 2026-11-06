import { eventBus } from './event-bus.js';
import { db } from '../database/connection.js';
const tracked = ['userRegistered', 'userLoggedIn', 'userLoggedOut', 'bookingSubmitted', 'bookingApproved', 'bookingRejected', 'bookingCancelled', 'paymentSubmitted', 'paymentVerified', 'paymentRejected', 'accommodationCreated', 'accommodationUpdated', 'accommodationDeactivated', 'notificationCreated', 'notificationRead', 'customerCheckedIn', 'customerCheckedOut', 'reviewSubmitted'];
for (const eventName of tracked) {
    eventBus.on(eventName, async (event) => {
        db.prepare('INSERT OR IGNORE INTO activity_logs(id,actor_id,action,entity_type,entity_id,metadata) VALUES(?,?,?,?,?,?)')
            .run(event.eventId, null, event.name, 'DOMAIN_EVENT', null, JSON.stringify(event.payload));
    });
}
