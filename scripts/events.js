// scripts/events.js

/**
 * Global Event Bus
 * Allows modules to communicate without direct dependencies.
 */

const eventListeners = {};

export const events = {
    /**
     * Subscribe to an event.
     * @param {string} event - Event name.
     * @param {function} callback - Callback function.
     */
    on(event, callback) {
        if (!eventListeners[event]) eventListeners[event] = [];
        eventListeners[event].push(callback);
    },

    /**
     * Emit an event with data.
     * @param {string} event - Event name.
     * @param {*} data - Data to pass to listeners.
     */
    emit(event, data) {
        if (eventListeners[event]) {
            eventListeners[event].forEach(cb => cb(data));
        }
    },

    /**
     * Unsubscribe from an event.
     * @param {string} event - Event name.
     * @param {function} callback - Callback to remove.
     */
    off(event, callback) {
        if (eventListeners[event]) {
            eventListeners[event] = eventListeners[event].filter(cb => cb !== callback);
        }
    }
};