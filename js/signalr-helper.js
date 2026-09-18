/**
 * Quick Service Portal - SignalR Real-Time Notification Service
 * Manages WebSocket/SignalR connection to /hubs/notifications,
 * authenticated via JWT Bearer token, and handles live incoming events.
 */

import * as ui from './ui-utils.js';
import { getLanguage, t } from './translations.js';

let hubConnection = null;
let isStarting = false;

/**
 * Initialize and start SignalR real-time notification listener
 * @param {ApiClient} apiClient - The API client instance containing baseUrl and getToken
 * @param {Function} onNotificationCallback - Callback invoked when a notification arrives
 */
export async function initSignalRNotificationService(apiClient, onNotificationCallback) {
    if (typeof signalR === 'undefined') {
        console.warn('⚡ [SignalR] Microsoft SignalR library not loaded on page.');
        return null;
    }

    const token = apiClient.getToken();
    if (!token) {
        console.warn('⚡ [SignalR] No JWT token available for SignalR connection.');
        return null;
    }

    // Base URL normalization
    const baseUrl = (apiClient.baseUrl || 'https://quick-service.runasp.net').replace(/\/+$/, '');
    const hubUrl = `${baseUrl}/hubs/notifications`;

    console.log(`⚡ [SignalR] Building connection to: ${hubUrl}`);

    try {
        // Build connection
        hubConnection = new signalR.HubConnectionBuilder()
            .withUrl(hubUrl, {
                accessTokenFactory: () => apiClient.getToken() || '',
                skipNegotiation: false
            })
            .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
            .configureLogging(signalR.LogLevel.Information)
            .build();

        // 1. Register listener for "ReceiveNotification"
        hubConnection.on('ReceiveNotification', (notification) => {
            console.log('%c⚡ [SignalR NOTIFICATION RECEIVED]:', 'color: #2ed573; font-weight: bold; font-size: 13px;', notification);

            handleIncomingSignalRNotification(notification, onNotificationCallback);
        });

        // 2. Lifecycle Events
        hubConnection.onreconnecting((error) => {
            console.warn('⚡ [SignalR] Connection lost. Reconnecting...', error);
        });

        hubConnection.onreconnected((connectionId) => {
            console.log('%c⚡ [SignalR] Reconnected successfully. ConnectionId: ' + connectionId, 'color: #2ed573; font-weight: bold;');
        });

        hubConnection.onclose((error) => {
            console.warn('⚡ [SignalR] Connection closed.', error);
        });

        // 3. Start Connection
        await startSignalRConnection();

        return hubConnection;
    } catch (err) {
        console.error('⚡ [SignalR] Failed to initialize SignalR connection:', err);
        return null;
    }
}

/**
 * Start or restart the SignalR Hub connection with retry mechanism
 */
async function startSignalRConnection() {
    if (!hubConnection || isStarting) return;
    if (hubConnection.state === signalR.HubConnectionState.Connected) return;

    isStarting = true;
    try {
        await hubConnection.start();
        console.log('%c⚡ [SignalR] Connected successfully to /hubs/notifications', 'color: #2ed573; font-weight: bold; font-size: 12px;');
    } catch (err) {
        console.error('⚡ [SignalR] Connection failed, retrying in 5 seconds...', err);
        setTimeout(() => {
            isStarting = false;
            startSignalRConnection();
        }, 5000);
        return;
    } finally {
        isStarting = false;
    }
}

/**
 * Handle incoming notification payload
 */
function handleIncomingSignalRNotification(notification, onNotificationCallback) {
    if (!notification) return;

    const isAr = getLanguage() === 'ar';
    const creatorName = notification.creatorName || '';
    let message = '';

    if (notification.recipientMessage) {
        message = isAr ? (notification.recipientMessage.ar || notification.recipientMessage.en)
                       : (notification.recipientMessage.en || notification.recipientMessage.ar);
    }

    if (!message && notification.content) {
        message = notification.content;
    }

    if (!message) {
        message = isAr ? 'لديك إشعار جديد في النظام!' : 'You have a new notification!';
    }

    const title = isAr ? '🔔 إشعار جديد' : '🔔 New Notification';
    const fullText = creatorName ? `${creatorName}: ${message}` : message;

    // 1. Play Audio Alarm
    if (typeof ui.startAlarmSound === 'function') {
        ui.startAlarmSound();
    }

    // 2. Desktop Browser Notification
    if (typeof ui.sendDesktopNotification === 'function') {
        ui.sendDesktopNotification(title, {
            body: fullText,
            icon: '/favicon.ico',
            tag: 'signalr-notification'
        });
    }

    // 3. In-App Toast
    if (typeof ui.showToast === 'function') {
        ui.showToast(fullText, 'info');
    }

    // 4. Trigger UI refresh callback
    if (typeof onNotificationCallback === 'function') {
        try {
            onNotificationCallback(notification);
        } catch (cbErr) {
            console.error('⚡ [SignalR] Callback execution failed:', cbErr);
        }
    }
}

/**
 * Gracefully stop connection upon logout
 */
export async function stopSignalRConnection() {
    if (hubConnection) {
        try {
            console.log('⚡ [SignalR] Stopping connection...');
            await hubConnection.stop();
            hubConnection = null;
        } catch (err) {
            console.warn('⚡ [SignalR] Error stopping connection:', err);
        }
    }
}
