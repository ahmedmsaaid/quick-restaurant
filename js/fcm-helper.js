/**
 * Quick Service Portal - Firebase Cloud Messaging (FCM) Helper
 * Manages Service Worker registration, FCM token syncing with backend,
 * interactive permission request banners, and real-time push notification handling.
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
let isFCMInitialized = false;

/**
 * Main initialization entry point for Web Push FCM
 */
export async function initFCMNotificationService(apiClient, onOrderRefreshCallback) {
    console.log('🔥 [FCM] Initializing Firebase Push Notification Service (Web)...');

    const hasSW = 'serviceWorker' in navigator;
    const hasNotif = 'Notification' in window;

    if (!hasSW || !hasNotif) {
        console.warn(`[FCM] Web Push is not supported in this browser environment.`);
        return null;
    }

    if (typeof firebase === 'undefined') {
        console.warn('[FCM] Firebase SDK scripts not loaded on page.');
        return null;
    }

    try {
        const supported = await firebase.messaging.isSupported();
        if (!supported) {
            console.warn('[FCM] Firebase messaging is not supported in this browser.');
            return null;
        }

        if (!firebase.apps.length) {
            firebase.initializeApp(FIREBASE_CONFIG);
        }

        messagingInstance = firebase.messaging();

        // 1. Register Service Worker with fallback
        let registration = null;
        try {
            registration = await navigator.serviceWorker.register('./firebase-messaging-sw.js');
            console.log('✅ [FCM] Service Worker registered at:', registration.scope);
        } catch (swErr) {
            console.warn('[FCM] Direct SW registration failed, trying root scope...', swErr);
            registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        }

        // 2. Setup background SW message listener (when user clicks desktop notification)
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'FCM_NOTIFICATION_CLICK') {
                console.log('🔔 [FCM] User clicked desktop notification:', event.data);
                if (typeof onOrderRefreshCallback === 'function') {
                    onOrderRefreshCallback(event.data);
                }
            }
        });

        // 3. Permission Management
        if (Notification.permission === 'default') {
            showPermissionRequestBanner(apiClient, registration, onOrderRefreshCallback);
        } else if (Notification.permission === 'granted') {
            await obtainAndSyncToken(apiClient, registration);
        } else {
            console.warn('[FCM] Notifications are blocked by user settings in browser.');
        }

        // 4. Foreground Message Listener (when dashboard is active)
        messagingInstance.onMessage((payload) => {
            console.log('⚡ [FCM] Incoming Real-Time Push Message:', payload);
            handleIncomingPushNotification(payload, onOrderRefreshCallback);
        });

        isFCMInitialized = true;
        return currentFcmToken;
    } catch (err) {
        console.error('[FCM] Error during FCM initialization:', err);
        return null;
    }
}

/**
 * Displays a clean UI banner requesting user to enable Push Notifications
 */
function showPermissionRequestBanner(apiClient, registration, onOrderRefreshCallback) {
    if (document.getElementById('fcm-permission-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'fcm-permission-banner';
    banner.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 99999;
        background: linear-gradient(135deg, #004D40 0%, #00796B 100%);
        color: #ffffff;
        padding: 14px 20px;
        border-radius: 12px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.3);
        border: 1px solid #FF9800;
        display: flex;
        align-items: center;
        gap: 14px;
        font-family: 'Cairo', sans-serif;
        direction: rtl;
        animation: fadeIn 0.4s ease-out;
        max-width: 420px;
    `;

    banner.innerHTML = `
        <span style="font-size: 1.8rem;">🔔</span>
        <div style="flex: 1; min-width: 0;">
            <strong style="display: block; font-size: 0.95rem; font-weight: 700;">تفعيل الإشعارات الفورية (FCM)</strong>
            <span style="font-size: 0.8rem; color: #E0F2F1; line-height: 1.4;">لتلقي تنبيهات الطلبات الجديدة فور صدورها بدون تأخير.</span>
        </div>
        <button id="btn-grant-fcm" style="
            background: #FF9800;
            color: #ffffff;
            border: none;
            padding: 8px 16px;
            border-radius: 8px;
            font-weight: 800;
            font-family: 'Cairo', sans-serif;
            font-size: 0.85rem;
            cursor: pointer;
            white-space: nowrap;
            box-shadow: 0 2px 6px rgba(0,0,0,0.2);
        ">تفعيل الآن</button>
        <button id="btn-dismiss-fcm" style="
            background: transparent;
            color: #ffffff;
            border: none;
            font-size: 1.2rem;
            cursor: pointer;
            padding: 0 4px;
            line-height: 1;
        ">&times;</button>
    `;

    document.body.appendChild(banner);

    const grantBtn = banner.querySelector('#btn-grant-fcm');
    const dismissBtn = banner.querySelector('#btn-dismiss-fcm');

    if (grantBtn) {
        grantBtn.onclick = async () => {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                banner.remove();
                await obtainAndSyncToken(apiClient, registration);
                ui.showToast('✅ تم تفعيل الإشعارات الفورية بنجاح!', 'success');
            } else {
                banner.remove();
            }
        };
    }

    if (dismissBtn) {
        dismissBtn.onclick = () => banner.remove();
    }
}

/**
 * Retrieves the device registration token from Firebase and syncs it with the backend
 */
async function obtainAndSyncToken(apiClient, registration) {
    try {
        console.log('[FCM] Fetching Web Device Registration Token...');
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

            console.log('%c🔑 [FCM TOKEN READY]:', 'font-size: 13px; font-weight: bold; color: #2ed573;');
            console.log(token);

            // Sync with backend /api/v1/users/add-fcm-token
            await syncFcmTokenWithBackend(apiClient, token);
            return token;
        } else {
            console.warn('[FCM] No registration token returned by Firebase.');
        }
    } catch (err) {
        console.error('[FCM] Failed to obtain registration token:', err);
    }
    return null;
}

/**
 * Sends the FCM device token to the backend endpoint: POST /api/v1/users/add-fcm-token
 */
async function syncFcmTokenWithBackend(apiClient, token) {
    try {
        const lastSyncedToken = localStorage.getItem('qs_synced_fcm_token');
        if (lastSyncedToken === token) {
            console.log('⚡ [FCM] Token is already synced with backend server.');
            return;
        }

        // AddFcmTokenCommand expects: { "token": "..." }
        const res = await apiClient.fetch('/api/v1/users/add-fcm-token', {
            method: 'POST',
            body: JSON.stringify({ token: token })
        });
        localStorage.setItem('qs_synced_fcm_token', token);
        console.log('✅ [FCM] Device Token registered on backend:', res);
    } catch (err) {
        console.error('❌ [FCM] Failed to sync FCM token with server:', err);
    }
}

/**
 * Process incoming foreground push notification payloads
 */
function handleIncomingPushNotification(payload, onOrderRefreshCallback) {
    const title = payload.notification?.title || payload.data?.title || payload.data?.Title || t('new_order_received') || 'طلب جديد وصل!';
    const body = payload.notification?.body || payload.data?.body || payload.data?.Body || t('rest_alarm_new') || 'لديك طلب جديد في القائمة!';

    // 1. Play Audio Alarm
    ui.startAlarmSound();

    // 2. Trigger Desktop Notification
    ui.sendDesktopNotification(title, {
        body: body,
        icon: payload.notification?.image || payload.data?.icon || 'assets/images/home_logo.png',
        tag: 'order-notification'
    });

    // 3. Display Toast Notification in Portal UI
    ui.showToast(`🔔 ${title}: ${body}`, 'info');

    // 4. Increment in-app notification badge immediately
    const badge = document.getElementById('notification-badge');
    if (badge) {
        const current = parseInt(badge.textContent || '0', 10);
        const next = isNaN(current) ? 1 : current + 1;
        badge.textContent = next;
        badge.style.display = 'inline-flex';
    }

    // 5. Trigger dashboard UI refresh callback immediately
    if (typeof onOrderRefreshCallback === 'function') {
        onOrderRefreshCallback(payload);
    }
}

export function getCurrentFcmToken() {
    return currentFcmToken;
}

export function isFCMReady() {
    return isFCMInitialized && !!currentFcmToken;
}
