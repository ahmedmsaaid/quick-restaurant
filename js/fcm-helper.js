/**
 * Quick Service Portal - Firebase Cloud Messaging (FCM) Helper
 * Manages Service Worker registration, FCM token syncing with backend,
 * and handling live push notifications (background & foreground).
 */

import * as ui from './ui-utils.js';
import { t } from './translations.js';

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCN_48C-NUsmB3McZAwpt2CIWF390mFtFg",
    authDomain: "quick-c535b.firebaseapp.com",
    projectId: "quick-c535b",
    storageBucket: "quick-c535b.firebasestorage.app",
    messagingSenderId: "634389575709",
    appId: "1:634389575709:web:8b5132643fd9b838edaef4",
    measurementId: "G-N0CJ0SYPYP"
};

const VAPID_KEY = "BA_Jrgy9-IHYzRoxZdyqFGddEcwph-CTNH3zSrMsw9_s1TwM51-0W3VTyKpaBCUCHwv_Hr1daiQzuFyqWshXwhg";

let messagingInstance = null;
let currentFcmToken = null;

export async function initFCMNotificationService(apiClient, onOrderRefreshCallback) {
    console.log('🔥 [FCM] Initializing Firebase Push Notification Service...');
    
    const isSecure = window.isSecureContext;
    const hasSW = 'serviceWorker' in navigator;
    const hasNotif = 'Notification' in window;

    console.log(`[FCM Debug] Protocol: ${window.location.protocol}, Hostname: ${window.location.hostname}, SecureContext: ${isSecure}, HasSW: ${hasSW}, HasNotif: ${hasNotif}`);

    if (!hasSW || !hasNotif) {
        console.warn(`[FCM] Web Push is disabled or not supported on this origin (${window.location.origin}). ServiceWorkers and Push Notifications require HTTPS or localhost.`);
        return null;
    }

    if (typeof firebase === 'undefined') {
        console.warn('[FCM] Firebase SDK scripts not loaded on page.');
        return null;
    }

    try {
        // Check Firebase Messaging browser compatibility
        const supported = await firebase.messaging.isSupported();
        if (!supported) {
            console.warn('[FCM] Firebase messaging is not supported in this browser environment.');
            return null;
        }

        // Initialize Firebase Web App if not initialized
        if (!firebase.apps.length) {
            firebase.initializeApp(FIREBASE_CONFIG);
        }

        messagingInstance = firebase.messaging();

        // Register Service Worker
        const registration = await navigator.serviceWorker.register('./firebase-messaging-sw.js');
        console.log('[FCM] Service Worker registered successfully:', registration.scope);

        // Request notification permission
        const permission = await Notification.requestPermission();
        console.log('[FCM] Notification Permission Status:', permission);
        
        if (permission !== 'granted') {
            console.warn(`[FCM] Notification permission state is: "${permission}". If prompt didn't show, click the lock 🔒 icon next to URL in address bar to allow Notifications.`);
        }

        console.log('[FCM] Fetching FCM Token from Firebase...');
        // Retrieve FCM Registration Token even if permission check passed
        const token = await messagingInstance.getToken({
            serviceWorkerRegistration: registration,
            vapidKey: VAPID_KEY
        });

        if (token) {
            currentFcmToken = token;
            window.fcmToken = token;
            window.copyFcmToken = () => {
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(token);
                    console.log('📋 FCM Token copied to clipboard!');
                }
                return token;
            };

            console.log('%c🔑 [FCM DEVICE TOKEN FOR TESTING]:', 'font-size: 14px; font-weight: bold; color: #2ed573;');
            console.log('%c' + token, 'font-size: 12px; font-weight: bold; color: #1e90ff; background: #121226; padding: 6px; border-radius: 4px;');
            console.log('💡 Tip: Type copyFcmToken() in console to copy the token anytime!');

            // Sync token with backend user session
            await syncFcmTokenWithBackend(apiClient, token);
        } else {
            console.warn('[FCM] No registration token available.');
        }

        // Listen for foreground push messages
        messagingInstance.onMessage((payload) => {
            console.log('[FCM] Foreground push message received:', payload);
            handleIncomingPushNotification(payload, onOrderRefreshCallback);
        });

        return token;
    } catch (err) {
        console.error('[FCM] Error initializing Firebase Messaging:', err);
        return null;
    }
}

/**
 * Sends FCM device token to backend /api/v1/users/add-fcm-token
 */
async function syncFcmTokenWithBackend(apiClient, token) {
    try {
        const res = await apiClient.fetch('/api/v1/users/add-fcm-token', {
            method: 'POST',
            body: JSON.stringify({ fcmToken: token, token: token })
        });
        console.log('[FCM] FCM Token synced with server:', res);
    } catch (err) {
        console.error('[FCM] Failed to sync FCM token with server:', err);
    }
}

/**
 * Process incoming foreground push notification payloads
 */
function handleIncomingPushNotification(payload, onOrderRefreshCallback) {
    const title = payload.notification?.title || t('new_order_received') || 'طلب جديد وصل!';
    const body = payload.notification?.body || t('rest_alarm_new') || 'لديك طلب جديد في القائمة!';
    
    // 1. Play Audio Alarm
    ui.startAlarmSound();

    // 2. Trigger Desktop Notification
    ui.sendDesktopNotification(title, {
        body: body,
        icon: payload.notification?.image || '/favicon.ico',
        tag: 'order-notification'
    });

    // 3. Display Toast Notification in Portal UI
    ui.showToast(`🔔 ${title}: ${body}`, 'info');

    // 4. Trigger dashboard UI refresh callback
    if (typeof onOrderRefreshCallback === 'function') {
        onOrderRefreshCallback(payload);
    }
}

export function getCurrentFcmToken() {
    return currentFcmToken;
}
