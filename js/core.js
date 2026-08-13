/**
 * Quick Service Portal - Core OOP Dashboard Framework
 * Adheres strictly to SOLID principles and DRY patterns.
 */

import { t, getLanguage, setLanguage, initTranslations, subscribeLangChange } from './translations.js';

/**
 * Single Responsibility: Console HTTP Logging
 */
export class Logger {
    static logHttp(method, url, reqBody, status, resBody, role = 'app') {
        const time = new Date().toLocaleTimeString();
        let emoji = '🚀';
        let color = '#3b82f6';

        if (role === 'market') {
            emoji = '🛒';
            color = '#2ed573';
        } else if (role === 'restaurant') {
            emoji = '🍔';
            color = '#ff4757';
        } else if (role === 'admin') {
            emoji = '👑';
            color = '#8b5cf6';
        }

        console.log(`%c${emoji} [HTTP REQUEST] [${time}] ${method} ${url}`, `color: ${color}; font-weight: bold; font-size: 11px;`);
        if (reqBody) {
            console.log('%c📦 Request Body:', 'color: #93c5fd;', reqBody);
        }
        const statusColor = status >= 200 && status < 300 ? '#2ed573' : '#ff4757';
        console.log(`%c📥 [HTTP RESPONSE] Status: ${status}`, `color: ${statusColor}; font-weight: bold; font-size: 11px;`);
        if (resBody) {
            console.log('%c📦 Response Body:', 'color: #a7f3d0;', resBody);
        }
        console.log('%c────────────────────────────────────────', 'color: #374151;');
    }
}

/**
 * Single Responsibility: Remote API Communication and Session Storage
 */
export class ApiClient {
    constructor(role, defaultBaseUrl = 'https://quick-service.runasp.net') {
        this.role = role;
        this.baseUrl = defaultBaseUrl;
        this.mockHandlers = {};
    }

    registerMockHandler(pathPrefix, handler) {
        this.mockHandlers[pathPrefix] = handler;
    }

    getTokenKey() {
        return (this.role === 'restaurant' || this.role === 'market') ? 'qs_vendor_token' : 'qs_admin_token';
    }

    getUserKey() {
        return (this.role === 'restaurant' || this.role === 'market') ? 'qs_vendor_user' : 'qs_admin_user';
    }

    getToken() {
        return localStorage.getItem(this.getTokenKey());
    }

    getUser() {
        try {
            const userJson = localStorage.getItem(this.getUserKey());
            return userJson ? JSON.parse(userJson) : null;
        } catch (e) {
            console.error('Failed to parse user session info:', e);
            return null;
        }
    }

    async fetch(path, options = {}) {
        // Intercept mocks if query has mock=true
        if (window.location.search.includes('mock=true')) {
            for (const [prefix, handler] of Object.entries(this.mockHandlers)) {
                if (path.startsWith(prefix)) {
                    return handler(path, options);
                }
            }
        }

        const token = this.getToken();
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        let reqBody = null;
        if (options.body && typeof options.body === 'string') {
            try { reqBody = JSON.parse(options.body); } catch (_) { reqBody = options.body; }
        } else if (options.body) {
            reqBody = options.body;
        }

        const fullUrl = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
        let response;
        try {
            response = await fetch(fullUrl, { ...options, headers });
        } catch (err) {
            Logger.logHttp(options.method || 'GET', fullUrl, reqBody, 0, { error: err.message }, this.role);
            throw err;
        }

        const clonedResponse = response.clone();
        let resBody = null;
        try {
            resBody = await clonedResponse.json();
        } catch (_) {
            try { resBody = await clonedResponse.text(); } catch (_) {}
        }

        Logger.logHttp(options.method || 'GET', fullUrl, reqBody, response.status, resBody, this.role);

        if (!response.ok) {
            let errorMessage = `${response.status} ${response.statusText}`;
            if (resBody && typeof resBody === 'object') {
                const msg = resBody.message || resBody.title || resBody.result
                    || (resBody.errors ? Object.values(resBody.errors).flat().join(' | ') : null)
                    || JSON.stringify(resBody);
                if (msg) errorMessage = msg;
            } else if (typeof resBody === 'string' && resBody.trim()) {
                errorMessage = resBody;
            }
            throw new Error(errorMessage);
        }
        return resBody;
    }
}

/**
 * Single Responsibility: File Stream Uploading
 */
export class ImageService {
    constructor(apiClient, defaultBucketUrl = 'https://uzpvlmgqwpxcuvngsayb.supabase.co/storage/v1/object/public/quick-service-photos/') {
        this.apiClient = apiClient;
        this.bucketUrl = defaultBucketUrl;
    }

    async uploadImage(file, type = 1) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', type);

        const response = await fetch(`${this.apiClient.baseUrl}/api/v1/stream/public`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiClient.getToken() || ''}`
            },
            body: formData
        });

        const resBody = await response.json();
        if (!response.ok) {
            throw new Error(resBody?.message || 'Image upload failed');
        }
        return resBody?.result || '';
    }

    getImageUrl(photo) {
        if (!photo) return '';
        if (photo.startsWith('http://') || photo.startsWith('https://') || photo.startsWith('data:')) return photo;
        return `${this.bucketUrl}${photo}`;
    }
}

/**
 * Single Responsibility: Core Dashboard UI Lifecycle Management
 */
export class BaseDashboard {
    constructor(role, menuLinksSelector = '.sidebar-link') {
        this.role = role;
        this.menuLinksSelector = menuLinksSelector;
        this.activeTab = '';
    }

    init() {
        initTranslations();
        this.setupLanguageSwitcher();
        this.setupLogout();
        this.setupSidebarMenu();
    }

    setupLanguageSwitcher() {
        const langBtn = document.getElementById('btn-lang-toggle');
        if (langBtn) {
            const updateLangBtnText = () => {
                const current = getLanguage();
                langBtn.textContent = current === 'en' ? 'العربية' : 'English';
            };
            updateLangBtnText();

            langBtn.addEventListener('click', () => {
                const nextLang = getLanguage() === 'en' ? 'ar' : 'en';
                setLanguage(nextLang);
                initTranslations();
                updateLangBtnText();
                this.onLanguageChanged(nextLang);
            });
        }

        subscribeLangChange(() => {
            initTranslations();
            this.onLanguageChanged(getLanguage());
        });
    }

    onLanguageChanged(lang) {
        // Lifecycle hook for sub-dashboards
    }

    setupLogout() {
        const logoutBtn = document.getElementById('btn-logout');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                const tokenKey = (this.role === 'restaurant' || this.role === 'market') ? 'qs_vendor_token' : 'qs_admin_token';
                const userKey = (this.role === 'restaurant' || this.role === 'market') ? 'qs_vendor_user' : 'qs_admin_user';
                localStorage.removeItem(tokenKey);
                localStorage.removeItem(userKey);
                window.location.replace(`login.html?role=${this.role === 'admin' ? 'admin' : this.role}`);
            });
        }
    }

    setupSidebarMenu() {
        const links = document.querySelectorAll(this.menuLinksSelector);
        links.forEach(link => {
            link.addEventListener('click', () => {
                const tab = link.getAttribute('data-tab');
                if (tab) this.switchTab(tab);
            });
        });
    }

    switchTab(tab) {
        this.activeTab = tab;
        const links = document.querySelectorAll(this.menuLinksSelector);
        links.forEach(link => {
            if (link.getAttribute('data-tab') === tab) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });
        this.onTabSwitched(tab);
    }

    onTabSwitched(tab) {
        // Lifecycle hook for sub-dashboards
    }
}
