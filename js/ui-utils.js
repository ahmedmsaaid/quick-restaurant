/**
 * Quick Service Portal - UI Utility & DOM Creation Helpers
 * Follows strict secure coding rules to avoid innerHTML assignments and PII exposure.
 */

import { t } from './translations.js';

// Global state for Audio Synthesizer Alert
let audioCtx = null;
let alarmOscillator = null;
let alarmGain = null;
let alarmIntervalId = null;

/**
 * Safely create a DOM element with classes and attributes (XSS-safe)
 */
export function createElement(tag, classes = [], attributes = {}) {
    const el = document.createElement(tag);
    
    // Set classes
    classes.forEach(cls => {
        if (cls) el.classList.add(cls);
    });
    
    // Set attributes
    Object.entries(attributes).forEach(([key, val]) => {
        if (key === 'dataset') {
            Object.entries(val).forEach(([dataKey, dataVal]) => {
                el.dataset[dataKey] = dataVal;
            });
        } else {
            el.setAttribute(key, val);
        }
    });
    
    return el;
}

/**
 * Safely format image URL from Supabase key or absolute URL
 */
export function getImageUrl(photo) {
    if (!photo) return '';
    if (photo.startsWith('http://') || photo.startsWith('https://') || photo.startsWith('data:')) {
        return photo;
    }
    return `https://uzpvlmgqwpxcuvngsayb.supabase.co/storage/v1/object/public/Quick-Service/${photo}`;
}

/**
 * Safely create a DOM element containing text content
 */
export function createElementWithText(tag, text, classes = [], attributes = {}) {
    const el = createElement(tag, classes, attributes);
    el.textContent = text;
    return el;
}

/**
 * POS Thermal Receipt Printer for Handheld POS (Sunmi V2 Pro) & Web Browsers
 */
export function printOrderReceipt(order = {}) {
    if (!order) return;

    const orderId = order.id || order.orderId || order.code || '1001';
    const dateStr = order.createdAt ? new Date(order.createdAt).toLocaleString('ar-EG') : new Date().toLocaleString('ar-EG');
    const storeName = order.storeName || order.vendorName || (document.documentElement.dir === 'rtl' ? 'خدمة كويك السريعة' : 'Quick Service');
    const customerName = order.customerName || order.userName || (document.documentElement.dir === 'rtl' ? 'عميل كويك' : 'Customer');
    const customerPhone = order.customerPhone || order.userPhone || '';
    const address = order.address || order.deliveryAddress || '';
    const items = order.items || order.orderItems || order.products || [];
    const subtotal = order.subtotal || order.itemsTotal || order.totalPrice || 0;
    const deliveryFee = order.deliveryFee || order.shippingFee || 0;
    const total = order.total || order.grandTotal || (parseFloat(subtotal) + parseFloat(deliveryFee)) || 0;
    const paymentMethod = order.paymentMethod || (document.documentElement.dir === 'rtl' ? 'نقداً عند الاستلام' : 'Cash on Delivery');

    let printArea = document.getElementById('thermal-receipt-print-area');
    if (!printArea) {
        printArea = document.createElement('div');
        printArea.id = 'thermal-receipt-print-area';
        document.body.appendChild(printArea);
    }

    let itemsHtml = '';
    if (items.length > 0) {
        items.forEach((item, idx) => {
            const name = item.name || item.productName || item.title || `منتج #${idx + 1}`;
            const qty = item.qty || item.quantity || item.count || 1;
            const price = item.price || item.unitPrice || 0;
            const itemTotal = (parseFloat(price) * parseInt(qty)).toFixed(2);
            itemsHtml += `
                <tr style="border-bottom: 1px dashed #ccc;">
                    <td style="padding: 4px 0; text-align: right;">${name}</td>
                    <td style="padding: 4px 0; text-align: center;">${qty}</td>
                    <td style="padding: 4px 0; text-align: left;">$${itemTotal}</td>
                </tr>
            `;
        });
    } else {
        itemsHtml = `
            <tr style="border-bottom: 1px dashed #ccc;">
                <td colspan="3" style="padding: 4px 0; text-align: center;">تفاصيل الطلب #${orderId}</td>
            </tr>
        `;
    }

    printArea.innerHTML = `
        <div style="font-family: 'Cairo', sans-serif, monospace; font-size: 11px; color: #000; direction: rtl; text-align: right; width: 100%; box-sizing: border-box; padding: 5px;">
            <div style="text-align: center; font-weight: 800; font-size: 14px; margin-bottom: 4px;">⚡ Quick Service POS ⚡</div>
            <div style="text-align: center; font-size: 11px; font-weight: 700; margin-bottom: 8px;">${storeName}</div>
            <div style="border-top: 1px dashed #000; margin: 4px 0;"></div>
            <div><strong>رقم الطلب:</strong> #${orderId}</div>
            <div><strong>التاريخ:</strong> ${dateStr}</div>
            <div><strong>العميل:</strong> ${customerName}</div>
            ${customerPhone ? `<div><strong>الهاتف:</strong> ${customerPhone}</div>` : ''}
            ${address ? `<div><strong>العنوان:</strong> ${address}</div>` : ''}
            <div style="border-top: 1px dashed #000; margin: 6px 0;"></div>
            <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                <thead>
                    <tr style="border-bottom: 1px solid #000;">
                        <th style="text-align: right; padding-bottom: 4px;">الصنف</th>
                        <th style="text-align: center; padding-bottom: 4px;">العدد</th>
                        <th style="text-align: left; padding-bottom: 4px;">المجموع</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml}
                </tbody>
            </table>
            <div style="border-top: 1px dashed #000; margin: 6px 0;"></div>
            <div style="display: flex; justify-content: space-between; font-weight: 700;">
                <span>المجموع الفرعي:</span>
                <span>$${parseFloat(subtotal).toFixed(2)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-weight: 700;">
                <span>التوصيل:</span>
                <span>$${parseFloat(deliveryFee).toFixed(2)}</span>
            </div>
            <div style="border-top: 1px solid #000; margin: 4px 0;"></div>
            <div style="display: flex; justify-content: space-between; font-weight: 800; font-size: 13px;">
                <span>الإجمالي الكلي:</span>
                <span>$${parseFloat(total).toFixed(2)}</span>
            </div>
            <div style="margin-top: 4px;"><strong>طريقة الدفع:</strong> ${paymentMethod}</div>
            <div style="border-top: 1px dashed #000; margin: 8px 0 4px 0;"></div>
            <div style="text-align: center; font-size: 10px; font-weight: 700;">شكراً لتسوقكم معنا! - Quick POS</div>
        </div>
    `;

    window.print();
}


/**
 * Triggers a Full-Screen Incoming Order Alert Overlay with Quick Logo & Loud Alarm Loop
 */
export function showFullScreenOrderAlert(orderCode = '', onAcknowledgeCallback = null) {
    let overlay = document.getElementById('full-screen-order-overlay');
    
    // Start Web Audio Synthesizer Alarm Loop
    startAlarmSound();

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'full-screen-order-overlay';
        overlay.className = 'full-order-overlay';
        document.body.appendChild(overlay);
    }

    const titleText = t('full_order_title');
    const subTitleText = t('full_order_subtitle');
    const btnText = t('full_order_btn');
    const codePrefix = t('full_order_code_prefix');
    const badgeText = orderCode ? `${codePrefix}${orderCode}` : (document.documentElement.dir === 'rtl' ? 'طلب جديد!' : 'New Order!');

    overlay.innerHTML = `
        <div class="full-order-content">
            <img src="assets/images/home_logo.png" alt="Quick Service Logo" class="full-order-logo">
            <div class="full-order-bell">🔔</div>
            <h1 class="full-order-title">${titleText}</h1>
            <p class="full-order-subtitle">${subTitleText}</p>
            <div class="full-order-badge" id="full-order-code">${badgeText}</div>
            <button id="btn-ack-full-order" class="full-order-btn">${btnText}</button>
        </div>
    `;

    const ackBtn = overlay.querySelector('#btn-ack-full-order');
    if (ackBtn) {
        ackBtn.onclick = () => {
            stopAlarmSound(); // Silence the alarm sound loop!
            overlay.classList.add('hidden');
            if (typeof onAcknowledgeCallback === 'function') {
                onAcknowledgeCallback();
            }
        };
    }

    overlay.classList.remove('hidden');
}


/**
 * Mask PII fields to protect privacy (SSN, Phone, Email)
 */
export function maskPII(value, type) {
    if (!value) return '';
    if (type === 'phone') {
        // e.g. +966 50 123 4567 -> +966 50 *** 4567
        const cleaned = value.replace(/\s+/g, '');
        if (cleaned.length > 7) {
            return `${cleaned.slice(0, 6)} *** ${cleaned.slice(-4)}`;
        }
        return '***-***-' + cleaned.slice(-4);
    }
    if (type === 'email') {
        // e.g. customer@quick.com -> c***r@quick.com
        const [name, domain] = value.split('@');
        if (name.length > 2) {
            return `${name[0]}***${name[name.length - 1]}@${domain}`;
        }
        return `***@${domain}`;
    }
    return '***';
}

/**
 * Show a custom modal dialog (replaces blocking native alerts/confirms)
 * @param {string} title - Modal title text
 * @param {HTMLElement} bodyNode - DOM Node containing the modal body content
 * @param {Array<{text: string, type: string, onClick: Function}>} buttons - Config array for footer actions
 */
export function showModal(title, bodyNode, buttons = []) {
    const overlay = document.getElementById('modal-overlay');
    const container = document.getElementById('modal-container');
    
    // Clear previous content safely
    container.replaceChildren();
    
    // Build Header
    const header = createElement('div', ['modal-header']);
    const titleEl = createElementWithText('h3', title);
    const closeBtn = createElementWithText('button', '×', ['modal-close-btn']);
    closeBtn.addEventListener('click', closeModal);
    header.appendChild(titleEl);
    header.appendChild(closeBtn);
    
    // Build Body
    const body = createElement('div', ['modal-body']);
    body.appendChild(bodyNode);
    
    // Build Footer
    const footer = createElement('div', ['modal-footer']);
    if (buttons.length === 0) {
        // Default close button
        const defaultBtn = createElementWithText('button', t('close'), ['btn', 'btn-secondary']);
        defaultBtn.addEventListener('click', closeModal);
        footer.appendChild(defaultBtn);
    } else {
        buttons.forEach(btnConfig => {
            const btn = createElementWithText('button', btnConfig.text, ['btn', `btn-${btnConfig.type || 'secondary'}`]);
            btn.addEventListener('click', (e) => {
                btnConfig.onClick(e);
                if (btnConfig.closeOnClick !== false) {
                    closeModal();
                }
            });
            footer.appendChild(btn);
        });
    }
    
    container.appendChild(header);
    container.appendChild(body);
    container.appendChild(footer);
    
    overlay.classList.remove('hidden');
}

/**
 * Close the custom modal
 */
export function closeModal() {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.add('hidden');
}

/**
 * Safely render a Chart.js instance on a canvas element
 */
export function renderChart(canvasEl, config) {
    if (!window.Chart) {
        console.error('Chart.js library is not loaded');
        return null;
    }
    
    // Destroy previous chart if attached to canvas to avoid memory leaks
    const existingChart = window.Chart.getChart(canvasEl);
    if (existingChart) {
        existingChart.destroy();
    }
    
    return new window.Chart(canvasEl, config);
}

/**
 * Initialize Web Audio API context safely (requires user gesture)
 */
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

/**
 * Play synthesized high-frequency alarm beeps
 */
function playBeepSound() {
    if (!audioCtx) return;
    
    const now = audioCtx.currentTime;
    
    // 1st chime node
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(587.33, now); // D5 note
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.15, now + 0.05);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    
    // 2nd chime node (slightly offset)
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(880, now + 0.15); // A5 note
    gain2.gain.setValueAtTime(0, now + 0.15);
    gain2.gain.linearRampToValueAtTime(0.15, now + 0.2);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    
    // Start and stop oscillators
    osc1.start(now);
    osc1.stop(now + 0.35);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.5);
}

/**
 * Start repeating loop food order buzzer (loops every 1.5 seconds)
 */
export function startAlarmSound() {
    initAudio();
    
    const banner = document.getElementById('alarm-controller');
    if (banner) {
        banner.classList.remove('hidden');
    }
    
    // Prevent overlapping timers
    if (alarmIntervalId) return;
    
    // Play immediately first
    playBeepSound();
    
    // Repeat loop
    alarmIntervalId = setInterval(() => {
        playBeepSound();
    }, 1500);
}

/**
 * Stop food order buzzer
 */
export function stopAlarmSound() {
    const banner = document.getElementById('alarm-controller');
    if (banner) {
        banner.classList.add('hidden');
    }
    
    if (alarmIntervalId) {
        clearInterval(alarmIntervalId);
        alarmIntervalId = null;
    }
}

// Bind audio context creation and notification permission request to page click to unlock Web Audio API restriction & browser notifications
document.addEventListener('click', () => {
    try {
        initAudio();
        requestNotificationPermission();
    } catch (e) {
        // Silent failure if browser blocks initialization
    }
}, { once: true });

/**
 * Request HTML5 Desktop Notification permission from the browser
 */
export function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            console.log('Notification permission status:', permission);
        }).catch(err => {
            console.error('Error requesting notification permission:', err);
        });
    }
}

/**
 * Send a native HTML5 browser desktop notification
 * @param {string} title - Notification title
 * @param {string} body - Notification message body
 * @param {Object} options - Optional parameters (icon, tag, onClick)
 */
export function sendDesktopNotification(title, body, options = {}) {
    if ('Notification' in window) {
        if (Notification.permission === 'granted') {
            try {
                const notif = new Notification(title, {
                    body: body,
                    icon: options.icon || '/favicon.ico',
                    dir: document.documentElement.getAttribute('dir') || 'rtl',
                    tag: options.tag || 'quick-order-notification',
                    renotify: true,
                    ...options
                });
                notif.onclick = () => {
                    window.focus();
                    if (options.onClick) options.onClick();
                };
            } catch (e) {
                console.error('Failed to trigger desktop notification:', e);
            }
        } else if (Notification.permission === 'default') {
            requestNotificationPermission();
        }
    }
}

/**
 * Show a premium toast notification banner (replaces native alert blocks)
 * @param {string} message - Message text to display
 * @param {'success'|'error'|'warning'|'info'} type - Toast type
 */
export function showToast(message, type = 'info') {
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        Object.assign(toastContainer.style, {
            position: 'fixed',
            bottom: '24px',
            zIndex: '9999',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            pointerEvents: 'none'
        });
        document.body.appendChild(toastContainer);
    }

    const isRtl = document.documentElement.dir === 'rtl' || document.body.dir === 'rtl';
    if (isRtl) {
        toastContainer.style.right = 'auto';
        toastContainer.style.left = '24px';
    } else {
        toastContainer.style.left = 'auto';
        toastContainer.style.right = '24px';
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';
    if (type === 'warning') icon = '⚠️';

    toast.textContent = `${icon} ${message}`;

    Object.assign(toast.style, {
        background: 'rgba(18, 18, 38, 0.95)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        padding: '12px 20px',
        borderRadius: '8px',
        color: '#fff',
        fontSize: '0.9rem',
        fontWeight: '500',
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.3)',
        pointerEvents: 'auto',
        transform: 'translateY(20px)',
        opacity: '0',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px'
    });

    if (isRtl) {
        if (type === 'success') toast.style.borderRight = '4px solid var(--color-success, #2ed573)';
        else if (type === 'error') toast.style.borderRight = '4px solid var(--color-danger, #ff4757)';
        else if (type === 'warning') toast.style.borderRight = '4px solid var(--color-pending, #ffa502)';
        else toast.style.borderRight = '4px solid var(--color-info, #1e90ff)';
    } else {
        if (type === 'success') toast.style.borderLeft = '4px solid var(--color-success, #2ed573)';
        else if (type === 'error') toast.style.borderLeft = '4px solid var(--color-danger, #ff4757)';
        else if (type === 'warning') toast.style.borderLeft = '4px solid var(--color-pending, #ffa502)';
        else toast.style.borderLeft = '4px solid var(--color-info, #1e90ff)';
    }

    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.transform = 'translateY(0)';
        toast.style.opacity = '1';
    }, 10);

    setTimeout(() => {
        toast.style.transform = 'translateY(-20px)';
        toast.style.opacity = '0';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 4000);
}

/**
 * Render a shimmer card grid placeholder for loading grids
 */
export function renderShimmerGrid(container, count = 3) {
    container.replaceChildren();
    const grid = createElement('div', ['shimmer-grid']);
    for (let i = 0; i < count; i++) {
        const card = createElement('div', ['shimmer-card']);
        
        const img = createElement('div', ['shimmer-item', 'shimmer-image']);
        card.appendChild(img);
        
        const title = createElement('div', ['shimmer-item', 'shimmer-title']);
        card.appendChild(title);
        
        const line1 = createElement('div', ['shimmer-item', 'shimmer-line']);
        card.appendChild(line1);
        
        const line2 = createElement('div', ['shimmer-item', 'shimmer-line', 'short']);
        card.appendChild(line2);
        
        grid.appendChild(card);
    }
    container.appendChild(grid);
}

/**
 * Render a shimmer list layout placeholder for loading lists/tables
 */
export function renderShimmerList(container, count = 4) {
    container.replaceChildren();
    const list = createElement('div', ['shimmer-container']);
    for (let i = 0; i < count; i++) {
        const card = createElement('div', ['shimmer-card'], { style: 'display: flex; align-items: center; gap: 1rem; padding: 1rem;' });
        
        const thumb = createElement('div', ['shimmer-item', 'shimmer-thumbnail']);
        card.appendChild(thumb);
        
        const content = createElement('div', [], { style: 'flex: 1; display: flex; flex-direction: column; gap: 0.5rem;' });
        const title = createElement('div', ['shimmer-item', 'shimmer-title'], { style: 'margin: 0; height: 1.2rem; width: 30%;' });
        const line = createElement('div', ['shimmer-item', 'shimmer-line'], { style: 'margin: 0; height: 0.8rem; width: 70%;' });
        content.appendChild(title);
        content.appendChild(line);
        card.appendChild(content);
        
        list.appendChild(card);
    }
    container.appendChild(list);
}

/**
 * Mark a form input as invalid, adding CSS class and helper error message
 */
export function setInputInvalid(inputEl, message) {
    inputEl.classList.add('input-invalid');
    
    let errorEl = inputEl.nextElementSibling;
    if (errorEl && errorEl.classList.contains('validation-error-msg')) {
        errorEl.textContent = message;
    } else {
        errorEl = createElementWithText('span', message, ['validation-error-msg']);
        inputEl.parentNode.insertBefore(errorEl, inputEl.nextSibling);
    }
    
    const clearStatus = () => {
        inputEl.classList.remove('input-invalid');
        if (errorEl) errorEl.remove();
        inputEl.removeEventListener('input', clearStatus);
        inputEl.removeEventListener('change', clearStatus);
    };
    inputEl.addEventListener('input', clearStatus);
    inputEl.addEventListener('change', clearStatus);
}

/**
 * Clear invalid status and helper error message from a form input
 */
export function clearInputInvalid(inputEl) {
    if (!inputEl) return;
    inputEl.classList.remove('input-invalid');
    const errorEl = inputEl.nextElementSibling;
    if (errorEl && errorEl.classList.contains('validation-error-msg')) {
        errorEl.remove();
    }
}

/**
 * Theme Manager for Light / Dark Mode System (AppColors)
 */
export function initTheme() {
    const savedTheme = localStorage.getItem('qs_theme') || 'light';
    setTheme(savedTheme);
    wireThemeToggleButtons();
}

export function setTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('qs_theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('qs_theme', 'light');
    }
    updateThemeButtonsUI(theme);
}

export function toggleTheme() {
    const current = localStorage.getItem('qs_theme') || 'light';
    const nextTheme = current === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
}

export function updateThemeButtonsUI(theme) {
    const btns = document.querySelectorAll('.btn-theme-toggle');
    btns.forEach(btn => {
        const labelEl = btn.querySelector('.theme-btn-label') || btn.querySelector('#mobile-drawer-theme-text');
        if (labelEl) {
            labelEl.textContent = theme === 'dark' ? '☀️ الوضع الفاتح (Light Mode)' : '🌙 الوضع الليلي (Dark Mode)';
        } else {
            btn.textContent = theme === 'dark' ? '☀️' : '🌙';
        }
        btn.title = theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    });
}

export function wireThemeToggleButtons() {
    const btns = document.querySelectorAll('.btn-theme-toggle');
    btns.forEach(btn => {
        const newBtn = btn.cloneNode(true);
        if (btn.parentNode) btn.parentNode.replaceChild(newBtn, btn);
    });
    const freshBtns = document.querySelectorAll('.btn-theme-toggle');
    freshBtns.forEach(btn => {
        btn.addEventListener('click', () => toggleTheme());
    });
    updateThemeButtonsUI(localStorage.getItem('qs_theme') || 'light');
}

export function initMobileSidebar() {
    let backdrop = document.querySelector('.sidebar-backdrop');
    if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.className = 'sidebar-backdrop';
        document.body.appendChild(backdrop);
    }

    const decorateMobileSidebar = () => {
        const sidebar = document.querySelector('.dashboard-sidebar');
        if (!sidebar) return;

        if (!sidebar.querySelector('.mobile-sidebar-header')) {
            const header = document.createElement('div');
            header.className = 'mobile-sidebar-header';
            
            const profile = JSON.parse(localStorage.getItem('qs_vendor_user') || '{}');
            const storeName = profile.name || (document.documentElement.dir === 'rtl' ? 'المتجر' : 'Store');
            const photoKey = profile.photo || profile.avatar || profile.featuredPhoto || '';
            const storeAvatarSrc = photoKey ? getImageUrl(photoKey) : `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 24 24' fill='%23004D40'><path d='M19 6h-2c0-2.76-2.24-5-5-5S7 3.24 7 6H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-7-3c1.66 0 3 1.34 3 3H9c0-1.66 1.34-3 3-3zm7 17H5V8h14v12z'/></svg>`;

            header.innerHTML = `
                <div class="mobile-vendor-info">
                    <img src="${storeAvatarSrc}" class="header-vendor-avatar" style="width: 44px; height: 44px;" alt="Store Avatar">
                    <span class="mobile-store-name">${storeName}</span>
                </div>
                <button class="btn-close-drawer" id="btn-close-drawer" title="Close">×</button>
            `;
            sidebar.insertBefore(header, sidebar.firstChild);

            const closeBtn = header.querySelector('#btn-close-drawer');
            if (closeBtn) closeBtn.addEventListener('click', closeMenu);
        }

        if (!sidebar.querySelector('.mobile-sidebar-actions')) {
            const actions = document.createElement('div');
            actions.className = 'mobile-sidebar-actions';

            const isDark = (localStorage.getItem('qs_theme') || 'light') === 'dark';
            const themeLabel = isDark ? '☀️ الوضع الفاتح (Light Mode)' : '🌙 الوضع الليلي (Dark Mode)';
            
            const desktopLangBtn = document.getElementById('btn-lang-toggle');
            const langLabel = desktopLangBtn ? desktopLangBtn.textContent : 'العربية';

            actions.innerHTML = `
                <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700; padding: 0.25rem 0.5rem;">إعدادات التحكم</div>
                <a href="index.html" class="sidebar-link mobile-action-link">
                    <span>🏠 الرئيسية (Home)</span>
                </a>
                <button class="sidebar-link mobile-action-link btn-theme-toggle" id="mobile-drawer-theme-btn">
                    <span id="mobile-drawer-theme-text">${themeLabel}</span>
                </button>
                <button class="sidebar-link mobile-action-link" id="mobile-drawer-lang-btn">
                    <span>🌐 <span id="mobile-drawer-lang-text">${langLabel}</span></span>
                </button>
                <button class="sidebar-link mobile-action-link" id="mobile-drawer-logout-btn" style="color: var(--color-danger);">
                    <span>🚪 تسجيل الخروج (Logout)</span>
                </button>
            `;

            sidebar.appendChild(actions);

            const themeBtn = actions.querySelector('#mobile-drawer-theme-btn');
            if (themeBtn) {
                themeBtn.addEventListener('click', () => {
                    toggleTheme();
                    const nowDark = (localStorage.getItem('qs_theme') || 'light') === 'dark';
                    const txt = actions.querySelector('#mobile-drawer-theme-text');
                    if (txt) txt.textContent = nowDark ? '☀️ الوضع الفاتح (Light Mode)' : '🌙 الوضع الليلي (Dark Mode)';
                });
            }

            const langBtn = actions.querySelector('#mobile-drawer-lang-btn');
            if (langBtn) {
                langBtn.addEventListener('click', () => {
                    if (desktopLangBtn) desktopLangBtn.click();
                });
            }

            const logoutBtn = actions.querySelector('#mobile-drawer-logout-btn');
            if (logoutBtn) {
                logoutBtn.addEventListener('click', () => {
                    const desktopLogout = document.getElementById('btn-logout');
                    if (desktopLogout) desktopLogout.click();
                });
            }
        }
    };

    const closeMenu = () => {
        const sidebar = document.querySelector('.dashboard-sidebar');
        if (sidebar) sidebar.classList.remove('mobile-open');
        backdrop.classList.remove('active');
    };

    const toggleMenu = () => {
        const sidebar = document.querySelector('.dashboard-sidebar');
        if (!sidebar) return;
        decorateMobileSidebar();
        const isOpen = sidebar.classList.contains('mobile-open');
        if (isOpen) {
            sidebar.classList.remove('mobile-open');
            backdrop.classList.remove('active');
        } else {
            sidebar.classList.add('mobile-open');
            backdrop.classList.add('active');
        }
    };

    // Global listener for menu toggle buttons
    window.addEventListener('click', (e) => {
        const toggleBtn = e.target.closest('#btn-mobile-sidebar-toggle, .btn-mobile-menu');
        if (toggleBtn) {
            e.preventDefault();
            e.stopPropagation();
            toggleMenu();
            return;
        }

        const sidebar = document.querySelector('.dashboard-sidebar');
        if (sidebar && sidebar.classList.contains('mobile-open')) {
            const isClickInsideSidebar = sidebar.contains(e.target);
            const isSidebarLink = e.target.closest('.sidebar-link');
            if (isSidebarLink || (!isClickInsideSidebar && e.target !== backdrop)) {
                closeMenu();
            }
        }
    });

    backdrop.addEventListener('click', closeMenu);
}

/**
 * Mobile Bottom Navigation Bar Controller
 */
export function initMobileBottomNav() {
    window.addEventListener('click', (e) => {
        const item = e.target.closest('.mobile-nav-item');
        if (!item) return;

        const targetTab = item.dataset.tab;
        if (!targetTab) return;

        // Update active class on mobile bottom nav
        const navContainer = item.closest('.mobile-bottom-nav');
        if (navContainer) {
            navContainer.querySelectorAll('.mobile-nav-item').forEach(btn => btn.classList.remove('active'));
            item.classList.add('active');
        }

        // Trigger corresponding sidebar link
        const targetBtn = document.querySelector(`.sidebar-link[data-tab="${targetTab}"]`) ||
                          document.querySelector(`#rest-menu-${targetTab}`) ||
                          document.querySelector(`#mkt-menu-${targetTab}`) ||
                          document.querySelector(`#sa-menu-${targetTab}`);
        if (targetBtn) {
            targetBtn.click();
        }
    });
}

// Global unhandled exception boundaries to prevent UI freezes
if (typeof window !== 'undefined') {
    window.addEventListener('error', (err) => {
        console.warn('Caught background error cleanly:', err.message);
    });
    window.addEventListener('unhandledrejection', (evt) => {
        console.warn('Caught background unhandled rejection cleanly:', evt.reason);
    });
}

// Auto-run theme, mobile drawer and bottom nav initialization immediately
if (typeof document !== 'undefined') {
    initTheme();
    initMobileBottomNav();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initTheme();
            initMobileSidebar();
            initMobileBottomNav();
        });
    } else {
        initTheme();
        initMobileSidebar();
        initMobileBottomNav();
    }
}


