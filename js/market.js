/**
 * Quick Service Portal - Supermarket Logistics Module
 * Full API integration: product catalog, order queue, categories,
 * discounts, and store profile — mirroring restaurant.js architecture.
 * Type = 1 (Supermarket)
 */

import * as ui from './ui-utils.js?v=2.0';
import { t, getLanguage, setLanguage, initTranslations, subscribeLangChange } from './translations.js';
import { ApiClient, ImageService, Logger } from './core.js';
import { initFCMNotificationService } from './fcm-helper.js';
console.log('🛒 market.js module loaded');

function clearInvalid(inputEl) {
    if (!inputEl) return;
    if (typeof ui.clearInputInvalid === 'function') {
        ui.clearInputInvalid(inputEl);
    } else {
        inputEl.classList.remove('input-invalid');
        const next = inputEl.nextElementSibling;
        if (next && next.classList.contains('validation-error-msg')) next.remove();
    }
}

let activeTab = 'orders';
let myMarketId = null;
let marketProducts = [];
let orders = [];
let categories = [];
let discounts = [];
let offers = [];
let branches = [];
let categoriesLoaded = false;
let discountsLoaded = false;
let offersLoaded = false;
let branchesLoaded = false;
let profileLoaded = false;
let knownOrderIds = null;
let activeDashboardChatInterval = null;
let chatPollInterval = null;

// Initialize Core OOP classes
const apiClient = new ApiClient('market');
const imageService = new ImageService(apiClient);

// Mock Handlers Configuration
apiClient.registerMockHandler('/api/v1/users', (path, options) => {
    return { success: true, result: { id: 1, name: 'Mock Supermarket Manager', role: 1 } };
});

apiClient.registerMockHandler('/api/v1/locations', (path, options) => {
    const method = options.method || 'GET';
    const getMockBranches = () => {
        const stored = localStorage.getItem('qs_mock_branches');
        if (stored) return JSON.parse(stored);
        const defaults = [
            { id: 101, name: 'Main Branch / الفرع الرئيسي', address: 'Olaya St, Riyadh / شارع العليا، الرياض', latitude: 24.7136, longitude: 46.6753, base: true },
            { id: 102, name: 'North Branch / فرع الشمال', address: 'King Fahd Rd, Riyadh / طريق الملك فهد، الرياض', latitude: 24.7885, longitude: 46.6582, base: false }
        ];
        localStorage.setItem('qs_mock_branches', JSON.stringify(defaults));
        return defaults;
    };
    const saveMockBranches = (list) => {
        localStorage.setItem('qs_mock_branches', JSON.stringify(list));
    };

    if (method === 'PATCH' || method === 'GET') {
        return { success: true, result: getMockBranches() };
    }
    if (method === 'POST') {
        const body = JSON.parse(options.body);
        const list = getMockBranches();
        const newId = list.length > 0 ? Math.max(...list.map(b => b.id)) + 1 : 101;
        const newBranch = {
            id: newId,
            name: body.name,
            address: body.address,
            latitude: body.latitude || 0,
            longitude: body.longitude || 0,
            base: body.base || false
        };
        if (newBranch.base) {
            list.forEach(b => b.base = false);
        }
        list.push(newBranch);
        saveMockBranches(list);
        return { success: true, result: newBranch };
    }
    if (method === 'PUT') {
        const body = JSON.parse(options.body);
        const list = getMockBranches();
        const branch = list.find(b => b.id === body.id);
        if (branch) {
            branch.name = body.name;
            branch.address = body.address;
            branch.latitude = body.latitude;
            branch.longitude = body.longitude;
            branch.base = body.base;
            if (branch.base) {
                list.forEach(b => { if (b.id !== branch.id) b.base = false; });
            }
            saveMockBranches(list);
            return { success: true, result: branch };
        }
        throw new Error('Branch not found');
    }
    if (method === 'DELETE') {
        const parts = path.split('/');
        const id = parseInt(parts[parts.length - 1]);
        let list = getMockBranches();
        list = list.filter(b => b.id !== id);
        saveMockBranches(list);
        return { success: true };
    }
});

// Delegation helpers maintaining backwards compatibility
async function apiFetch(path, options = {}) {
    return apiClient.fetch(path, options);
}

async function uploadImage(file) {
    return imageService.uploadImage(file, 1);
}

function getImageUrl(photo) {
    return imageService.getImageUrl(photo);
}

function logHttp(method, url, reqBody, status, resBody) {
    Logger.logHttp(method, url, reqBody, status, resBody, 'market');
}

// ─── Description Parsers ──────────────────────────────────────────────────────
function parseProductDescription(rawDesc) {
    if (rawDesc && rawDesc.includes('__MODS__')) {
        const startIdx = rawDesc.indexOf('{');
        const endIdx = rawDesc.lastIndexOf('}');
        if (startIdx !== -1 && endIdx !== -1 && startIdx < endIdx) {
            try {
                const parsed = JSON.parse(rawDesc.slice(startIdx, endIdx + 1));
                if (parsed.desc && parsed.desc.includes('__MODS__')) {
                    return parseProductDescription(parsed.desc);
                }
                return { desc: parsed.desc || '', category: parsed.category || '', mods: parsed.mods || [] };
            } catch (_) { }
        }
    }
    return { desc: rawDesc || '', category: '', mods: [] };
}

function parseUserDescription(rawDesc) {
    if (rawDesc && rawDesc.includes('__SETTINGS__')) {
        const startIdx = rawDesc.indexOf('{');
        const endIdx = rawDesc.lastIndexOf('}');
        if (startIdx !== -1 && endIdx !== -1 && startIdx < endIdx) {
            try {
                const parsed = JSON.parse(rawDesc.slice(startIdx, endIdx + 1));
                if (parsed.description && parsed.description.includes('__SETTINGS__')) {
                    return parseUserDescription(parsed.description);
                }
                return {
                    description: parsed.description || '',
                    days: parsed.days || 'Sat - Thu',
                    hours: parsed.hours || '9:00 AM - 10:00 PM'
                };
            } catch (_) { }
        }
    }
    return { description: rawDesc || '', days: 'Sat - Thu', hours: '9:00 AM - 10:00 PM' };
}

// Helper: Toggle store activity status via API
async function toggleActivityStatus() {
    const profile = JSON.parse(localStorage.getItem('qs_vendor_user') || '{}');
    const userId = parseInt(profile.id);
    if (!userId) throw new Error('No user ID found');
    await apiFetch(`/api/v1/users/toggle-activity/${userId}`, { method: 'PATCH' });
    // Flip active locally: false = closed/inactive, true = active
    profile.active = (profile.active === 0 || profile.active === false) ? true : false;
    profile.status = profile.active ? 1 : 0;
    localStorage.setItem('qs_vendor_user', JSON.stringify(profile));
    return profile.active;
}

async function updateUserSettings(days, hours, descriptionText) {
    const profile = JSON.parse(localStorage.getItem('qs_vendor_user') || '{}');
    await apiFetch('/api/v1/users/update-profile', {
        method: 'PUT',
        body: JSON.stringify({ name: profile.name || 'Market', photo: profile.photo || '', description: descriptionText })
    });
    profile.description = descriptionText;
    localStorage.setItem('qs_vendor_user', JSON.stringify(profile));
}

// ─── Status Maps ──────────────────────────────────────────────────────────────
function mapBackendStatusToLocal(s) {
    switch (s) {
        case 0: // Created — new order, needs market accept/decline
            return 'new';
        case 1: // PendingForPayment — online payment pending
            return 'pending_payment';
        case 2: // PendingForDelivery — market accepted (cash), waiting for captain
            return 'waiting_for_driver';
        case 3: // Confirmed — captain accepted, market can start preparing
            return 'confirmed';
        case 4: // Preparing
            return 'preparing';
        case 5: // ReadyForPickup
            return 'ready_for_pickup';
        case 6: // OutForDelivery
            return 'on_the_way';
        case 7: // Delivered
            return 'completed';
        case 8: // Cancelled
        case 9: // Rejected
            return 'declined';
        default:
            return 'new';
    }
}
function mapLocalStatusToBackend(s) {
    switch (s) {
        case 'new': return 0;
        case 'pending_payment': return 1;
        case 'waiting_for_driver': return 2;
        case 'confirmed': return 3;
        case 'preparing': return 4;
        case 'ready_for_pickup': return 5;
        case 'on_the_way': return 6;
        case 'completed': return 7;
        case 'declined': return 9;
        default: return 0;
    }
}

// ─── Data Refresh ─────────────────────────────────────────────────────────────
async function refreshProfile() {
    try {
        const data = await apiFetch('/api/v1/users', { method: 'GET' });
        if (data && data.result) {
            const existing = JSON.parse(localStorage.getItem('qs_vendor_user') || '{}');
            const merged = { ...existing, ...data.result };
            localStorage.setItem('qs_vendor_user', JSON.stringify(merged));
            myMarketId = parseInt(data.result.id);
            profileLoaded = true;
            updateHeaderVendorName();
        }
    } catch (e) { console.error('Failed to refresh profile:', e); }
}

async function refreshProducts() {
    if (!myMarketId) return;
    try {
        const data = await apiFetch('/api/v1/products/paginate', {
            method: 'PATCH',
            body: JSON.stringify({
                pageNumber: 1, pageSize: 1000, enablePagination: false,
                filters: { creatorId: myMarketId }
            })
        });
        if (data && data.result) {
            marketProducts = data.result.map(p => {
                const parsed = parseProductDescription(p.description);
                const matchedCat = categories.find(c => c.id === p.categoryId);
                const categoryName = matchedCat ? matchedCat.name : (parsed.category || p.category || '');
                return {
                    id: p.id.toString(),
                    name: p.name,
                    price: p.price,
                    category: categoryName,
                    description: parsed.desc,
                    isOutOfStock: !p.isAvailable,
                    image: p.photo || '',
                    rawProduct: p
                };
            });
        }
    } catch (e) { console.error('Failed to load products:', e); }
}

async function refreshOrders() {
    if (!myMarketId) {
        const userJson = localStorage.getItem('qs_vendor_user');
        if (userJson) {
            try { myMarketId = parseInt(JSON.parse(userJson).id); } catch (_) { }
        }
    }
    try {
        if (marketProducts.length === 0 && myMarketId) await refreshProducts();
        const myProductIds = new Set(marketProducts.map(p => parseInt(p.id)));
        const data = await apiFetch('/api/v1/orders', {
            method: 'PATCH',
            body: JSON.stringify({
                pageNumber: 1, pageSize: 1000, enablePagination: false,
                includesPath: ["OrderProducts.Product", "User"],
                filters: {}
            })
        });
        if (data && data.result) {
            console.log("DEBUG - raw orders from backend:", data.result);
            console.log("DEBUG - myProductIds Set:", Array.from(myProductIds));
            const fetchedOrders = data.result.filter(ord => {
                if (!ord.products || ord.products.length === 0) {
                    if (myMarketId && ord.creatorId && parseInt(ord.creatorId) === myMarketId) return true;
                    if (myMarketId && ord.storeId && parseInt(ord.storeId) === myMarketId) return true;
                    if (myMarketId && ord.vendorId && parseInt(ord.vendorId) === myMarketId) return true;
                    if (myProductIds.size === 0) return true;
                    return false;
                }
                const matches = ord.products.some(p => myProductIds.has(p.productId));
                if (matches) return true;
                if (myMarketId && ord.creatorId && parseInt(ord.creatorId) === myMarketId) return true;
                if (myMarketId && ord.storeId && parseInt(ord.storeId) === myMarketId) return true;
                if (myMarketId && ord.vendorId && parseInt(ord.vendorId) === myMarketId) return true;
                if (myProductIds.size === 0) return true;
                return false;
            }).map(ord => {
                const items = (ord.products || []).map(p => {
                    const menuItem = marketProducts.find(m => m.id === p.productId.toString());
                    return {
                        name: p.productName || (menuItem ? menuItem.name : 'Item'),
                        qty: p.quantity,
                        price: p.price,
                        picked: false,
                        productId: p.productId
                    };
                });
                return {
                    id: ord.id.toString(),
                    status: mapBackendStatusToLocal(ord.status),
                    items,
                    totalPrice: ord.totalPrice - (ord.deliveryFee || 0) - (ord.orderFee || 0),
                    notes: ord.address || '',
                    customerName: ord.user ? ord.user.name : (getLanguage() === 'ar' ? 'عميل' : 'Customer'),
                    customerPhone: ord.user ? ord.user.phone : '',
                    createdAt: ord.createdAt,
                    rawOrder: ord
                };
            });

            // Detect new incoming pending orders for notifications
            if (knownOrderIds !== null) {
                const newIncoming = fetchedOrders.filter(o => !knownOrderIds.has(o.id) && (o.status === 'new' || o.status === 'pending_payment' || o.status === 'pending'));
                if (newIncoming.length > 0) {
                    console.log('🛒 New incoming supermarket orders detected:', newIncoming);
                    ui.showFullScreenOrderAlert(newIncoming[0].id, () => {
                        const ordersTab = document.getElementById('mkt-menu-orders');
                        if (ordersTab) ordersTab.click();
                    });
                    
                    newIncoming.forEach(ord => {
                        const title = getLanguage() === 'ar' 
                            ? `🛒 طلب سوبر ماركت جديد! (#${ord.id})` 
                            : `🛒 New Supermarket Order! (#${ord.id})`;
                        const body = getLanguage() === 'ar'
                            ? `طلب جديد من ${ord.customerName} - الإجمالي: ${ord.totalPrice} د.ع`
                            : `New supermarket order from ${ord.customerName} - Total: ${ord.totalPrice} IQD`;
                        
                        ui.sendDesktopNotification(title, body, { tag: 'order-' + ord.id });
                        ui.showToast(getLanguage() === 'ar' ? `وصل طلب جديد! #${ord.id}` : `New order received! #${ord.id}`, 'info');
                    });
                }
            }

            knownOrderIds = new Set(fetchedOrders.map(o => o.id));
            orders = fetchedOrders;
        }
    } catch (e) { console.error('Failed to load orders:', e); }
}

async function refreshCategories() {
    try {
        const data = await apiFetch('/api/v1/categories', {
            method: 'PATCH',
            body: JSON.stringify({
                pageNumber: 1, pageSize: 1000, enablePagination: false,
                filters: { CreatorId: myMarketId ? parseInt(myMarketId) : 0 }
            })
        });
        if (data && data.result) {
            categories = data.result
                .filter(c => c.type === 1 || c.type === null || c.type === undefined || (myMarketId && c.creatorId === parseInt(myMarketId)))
                .map(c => ({ id: c.id, name: c.name, description: c.description || '', photo: c.photo || '', type: c.type }));
            categoriesLoaded = true;
        }
    } catch (e) { console.error('Failed to load categories:', e); }
}

async function refreshDiscounts() {
    try {
        const data = await apiFetch('/api/v1/discounts', {
            method: 'PATCH',
            body: JSON.stringify({
                pageNumber: 1, pageSize: 1000, enablePagination: false,
                filters: { CreatorId: myMarketId ? parseInt(myMarketId) : 0 }
            })
        });
        if (data && data.result) {
            discounts = data.result.map(d => ({
                id: d.id, name: d.name, description: d.description || '',
                percentage: d.percentage, type: d.type,
                startDate: d.startDate, endDate: d.endDate, isActive: d.isActive
            }));
            discountsLoaded = true;
        }
    } catch (e) { console.error('Failed to load discounts:', e); }
}

async function refreshOffers() {
    try {
        const data = await apiFetch('/api/v1/offers', {
            method: 'PATCH',
            body: JSON.stringify({
                pageNumber: 1, pageSize: 1000, enablePagination: false,
                includesPath: ['OfferProducts.Product'],
                filters: { CreatorId: myMarketId ? parseInt(myMarketId) : 0 }
            })
        });
        if (data && data.result) {
            const tempOffers = [];
            for (const o of data.result) {
                const resolvedProducts = [];
                const rawProducts = o.products || [];
                for (const p of rawProducts) {
                    if (p.name) {
                        resolvedProducts.push({
                            id: p.id,
                            name: p.name,
                            price: p.price,
                            image: p.photo || '',
                            quantity: p.quantity || 1
                        });
                    } else {
                        const localProd = marketProducts.find(mp => mp.id.toString() === p.id.toString());
                        if (localProd) {
                            resolvedProducts.push({
                                id: p.id,
                                name: localProd.name,
                                price: localProd.price,
                                image: localProd.image,
                                quantity: p.quantity || 1
                            });
                        } else {
                            try {
                                const prodData = await apiFetch(`/api/v1/products/${p.id}`, { method: 'GET' });
                                if (prodData && prodData.result) {
                                    resolvedProducts.push({
                                        id: p.id,
                                        name: prodData.result.name,
                                        price: prodData.result.price,
                                        image: prodData.result.photo || '',
                                        quantity: p.quantity || 1
                                    });
                                } else {
                                    resolvedProducts.push({ id: p.id, name: `${getLanguage() === 'ar' ? 'منتج' : 'Product'} #${p.id}`, price: 0, quantity: p.quantity || 1 });
                                }
                            } catch (_) {
                                resolvedProducts.push({ id: p.id, name: `${getLanguage() === 'ar' ? 'منتج' : 'Product'} #${p.id}`, price: 0, quantity: p.quantity || 1 });
                            }
                        }
                    }
                }
                tempOffers.push({
                    id: o.id, name: o.name, price: o.price,
                    featuredPhoto: o.featuredPhoto || '',
                    description: o.description || '',
                    active: o.active, approved: o.approved,
                    offerType: o.offerType, type: o.type,
                    numberOfClicks: o.numberOfClicks || 0,
                    numberOfWatches: o.numberOfWatches || 0,
                    numberOfBooking: o.numberOfBooking || 0,
                    products: resolvedProducts,
                    createdOn: o.createdOn
                });
            }
            offers = tempOffers;
            offersLoaded = true;
        }
    } catch (e) { console.error('Failed to load offers:', e); }
}

async function updateStatus(orderId, localStatus) {
    try {
        let backendStatus = mapLocalStatusToBackend(localStatus);
        const order = orders.find(o => o.id === orderId.toString());
        
        const rowVersion = order && order.rawOrder ? order.rawOrder.rowVersion : null;
        await apiFetch('/api/v1/orders/status', {
            method: 'PUT',
            body: JSON.stringify({ id: parseInt(orderId), status: backendStatus, rowVersion })
        });
        await refreshOrders();
        updateBadges();
        renderActiveTab();
    } catch (e) {
        console.error('Failed to update order status:', e);
        ui.showToast(t('error_generic') + ': ' + e.message, 'error');
    }
}

// ─── Init & Notifications ─────────────────────────────────────────────────────
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function updateNotificationCount() {
    const badge = document.getElementById('notification-badge');
    if (!badge) return;
    try {
        const res = await apiFetch('/api/v1/users/count-notifications', { method: 'GET' });
        let serverCount = 0;
        if (res && res.success) {
            serverCount = parseInt(res.result || 0);
        }
        const pendingCount = orders.filter(o => o.status === 'new' || o.status === 'pending_payment' || o.status === 'pending').length;
        const totalCount = Math.max(serverCount, pendingCount);
        if (totalCount > 0) {
            badge.textContent = totalCount;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    } catch (e) {
        console.error('Failed to fetch notification count:', e);
        const pendingCount = orders.filter(o => o.status === 'new' || o.status === 'pending_payment' || o.status === 'pending').length;
        if (pendingCount > 0) {
            badge.textContent = pendingCount;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }
}

async function loadNotificationsList() {
    const list = document.getElementById('notifications-list');
    if (!list) return;

    list.innerHTML = `<div class="notifications-empty">${getLanguage() === 'ar' ? 'جارٍ التحميل...' : 'Loading...'}</div>`;

    try {
        const res = await apiFetch('/api/v1/users/notifications?pageNumber=1&pageSize=20&enablePagination=true', { method: 'GET' });
        if (res && res.success && res.result) {
            const items = res.result;
            list.innerHTML = '';
            if (items.length === 0) {
                list.innerHTML = `<div class="notifications-empty" data-i18n="notifications_empty">${t('notifications_empty')}</div>`;
                return;
            }

            items.forEach(item => {
                const itemEl = document.createElement('div');
                itemEl.className = 'notification-item' + (!item.read ? ' unread' : '');
                itemEl.setAttribute('data-id', item.id);

                const msg = (getLanguage() === 'ar' ? (item.recipientMessage?.ar || item.recipientMessage?.en) : (item.recipientMessage?.en || item.recipientMessage?.ar)) || item.content || '';
                const timeText = new Date(item.createdOn).toLocaleString(getLanguage() === 'ar' ? 'ar-EG' : 'en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit'
                });

                itemEl.innerHTML = `
                    <div class="notification-text">${escapeHtml(msg)}</div>
                    <div class="notification-time">${timeText}</div>
                `;

                itemEl.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (!item.read) {
                        try {
                            await apiFetch(`/api/v1/users/read-notifications/${item.id}`, { method: 'GET' });
                            itemEl.classList.remove('unread');
                            item.read = true;
                            await updateNotificationCount();
                        } catch (err) {
                            console.error('Failed to read notification:', err);
                        }
                    }
                });

                list.appendChild(itemEl);
            });
        } else {
            list.innerHTML = `<div class="notifications-empty">${getLanguage() === 'ar' ? 'فشل تحميل الإشعارات' : 'Failed to load notifications'}</div>`;
        }
    } catch (e) {
        console.error('Failed to load notifications list:', e);
        list.innerHTML = `<div class="notifications-empty">${getLanguage() === 'ar' ? 'حدث خطأ أثناء تحميل الإشعارات' : 'An error occurred loading notifications'}</div>`;
    }
}

async function initNotificationsSystem() {
    const btn = document.getElementById('btn-notifications');
    const dropdown = document.getElementById('notifications-dropdown');
    const markAllBtn = document.getElementById('btn-mark-all-read');

    if (!btn || !dropdown) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('hidden');
        if (!dropdown.classList.contains('hidden')) {
            loadNotificationsList();
        }
    });

    document.addEventListener('click', (e) => {
        if (!dropdown.classList.contains('hidden') && !dropdown.contains(e.target) && e.target !== btn) {
            dropdown.classList.add('hidden');
        }
    });

    if (markAllBtn) {
        markAllBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const unreadItems = document.querySelectorAll('#notifications-list .notification-item.unread');
            if (unreadItems.length === 0) return;

            markAllBtn.disabled = true;
            const promises = [];
            unreadItems.forEach(item => {
                const id = item.getAttribute('data-id');
                promises.push(apiFetch(`/api/v1/users/read-notifications/${id}`, { method: 'GET' }));
            });
            try {
                await Promise.all(promises);
                await loadNotificationsList();
                await updateNotificationCount();
            } catch (err) {
                console.error('Failed to mark notifications as read:', err);
            } finally {
                markAllBtn.disabled = false;
            }
        });
    }

    await updateNotificationCount();
    setInterval(updateNotificationCount, 30000);
}

const DEFAULT_STORE_AVATAR = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="%23004D40"><path d="M19 6h-2c0-2.76-2.24-5-5-5S7 3.24 7 6H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-7-3c1.66 0 3 1.34 3 3H9c0-1.66 1.34-3 3-3zm7 17H5V8h14v12z"/></svg>`;

function updateHeaderVendorName() {
    const headerEl = document.getElementById('header-vendor-name');
    const avatarEl = document.getElementById('header-vendor-avatar');
    const profile = JSON.parse(localStorage.getItem('qs_vendor_user') || '{}');
    
    if (headerEl) {
        const name = profile.name || profile.storeName || (getLanguage() === 'ar' ? 'سوبر ماركت' : 'Market');
        headerEl.textContent = name;
    }

    if (avatarEl) {
        const photoKey = profile.photo || profile.avatar || profile.featuredPhoto || profile.photoUrl || '';
        avatarEl.onerror = () => {
            avatarEl.src = DEFAULT_STORE_AVATAR;
        };
        if (photoKey) {
            avatarEl.src = getImageUrl(photoKey);
        } else {
            avatarEl.src = DEFAULT_STORE_AVATAR;
        }
    }
}

export async function initMarket() {
    ui.initTheme();
    initTranslations();
    updateHeaderVendorName();
    setupSidebarNavigation();
    initNotificationsSystem();

    // Initialize Firebase Cloud Messaging Push Notifications
    initFCMNotificationService(apiClient, async () => {
        await refreshOrders();
        updateBadges();
        checkBuzzerAlarm();
        if (activeTab === 'queue' || activeTab === 'progress') {
            renderActiveTab();
        }
    });

    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('qs_vendor_token');
            localStorage.removeItem('qs_vendor_user');
            window.location.replace('login.html?role=market');
        });
    }

    const langBtn = document.getElementById('btn-lang-toggle');
    if (langBtn) {
        const updateLangBtnText = () => {
            langBtn.textContent = getLanguage() === 'en' ? 'العربية' : 'English';
        };
        updateLangBtnText();
        langBtn.addEventListener('click', () => {
            const nextLang = getLanguage() === 'en' ? 'ar' : 'en';
            setLanguage(nextLang);
            initTranslations();
            updateLangBtnText();
            renderActiveTab();
        });
    }

    subscribeLangChange(() => {
        initTranslations();
        updateHeaderVendorName();
        if (document.getElementById('notifications-dropdown') && !document.getElementById('notifications-dropdown').classList.contains('hidden')) {
            loadNotificationsList();
        }
        renderActiveTab();
    });

    // Fetch profile first to get myMarketId
    const userJson = localStorage.getItem('qs_vendor_user');
    if (userJson) {
        try { myMarketId = parseInt(JSON.parse(userJson).id); } catch (_) { }
    }
    try {
        const profileData = await apiFetch('/api/v1/users', { method: 'GET' });
        if (profileData && profileData.result) {
            const existing = JSON.parse(localStorage.getItem('qs_vendor_user') || '{}');
            localStorage.setItem('qs_vendor_user', JSON.stringify({ ...existing, ...profileData.result }));
            myMarketId = parseInt(profileData.result.id);
            profileLoaded = true;
            updateHeaderVendorName();
        }
    } catch (e) { console.error('Failed to load profile:', e); }

    try {
        const container = document.getElementById('mkt-tab-container');
        if (container) ui.renderShimmerGrid(container);
        await Promise.all([refreshProducts(), refreshOrders(), refreshCategories(), refreshDiscounts(), refreshOffers(), refreshBranches()]);
    } catch (e) { console.error('Failed to load initial data:', e); }

    // Wire dismiss alarm button in floating banner
    const dismissBtn = document.getElementById('btn-dismiss-alarm');
    if (dismissBtn) {
        dismissBtn.addEventListener('click', () => {
            ui.stopAlarmSound();
        });
    }

    updateBadges();
    checkBuzzerAlarm();
    renderActiveTab();

    // Poll orders every 10s — only re-render if on orders tab
    setInterval(async () => {
        try {
            await refreshOrders();
            updateBadges();
            checkBuzzerAlarm();
            if (activeTab === 'orders') renderActiveTab();
        } catch (e) { console.error('Error polling orders:', e); }
    }, 10000);
}

// Check if there are new pending orders for this store to sound alarm
function checkBuzzerAlarm() {
    const hasIncoming = orders.some(o => o.status === 'new' || o.status === 'pending_payment' || o.status === 'pending');
    if (hasIncoming) {
        ui.startAlarmSound();
    } else {
        ui.stopAlarmSound();
    }
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function updateBadges() {
    const badge = document.getElementById('mkt-badge-orders');
    const pendingCount = orders.filter(o => o.status === 'new' || o.status === 'pending_payment' || o.status === 'pending').length;
    if (badge) {
        badge.textContent = pendingCount;
        badge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
    }
    updateNotificationCount();
}

function setupSidebarNavigation() {
    const links = document.querySelectorAll('.sidebar-link');
    links.forEach(link => {
        link.addEventListener('click', () => {
            links.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            if (activeDashboardChatInterval) {
                clearInterval(activeDashboardChatInterval);
                activeDashboardChatInterval = null;
            }
            
            const targetTab = link.getAttribute('data-tab');
            if (targetTab) {
                activeTab = targetTab;
                updateHeaders();
                renderActiveTab();
            }
        });
    });
}

function updateHeaders() {
    const title = document.getElementById('mkt-section-title');
    const subtitle = document.getElementById('mkt-section-subtitle');
    if (title && subtitle) {
        title.textContent = t(`mkt_section_${activeTab}_title`);
        subtitle.textContent = t(`mkt_section_${activeTab}_sub`);
    }
}

function renderActiveTab() {
    updateHeaders();
    const container = document.getElementById('mkt-tab-container');
    if (!container) return;
    container.replaceChildren();

    try {
        if (activeTab === 'inventory') {
            renderInventoryTab(container);
        } else if (activeTab === 'orders') {
            renderOrdersTab(container);
        } else if (activeTab === 'categories') {
            const render = () => {
                container.replaceChildren();
                try { renderCategoriesTab(container); } catch(e) { console.error('renderCategoriesTab error:', e); }
            };
            if (categories.length > 0 || categoriesLoaded) {
                render();
                refreshCategories().then(() => {
                    if (activeTab === 'categories') render();
                });
            } else {
                ui.renderShimmerList(container);
                refreshCategories().then(() => {
                    if (activeTab === 'categories') render();
                });
            }
        } else if (activeTab === 'discounts') {
            const render = () => {
                container.replaceChildren();
                try { renderDiscountsTab(container); } catch(e) { console.error('renderDiscountsTab error:', e); }
            };
            if (discounts.length > 0 || discountsLoaded) {
                render();
                refreshDiscounts().then(() => {
                    if (activeTab === 'discounts') render();
                });
            } else {
                ui.renderShimmerList(container);
                refreshDiscounts().then(() => {
                    if (activeTab === 'discounts') render();
                });
            }
        } else if (activeTab === 'offers') {
            const render = () => {
                container.replaceChildren();
                try { renderOffersTab(container); } catch(e) { console.error('renderOffersTab error:', e); }
            };
            if (offers.length > 0 || offersLoaded) {
                render();
                refreshOffers().then(() => {
                    if (activeTab === 'offers') render();
                });
            } else {
                ui.renderShimmerGrid(container);
                refreshOffers().then(() => {
                    if (activeTab === 'offers') render();
                });
            }
        } else if (activeTab === 'profile') {
            const render = () => {
                container.replaceChildren();
                try { renderProfileTab(container); } catch(e) { console.error('renderProfileTab error:', e); }
            };
            if (profileLoaded) {
                render();
                refreshProfile().then(() => {
                    if (activeTab === 'profile') render();
                });
            } else {
                ui.renderShimmerList(container);
                refreshProfile().then(() => {
                    if (activeTab === 'profile') render();
                });
            }
        } else if (activeTab === 'branches') {
            const render = () => {
                container.replaceChildren();
                try { renderBranchesTab(container); } catch(e) { console.error('renderBranchesTab error:', e); }
            };
            if (branches.length > 0 || branchesLoaded) {
                render();
                refreshBranches().then(() => {
                    if (activeTab === 'branches') render();
                });
            } else {
                ui.renderShimmerGrid(container);
                refreshBranches().then(() => {
                    if (activeTab === 'branches') render();
                });
            }
        } else if (activeTab === 'chats') {
            renderChatsTab(container);
        } else if (activeTab === 'settings') {
            renderSettingsTab(container);
        }
    } catch (e) {
        console.error(`Error rendering tab ${activeTab}:`, e);
        container.innerHTML = `<div style="text-align:center; padding: 3rem; color: var(--color-danger);">${getLanguage() === 'ar' ? 'حدث خطأ أثناء عرض التبويب' : 'Error rendering tab'}</div>`;
    }
}

/* ==========================================================================
   Tab 10: Store & App Settings
   ========================================================================== */
function renderSettingsTab(parent) {
    const isAr = getLanguage() === 'ar';

    const settingsGrid = ui.createElement('div', ['settings-grid'], {
        style: 'display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.5rem; width: 100%; align-items: start;'
    });

    const prefsPanel = ui.createElement('div', ['glass-panel'], {
        style: 'padding: 1.8rem; display: flex; flex-direction: column; gap: 1.2rem;'
    });

    const prefsHeader = ui.createElement('div', []);
    prefsHeader.appendChild(ui.createElementWithText('h3', isAr ? '⚙️ تفضيلات اللوحة والحساب' : '⚙️ Dashboard & Account Settings', [], { style: 'margin: 0 0 0.4rem 0; color: var(--text-primary); font-size: 1.2rem;' }));
    prefsHeader.appendChild(ui.createElementWithText('p', isAr ? 'التحكم في لغة اللوحة، المظهر الفاتح/الليلي، وتسجيل الخروج' : 'Manage interface language, display theme mode, and session logout', [], { style: 'margin: 0; color: var(--text-secondary); font-size: 0.85rem;' }));
    prefsPanel.appendChild(prefsHeader);

    // Language Option
    const currentLang = getLanguage();
    const langRow = ui.createElement('div', [], {
        style: 'display: flex; align-items: center; justify-content: space-between; padding: 1rem; background: var(--bg-card, rgba(255,255,255,0.05)); border: 1px solid var(--border-color); border-radius: 12px;'
    });
    const langTextGroup = ui.createElement('div', []);
    langTextGroup.appendChild(ui.createElementWithText('div', isAr ? '🌐 لغة اللوحة (Language)' : '🌐 Interface Language', [], { style: 'font-weight: 700; color: var(--text-primary);' }));
    langTextGroup.appendChild(ui.createElementWithText('div', currentLang === 'ar' ? 'اللغة الحالية: العربية 🇸🇦' : 'Current Language: English 🇬🇧', [], { style: 'font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;' }));
    langRow.appendChild(langTextGroup);

    const langBtn = ui.createElementWithText('button', currentLang === 'ar' ? 'English' : 'العربية', ['btn', 'btn-secondary', 'btn-sm'], {
        style: 'border-radius: 8px; padding: 0.5rem 1rem; font-weight: 700; cursor: pointer;'
    });
    langBtn.addEventListener('click', () => {
        setLanguage(currentLang === 'ar' ? 'en' : 'ar');
    });
    langRow.appendChild(langBtn);
    prefsPanel.appendChild(langRow);

    // Theme Option
    const isDark = (localStorage.getItem('qs_theme') || 'light') === 'dark';
    const themeRow = ui.createElement('div', [], {
        style: 'display: flex; align-items: center; justify-content: space-between; padding: 1rem; background: var(--bg-card, rgba(255,255,255,0.05)); border: 1px solid var(--border-color); border-radius: 12px;'
    });
    const themeTextGroup = ui.createElement('div', []);
    themeTextGroup.appendChild(ui.createElementWithText('div', isAr ? '🌙 مظهر اللوحة (Theme)' : '🌙 Display Theme', [], { style: 'font-weight: 700; color: var(--text-primary);' }));
    themeTextGroup.appendChild(ui.createElementWithText('div', isDark ? (isAr ? 'الوضع الحالي: الداكن (Dark Mode)' : 'Current: Dark Mode') : (isAr ? 'الوضع الحالي: الفاتح (Light Mode)' : 'Current: Light Mode'), [], { style: 'font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;' }));
    themeRow.appendChild(themeTextGroup);

    const themeBtn = ui.createElementWithText('button', isDark ? '☀️ Light' : '🌙 Dark', ['btn', 'btn-secondary', 'btn-sm'], {
        style: 'border-radius: 8px; padding: 0.5rem 1rem; font-weight: 700; cursor: pointer;'
    });
    themeBtn.addEventListener('click', () => {
        toggleTheme();
        renderActiveTab();
    });
    themeRow.appendChild(themeBtn);
    prefsPanel.appendChild(themeRow);

    // Logout Section
    const logoutRow = ui.createElement('div', [], {
        style: 'display: flex; align-items: center; justify-content: space-between; padding: 1rem; background: rgba(255, 71, 87, 0.08); border: 1px solid rgba(255, 71, 87, 0.3); border-radius: 12px; margin-top: 0.5rem;'
    });
    const logoutTextGroup = ui.createElement('div', []);
    logoutTextGroup.appendChild(ui.createElementWithText('div', isAr ? '🚪 تسجيل الخروج' : '🚪 Account Logout', [], { style: 'font-weight: 700; color: #ff4757;' }));
    logoutTextGroup.appendChild(ui.createElementWithText('div', isAr ? 'إنهاء الجلسة الحالية والعودة لصفحة الدخول' : 'End current session and return to login screen', [], { style: 'font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;' }));
    logoutRow.appendChild(logoutTextGroup);

    const logoutBtn = ui.createElementWithText('button', isAr ? 'خروج' : 'Logout', ['btn', 'btn-danger', 'btn-sm'], {
        style: 'border-radius: 8px; padding: 0.5rem 1.2rem; font-weight: 700; cursor: pointer;'
    });
    logoutBtn.addEventListener('click', () => {
        const desktopLogout = document.getElementById('btn-logout');
        if (desktopLogout) {
            desktopLogout.click();
        } else {
            localStorage.removeItem('qs_vendor_token');
            localStorage.removeItem('qs_vendor_user');
            window.location.replace('login.html');
        }
    });
    logoutRow.appendChild(logoutBtn);
    prefsPanel.appendChild(logoutRow);

    settingsGrid.appendChild(prefsPanel);
    parent.appendChild(settingsGrid);
}

/* ==========================================================================
   Tab 1: Inventory / Products Catalog
   ========================================================================== */
function renderInventoryTab(parent) {
    // Toolbar
    const toolbar = ui.createElement('div', ['filter-bar'], { style: 'margin-bottom: 1.5rem; display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; width: 100%;' });

    const searchInput = ui.createElement('input', ['search-input'], {
        id: 'mkt-item-search',
        placeholder: t('mkt_inventory_search_placeholder'),
        type: 'text'
    });

    const catFilter = ui.createElement('select', ['select-input'], { id: 'mkt-cat-filter' });
    catFilter.appendChild(ui.createElementWithText('option', t('mkt_inventory_cat_all'), [], { value: 'all' }));
    if (categories.length === 0) {
        const nocat = ui.createElementWithText('option',
            getLanguage() === 'ar' ? '— أضف أقساماً من تبويب الأقسام أولاً —' : '— Add categories from the Categories tab first —',
            [], { value: '', disabled: 'disabled' });
        catFilter.appendChild(nocat);
    } else {
        categories.forEach(c => catFilter.appendChild(ui.createElementWithText('option', c.name, [], { value: c.name })));
    }

    const addBtn = ui.createElementWithText('button', t('mkt_inventory_btn_add'), ['btn', 'btn-success']);
    addBtn.addEventListener('click', showAddProductModal);

    toolbar.appendChild(searchInput);
    toolbar.appendChild(catFilter);
    toolbar.appendChild(addBtn);
    parent.appendChild(toolbar);

    // Card Grid
    const grid = ui.createElement('div', ['analytics-grid']);
    parent.appendChild(grid);

    const runFilter = () => {
        grid.replaceChildren();
        const query = searchInput.value.toLowerCase();
        const selectedCat = catFilter.value;

        const filtered = marketProducts.filter(item => {
            const name = (item && item.name) ? item.name.toString().toLowerCase() : '';
            const desc = (item && item.description) ? item.description.toString().toLowerCase() : '';
            const matchesQuery = name.includes(query) || desc.includes(query);
            const matchesCat = selectedCat === 'all' || item.category === selectedCat;
            return matchesQuery && matchesCat;
        });

        if (filtered.length === 0) {
            grid.appendChild(ui.createElementWithText('p', t('mkt_inventory_stock_empty'), [], {
                style: 'text-align: center; padding: 2rem; color: var(--text-muted); grid-column: 1 / -1;'
            }));
            return;
        }

        filtered.forEach(item => {
            const qty = item.rawProduct ? (item.rawProduct.quantity || 0) : 0;
            const stockStatus = qty === 0 ? 'out' : qty < 5 ? 'low' : 'ok';

            const card = ui.createElement('div', ['summary-card'], { style: item.isOutOfStock ? 'opacity: 0.65;' : '' });

            // Image
            if (item.image) {
                const img = ui.createElement('img', [], {
                    src: getImageUrl(item.image),
                    style: 'width: 100%; height: 100px; object-fit: cover; border-radius: 6px; margin-bottom: 1rem; border: 1px solid var(--border-color);'
                });
                card.appendChild(img);
            } else {
                const imgMock = ui.createElement('div', [], {
                    style: 'height: 100px; background: linear-gradient(135deg, #2ed573, #1e90ff); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 2rem; margin-bottom: 1rem;'
                });
                imgMock.textContent = '📦';
                card.appendChild(imgMock);
            }

            card.appendChild(ui.createElementWithText('strong', item.name, [], { style: 'font-size: 1.05rem; display: block; margin-bottom: 0.25rem;' }));
            card.appendChild(ui.createElementWithText('div', `$${(parseFloat(item.price) || 0).toFixed(2)}`, [], { style: 'font-weight: 800; color: var(--color-success); margin-bottom: 0.5rem;' }));

            if (item.category) {
                card.appendChild(ui.createElementWithText('span', item.category, ['badge', 'badge-info'], { style: 'margin-bottom: 0.5rem;' }));
            }

            card.appendChild(ui.createElementWithText('p', item.description || '', ['text-muted'], { style: 'font-size: 0.8rem; margin-bottom: 0.75rem; line-height: 1.4;' }));

            // Stock badge
            const stockBadge = ui.createElement('div', [], { style: 'margin-bottom: 0.75rem;' });
            if (stockStatus === 'out') {
                stockBadge.appendChild(ui.createElementWithText('span', t('mkt_inventory_level_out'), ['badge', 'badge-danger']));
            } else if (stockStatus === 'low') {
                stockBadge.appendChild(ui.createElementWithText('span', `${t('mkt_inventory_level_low')} (${qty})`, ['badge', 'badge-pending']));
            } else {
                stockBadge.appendChild(ui.createElementWithText('span', `${t('mkt_inventory_level_ok')} (${qty})`, ['badge', 'badge-success']));
            }
            card.appendChild(stockBadge);

            // Actions
            const actions = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-color); padding-top: 0.75rem; margin-top: 0.75rem;' });

            // Toggle stock
            const switchLabel = ui.createElement('label', ['switch-container']);
            const switchInput = ui.createElement('input', ['switch-input'], {
                type: 'checkbox',
                checked: !item.isOutOfStock ? 'checked' : ''
            });
            switchInput.addEventListener('change', async (e) => {
                const isChecked = e.target.checked;
                try {
                    await apiFetch('/api/v1/products', {
                        method: 'PUT',
                        body: JSON.stringify({
                            id: parseInt(item.id),
                            name: item.name,
                            photo: item.image,
                            description: item.description,
                            quantity: isChecked ? 999 : 0,
                            limit: false,
                            price: item.price,
                            size: null,
                            type: 1,
                            categoryId: item.rawProduct ? item.rawProduct.categoryId : 0,
                            discountIds: []
                        })
                    });
                    item.isOutOfStock = !isChecked;
                    renderActiveTab();
                } catch (err) {
                    console.error('Failed to toggle availability:', err);
                    ui.showToast(t('error_generic') + ': ' + err.message, 'error');
                    e.target.checked = !isChecked;
                }
            });
            switchLabel.appendChild(switchInput);
            switchLabel.appendChild(ui.createElement('span', ['switch-slider']));
            switchLabel.appendChild(ui.createElementWithText('span', !item.isOutOfStock ? t('rest_menu_in_stock') : t('rest_menu_stock_out'), [], { style: 'font-size: 0.75rem;' }));

            const editBtn = ui.createElementWithText('button', t('rest_menu_btn_edit'), ['btn', 'btn-secondary', 'btn-sm']);
            editBtn.addEventListener('click', () => showEditProductModal(item));

            actions.appendChild(switchLabel);
            actions.appendChild(editBtn);
            card.appendChild(actions);
            grid.appendChild(card);
        });
    };

    searchInput.addEventListener('input', runFilter);
    catFilter.addEventListener('change', runFilter);
    runFilter();
}

function showAddProductModal() {
    const form = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; min-width: 320px; max-width: 500px;' });

    const nameWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    nameWrap.appendChild(ui.createElementWithText('label', t('mkt_add_modal_name'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const nameIn = ui.createElement('input', ['search-input'], { type: 'text', placeholder: getLanguage() === 'ar' ? 'مثال: حليب طازج' : 'e.g. Fresh Milk' });
    nameWrap.appendChild(nameIn);

    const catWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    catWrap.appendChild(ui.createElementWithText('label', t('mkt_add_modal_category'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const catSel = ui.createElement('select', ['select-input']);
    if (categories.length === 0) {
        ['Dairy', 'Bakery', 'Canned', 'Produce', 'Beverages'].forEach(c => catSel.appendChild(ui.createElementWithText('option', c, [], { value: c })));
    } else {
        categories.forEach(c => catSel.appendChild(ui.createElementWithText('option', c.name, [], { value: c.name })));
    }
    catWrap.appendChild(catSel);

    const row1 = ui.createElement('div', [], { style: 'display: grid; grid-template-columns: 2fr 1fr; gap: 1rem;' });
    row1.appendChild(nameWrap);
    row1.appendChild(catWrap);

    const descWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    descWrap.appendChild(ui.createElementWithText('label', t('mkt_add_modal_desc'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const descIn = ui.createElement('textarea', ['search-input'], { style: 'min-height: 60px; font-family: inherit; resize: vertical;', placeholder: getLanguage() === 'ar' ? 'وصف المنتج...' : 'Product description...' });
    descWrap.appendChild(descIn);

    const priceWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    priceWrap.appendChild(ui.createElementWithText('label', t('mkt_add_modal_price'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const priceIn = ui.createElement('input', ['search-input'], { type: 'number', step: '0.01', min: '0', value: '5.00' });
    priceWrap.appendChild(priceIn);

    const qtyWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    qtyWrap.appendChild(ui.createElementWithText('label', t('rest_add_modal_quantity'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const qtyIn = ui.createElement('input', ['search-input'], { type: 'number', min: '0', step: '1', value: '50' });
    qtyWrap.appendChild(qtyIn);

    const row2 = ui.createElement('div', [], { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;' });
    row2.appendChild(priceWrap);
    row2.appendChild(qtyWrap);

    // Discount dropdown
    const discountWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    discountWrap.appendChild(ui.createElementWithText('label', t('rest_add_modal_discount'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const discountSel = ui.createElement('select', ['select-input']);
    discountSel.appendChild(ui.createElementWithText('option', t('rest_add_modal_no_discount'), [], { value: '' }));
    discounts.forEach(d => discountSel.appendChild(ui.createElementWithText('option', `${d.name} (${d.percentage}%)`, [], { value: d.id.toString() })));
    discountWrap.appendChild(discountSel);

    // Image
    const imgWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    imgWrap.appendChild(ui.createElementWithText('label', t('mkt_add_modal_image'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const imgRow = ui.createElement('div', [], { style: 'display: flex; gap: 1rem; align-items: center;' });
    const imgInput = ui.createElement('input', [], { type: 'file', accept: 'image/*', style: 'display: none;' });
    const uploadImgBtn = ui.createElementWithText('button', getLanguage() === 'ar' ? 'اختر صورة' : 'Choose Image', ['btn', 'btn-secondary']);
    uploadImgBtn.addEventListener('click', () => imgInput.click());
    const previewImg = ui.createElement('img', [], { style: 'width: 50px; height: 50px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); object-fit: cover; display: none;' });
    let uploadedPhotoKey = '';
    imgInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            previewImg.src = URL.createObjectURL(file);
            previewImg.style.display = 'block';
            try {
                const result = await uploadImage(file);
                if (result) { uploadedPhotoKey = result; previewImg.src = getImageUrl(uploadedPhotoKey); }
            } catch (_) { ui.showToast(getLanguage() === 'ar' ? 'فشل رفع الصورة' : 'Failed to upload image', 'error'); }
        }
    });
    imgRow.appendChild(uploadImgBtn);
    imgRow.appendChild(imgInput);
    imgRow.appendChild(previewImg);
    imgWrap.appendChild(imgRow);
    const imgHint = ui.createElementWithText('span', getLanguage() === 'ar' ? 'الأبعاد الموصى بها: 600 × 600 بكسل (نسبة 1:1)' : 'Recommended dimensions: 600 × 600 px (1:1)', [], { style: 'font-size: 0.75rem; color: var(--text-muted); display: block; margin-top: 0.25rem;' });
    imgWrap.appendChild(imgHint);

    // Availability
    const availLabel = ui.createElement('label', ['switch-container'], { style: 'margin-top: 0.5rem;' });
    const availInput = ui.createElement('input', ['switch-input'], { type: 'checkbox', checked: 'true' });
    const availSlider = ui.createElement('div', ['switch-slider']);
    availLabel.appendChild(availInput);
    availLabel.appendChild(availSlider);
    availLabel.appendChild(ui.createElementWithText('span', t('mkt_add_modal_available'), [], { style: 'font-size: 0.85rem;' }));
    availInput.addEventListener('change', (e) => {
        qtyIn.disabled = !e.target.checked;
        if (!e.target.checked) qtyIn.value = '0';
        else if (qtyIn.value === '0') qtyIn.value = '50';
    });

    form.appendChild(row1);
    form.appendChild(descWrap);
    form.appendChild(row2);
    form.appendChild(discountWrap);
    form.appendChild(imgWrap);
    form.appendChild(availLabel);

    ui.showModal(t('mkt_add_modal_title'), form, [
        {
            text: t('mkt_add_modal_save_btn'),
            type: 'success',
            closeOnClick: false,
            onClick: async () => {
                const name = nameIn.value.trim();
                const priceVal = priceIn.value.trim();
                const qtyVal = qtyIn.value.trim();
                const description = descIn.value.trim();

                let isValid = true;
                if (!name) {
                    ui.setInputInvalid(nameIn, getLanguage() === 'ar' ? 'الاسم مطلوب' : 'Name is required');
                    isValid = false;
                }
                if (!priceVal || parseFloat(priceVal) <= 0) {
                    ui.setInputInvalid(priceIn, getLanguage() === 'ar' ? 'السعر يجب أن يكون أكبر من 0' : 'Price must be greater than 0');
                    isValid = false;
                }
                if (!description) {
                    ui.setInputInvalid(descIn, getLanguage() === 'ar' ? 'الوصف مطلوب' : 'Description is required');
                    isValid = false;
                }
                if (availInput.checked && (!qtyVal || parseInt(qtyVal) < 0)) {
                    ui.setInputInvalid(qtyIn, getLanguage() === 'ar' ? 'الكمية يجب أن تكون 0 أو أكثر' : 'Quantity must be 0 or more');
                    isValid = false;
                }

                if (!isValid) return;

                const price = parseFloat(priceVal);
                const quantity = availInput.checked ? parseInt(qtyVal) : 0;
                const selectedCatName = catSel.value;
                const matchedCat = categories.find(c => c.name === selectedCatName);
                const categoryId = matchedCat ? matchedCat.id : 0;
                // Optimistic add
                const tempItem = {
                    id: 'temp-' + Date.now(), name, price, category: selectedCatName,
                    description, isOutOfStock: !availInput.checked || quantity === 0,
                    image: uploadedPhotoKey, rawProduct: { quantity, discountIds: discountSel.value ? [parseInt(discountSel.value)] : [] }
                };
                marketProducts.push(tempItem);
                renderActiveTab();
                ui.closeModal();

                try {
                    await apiFetch('/api/v1/products', {
                        method: 'POST',
                        body: JSON.stringify({
                            id: 0, name, photo: uploadedPhotoKey, description,
                            quantity, limit: false, price, size: null, type: 1,
                            categoryId, creatorId: myMarketId || 0,
                            discountIds: discountSel.value ? [parseInt(discountSel.value)] : []
                        })
                    });
                    ui.showToast(getLanguage() === 'ar' ? 'تمت إضافة المنتج بنجاح' : 'Product added successfully', 'success');
                    await refreshProducts();
                    if (activeTab === 'inventory') renderActiveTab();
                } catch (err) {
                    console.error('Failed to create product:', err);
                    marketProducts = marketProducts.filter(p => p.id !== tempItem.id);
                    renderActiveTab();
                    ui.showToast((getLanguage() === 'ar' ? 'فشل إضافة المنتج: ' : 'Failed to add product: ') + err.message, 'error');
                }
            }
        },
        { text: t('cancel'), type: 'secondary', onClick: ui.closeModal }
    ]);
}

function showEditProductModal(item) {
    const modalBody = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.75rem;' });

    modalBody.appendChild(ui.createElementWithText('label', t('mkt_add_modal_name'), [], { style: 'font-size: 0.85rem;' }));
    const nameIn = ui.createElement('input', ['search-input'], { value: item.name, type: 'text', style: 'width: 100%' });
    modalBody.appendChild(nameIn);

    modalBody.appendChild(ui.createElementWithText('label', t('mkt_add_modal_price'), [], { style: 'font-size: 0.85rem;' }));
    const priceIn = ui.createElement('input', ['search-input'], { value: item.price, type: 'number', style: 'width: 100%' });
    modalBody.appendChild(priceIn);

    modalBody.appendChild(ui.createElementWithText('label', t('mkt_add_modal_desc'), [], { style: 'font-size: 0.85rem;' }));
    const descIn = ui.createElement('input', ['search-input'], { value: item.description || '', type: 'text', style: 'width: 100%' });
    modalBody.appendChild(descIn);

    const currentQty = item.rawProduct && item.rawProduct.quantity !== undefined ? item.rawProduct.quantity : 50;
    modalBody.appendChild(ui.createElementWithText('label', t('rest_add_modal_quantity'), [], { style: 'font-size: 0.85rem;' }));
    const qtyIn = ui.createElement('input', ['search-input'], { value: currentQty, type: 'number', style: 'width: 100%', min: '0' });
    modalBody.appendChild(qtyIn);

    // Discount dropdown
    let activeDiscountId = '';
    if (item.rawProduct && item.rawProduct.discountIds && item.rawProduct.discountIds.length > 0) {
        activeDiscountId = item.rawProduct.discountIds[0].toString();
    }
    modalBody.appendChild(ui.createElementWithText('label', t('rest_add_modal_discount'), [], { style: 'font-size: 0.85rem;' }));
    const discountSel = ui.createElement('select', ['select-input'], { style: 'width: 100%' });
    discountSel.appendChild(ui.createElementWithText('option', t('rest_add_modal_no_discount'), [], { value: '' }));
    discounts.forEach(d => {
        const opt = ui.createElementWithText('option', `${d.name} (${d.percentage}%)`, [], { value: d.id.toString() });
        if (d.id.toString() === activeDiscountId) opt.selected = true;
        discountSel.appendChild(opt);
    });
    modalBody.appendChild(discountSel);

    // Category dropdown
    modalBody.appendChild(ui.createElementWithText('label', t('mkt_add_modal_category'), [], { style: 'font-size: 0.85rem;' }));
    const catSel = ui.createElement('select', ['select-input'], { style: 'width: 100%' });
    if (categories.length === 0) {
        ['Dairy', 'Bakery', 'Canned', 'Produce', 'Beverages'].forEach(c => catSel.appendChild(ui.createElementWithText('option', c, [], { value: c })));
    } else {
        categories.forEach(c => catSel.appendChild(ui.createElementWithText('option', c.name, [], { value: c.name })));
    }
    catSel.value = item.category || '';
    modalBody.appendChild(catSel);

    // Image row
    modalBody.appendChild(ui.createElementWithText('label', t('mkt_add_modal_image'), [], { style: 'font-size: 0.85rem;' }));
    const imgRow = ui.createElement('div', [], { style: 'display: flex; gap: 1rem; align-items: center;' });
    const imgInput = ui.createElement('input', [], { type: 'file', accept: 'image/*', style: 'display: none;' });
    const uploadImgBtn = ui.createElementWithText('button', getLanguage() === 'ar' ? 'اختر صورة' : 'Choose Image', ['btn', 'btn-secondary']);
    uploadImgBtn.addEventListener('click', () => imgInput.click());
    const previewImg = ui.createElement('img', [], {
        src: getImageUrl(item.image || ''),
        style: 'width: 50px; height: 50px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); object-fit: cover;'
    });
    if (!item.image) previewImg.style.display = 'none';
    let uploadedPhotoKey = item.image || '';
    imgInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            previewImg.src = URL.createObjectURL(file);
            previewImg.style.display = 'block';
            try {
                const result = await uploadImage(file);
                if (result) { uploadedPhotoKey = result; previewImg.src = getImageUrl(uploadedPhotoKey); }
            } catch (_) {
                ui.showToast(getLanguage() === 'ar' ? 'فشل رفع الصورة' : 'Failed to upload image', 'error');
            }
        }
    });
    imgRow.appendChild(uploadImgBtn);
    imgRow.appendChild(imgInput);
    imgRow.appendChild(previewImg);
    modalBody.appendChild(imgRow);
    const imgHint = ui.createElementWithText('span', getLanguage() === 'ar' ? 'الأبعاد الموصى بها: 600 × 600 بكسل (نسبة 1:1)' : 'Recommended dimensions: 600 × 600 px (1:1)', [], { style: 'font-size: 0.75rem; color: var(--text-muted); display: block; margin-top: 0.25rem;' });
    modalBody.appendChild(imgHint);

    ui.showModal(t('rest_menu_modal_title'), modalBody, [
        {
            text: t('rest_menu_modal_save_btn'),
            type: 'success',
            closeOnClick: false,
            onClick: async () => {
                const newName = nameIn.value.trim();
                const priceVal = priceIn.value.trim();
                const qtyVal = qtyIn.value.trim();
                const newDescText = descIn.value.trim();

                let isValid = true;
                if (!newName) {
                    ui.setInputInvalid(nameIn, getLanguage() === 'ar' ? 'الاسم مطلوب' : 'Name is required');
                    isValid = false;
                }
                if (!priceVal || parseFloat(priceVal) <= 0) {
                    ui.setInputInvalid(priceIn, getLanguage() === 'ar' ? 'السعر يجب أن يكون أكبر من 0' : 'Price must be greater than 0');
                    isValid = false;
                }
                if (!newDescText) {
                    ui.setInputInvalid(descIn, getLanguage() === 'ar' ? 'الوصف مطلوب' : 'Description is required');
                    isValid = false;
                }
                if (!qtyVal || parseInt(qtyVal) < 0) {
                    ui.setInputInvalid(qtyIn, getLanguage() === 'ar' ? 'الكمية يجب أن تكون 0 أو أكثر' : 'Quantity must be 0 or more');
                    isValid = false;
                }

                if (!isValid) return;

                const newPrice = parseFloat(priceVal);
                const quantity = parseInt(qtyVal);
                const selectedCatName = catSel.value;
                const matchedCat = categories.find(c => c.name === selectedCatName);
                const categoryId = matchedCat ? matchedCat.id : (item.rawProduct ? item.rawProduct.categoryId : 0);
                const originalProducts = [...marketProducts];
                const index = marketProducts.findIndex(p => p.id === item.id);
                if (index !== -1) {
                    marketProducts[index] = { ...marketProducts[index], name: newName, price: newPrice, category: selectedCatName, description: newDescText, image: uploadedPhotoKey, isOutOfStock: quantity === 0, rawProduct: { ...marketProducts[index].rawProduct, quantity, discountIds: discountSel.value ? [parseInt(discountSel.value)] : [] } };
                    renderActiveTab();
                }
                ui.closeModal();

                try {
                    await apiFetch('/api/v1/products', {
                        method: 'PUT',
                        body: JSON.stringify({
                            id: parseInt(item.id), name: newName, photo: uploadedPhotoKey,
                            description: newDescText, quantity, limit: false, price: newPrice,
                            size: null, type: 1, categoryId,
                            creatorId: item.rawProduct ? item.rawProduct.creatorId : (myMarketId || 0),
                            discountIds: discountSel.value ? [parseInt(discountSel.value)] : []
                        })
                    });
                    ui.showToast(getLanguage() === 'ar' ? 'تم تحديث المنتج بنجاح' : 'Product updated successfully', 'success');
                    await refreshProducts();
                    if (activeTab === 'inventory') renderActiveTab();
                } catch (err) {
                    console.error('Failed to update product:', err);
                    marketProducts = originalProducts;
                    renderActiveTab();
                    ui.showToast((getLanguage() === 'ar' ? 'فشل تحديث المنتج: ' : 'Failed to update product: ') + err.message, 'error');
                }
            }
        },
        {
            text: getLanguage() === 'ar' ? '🗑️ حذف المنتج' : '🗑️ Delete Product',
            type: 'danger',
            onClick: async () => {
                if (confirm(getLanguage() === 'ar' ? 'هل أنت متأكد من حذف هذا المنتج؟' : 'Are you sure you want to delete this product?')) {
                    const originalProducts = [...marketProducts];
                    marketProducts = marketProducts.filter(p => p.id !== item.id);
                    renderActiveTab();
                    ui.closeModal();
                    try {
                        await apiFetch(`/api/v1/products/${item.id}`, { method: 'DELETE' });
                        ui.showToast(getLanguage() === 'ar' ? 'تم حذف المنتج بنجاح' : 'Product deleted successfully', 'success');
                        await refreshProducts();
                        if (activeTab === 'inventory') renderActiveTab();
                    } catch (err) {
                        console.error('Failed to delete product:', err);
                        marketProducts = originalProducts;
                        renderActiveTab();
                        ui.showToast((getLanguage() === 'ar' ? 'فشل حذف المنتج: ' : 'Failed to delete product: ') + err.message, 'error');
                    }
                }
            }
        },
        { text: t('cancel'), type: 'secondary', onClick: ui.closeModal }
    ]);
}

/* ==========================================================================
   Tab 2: Orders Queue (Grocery Picking)
   ========================================================================== */
function renderOrdersTab(parent) {
    // New orders needing accept/decline
    const newOrders = orders.filter(o => o.status === 'new' || o.status === 'pending_payment');
    // Accepted, waiting for captain to confirm
    const waitingOrders = orders.filter(o => o.status === 'waiting_for_driver');
    // Captain confirmed, market can prepare
    const confirmedOrders = orders.filter(o => o.status === 'confirmed' || o.status === 'preparing');
    const completedOrders = orders.filter(o => o.status === 'completed' || o.status === 'ready_for_pickup' || o.status === 'on_the_way');

    if (newOrders.length === 0 && waitingOrders.length === 0 && confirmedOrders.length === 0 && completedOrders.length === 0) {
        const emptyBlock = ui.createElement('div', ['glass-panel'], { style: 'text-align: center; padding: 4rem 2rem;' });
        emptyBlock.appendChild(ui.createElementWithText('h3', t('mkt_packing_empty_title'), [], { style: 'margin-bottom: 0.5rem;' }));
        emptyBlock.appendChild(ui.createElementWithText('p', t('mkt_packing_empty_desc'), ['text-secondary']));
        parent.appendChild(emptyBlock);
        return;
    }

    // New orders (status=0/1): need accept or decline
    if (newOrders.length > 0) {
        parent.appendChild(ui.createElementWithText('h3', getLanguage() === 'ar' ? '🔔 طلبات جديدة تحتاج قبول' : '🔔 New Orders - Needs Acceptance', [], { style: 'margin-bottom: 1rem; font-size: 1.05rem;' }));
        const grid0 = ui.createElement('div', ['analytics-grid'], { style: 'margin-bottom: 2rem;' });
        newOrders.forEach(ord => buildOrderCard(grid0, ord));
        parent.appendChild(grid0);
    }

    // Waiting for driver (status=2): accepted, captain not yet confirmed
    if (waitingOrders.length > 0) {
        parent.appendChild(ui.createElementWithText('h3', getLanguage() === 'ar' ? '⏳ بانتظار تعيين سائق' : '⏳ Awaiting Driver Assignment', [], { style: 'margin-bottom: 1rem; font-size: 1.05rem; color: var(--color-pending);' }));
        const grid1 = ui.createElement('div', ['analytics-grid'], { style: 'margin-bottom: 2rem;' });
        waitingOrders.forEach(ord => buildOrderCard(grid1, ord, true));
        parent.appendChild(grid1);
    }

    // Active orders (status=3/4): captain confirmed, market preparing
    if (confirmedOrders.length > 0) {
        parent.appendChild(ui.createElementWithText('h3', getLanguage() === 'ar' ? '🛒 طلبات قيد التجهيز' : '🛒 Active Orders', [], { style: 'margin-bottom: 1rem; font-size: 1.05rem;' }));
        const grid = ui.createElement('div', ['analytics-grid'], { style: 'margin-bottom: 2rem;' });
        confirmedOrders.forEach(ord => buildOrderCard(grid, ord));
        parent.appendChild(grid);
    }

    // Completed orders
    if (completedOrders.length > 0) {
        parent.appendChild(ui.createElementWithText('h3', getLanguage() === 'ar' ? '✅ الطلبات المكتملة' : '✅ Completed Orders', [], { style: 'margin-bottom: 1rem; font-size: 1.05rem; color: var(--color-success);' }));
        const grid2 = ui.createElement('div', ['analytics-grid']);
        completedOrders.forEach(ord => buildOrderCard(grid2, ord, true));
        parent.appendChild(grid2);
    }
}

function buildOrderCard(container, ord, readonly = false) {
    const card = ui.createElement('div', ['summary-card']);

    // Header
    const header = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;' });
    header.appendChild(ui.createElementWithText('strong', `${getLanguage() === 'ar' ? 'طلب #' : 'Order #'}${ord.id}`, [], { style: 'font-size: 1.05rem;' }));

    const statusColors = { 
        new: 'badge-pending', pending_payment: 'badge-warning', waiting_for_driver: 'badge-info',
        confirmed: 'badge-info', preparing: 'badge-info', ready_for_pickup: 'badge-success',
        on_the_way: 'badge-info', completed: 'badge-success', declined: 'badge-danger'
    };
    const statusLabels = {
        new: getLanguage() === 'ar' ? 'جديد' : 'New',
        pending_payment: getLanguage() === 'ar' ? 'بانتظار الدفع' : 'Awaiting Payment',
        waiting_for_driver: getLanguage() === 'ar' ? 'بانتظار سائق' : 'Awaiting Driver',
        confirmed: getLanguage() === 'ar' ? 'مؤكد - ابدأ التجهيز' : 'Confirmed - Start Prep',
        preparing: getLanguage() === 'ar' ? 'جارٍ التجهيز' : 'Preparing',
        ready_for_pickup: getLanguage() === 'ar' ? 'جاهز' : 'Ready',
        on_the_way: getLanguage() === 'ar' ? 'في الطريق' : 'On the Way',
        completed: getLanguage() === 'ar' ? 'مكتمل' : 'Done',
        declined: getLanguage() === 'ar' ? 'مرفوض' : 'Declined'
    };
    header.appendChild(ui.createElementWithText('span', statusLabels[ord.status] || ord.status, ['badge', statusColors[ord.status] || 'badge-info']));
    card.appendChild(header);

    card.appendChild(ui.createElementWithText('div', `👤 ${ord.customerName}`, [], { style: 'font-size: 0.85rem; margin-bottom: 0.25rem;' }));
    card.appendChild(ui.createElementWithText('div', `📦 ${ord.items.length} ${getLanguage() === 'ar' ? 'صنف' : 'items'}`, [], { style: 'font-size: 0.85rem; margin-bottom: 0.25rem;' }));
    card.appendChild(ui.createElementWithText('div', `💵 $${(parseFloat(ord.totalPrice) || 0).toFixed(2)}`, [], { style: 'font-weight: 800; color: var(--color-success); font-size: 1.1rem; margin-bottom: 0.75rem;' }));

    const previewText = ord.items.map(it => `${it.qty}x ${it.name}`).join(', ');
    card.appendChild(ui.createElementWithText('p', previewText.length > 60 ? previewText.slice(0, 57) + '...' : previewText, ['text-muted'], { style: 'font-size: 0.78rem; margin-bottom: 1rem;' }));

    if (!readonly) {
        const btnRow = ui.createElement('div', [], { style: 'display: flex; gap: 0.5rem; flex-wrap: wrap;' });

        if (ord.status === 'new' || ord.status === 'pending_payment') {
            // New order: accept (set to waiting_for_driver=2) or decline
            const acceptBtn = ui.createElementWithText('button', getLanguage() === 'ar' ? '✅ قبول الطلب' : '✅ Accept Order', ['btn', 'btn-primary', 'btn-sm'], { style: 'flex: 1; justify-content: center;' });
            acceptBtn.addEventListener('click', () => {
                // Cash (paymentMethod=0) → waiting_for_driver(2), Online (paymentMethod=1) → pending_payment(1)
                const paymentMethod = ord.rawOrder ? ord.rawOrder.paymentMethod : 0;
                const acceptStatus = paymentMethod === 1 ? 'pending_payment' : 'waiting_for_driver';
                updateStatus(ord.id, acceptStatus);
            });

            btnRow.appendChild(acceptBtn);
        } else if (ord.status === 'confirmed') {
            // Captain confirmed: market can now start preparing
            const startBtn = ui.createElementWithText('button', getLanguage() === 'ar' ? '🛒 ابدأ التجهيز' : '🛒 Start Preparing', ['btn', 'btn-primary', 'btn-sm'], { style: 'flex: 1; justify-content: center;' });
            startBtn.addEventListener('click', () => updateStatus(ord.id, 'preparing'));
            btnRow.appendChild(startBtn);
        } else if (ord.status === 'preparing') {
            const readyBtn = ui.createElementWithText('button', getLanguage() === 'ar' ? '📦 جاهز للاستلام' : '📦 Mark Ready', ['btn', 'btn-success', 'btn-sm'], { style: 'flex: 1; justify-content: center;' });
            readyBtn.addEventListener('click', () => updateStatus(ord.id, 'ready_for_pickup'));
            btnRow.appendChild(readyBtn);
        }

        card.appendChild(btnRow);

        // Add chat button if active order
        if (ord.status !== 'declined') {
            const chatBtn = ui.createElementWithText('button', getLanguage() === 'ar' ? '💬 دردشة' : '💬 Chat', ['btn', 'btn-secondary', 'btn-sm'], { style: 'margin-top: 0.5rem; width: 100%; display: flex; justify-content: center; align-items: center;' });
            chatBtn.addEventListener('click', () => {
                showMarketChatSelection(ord);
            });
            card.appendChild(chatBtn);
        }
    }

    container.appendChild(card);
}

/* ==========================================================================
   Tab 3: Manage Categories
   ========================================================================== */
function renderCategoriesTab(parent) {
    const isAr = getLanguage() === 'ar';
    const wrapper = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1.25rem; width: 100%;' });

    // Top Summary & Search Toolbar
    const toolbar = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; background: var(--bg-surface-glass); border: 1px solid var(--border-color); border-radius: 16px; padding: 1rem 1.25rem; backdrop-filter: blur(12px);' });

    // Left side: stats summary chips
    const statsBox = ui.createElement('div', [], { style: 'display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;' });
    
    const catChip = ui.createElement('div', [], { style: 'display: flex; align-items: center; gap: 0.4rem; background: rgba(46, 213, 115, 0.12); border: 1px solid rgba(46, 213, 115, 0.25); border-radius: 20px; padding: 0.35rem 0.85rem; font-size: 0.82rem; font-weight: 700; color: var(--mkt-color, #2ed573);' });
    catChip.textContent = `📂 ${categories.length} ${isAr ? 'قسم رئيسي' : 'Categories'}`;
    
    const prodCount = marketProducts.length;
    const prodChip = ui.createElement('div', [], { style: 'display: flex; align-items: center; gap: 0.4rem; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border-color); border-radius: 20px; padding: 0.35rem 0.85rem; font-size: 0.82rem; font-weight: 600; color: var(--text-secondary);' });
    prodChip.textContent = `📦 ${prodCount} ${isAr ? 'منتج موزع' : 'Products'}`;
    
    statsBox.appendChild(catChip);
    statsBox.appendChild(prodChip);
    toolbar.appendChild(statsBox);

    // Right side: Search + Add Button
    const actionsBox = ui.createElement('div', [], { style: 'display: flex; align-items: center; gap: 0.75rem; flex: 1; justify-content: flex-end; max-width: 500px;' });
    
    const searchIn = ui.createElement('input', ['search-input'], {
        type: 'text',
        placeholder: isAr ? '🔍 ابحث في الأقسام...' : '🔍 Search categories...',
        style: 'max-width: 260px; font-size: 0.85rem;'
    });
    
    const addCatBtn = ui.createElementWithText('button', isAr ? '➕ إضافة قسم جديد' : '➕ Add Category', ['btn', 'btn-success'], {
        style: 'white-space: nowrap; box-shadow: 0 4px 14px var(--mkt-glow, rgba(46, 213, 115, 0.3)); font-weight: 700;'
    });
    addCatBtn.addEventListener('click', showAddCategoryModal);
    
    actionsBox.appendChild(searchIn);
    actionsBox.appendChild(addCatBtn);
    toolbar.appendChild(actionsBox);
    wrapper.appendChild(toolbar);

    // Categories Grid
    const grid = ui.createElement('div', [], { style: 'display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1.25rem; width: 100%;' });
    const catEmojis = ['🥛', '🍞', '🥫', '🥦', '🧃', '🧀', '🥩', '🍎', '🛒', '🌾', '🍫', '🧂'];

    function renderCards(list) {
        grid.replaceChildren();
        if (list.length === 0) {
            const emptyState = ui.createElement('div', ['glass-panel'], { style: 'text-align: center; padding: 3.5rem 1.5rem; width: 100%; grid-column: 1 / -1; border-radius: 16px;' });
            emptyState.appendChild(ui.createElementWithText('h3', isAr ? '📂 لا توجد أقسام مطابقة' : '📂 No Categories Found', [], { style: 'margin-bottom: 0.5rem; font-size: 1.25rem;' }));
            emptyState.appendChild(ui.createElementWithText('p', isAr ? 'أضف قسمًا جديدًا لتنظيم منتجات المعرض بشكل احترافي.' : 'Add a new category to organize your retail catalog.', ['text-secondary'], { style: 'font-size: 0.85rem;' }));
            grid.appendChild(emptyState);
            return;
        }

        list.forEach((cat, idx) => {
            const count = marketProducts.filter(p => p.category === cat.name).length;
            const emoji = catEmojis[idx % catEmojis.length];

            const card = ui.createElement('div', ['category-card', 'market-theme']);

            // Photo / Gradient Header Wrap
            const photoWrap = ui.createElement('div', ['category-image-wrapper']);

            if (cat.photo) {
                const img = ui.createElement('img', [], {
                    src: getImageUrl(cat.photo),
                    alt: cat.name
                });
                img.onerror = () => {
                    img.remove();
                    photoWrap.innerHTML = `<span style="font-size:3rem; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.5));">${emoji}</span>`;
                };
                photoWrap.appendChild(img);
            } else {
                photoWrap.style.background = 'linear-gradient(135deg, rgba(46, 213, 115, 0.15) 0%, rgba(18, 18, 38, 0.9) 100%)';
                photoWrap.innerHTML = `<span style="font-size:3.2rem; filter: drop-shadow(0 4px 12px rgba(46, 213, 115, 0.3));">${emoji}</span>`;
            }

            // Floating count badge
            const badgeChip = ui.createElement('div', ['category-badge-chip']);
            badgeChip.textContent = `📦 ${count} ${isAr ? (count === 1 ? 'منتج' : 'منتجات') : (count === 1 ? 'product' : 'products')}`;
            photoWrap.appendChild(badgeChip);
            card.appendChild(photoWrap);

            // Card Body
            const body = ui.createElement('div', ['category-card-body']);
            body.appendChild(ui.createElementWithText('h4', cat.name, ['category-title']));
            body.appendChild(ui.createElementWithText('p', cat.description || (isAr ? 'قسم مخصص لإدارة المنتجات والمبيعات.' : 'Custom product catalog category.'), ['category-description']));

            // Actions Footer
            const actions = ui.createElement('div', ['category-card-actions']);
            const editBtn = ui.createElementWithText('button', isAr ? '✏️ تعديل القسم' : '✏️ Edit', ['btn', 'btn-secondary', 'btn-sm'], { style: 'flex: 1; justify-content: center; font-size: 0.8rem; font-weight: 600;' });
            editBtn.addEventListener('click', () => showEditCategoryModal(cat));

            const deleteBtn = ui.createElementWithText('button', '🗑️', ['btn', 'btn-danger', 'btn-sm'], { style: 'padding: 0.35rem 0.65rem; border-radius: 8px;' });
            deleteBtn.title = isAr ? 'حذف القسم' : 'Delete Category';
            deleteBtn.addEventListener('click', () => handleDeleteCategory(cat));

            actions.appendChild(editBtn);
            actions.appendChild(deleteBtn);
            body.appendChild(actions);
            card.appendChild(body);

            grid.appendChild(card);
        });
    }

    renderCards(categories);

    searchIn.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        const filtered = categories.filter(c => c.name.toLowerCase().includes(query) || (c.description && c.description.toLowerCase().includes(query)));
        renderCards(filtered);
    });

    wrapper.appendChild(grid);
    parent.appendChild(wrapper);
}

function showAddCategoryModal() {
    const form = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; min-width: 320px;' });
    const nameWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    nameWrap.appendChild(ui.createElementWithText('label', t('rest_cat_modal_name'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const nameIn = ui.createElement('input', ['search-input'], { type: 'text', placeholder: getLanguage() === 'ar' ? 'مثال: منتجات الألبان' : 'e.g. Dairy Products' });
    nameWrap.appendChild(nameIn);
    const descWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    descWrap.appendChild(ui.createElementWithText('label', t('rest_cat_modal_desc'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const descIn = ui.createElement('input', ['search-input'], { type: 'text', placeholder: getLanguage() === 'ar' ? 'وصف القسم...' : 'Category description...' });
    descWrap.appendChild(descIn);

    // Photo/Image Row
    const photoLabel = ui.createElementWithText('label', getLanguage() === 'ar' ? 'صورة القسم:' : 'Category Image:', [], { style: 'font-weight: 600; font-size: 0.85rem;' });
    const imgRow = ui.createElement('div', [], { style: 'display: flex; gap: 1rem; align-items: center;' });
    const imgInput = ui.createElement('input', [], { type: 'file', accept: 'image/*', style: 'display: none;' });
    const uploadImgBtn = ui.createElementWithText('button', getLanguage() === 'ar' ? 'اختر صورة' : 'Choose Image', ['btn', 'btn-secondary', 'btn-sm']);
    uploadImgBtn.addEventListener('click', () => imgInput.click());
    const previewImg = ui.createElement('img', [], {
        src: '',
        style: 'width: 50px; height: 50px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); object-fit: cover; display: none;'
    });
    let uploadedPhotoKey = '';
    
    imgInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            previewImg.src = URL.createObjectURL(file);
            previewImg.style.display = 'block';
            uploadImgBtn.disabled = true;
            uploadImgBtn.textContent = getLanguage() === 'ar' ? 'جاري الرفع...' : 'Uploading...';
            try {
                const result = await uploadImage(file);
                if (result) {
                    uploadedPhotoKey = result;
                    previewImg.src = getImageUrl(uploadedPhotoKey);
                }
            } catch (_) {
                ui.showToast(getLanguage() === 'ar' ? 'فشل رفع الصورة' : 'Failed to upload image', 'error');
            } finally {
                uploadImgBtn.disabled = false;
                uploadImgBtn.textContent = getLanguage() === 'ar' ? 'اختر صورة' : 'Choose Image';
            }
        }
    });
    imgRow.appendChild(uploadImgBtn);
    imgRow.appendChild(imgInput);
    imgRow.appendChild(previewImg);

    form.appendChild(nameWrap);
    form.appendChild(descWrap);
    form.appendChild(photoLabel);
    form.appendChild(imgRow);
    const imgHint = ui.createElementWithText('span', getLanguage() === 'ar' ? 'الأبعاد الموصى بها: 400 × 400 بكسل (نسبة 1:1)' : 'Recommended dimensions: 400 × 400 px (1:1)', [], { style: 'font-size: 0.75rem; color: var(--text-muted); display: block; margin-top: 0.25rem;' });
    form.appendChild(imgHint);

    ui.showModal(t('rest_cat_modal_add_title'), form, [
        {
            text: t('rest_cat_modal_save'),
            type: 'success',
            closeOnClick: false,
            onClick: async () => {
                const name = nameIn.value.trim();
                if (!name) {
                    ui.setInputInvalid(nameIn, getLanguage() === 'ar' ? 'الاسم مطلوب' : 'Name is required');
                    return;
                }
                const description = descIn.value.trim();
                const tempId = 'temp-' + Date.now();
                categories.push({ id: tempId, name, description, photo: uploadedPhotoKey, type: 1 });
                ui.closeModal();
                renderActiveTab();
                try {
                    const response = await apiFetch('/api/v1/categories', {
                        method: 'POST',
                        body: JSON.stringify({ name, description, photo: uploadedPhotoKey, type: 1 })
                    });
                    ui.showToast(getLanguage() === 'ar' ? 'تمت إضافة القسم بنجاح' : 'Category created successfully', 'success');
                    const idx = categories.findIndex(c => c.id === tempId);
                    if (idx !== -1 && response.result?.id) categories[idx].id = response.result.id;
                    await refreshCategories();
                    if (activeTab === 'categories') renderActiveTab();
                } catch (err) {
                    console.error('Failed to create category:', err);
                    categories = categories.filter(c => c.id !== tempId);
                    renderActiveTab();
                    ui.showToast((getLanguage() === 'ar' ? 'فشل إضافة القسم: ' : 'Failed to create category: ') + err.message, 'error');
                }
            }
        },
        { text: t('cancel'), type: 'secondary', onClick: ui.closeModal }
    ]);
}

function showEditCategoryModal(cat) {
    const form = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; min-width: 320px;' });
    const nameWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    nameWrap.appendChild(ui.createElementWithText('label', t('rest_cat_modal_name'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const nameIn = ui.createElement('input', ['search-input'], { type: 'text', value: cat.name });
    nameWrap.appendChild(nameIn);
    const descWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    descWrap.appendChild(ui.createElementWithText('label', t('rest_cat_modal_desc'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const descIn = ui.createElement('input', ['search-input'], { type: 'text', value: cat.description || '' });
    descWrap.appendChild(descIn);

    // Photo/Image Row
    const photoLabel = ui.createElementWithText('label', getLanguage() === 'ar' ? 'صورة القسم:' : 'Category Image:', [], { style: 'font-weight: 600; font-size: 0.85rem;' });
    const imgRow = ui.createElement('div', [], { style: 'display: flex; gap: 1rem; align-items: center;' });
    const imgInput = ui.createElement('input', [], { type: 'file', accept: 'image/*', style: 'display: none;' });
    const uploadImgBtn = ui.createElementWithText('button', getLanguage() === 'ar' ? 'اختر صورة' : 'Choose Image', ['btn', 'btn-secondary', 'btn-sm']);
    uploadImgBtn.addEventListener('click', () => imgInput.click());
    const previewImg = ui.createElement('img', [], {
        src: cat.photo ? getImageUrl(cat.photo) : '',
        style: 'width: 50px; height: 50px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); object-fit: cover;'
    });
    if (!cat.photo) previewImg.style.display = 'none';
    let uploadedPhotoKey = cat.photo || '';
    
    imgInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            previewImg.src = URL.createObjectURL(file);
            previewImg.style.display = 'block';
            uploadImgBtn.disabled = true;
            uploadImgBtn.textContent = getLanguage() === 'ar' ? 'جاري الرفع...' : 'Uploading...';
            try {
                const result = await uploadImage(file);
                if (result) {
                    uploadedPhotoKey = result;
                    previewImg.src = getImageUrl(uploadedPhotoKey);
                }
            } catch (_) {
                ui.showToast(getLanguage() === 'ar' ? 'فشل رفع الصورة' : 'Failed to upload image', 'error');
            } finally {
                uploadImgBtn.disabled = false;
                uploadImgBtn.textContent = getLanguage() === 'ar' ? 'اختر صورة' : 'Choose Image';
            }
        }
    });
    imgRow.appendChild(uploadImgBtn);
    imgRow.appendChild(imgInput);
    imgRow.appendChild(previewImg);

    form.appendChild(nameWrap);
    form.appendChild(descWrap);
    form.appendChild(photoLabel);
    form.appendChild(imgRow);
    const imgHint = ui.createElementWithText('span', getLanguage() === 'ar' ? 'الأبعاد الموصى بها: 400 × 400 بكسل (نسبة 1:1)' : 'Recommended dimensions: 400 × 400 px (1:1)', [], { style: 'font-size: 0.75rem; color: var(--text-muted); display: block; margin-top: 0.25rem;' });
    form.appendChild(imgHint);

    ui.showModal(t('rest_cat_modal_edit_title'), form, [
        {
            text: t('rest_cat_modal_save'),
            type: 'success',
            closeOnClick: false,
            onClick: async () => {
                const name = nameIn.value.trim();
                if (!name) {
                    ui.setInputInvalid(nameIn, getLanguage() === 'ar' ? 'الاسم مطلوب' : 'Name is required');
                    return;
                }
                const description = descIn.value.trim();
                const oldName = cat.name;
                const originalCats = [...categories];
                marketProducts.forEach(p => { if (p.category === oldName) p.category = name; });
                cat.name = name;
                cat.description = description;
                cat.photo = uploadedPhotoKey;
                ui.closeModal();
                renderActiveTab();
                try {
                    await apiFetch('/api/v1/categories', { method: 'PUT', body: JSON.stringify({ id: cat.id, name, description, photo: uploadedPhotoKey, type: 1 }) });
                    ui.showToast(getLanguage() === 'ar' ? 'تم تحديث القسم بنجاح' : 'Category updated successfully', 'success');
                    await refreshCategories();
                    if (activeTab === 'categories') renderActiveTab();
                } catch (err) {
                    console.error('Failed to update category:', err);
                    categories = originalCats;
                    renderActiveTab();
                    ui.showToast((getLanguage() === 'ar' ? 'فشل تحديث القسم: ' : 'Failed to update category: ') + err.message, 'error');
                }
            }
        },
        { text: t('cancel'), type: 'secondary', onClick: ui.closeModal }
    ]);
}

async function handleDeleteCategory(cat) {
    if (confirm(getLanguage() === 'ar' ? `هل أنت متأكد من حذف قسم "${cat.name}"؟` : `Delete category "${cat.name}"?`)) {
        const original = [...categories];
        categories = categories.filter(c => c.id !== cat.id);
        renderActiveTab();
        try {
            await apiFetch(`/api/v1/categories/${cat.id}`, { method: 'DELETE' });
            ui.showToast(getLanguage() === 'ar' ? 'تم حذف القسم بنجاح' : 'Category deleted successfully', 'success');
            await refreshCategories();
            if (activeTab === 'categories') renderActiveTab();
        } catch (err) {
            console.error('Failed to delete category:', err);
            categories = original;
            renderActiveTab();
            ui.showToast((getLanguage() === 'ar' ? 'فشل حذف القسم: ' : 'Failed to delete category: ') + err.message, 'error');
        }
    }
}

/* ==========================================================================
   Tab 4: Discounts
   ========================================================================== */
function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleString(getLanguage() === 'ar' ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (_) { return dateStr; }
}

function renderDiscountsTab(parent) {
    const wrapper = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; width: 100%;' });
    const topBar = ui.createElement('div', [], { style: 'display: flex; justify-content: flex-end;' });
    const addDiscountBtn = ui.createElementWithText('button', t('rest_discount_add_btn'), ['btn', 'btn-primary']);
    addDiscountBtn.addEventListener('click', showAddDiscountModal);
    topBar.appendChild(addDiscountBtn);
    wrapper.appendChild(topBar);

    const grid = ui.createElement('div', ['analytics-grid'], { style: 'margin-top: 1rem; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.5rem; width: 100%;' });

    if (discounts.length === 0) {
        const emptyState = ui.createElement('div', ['glass-panel'], { style: 'text-align: center; padding: 3rem 1.5rem; width: 100%; grid-column: 1 / -1;' });
        emptyState.appendChild(ui.createElementWithText('h3', t('rest_discount_empty_title') || '🎟️ No Discounts', [], { style: 'margin-bottom: 0.5rem; font-size: 1.25rem;' }));
        emptyState.appendChild(ui.createElementWithText('p', t('rest_discount_empty_desc'), ['text-secondary'], { style: 'font-size: 0.85rem;' }));
        grid.appendChild(emptyState);
    } else {
        discounts.forEach(disc => {
            const card = ui.createElement('div', ['summary-card'], { style: 'display: flex; flex-direction: column; justify-content: space-between; min-height: 220px; position: relative;' });

            const header = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; width: 100%;' });
            const name = ui.createElementWithText('strong', disc.name || '-', [], { style: 'font-size: 1.1rem; font-weight: 700; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;' });
            const deleteBtn = ui.createElementWithText('button', '🗑️', ['btn', 'btn-danger', 'btn-sm'], { style: 'padding: 0.25rem 0.5rem; font-size: 0.85rem; border-radius: 4px;' });
            deleteBtn.addEventListener('click', () => handleDeleteDiscount(disc));
            header.appendChild(name);
            header.appendChild(deleteBtn);
            card.appendChild(header);

            card.appendChild(ui.createElementWithText('p', disc.description || '-', ['text-secondary'], { style: 'font-size: 0.8rem; margin: 0.5rem 0; flex-grow: 1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;' }));

            const percentContainer = ui.createElement('div', [], { style: 'display: flex; align-items: baseline; gap: 0.35rem; margin: 0.75rem 0;' });
            percentContainer.appendChild(ui.createElementWithText('span', `${disc.percentage}%`, [], { style: 'font-size: 2.25rem; font-weight: 800; color: var(--mkt-color, #2ed573); font-family: "Outfit", sans-serif;' }));
            percentContainer.appendChild(ui.createElementWithText('span', getLanguage() === 'ar' ? 'خصم' : 'OFF', [], { style: 'font-size: 0.85rem; font-weight: 600; color: var(--text-secondary); text-transform: uppercase;' }));
            card.appendChild(percentContainer);

            const cardFooter = ui.createElement('div', [], { style: 'border-top: 1px solid var(--border-color); padding-top: 0.75rem; display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.75rem; color: var(--text-muted);' });
            const startDiv = ui.createElement('div', [], { style: 'display: flex; align-items: center; gap: 0.35rem;' });
            startDiv.innerHTML = `<span>🟢</span> <span>${getLanguage() === 'ar' ? 'البدء:' : 'Starts:'} ${formatDateTime(disc.startDate)}</span>`;
            const endDiv = ui.createElement('div', [], { style: 'display: flex; align-items: center; gap: 0.35rem;' });
            endDiv.innerHTML = `<span>🔴</span> <span>${getLanguage() === 'ar' ? 'الانتهاء:' : 'Ends:'} ${formatDateTime(disc.endDate)}</span>`;
            cardFooter.appendChild(startDiv);
            cardFooter.appendChild(endDiv);
            card.appendChild(cardFooter);
            grid.appendChild(card);
        });
    }

    wrapper.appendChild(grid);
    parent.appendChild(wrapper);
}

function showAddDiscountModal() {
    const form = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; min-width: 320px;' });

    const fields = [
        { label: t('rest_discount_modal_name'), type: 'text', placeholder: getLanguage() === 'ar' ? 'مثال: خصم الصيف' : 'e.g. Summer Discount' },
        { label: t('rest_discount_modal_desc'), type: 'text', placeholder: getLanguage() === 'ar' ? 'وصف...' : 'Description...' },
        { label: t('rest_discount_modal_percentage'), type: 'number', placeholder: '15', min: '1', max: '100' },
        { label: t('rest_discount_modal_start'), type: 'datetime-local' },
        { label: t('rest_discount_modal_end'), type: 'datetime-local' }
    ];
    const inputs = fields.map(f => {
        const wrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
        wrap.appendChild(ui.createElementWithText('label', f.label, [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
        const inp = ui.createElement('input', ['search-input'], { type: f.type, ...(f.placeholder ? { placeholder: f.placeholder } : {}), ...(f.min ? { min: f.min } : {}), ...(f.max ? { max: f.max } : {}) });
        wrap.appendChild(inp);
        form.appendChild(wrap);
        return inp;
    });
    const [nameIn, descIn, pctIn, startIn, endIn] = inputs;

    ui.showModal(t('rest_discount_modal_add_title'), form, [
        {
            text: t('rest_discount_modal_save'),
            type: 'success',
            closeOnClick: false,
            onClick: async () => {
                const name = nameIn.value.trim();
                const pctVal = pctIn.value.trim();
                const description = descIn.value.trim();
                const startDateVal = startIn.value;
                const endDateVal = endIn.value;

                let isValid = true;
                if (!name) {
                    ui.setInputInvalid(nameIn, getLanguage() === 'ar' ? 'الاسم مطلوب' : 'Name is required');
                    isValid = false;
                }
                const percentage = parseFloat(pctVal);
                if (!pctVal || isNaN(percentage) || percentage <= 0 || percentage > 100) {
                    ui.setInputInvalid(pctIn, getLanguage() === 'ar' ? 'النسبة المئوية يجب أن تكون بين 1 و 100' : 'Percentage must be between 1 and 100');
                    isValid = false;
                }
                if (startDateVal && endDateVal && new Date(startDateVal) >= new Date(endDateVal)) {
                    ui.setInputInvalid(endIn, getLanguage() === 'ar' ? 'تاريخ الانتهاء يجب أن يكون بعد تاريخ البدء' : 'End date must be after start date');
                    isValid = false;
                }

                if (!isValid) return;

                const startDate = startDateVal ? new Date(startDateVal).toISOString() : null;
                const endDate = endDateVal ? new Date(endDateVal).toISOString() : null;
                const tempId = 'temp-' + Date.now();
                discounts.push({ id: tempId, name, description, percentage, type: 1, startDate, endDate, isActive: true });
                ui.closeModal();
                renderActiveTab();
                try {
                    const response = await apiFetch('/api/v1/discounts', { method: 'POST', body: JSON.stringify({ name, description, percentage, type: 1, startDate, endDate }) });
                    ui.showToast(getLanguage() === 'ar' ? 'تمت إضافة الخصم بنجاح' : 'Discount created successfully', 'success');
                    const idx = discounts.findIndex(d => d.id === tempId);
                    if (idx !== -1 && response.result?.id) discounts[idx].id = response.result.id;
                    await refreshDiscounts();
                    if (activeTab === 'discounts') renderActiveTab();
                } catch (err) {
                    console.error('Failed to create discount:', err);
                    discounts = discounts.filter(d => d.id !== tempId);
                    renderActiveTab();
                    ui.showToast((getLanguage() === 'ar' ? 'فشل إضافة الخصم: ' : 'Failed to create discount: ') + err.message, 'error');
                }
            }
        },
        { text: t('cancel'), type: 'secondary', onClick: ui.closeModal }
    ]);
}

async function handleDeleteDiscount(disc) {
    if (confirm(getLanguage() === 'ar' ? `هل أنت متأكد من حذف "${disc.name}"؟` : `Delete discount "${disc.name}"?`)) {
        const original = [...discounts];
        discounts = discounts.filter(d => d.id !== disc.id);
        renderActiveTab();
        try {
            await apiFetch(`/api/v1/discounts/${disc.id}`, { method: 'DELETE' });
            ui.showToast(getLanguage() === 'ar' ? 'تم حذف الخصم بنجاح' : 'Discount deleted successfully', 'success');
            await refreshDiscounts();
            if (activeTab === 'discounts') renderActiveTab();
        } catch (err) {
            console.error('Failed to delete discount:', err);
            ui.showToast((getLanguage() === 'ar' ? 'فشل حذف الخصم: ' : 'Failed to delete discount: ') + err.message, 'error');
            discounts = original;
            renderActiveTab();
        }
    }
}

/* ==========================================================================
   Tab 5: Offers
   ========================================================================== */
function renderOffersTab(parent) {
    const wrapper = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; width: 100%;' });

    const topBar = ui.createElement('div', [], { style: 'display: flex; justify-content: flex-end;' });
    const addOfferBtn = ui.createElementWithText('button', t('offer_add_btn'), ['btn', 'btn-primary']);
    addOfferBtn.addEventListener('click', showAddOfferModal);
    topBar.appendChild(addOfferBtn);
    wrapper.appendChild(topBar);

    const grid = ui.createElement('div', ['analytics-grid'], { style: 'margin-top: 1rem; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.5rem; width: 100%;' });

    if (offers.length === 0) {
        const emptyState = ui.createElement('div', ['glass-panel'], { style: 'text-align: center; padding: 3rem 1.5rem; width: 100%; grid-column: 1 / -1;' });
        emptyState.appendChild(ui.createElementWithText('h3', t('offer_empty_title'), [], { style: 'margin-bottom: 0.5rem; font-size: 1.25rem;' }));
        emptyState.appendChild(ui.createElementWithText('p', t('offer_empty_desc'), ['text-secondary'], { style: 'font-size: 0.85rem;' }));
        grid.appendChild(emptyState);
    } else {
        offers.forEach(offer => {
            const card = ui.createElement('div', ['summary-card'], { style: 'display: flex; flex-direction: column; min-height: 260px; position: relative; overflow: hidden;' });

            // Accent blob
            const accent = ui.createElement('div', [], { style: 'position: absolute; top: -20px; right: -20px; width: 90px; height: 90px; border-radius: 50%; background: var(--mkt-color, #2ed573); opacity: 0.08; pointer-events: none;' });
            card.appendChild(accent);

            // Featured image
            if (offer.featuredPhoto) {
                const img = ui.createElement('img', [], {
                    src: getImageUrl(offer.featuredPhoto),
                    style: 'width: 100%; height: 110px; object-fit: cover; border-radius: 8px; margin-bottom: 0.75rem; border: 1px solid var(--border-color);'
                });
                card.appendChild(img);
            } else {
                const imgPlaceholder = ui.createElement('div', [], {
                    style: 'height: 110px; background: linear-gradient(135deg, var(--mkt-color, #2ed573) 0%, #1e90ff 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 2.5rem; margin-bottom: 0.75rem;'
                });
                imgPlaceholder.textContent = '🏷️';
                card.appendChild(imgPlaceholder);
            }

            // Header row: name + delete
            const headerRow = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.4rem;' });
            headerRow.appendChild(ui.createElementWithText('strong', offer.name || '-', [], { style: 'font-size: 1.05rem; font-weight: 700; color: var(--text-primary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' }));
            const delBtn = ui.createElementWithText('button', '🗑️', ['btn', 'btn-danger', 'btn-sm'], { style: 'padding: 0.25rem 0.5rem; font-size: 0.85rem; border-radius: 4px; flex-shrink: 0;' });
            delBtn.addEventListener('click', () => handleDeleteOffer(offer));
            headerRow.appendChild(delBtn);
            card.appendChild(headerRow);

            // Description
            if (offer.description) {
                card.appendChild(ui.createElementWithText('p', offer.description, ['text-secondary'], { style: 'font-size: 0.78rem; margin-bottom: 0.5rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;' }));
            }

            // Products included in this offer
            if (offer.products && offer.products.length > 0) {
                const prodContainer = ui.createElement('div', [], {
                    style: 'margin: 0.4rem 0; padding: 0.4rem 0.6rem; background: rgba(0, 0, 0, 0.02); border-radius: 6px; border: 1px dashed var(--border-color); max-height: 90px; overflow-y: auto;'
                });
                const prodTitle = ui.createElementWithText('div', getLanguage() === 'ar' ? '📦 المنتجات المشمولة:' : '📦 Included Products:', [], {
                    style: 'font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.25rem;'
                });
                prodContainer.appendChild(prodTitle);

                const prodList = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.2rem;' });
                offer.products.forEach(p => {
                    const item = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; color: var(--text-primary);' });
                    const qtyStr = p.quantity && p.quantity > 1 ? ` (x${p.quantity})` : '';
                    item.appendChild(ui.createElementWithText('span', `• ${p.name || (getLanguage() === 'ar' ? 'منتج غير معروف' : 'Unknown Product')}${qtyStr}`, [], {
                        style: 'text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 70%;'
                    }));
                    if (p.price) {
                        item.appendChild(ui.createElementWithText('span', `$${(parseFloat(p.price) || 0).toFixed(2)}`, ['text-muted'], { style: 'font-size: 0.85rem;' }));
                    }
                    prodList.appendChild(item);
                });
                prodContainer.appendChild(prodList);
                card.appendChild(prodContainer);
            }

            // Price
            const priceEl = ui.createElement('div', [], { style: 'margin-bottom: 0.75rem;' });
            priceEl.appendChild(ui.createElementWithText('span', `$${(parseFloat(offer.price) || 0).toFixed(2)}`, [], { style: 'font-size: 1.3rem; font-weight: 800; color: var(--color-success);' }));
            card.appendChild(priceEl);

            // Status badges
            const badgeRow = ui.createElement('div', [], { style: 'display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.75rem;' });
            if (offer.active) {
                badgeRow.appendChild(ui.createElementWithText('span', t('offer_status_active'), ['badge', 'badge-success']));
            } else {
                badgeRow.appendChild(ui.createElementWithText('span', t('offer_status_inactive'), ['badge', 'badge-danger']));
            }
            if (!offer.approved) {
                badgeRow.appendChild(ui.createElementWithText('span', t('offer_status_pending'), ['badge', 'badge-pending']));
            }
            if (offer.offerType === 1) {
                badgeRow.appendChild(ui.createElementWithText('span', '🛠️ ' + t('offer_badge_editable'), ['badge', 'badge-secondary']));
            } else {
                badgeRow.appendChild(ui.createElementWithText('span', '🔒 ' + t('offer_badge_fixed'), ['badge', 'badge-secondary'], { style: 'background-color: #7f8c8d;' }));
            }
            card.appendChild(badgeRow);

            // Stats row
            const statsRow = ui.createElement('div', [], { style: 'display: flex; gap: 1rem; border-top: 1px solid var(--border-color); padding-top: 0.75rem; margin-top: auto; font-size: 0.75rem; color: var(--text-muted);' });
            const makeStatEl = (icon, val, label) => {
                const el = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; align-items: center; gap: 0.15rem;' });
                el.appendChild(ui.createElementWithText('span', `${icon} ${val}`, [], { style: 'font-weight: 700; font-size: 0.85rem; color: var(--text-primary);' }));
                el.appendChild(ui.createElementWithText('span', label, [], {}));
                return el;
            };
            statsRow.appendChild(makeStatEl('👆', offer.numberOfClicks, t('offer_clicks')));
            statsRow.appendChild(makeStatEl('👁️', offer.numberOfWatches, t('offer_watches')));
            statsRow.appendChild(makeStatEl('📋', offer.numberOfBooking, t('offer_bookings')));
            card.appendChild(statsRow);

            grid.appendChild(card);
        });
    }

    wrapper.appendChild(grid);
    parent.appendChild(wrapper);
}

function showAddOfferModal() {
    const form = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; min-width: 320px; max-width: 480px;' });

    // Name
    const nameWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    nameWrap.appendChild(ui.createElementWithText('label', t('offer_modal_name'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const nameIn = ui.createElement('input', ['search-input'], { type: 'text', placeholder: getLanguage() === 'ar' ? 'مثال: عرض نهاية الأسبوع' : 'e.g. Weekend Bundle Deal' });
    nameWrap.appendChild(nameIn);
    form.appendChild(nameWrap);

    // Description
    const descWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    descWrap.appendChild(ui.createElementWithText('label', t('offer_modal_desc'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const descIn = ui.createElement('textarea', ['search-input'], { style: 'min-height: 60px; font-family: inherit; resize: vertical;', placeholder: getLanguage() === 'ar' ? 'وصف العرض...' : 'Offer description...' });
    descWrap.appendChild(descIn);
    form.appendChild(descWrap);

    // Price
    const priceWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    priceWrap.appendChild(ui.createElementWithText('label', t('offer_modal_price'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const priceIn = ui.createElement('input', ['search-input'], { type: 'number', step: '0.01', min: '0', value: '10.00' });
    priceWrap.appendChild(priceIn);
    form.appendChild(priceWrap);

    // Featured Photo
    const imgWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    imgWrap.appendChild(ui.createElementWithText('label', t('offer_modal_image'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const imgRow = ui.createElement('div', [], { style: 'display: flex; gap: 1rem; align-items: center;' });
    const imgInput = ui.createElement('input', [], { type: 'file', accept: 'image/*', style: 'display: none;' });
    const uploadImgBtn = ui.createElementWithText('button', getLanguage() === 'ar' ? 'اختر صورة' : 'Choose Image', ['btn', 'btn-secondary']);
    uploadImgBtn.addEventListener('click', () => imgInput.click());
    const previewImg = ui.createElement('img', [], { style: 'width: 50px; height: 50px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); object-fit: cover; display: none;' });
    let uploadedPhotoKey = '';
    imgInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            previewImg.src = URL.createObjectURL(file);
            previewImg.style.display = 'block';
            try {
                const result = await uploadImage(file);
                if (result) { uploadedPhotoKey = result; previewImg.src = getImageUrl(uploadedPhotoKey); }
            } catch (_) {
                ui.showToast(getLanguage() === 'ar' ? 'فشل رفع الصورة' : 'Failed to upload image', 'error');
            }
        }
    });
    imgRow.appendChild(uploadImgBtn);
    imgRow.appendChild(imgInput);

    imgRow.appendChild(previewImg);
    imgWrap.appendChild(imgRow);
    const imgHint = ui.createElementWithText('span', getLanguage() === 'ar' ? 'الأبعاد الموصى بها: 1050 × 450 بكسل (نسبة 7:3)' : 'Recommended dimensions: 1050 × 450 px (7:3)', [], { style: 'font-size: 0.75rem; color: var(--text-muted); display: block; margin-top: 0.25rem;' });
    imgWrap.appendChild(imgHint);
    form.appendChild(imgWrap);

    // Linked products checkboxes
    const prodWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.5rem;' });
    const prodNote = ui.createElementWithText('small', getLanguage() === 'ar' ? '(مطلوب - اختر منتج واحد على الأقل للعرض)' : '(Required - Select at least 1 product for the offer)', [], { style: 'color: var(--color-warning, #ffa502); font-size: 0.75rem; font-weight: 500;' });
    prodWrap.appendChild(prodNote);

    const checkboxContainer = ui.createElement('div', [], {
        style: 'display: flex; flex-direction: column; gap: 0.4rem; max-height: 160px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 0.5rem; background: rgba(255, 255, 255, 0.02);'
    });

    const checkboxes = [];
    if (marketProducts.length === 0) {
        const noProds = ui.createElementWithText('span', getLanguage() === 'ar' ? 'لا توجد منتجات متوفرة' : 'No products available', ['text-muted'], { style: 'font-size: 0.85rem; padding: 0.25rem;' });
        checkboxContainer.appendChild(noProds);
    } else {
        marketProducts.forEach(p => {
            const itemWrap = ui.createElement('div', [], {
                style: 'display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; padding: 0.35rem 0.5rem; border-radius: var(--radius-sm); transition: background-color 0.2s; user-select: none;'
            });
            itemWrap.addEventListener('mouseover', () => { itemWrap.style.backgroundColor = 'rgba(255, 255, 255, 0.04)'; });
            itemWrap.addEventListener('mouseout', () => { itemWrap.style.backgroundColor = 'transparent'; });

            const leftPart = ui.createElement('label', [], {
                style: 'display: flex; align-items: center; gap: 0.6rem; cursor: pointer; flex: 1; margin: 0;'
            });

            const isFirst = checkboxes.length === 0;
            const chk = ui.createElement('input', [], { type: 'checkbox', value: p.id.toString(), style: 'cursor: pointer;' });
            if (isFirst) chk.checked = true;
            leftPart.appendChild(chk);

            if (p.image) {
                const img = ui.createElement('img', [], {
                    src: getImageUrl(p.image),
                    style: 'width: 24px; height: 24px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-color);'
                });
                leftPart.appendChild(img);
            }

            const nameSpan = ui.createElementWithText('span', `${p.name} ($${(p.price || 0).toFixed(2)})`, [], { style: 'font-size: 0.85rem; color: var(--text-primary);' });
            leftPart.appendChild(nameSpan);
            itemWrap.appendChild(leftPart);

            const qtyContainer = ui.createElement('div', [], {
                style: 'display: flex; align-items: center; gap: 0.35rem;'
            });
            const qtyLabel = ui.createElementWithText('span', getLanguage() === 'ar' ? 'العدد:' : 'Qty:', [], { style: 'font-size: 0.75rem; color: var(--text-muted);' });
            const qtyInput = ui.createElement('input', [], {
                type: 'number',
                value: '1',
                min: '1',
                style: 'width: 55px; padding: 0.15rem 0.3rem; border: 1px solid var(--border-color); border-radius: 4px; background: rgba(0, 0, 0, 0.2); color: var(--text-primary); font-size: 0.75rem; text-align: center;',
                disabled: !isFirst
            });
            qtyContainer.appendChild(qtyLabel);
            qtyContainer.appendChild(qtyInput);
            itemWrap.appendChild(qtyContainer);

            chk.addEventListener('change', () => {
                qtyInput.disabled = !chk.checked;
                if (!chk.checked) {
                    qtyInput.value = '1';
                }
            });

            checkboxContainer.appendChild(itemWrap);
            checkboxes.push({ chk, qtyInput });
        });
    }
    prodWrap.appendChild(checkboxContainer);
    form.appendChild(prodWrap);

    // Active toggle
    const activeLabel = ui.createElement('label', ['switch-container'], { style: 'margin-top: 0.5rem;' });
    const activeInput = ui.createElement('input', ['switch-input'], { type: 'checkbox' });
    activeInput.checked = true;
    const activeSlider = ui.createElement('div', ['switch-slider']);
    activeLabel.appendChild(activeInput);
    activeLabel.appendChild(activeSlider);
    activeLabel.appendChild(ui.createElementWithText('span', t('offer_modal_active'), [], { style: 'font-size: 0.85rem;' }));
    form.appendChild(activeLabel);

    // Editable toggle
    const editableLabel = ui.createElement('label', ['switch-container'], { style: 'margin-top: 0.5rem;' });
    const editableInput = ui.createElement('input', ['switch-input'], { type: 'checkbox' });
    editableInput.checked = false;
    const editableSlider = ui.createElement('div', ['switch-slider']);
    editableLabel.appendChild(editableInput);
    editableLabel.appendChild(editableSlider);
    editableLabel.appendChild(ui.createElementWithText('span', t('offer_modal_editable'), [], { style: 'font-size: 0.85rem;' }));
    form.appendChild(editableLabel);

    ui.showModal(t('offer_modal_add_title'), form, [
        {
            text: t('offer_modal_save'),
            type: 'success',
            closeOnClick: false,
            onClick: async () => {
                const name = nameIn.value.trim();
                const priceVal = priceIn.value.trim();
                const description = descIn.value.trim();

                const productObjectsList = [];
                const selectedProductIds = [];
                const productsWithQty = [];
                checkboxes.forEach(item => {
                    if (item.chk.checked) {
                        const id = parseInt(item.chk.value, 10);
                        if (!isNaN(id) && id > 0) {
                            const qty = parseInt(item.qtyInput.value, 10) || 1;
                            selectedProductIds.push(id);
                            productObjectsList.push({
                                productId: id,
                                quantity: qty
                            });
                            const localProd = marketProducts.find(mp => mp.id.toString() === id.toString());
                            productsWithQty.push({
                                id,
                                name: localProd ? localProd.name : `${getLanguage() === 'ar' ? 'منتج' : 'Product'} #${id}`,
                                price: localProd ? localProd.price : 0,
                                image: localProd ? localProd.image : '',
                                quantity: qty
                            });
                        }
                    }
                });

                let isValid = true;
                const isAr = getLanguage() === 'ar';

                // Clear prior invalid states
                clearInvalid(nameIn);
                clearInvalid(priceIn);
                clearInvalid(descIn);
                checkboxContainer.style.border = '1px solid var(--border-color)';

                if (!name) {
                    ui.setInputInvalid(nameIn, isAr ? 'اسم العرض مطلوب' : 'Offer name is required');
                    isValid = false;
                }

                const price = parseFloat(priceVal);
                if (!priceVal || isNaN(price) || price < 0) {
                    ui.setInputInvalid(priceIn, isAr ? 'السعر يجب أن يكون 0 أو أكثر' : 'Price must be 0 or more');
                    isValid = false;
                }

                if (!description) {
                    ui.setInputInvalid(descIn, isAr ? 'وصف العرض مطلوب' : 'Description is required');
                    isValid = false;
                }

                if (!uploadedPhotoKey) {
                    ui.showToast(isAr ? '⚠️ يرجى رفع/اختيار صورة رئيسية للعرض أولاً' : '⚠️ Please upload a featured image for the offer', 'warning');
                    isValid = false;
                }

                if (marketProducts.length === 0) {
                    ui.showToast(isAr ? '⚠️ لا توجد منتجات في المتجر، أضف منتجات أولاً من تبويب المخزن' : '⚠️ No products found. Add products from the Inventory tab first.', 'warning');
                    checkboxContainer.style.border = '2px solid var(--color-danger)';
                    isValid = false;
                } else if (selectedProductIds.length === 0) {
                    ui.showToast(isAr ? '⚠️ يرجى تحديد منتج واحد على الأقل مشمول في العرض (ضع علامة صح ✅ على المنتج)' : '⚠️ Please select at least one product for this offer (check the box ✅)', 'warning');
                    checkboxContainer.style.border = '2px solid var(--color-danger)';
                    isValid = false;
                }

                if (!isValid) return;

                const isEditable = editableInput.checked ? 1 : 0;

                // Optimistic add
                const tempOffer = {
                    id: 'temp-' + Date.now(), name, price, description,
                    featuredPhoto: uploadedPhotoKey,
                    active: activeInput.checked, approved: false,
                    offerType: isEditable, type: 1,
                    numberOfClicks: 0, numberOfWatches: 0, numberOfBooking: 0,
                    products: productsWithQty
                };
                offers.push(tempOffer);
                renderActiveTab();
                ui.closeModal();

                try {
                    const response = await apiFetch('/api/v1/offers', {
                        method: 'POST',
                        body: JSON.stringify({
                            name, price, description,
                            featuredPhoto: uploadedPhotoKey,
                            otherPhotos: [],
                            active: activeInput.checked,
                            productId: productObjectsList,
                            productIds: selectedProductIds,
                            type: 1,   // Supermarket
                            offerType: isEditable
                        })
                    });
                    ui.showToast(getLanguage() === 'ar' ? 'تمت إضافة العرض بنجاح' : 'Offer created successfully', 'success');
                    const idx = offers.findIndex(o => o.id === tempOffer.id);
                    if (idx !== -1 && response.result?.id) offers[idx].id = response.result.id;
                    await refreshOffers();
                    if (activeTab === 'offers') renderActiveTab();
                } catch (err) {
                    console.error('Failed to create offer:', err);
                    offers = offers.filter(o => o.id !== tempOffer.id);
                    renderActiveTab();
                    let msg = err.message || '';
                    if (msg.includes('Offer_ProductIds_MinOne')) {
                        msg = isAr ? 'يجب اختيار منتج واحد على الأقل للعرض' : 'Offer must contain at least 1 product';
                    }
                    ui.showToast((isAr ? '❌ فشل إضافة العرض: ' : '❌ Failed to add offer: ') + msg, 'error');
                }
            }
        },
        { text: t('cancel'), type: 'secondary', onClick: ui.closeModal }
    ]);
}

async function handleDeleteOffer(offer) {
    if (confirm(getLanguage() === 'ar' ? `هل أنت متأكد من حذف العرض "${offer.name}"؟` : `Delete offer "${offer.name}"?`)) {
        const original = [...offers];
        offers = offers.filter(o => o.id !== offer.id);
        renderActiveTab();
        try {
            await apiFetch(`/api/v1/offers/${offer.id}`, { method: 'DELETE' });
            ui.showToast(getLanguage() === 'ar' ? 'تم حذف العرض بنجاح' : 'Offer deleted successfully', 'success');
            await refreshOffers();
            if (activeTab === 'offers') renderActiveTab();
        } catch (err) {
            console.error('Failed to delete offer:', err);
            ui.showToast((getLanguage() === 'ar' ? 'فشل حذف العرض: ' : 'Failed to delete offer: ') + err.message, 'error');
            offers = original;
            renderActiveTab();
        }
    }
}

/* ==========================================================================
   Tab 6: My Store Profile
   ========================================================================== */
function renderProfileTab(parent) {
    const getUserSettings = () => {
        const userJson = localStorage.getItem('qs_vendor_user');
        const u = JSON.parse(userJson || '{}');
        return { user: u, settings: parseUserDescription(u.description) };
    };
    const { user, settings } = getUserSettings();

    const wrapper = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1.5rem; max-width: 640px; width: 100%;' });

    // ── Section 1: Basic Info ──────────────────────────────────────────────
    const infoPanel = ui.createElement('div', ['glass-panel']);
    infoPanel.appendChild(ui.createElementWithText('h3', `🛒 ${t('rest_profile_section_info')}`, [], { style: 'font-size: 1.05rem; font-weight: 700; margin-bottom: 1.25rem; padding-bottom: 0.75rem; border-bottom: 1px solid var(--border-color);' }));

    const photoRow = ui.createElement('div', [], { style: 'display: flex; align-items: center; gap: 1.25rem; margin-bottom: 1.25rem;' });
    let currentPhoto = user.photo || '';
    const photoPreview = ui.createElement('div', [], { style: 'width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(135deg, var(--mkt-color, #2ed573), #1e90ff); display: flex; align-items: center; justify-content: center; font-size: 2rem; flex-shrink: 0; overflow: hidden; border: 3px solid var(--border-color);' });
    if (currentPhoto) {
        const img = ui.createElement('img', [], { src: getImageUrl(currentPhoto), style: 'width: 100%; height: 100%; object-fit: cover;' });
        photoPreview.appendChild(img);
    } else { photoPreview.textContent = '🛒'; }

    const photoInput = ui.createElement('input', [], { type: 'file', accept: 'image/*', style: 'display: none;' });
    const photoBtn = ui.createElementWithText('button', t('rest_profile_photo_btn'), ['btn', 'btn-secondary', 'btn-sm']);
    photoBtn.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        photoPreview.innerHTML = '';
        const img = ui.createElement('img', [], { src: URL.createObjectURL(file), style: 'width: 100%; height: 100%; object-fit: cover;' });
        photoPreview.appendChild(img);
        try {
            const result = await uploadImage(file);
            if (result) { currentPhoto = result; img.src = getImageUrl(currentPhoto); }
        } catch (_) { ui.showToast(t('rest_profile_photo_upload_error'), 'error'); }
    });
    const photoBtnGroup = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    photoBtnGroup.appendChild(ui.createElementWithText('label', t('rest_profile_photo_label'), [], { style: 'font-size: 0.85rem; font-weight: 600;' }));
    photoBtnGroup.appendChild(photoBtn);
    photoBtnGroup.appendChild(photoInput);
    const imgHint = ui.createElementWithText('span', getLanguage() === 'ar' ? 'الأبعاد الموصى بها: 400 × 400 بكسل (نسبة 1:1)' : 'Recommended dimensions: 400 × 400 px (1:1)', [], { style: 'font-size: 0.75rem; color: var(--text-muted); display: block; margin-top: 0.25rem;' });
    photoBtnGroup.appendChild(imgHint);
    photoRow.appendChild(photoPreview);
    photoRow.appendChild(photoBtnGroup);
    infoPanel.appendChild(photoRow);

    const nameWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 1rem;' });
    nameWrap.appendChild(ui.createElementWithText('label', t('rest_profile_name_label'), [], { style: 'font-size: 0.85rem; font-weight: 600;' }));
    const nameIn = ui.createElement('input', ['search-input'], { type: 'text', value: user.name || '', placeholder: getLanguage() === 'ar' ? 'اسم السوبر ماركت' : 'Supermarket name' });
    nameWrap.appendChild(nameIn);
    infoPanel.appendChild(nameWrap);

    const descWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 1.25rem;' });
    descWrap.appendChild(ui.createElementWithText('label', t('rest_profile_desc_label'), [], { style: 'font-size: 0.85rem; font-weight: 600;' }));
    const descIn = ui.createElement('textarea', ['search-input'], { placeholder: t('rest_profile_desc_placeholder'), style: 'min-height: 80px; font-family: inherit; resize: vertical;' });
    descIn.value = settings.description || '';
    descWrap.appendChild(descIn);
    infoPanel.appendChild(descWrap);

    // Main Category field for Market/Store
    const catWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 1.25rem;' });
    catWrap.appendChild(ui.createElementWithText('label', getLanguage() === 'ar' ? 'القسم الرئيسي للمتجر 🛒' : 'Main Store Category 🛒', [], { style: 'font-size: 0.85rem; font-weight: 600;' }));
    const catSelect = ui.createElement('select', ['select-input'], { style: 'width: 100%; font-size: 0.9rem; padding: 0.6rem;' });
    catSelect.innerHTML = `<option value="">${getLanguage() === 'ar' ? '⏳ جاري تحميل الأقسام...' : '⏳ Loading categories...'}</option>`;
    catWrap.appendChild(catSelect);
    infoPanel.appendChild(catWrap);

    // Fetch main categories for Markets (userRole = 1 or 4)
    (async () => {
        try {
            const res = await apiFetch('/api/v1/main-categories', {
                method: 'PATCH',
                body: JSON.stringify({ pageNumber: 1, pageSize: 100, enablePagination: false })
            });
            const mainCats = Array.isArray(res) ? res : (res?.result ?? []);
            const mktCats = mainCats.filter(c => c.userRole === 1 || c.userRole === 4 || c.userRole === 'Vendor' || c.userRole === undefined);
            const displayCats = mktCats.length > 0 ? mktCats : mainCats;

            catSelect.replaceChildren();
            if (displayCats.length === 0) {
                const opt = ui.createElement('option', [], { value: '' });
                opt.textContent = getLanguage() === 'ar' ? 'لا توجد أقسام متاحة' : 'No categories available';
                catSelect.appendChild(opt);
                return;
            }

            displayCats.forEach(c => {
                const opt = ui.createElement('option', [], { value: String(c.id) });
                opt.textContent = c.name;
                if (user.categoryId == c.id || user.mainCategoryId == c.id) opt.selected = true;
                catSelect.appendChild(opt);
            });
        } catch (err) {
            console.error('Failed to load main categories:', err);
            catSelect.innerHTML = `<option value="">${getLanguage() === 'ar' ? '❌ فشل تحميل الأقسام' : '❌ Failed to load categories'}</option>`;
        }
    })();

    const saveInfoBtn = ui.createElementWithText('button', t('rest_profile_save_btn'), ['btn', 'btn-primary']);
    const infoFeedback = ui.createElement('span', [], { style: 'font-size: 0.85rem; margin-left: 1rem;' });
    const infoFooter = ui.createElement('div', [], { style: 'display: flex; align-items: center;' });
    infoFooter.appendChild(saveInfoBtn);
    infoFooter.appendChild(infoFeedback);
    infoPanel.appendChild(infoFooter);

    saveInfoBtn.addEventListener('click', async () => {
        const name = nameIn.value.trim();
        if (!name) { nameIn.style.borderColor = 'var(--color-danger)'; nameIn.focus(); return; }
        nameIn.style.borderColor = '';
        saveInfoBtn.disabled = true;
        saveInfoBtn.textContent = getLanguage() === 'ar' ? 'جارٍ الحفظ...' : 'Saving...';
        const newRawDesc = descIn.value.trim();
        const selectedCatId = catSelect.value ? parseInt(catSelect.value, 10) : null;
        try {
            const body = { name, photo: currentPhoto, description: newRawDesc };
            if (selectedCatId) body.categoryId = selectedCatId;

            await apiFetch('/api/v1/users/update-profile', { method: 'PUT', body: JSON.stringify(body) });
            const profile = JSON.parse(localStorage.getItem('qs_vendor_user') || '{}');
            profile.name = name; profile.photo = currentPhoto; profile.description = newRawDesc;
            if (selectedCatId) profile.categoryId = selectedCatId;
            localStorage.setItem('qs_vendor_user', JSON.stringify(profile));
            updateHeaderVendorName();
            infoFeedback.textContent = '✅ ' + t('rest_profile_saved');
            infoFeedback.style.color = 'var(--color-success)';
            setTimeout(() => { infoFeedback.textContent = ''; }, 3000);
        } catch (err) {
            infoFeedback.textContent = '❌ ' + t('rest_profile_save_error');
            infoFeedback.style.color = 'var(--color-danger)';
        } finally {
            saveInfoBtn.disabled = false;
            saveInfoBtn.textContent = t('rest_profile_save_btn');
        }
    });
    wrapper.appendChild(infoPanel);

    // ── Section 2: Working Hours & Closure ────────────────────────────────
    const schedPanel = ui.createElement('div', ['glass-panel']);
    schedPanel.appendChild(ui.createElementWithText('h3', `🕒 ${t('rest_profile_section_sched')}`, [], { style: 'font-size: 1.05rem; font-weight: 700; margin-bottom: 1.25rem; padding-bottom: 0.75rem; border-bottom: 1px solid var(--border-color);' }));

    // Activity Toggle — uses PATCH /api/v1/users/toggle-activity/{userId}
    const closureBox = ui.createElement('div', [], { style: 'padding: 1rem 1.25rem; background: rgba(255, 71, 87, 0.05); border: 1px solid rgba(255, 71, 87, 0.2); border-radius: 8px; margin-bottom: 1.5rem;' });
    closureBox.appendChild(ui.createElementWithText('p', t('rest_sched_closure_title'), [], { style: 'font-weight: 600; font-size: 0.9rem; color: var(--color-danger); margin-bottom: 0.5rem;' }));
    closureBox.appendChild(ui.createElementWithText('p', t('rest_sched_closure_desc'), ['text-secondary'], { style: 'font-size: 0.8rem; margin-bottom: 1rem;' }));

    const mktProfile = JSON.parse(localStorage.getItem('qs_vendor_user') || '{}');
    const isMktActive = !(mktProfile.active === 0 || mktProfile.active === false);

    const cSwLabel = ui.createElement('label', ['switch-container']);
    const cSwInput = ui.createElement('input', ['switch-input', 'switch-danger'], { type: 'checkbox', checked: !isMktActive ? 'checked' : '' });
    cSwInput.addEventListener('change', async (e) => {
        cSwInput.disabled = true;
        try {
            await toggleActivityStatus();
            const updatedUser = JSON.parse(localStorage.getItem('qs_vendor_user') || '{}');
            const nowClosed = (updatedUser.active === 0 || updatedUser.active === false);
            cSwLabel.querySelector('span:last-child').textContent = nowClosed ? t('rest_sched_closure_on') : t('rest_sched_closure_off');
        } catch (err) {
            ui.showToast(t('error_generic') + ': ' + err.message, 'error');
            e.target.checked = !e.target.checked;
        } finally { cSwInput.disabled = false; }
    });
    cSwLabel.appendChild(cSwInput);
    cSwLabel.appendChild(ui.createElement('span', ['switch-slider']));
    cSwLabel.appendChild(ui.createElementWithText('span', !isMktActive ? t('rest_sched_closure_on') : t('rest_sched_closure_off'), [], { style: 'font-weight: 600;' }));
    closureBox.appendChild(cSwLabel);
    schedPanel.appendChild(closureBox);

    const daysWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 1rem;' });
    daysWrap.appendChild(ui.createElementWithText('label', t('rest_sched_hours_days_label'), [], { style: 'font-size: 0.85rem; font-weight: 600;' }));
    const selectDays = ui.createElement('select', ['select-input']);
    selectDays.appendChild(ui.createElementWithText('option', t('rest_sched_hours_days_opt_standard'), [], { value: 'Sat - Thu' }));
    selectDays.appendChild(ui.createElementWithText('option', t('rest_sched_hours_days_opt_everyday'), [], { value: 'Everyday' }));
    selectDays.value = settings.days || 'Sat - Thu';
    daysWrap.appendChild(selectDays);
    schedPanel.appendChild(daysWrap);

    const hoursWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 1.25rem;' });
    hoursWrap.appendChild(ui.createElementWithText('label', t('rest_sched_hours_window_label'), [], { style: 'font-size: 0.85rem; font-weight: 600;' }));
    const inputHours = ui.createElement('input', ['search-input'], { type: 'text', value: settings.hours || '', placeholder: 'e.g. 8:00 AM - 11:00 PM' });
    hoursWrap.appendChild(inputHours);
    schedPanel.appendChild(hoursWrap);

    const saveSchedBtn = ui.createElementWithText('button', t('rest_sched_hours_btn'), ['btn', 'btn-primary']);
    const schedFeedback = ui.createElement('span', [], { style: 'font-size: 0.85rem; margin-left: 1rem;' });
    const schedFooter = ui.createElement('div', [], { style: 'display: flex; align-items: center;' });
    schedFooter.appendChild(saveSchedBtn);
    schedFooter.appendChild(schedFeedback);
    schedPanel.appendChild(schedFooter);

    saveSchedBtn.addEventListener('click', async () => {
        const freshNow = getUserSettings();
        saveSchedBtn.disabled = true;
        try {
            await updateUserSettings(selectDays.value, inputHours.value, freshNow.settings.description);
            schedFeedback.textContent = '✅ ' + t('rest_sched_hours_saved');
            schedFeedback.style.color = 'var(--color-success)';
            setTimeout(() => { schedFeedback.textContent = ''; }, 2500);
        } catch (err) {
            schedFeedback.textContent = '❌ ' + (t('error_generic') + ': ' + err.message);
            schedFeedback.style.color = 'var(--color-danger)';
        } finally { saveSchedBtn.disabled = false; }
    });

    wrapper.appendChild(schedPanel);
    parent.appendChild(wrapper);
}

/* ==========================================================================
   Tab 9: Branches Management
   ========================================================================== */
async function refreshBranches() {
    try {
        const data = await apiFetch('/api/v1/locations', {
            method: 'PATCH',
            body: JSON.stringify({
                pageNumber: 1,
                pageSize: 1000,
                enablePagination: false,
                filters: {
                    creatorId: myMarketId ? parseInt(myMarketId) : 0
                }
            })
        });
        if (data && data.result) {
            branches = data.result.map(loc => ({
                id: loc.id,
                name: loc.name || '',
                address: loc.address || '',
                latitude: loc.latitude || 0,
                longitude: loc.longitude || 0,
                base: loc.base || false
            }));
            branchesLoaded = true;
        }
    } catch (e) {
        console.error('Failed to load branches:', e);
    }
}

function renderBranchesTab(parent) {
    const wrapper = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; width: 100%;' });

    // Top Bar with Add Branch Button
    const topBar = ui.createElement('div', [], { style: 'display: flex; justify-content: flex-end;' });
    const addBtn = ui.createElementWithText('button', t('branch_add_btn'), ['btn', 'btn-primary']);
    addBtn.addEventListener('click', () => showAddBranchModal());
    topBar.appendChild(addBtn);
    wrapper.appendChild(topBar);

    // Card Grid Container
    const grid = ui.createElement('div', ['analytics-grid'], { style: 'margin-top: 1rem; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.5rem; width: 100%;' });

    if (branches.length === 0) {
        const emptyState = ui.createElement('div', ['glass-panel'], { style: 'text-align: center; padding: 3rem 1.5rem; width: 100%; grid-column: 1 / -1;' });
        emptyState.appendChild(ui.createElementWithText('h3', t('branch_empty_title'), [], { style: 'margin-bottom: 0.5rem; font-size: 1.25rem;' }));
        emptyState.appendChild(ui.createElementWithText('p', t('branch_empty_desc'), ['text-secondary'], { style: 'font-size: 0.85rem;' }));
        grid.appendChild(emptyState);
    } else {
        branches.forEach(b => {
            const card = ui.createElement('div', ['summary-card'], { style: 'display: flex; flex-direction: column; justify-content: space-between; min-height: 180px; position: relative; overflow: hidden;' });

            const content = ui.createElement('div');
            
            // Branch Name
            const nameRow = ui.createElement('div', [], { style: 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;' });
            nameRow.appendChild(ui.createElementWithText('strong', b.name || (getLanguage() === 'ar' ? 'فرع بدون اسم' : 'Unnamed Branch'), [], { style: 'font-size: 1.1rem;' }));
            
            if (b.base) {
                nameRow.appendChild(ui.createElementWithText('span', getLanguage() === 'ar' ? 'الرئيسي' : 'Base', ['badge', 'badge-success']));
            }
            content.appendChild(nameRow);

            // Address
            content.appendChild(ui.createElementWithText('p', b.address || '', ['text-secondary'], { style: 'font-size: 0.85rem; margin-bottom: 0.5rem; line-height: 1.4;' }));

            // Coordinates
            content.appendChild(ui.createElementWithText('div', `📍 Lat: ${b.latitude.toFixed(5)} | Lng: ${b.longitude.toFixed(5)}`, [], { style: 'font-size: 0.75rem; color: var(--text-muted); font-family: monospace; margin-bottom: 1rem;' }));

            card.appendChild(content);

            // Action Buttons
            const actions = ui.createElement('div', [], { style: 'display: flex; gap: 0.5rem; border-top: 1px solid var(--border-color); padding-top: 0.75rem; margin-top: auto;' });
            
            const editBtn = ui.createElementWithText('button', t('rest_menu_btn_edit'), ['btn', 'btn-secondary', 'btn-sm']);
            editBtn.addEventListener('click', () => showEditBranchModal(b));
            
            const deleteBtn = ui.createElementWithText('button', getLanguage() === 'ar' ? 'حذف' : 'Delete', ['btn', 'btn-danger', 'btn-sm']);
            deleteBtn.addEventListener('click', () => handleDeleteBranch(b));

            actions.appendChild(editBtn);
            actions.appendChild(deleteBtn);
            card.appendChild(actions);

            grid.appendChild(card);
        });
    }

    wrapper.appendChild(grid);
    parent.appendChild(wrapper);
}

function attachBranchInteractiveMapPicker(latIn, lngIn, locateBtn) {
    const searchRow = ui.createElement('div', [], { style: 'display: flex; gap: 0.5rem; margin-top: 0.5rem; margin-bottom: 0.35rem;' });
    const searchIn = ui.createElement('input', ['search-input'], {
        type: 'text',
        placeholder: getLanguage() === 'ar' ? '🔍 اكتب اسم المدينة، الحي، أو الشارع للذهاب إليه...' : '🔍 Type city, street or address name...',
        style: 'flex: 1; font-size: 0.85rem;'
    });
    const searchBtn = ui.createElementWithText('button', getLanguage() === 'ar' ? 'انتقال للموقع' : 'Go to location', ['btn', 'btn-primary'], {
        type: 'button',
        style: 'white-space: nowrap; font-size: 0.85rem; padding: 0.4rem 0.85rem;'
    });

    searchRow.appendChild(searchIn);
    searchRow.appendChild(searchBtn);

    const mapDiv = ui.createElement('div', [], {
        style: 'height: 220px; width: 100%; border-radius: 10px; margin-top: 0.25rem; margin-bottom: 0.35rem; border: 1px solid var(--border-color, #d0d7de); z-index: 1;'
    });
    const helpP = ui.createElementWithText('p', getLanguage() === 'ar' ? '💡 يمكنك استخدام البحث أعلاه، أو سحب العلامة على الخريطة لتحديد المكان بوضوح.' : '💡 Use search above, or click/drag the marker on the map to set exact location.', [], {
        style: 'font-size: 0.78rem; color: var(--text-muted, #666); margin-bottom: 0.5rem;'
    });

    let mapInstance = null;
    let markerInstance = null;

    async function performAddressSearch() {
        const query = searchIn.value.trim();
        if (!query) return;

        searchBtn.disabled = true;
        const origText = searchBtn.textContent;
        searchBtn.textContent = getLanguage() === 'ar' ? "⌛ جاري البحث..." : "⌛ Searching...";

        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
            const results = await response.json();
            if (results && results.length > 0) {
                const lat = parseFloat(results[0].lat);
                const lng = parseFloat(results[0].lon);
                latIn.value = lat.toFixed(6);
                lngIn.value = lng.toFixed(6);
                if (mapInstance && markerInstance) {
                    markerInstance.setLatLng([lat, lng]);
                    mapInstance.setView([lat, lng], 16);
                }
                ui.showToast(getLanguage() === 'ar' ? `📍 تم الانتقال إلى: ${results[0].display_name.split(',')[0]}` : `📍 Moved to: ${results[0].display_name.split(',')[0]}`, "success");
            } else {
                ui.showToast(getLanguage() === 'ar' ? "⚠️ لم يتم العثور على موقع بهذا العنوان، يرجى تحريك الخريطة يدوياً" : "⚠️ Location not found. Please locate manually on map.", "warning");
            }
        } catch (err) {
            console.error('Geocoding search failed:', err);
            ui.showToast(getLanguage() === 'ar' ? "❌ فشل الاتصال بخدمة البحث" : "❌ Location search failed.", "error");
        } finally {
            searchBtn.textContent = origText;
            searchBtn.disabled = false;
        }
    }

    searchBtn.addEventListener('click', performAddressSearch);
    searchIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            performAddressSearch();
        }
    });

    locateBtn.addEventListener('click', () => {
        locateBtn.disabled = true;
        const originalText = locateBtn.textContent;
        locateBtn.textContent = getLanguage() === 'ar' ? "⌛ جاري تحديث الموقع..." : "⌛ Locating...";
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                latIn.value = lat.toFixed(6);
                lngIn.value = lng.toFixed(6);
                if (mapInstance && markerInstance) {
                    markerInstance.setLatLng([lat, lng]);
                    mapInstance.setView([lat, lng], 16);
                }
                locateBtn.textContent = getLanguage() === 'ar' ? "✅ تم تحديد الموقع" : "✅ Located";
                locateBtn.disabled = false;
                setTimeout(() => { locateBtn.textContent = originalText; }, 2000);
            },
            (err) => {
                console.error(err);
                ui.showToast(getLanguage() === 'ar' ? "⚠️ تعذر جلب الموقع تلقائياً، يمكنك كتابة العنوان في خانة البحث أو تحديد المكان على الخريطة" : "⚠️ Unable to detect location. Please use search box or pick on map.", "warning");
                locateBtn.textContent = originalText;
                locateBtn.disabled = false;
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    });

    setTimeout(() => {
        if (typeof L !== 'undefined') {
            const initialLat = parseFloat(latIn.value) || 24.7136;
            const initialLng = parseFloat(lngIn.value) || 46.6753;
            mapInstance = L.map(mapDiv).setView([initialLat, initialLng], 14);

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(mapInstance);

            markerInstance = L.marker([initialLat, initialLng], { draggable: true }).addTo(mapInstance);

            markerInstance.on('dragend', (e) => {
                const p = e.target.getLatLng();
                latIn.value = p.lat.toFixed(6);
                lngIn.value = p.lng.toFixed(6);
            });

            mapInstance.on('click', (e) => {
                markerInstance.setLatLng(e.latlng);
                latIn.value = e.latlng.lat.toFixed(6);
                lngIn.value = e.latlng.lng.toFixed(6);
            });

            const onInputSync = () => {
                const la = parseFloat(latIn.value);
                const ln = parseFloat(lngIn.value);
                if (!isNaN(la) && !isNaN(ln)) {
                    markerInstance.setLatLng([la, ln]);
                    mapInstance.panTo([la, ln]);
                }
            };
            latIn.addEventListener('change', onInputSync);
            lngIn.addEventListener('change', onInputSync);

            setTimeout(() => {
                mapInstance.invalidateSize();
            }, 300);
        }
    }, 150);

    const container = ui.createElement('div', [], { style: 'display: flex; flex-direction: column;' });
    container.appendChild(searchRow);
    container.appendChild(mapDiv);
    container.appendChild(helpP);
    return container;
}

function showAddBranchModal() {
    const form = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; min-width: 320px; max-width: 500px;' });

    const nameWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    nameWrap.appendChild(ui.createElementWithText('label', t('branch_modal_name'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const nameIn = ui.createElement('input', ['search-input'], { type: 'text', placeholder: getLanguage() === 'ar' ? 'مثال: فرع العليا' : 'e.g. Olaya Branch' });
    nameWrap.appendChild(nameIn);

    const addrWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    addrWrap.appendChild(ui.createElementWithText('label', t('branch_modal_address'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const addrIn = ui.createElement('input', ['search-input'], { type: 'text', placeholder: getLanguage() === 'ar' ? 'شارع العليا، الرياض' : 'Olaya St, Riyadh' });
    addrWrap.appendChild(addrIn);

    const latWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    latWrap.appendChild(ui.createElementWithText('label', t('branch_modal_lat'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const latIn = ui.createElement('input', ['search-input'], { type: 'number', step: 'any', value: '24.7136' });
    latWrap.appendChild(latIn);

    const lngWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    lngWrap.appendChild(ui.createElementWithText('label', t('branch_modal_lng'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const lngIn = ui.createElement('input', ['search-input'], { type: 'number', step: 'any', value: '46.6753' });
    lngWrap.appendChild(lngIn);

    const coordsRow = ui.createElement('div', [], { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;' });
    coordsRow.appendChild(latWrap);
    coordsRow.appendChild(lngWrap);

    const locateBtn = ui.createElementWithText('button', t('branch_modal_locate_btn'), ['btn', 'btn-secondary'], { type: 'button', style: 'margin-top: 0.25rem; display: flex; align-items: center; justify-content: center; gap: 0.5rem;' });
    const mapPickerWrapper = attachBranchInteractiveMapPicker(latIn, lngIn, locateBtn);

    const baseLabel = ui.createElement('label', ['switch-container'], { style: 'margin-top: 0.5rem;' });
    const baseInput = ui.createElement('input', ['switch-input'], { type: 'checkbox' });
    baseLabel.appendChild(baseInput);
    baseLabel.appendChild(ui.createElement('span', ['switch-slider']));
    baseLabel.appendChild(ui.createElementWithText('span', t('branch_modal_base'), [], { style: 'font-size: 0.85rem;' }));

    form.appendChild(nameWrap);
    form.appendChild(addrWrap);
    form.appendChild(coordsRow);
    form.appendChild(locateBtn);
    form.appendChild(mapPickerWrapper);
    form.appendChild(baseLabel);

    ui.showModal(t('branch_modal_add_title'), form, [
        {
            text: t('save'),
            type: 'success',
            closeOnClick: false,
            onClick: async () => {
                const name = nameIn.value.trim();
                const address = addrIn.value.trim();
                const latVal = latIn.value.trim();
                const lngVal = lngIn.value.trim();

                let isValid = true;
                if (!name) {
                    ui.setInputInvalid(nameIn, getLanguage() === 'ar' ? 'الاسم مطلوب' : 'Name is required');
                    isValid = false;
                }
                if (!address) {
                    ui.setInputInvalid(addrIn, getLanguage() === 'ar' ? 'العنوان مطلوب' : 'Address is required');
                    isValid = false;
                }
                if (!latVal || isNaN(parseFloat(latVal))) {
                    ui.setInputInvalid(latIn, getLanguage() === 'ar' ? 'خط العرض غير صحيح' : 'Invalid latitude');
                    isValid = false;
                }
                if (!lngVal || isNaN(parseFloat(lngVal))) {
                    ui.setInputInvalid(lngIn, getLanguage() === 'ar' ? 'خط الطول غير صحيح' : 'Invalid longitude');
                    isValid = false;
                }

                if (!isValid) return;

                const latitude = parseFloat(latVal);
                const longitude = parseFloat(lngVal);
                const base = baseInput.checked;

                // Optimistic add
                const tempBranch = { id: 'temp-' + Date.now(), name, address, latitude, longitude, base };
                branches.push(tempBranch);
                renderActiveTab();
                ui.closeModal();

                try {
                    await apiFetch('/api/v1/locations', {
                        method: 'POST',
                        body: JSON.stringify({ name, address, latitude, longitude, base })
                    });
                    ui.showToast(getLanguage() === 'ar' ? 'تمت إضافة الفرع بنجاح' : 'Branch added successfully', 'success');
                    await refreshBranches();
                    if (activeTab === 'branches') renderActiveTab();
                } catch (err) {
                    console.error('Failed to add branch:', err);
                    branches = branches.filter(b => b.id !== tempBranch.id);
                    renderActiveTab();
                    ui.showToast((getLanguage() === 'ar' ? 'فشل إضافة الفرع: ' : 'Failed to add branch: ') + err.message, 'error');
                }
            }
        },
        { text: t('cancel'), type: 'secondary', onClick: ui.closeModal }
    ]);
}

function showEditBranchModal(b) {
    const form = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; min-width: 320px; max-width: 500px;' });

    const nameWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    nameWrap.appendChild(ui.createElementWithText('label', t('branch_modal_name'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const nameIn = ui.createElement('input', ['search-input'], { type: 'text', value: b.name });
    nameWrap.appendChild(nameIn);

    const addrWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    addrWrap.appendChild(ui.createElementWithText('label', t('branch_modal_address'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const addrIn = ui.createElement('input', ['search-input'], { type: 'text', value: b.address });
    addrWrap.appendChild(addrIn);

    const latWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    latWrap.appendChild(ui.createElementWithText('label', t('branch_modal_lat'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const latIn = ui.createElement('input', ['search-input'], { type: 'number', step: 'any', value: b.latitude });
    latWrap.appendChild(latIn);

    const lngWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    lngWrap.appendChild(ui.createElementWithText('label', t('branch_modal_lng'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const lngIn = ui.createElement('input', ['search-input'], { type: 'number', step: 'any', value: b.longitude });
    lngWrap.appendChild(lngIn);

    const coordsRow = ui.createElement('div', [], { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;' });
    coordsRow.appendChild(latWrap);
    coordsRow.appendChild(lngWrap);

    const locateBtn = ui.createElementWithText('button', t('branch_modal_locate_btn'), ['btn', 'btn-secondary'], { type: 'button', style: 'margin-top: 0.25rem; display: flex; align-items: center; justify-content: center; gap: 0.5rem;' });
    const mapPickerWrapper = attachBranchInteractiveMapPicker(latIn, lngIn, locateBtn);

    const baseLabel = ui.createElement('label', ['switch-container'], { style: 'margin-top: 0.5rem;' });
    const baseInput = ui.createElement('input', ['switch-input'], { type: 'checkbox', checked: b.base ? 'checked' : '' });
    baseLabel.appendChild(baseInput);
    baseLabel.appendChild(ui.createElement('span', ['switch-slider']));
    baseLabel.appendChild(ui.createElementWithText('span', t('branch_modal_base'), [], { style: 'font-size: 0.85rem;' }));

    form.appendChild(nameWrap);
    form.appendChild(addrWrap);
    form.appendChild(coordsRow);
    form.appendChild(locateBtn);
    form.appendChild(mapPickerWrapper);
    form.appendChild(baseLabel);

    ui.showModal(t('branch_modal_edit_title'), form, [
        {
            text: t('save'),
            type: 'success',
            closeOnClick: false,
            onClick: async () => {
                const name = nameIn.value.trim();
                const address = addrIn.value.trim();
                const latVal = latIn.value.trim();
                const lngVal = lngIn.value.trim();

                let isValid = true;
                if (!name) {
                    ui.setInputInvalid(nameIn, getLanguage() === 'ar' ? 'الاسم مطلوب' : 'Name is required');
                    isValid = false;
                }
                if (!address) {
                    ui.setInputInvalid(addrIn, getLanguage() === 'ar' ? 'العنوان مطلوب' : 'Address is required');
                    isValid = false;
                }
                if (!latVal || isNaN(parseFloat(latVal))) {
                    ui.setInputInvalid(latIn, getLanguage() === 'ar' ? 'خط العرض غير صحيح' : 'Invalid latitude');
                    isValid = false;
                }
                if (!lngVal || isNaN(parseFloat(lngVal))) {
                    ui.setInputInvalid(lngIn, getLanguage() === 'ar' ? 'خط الطول غير صحيح' : 'Invalid longitude');
                    isValid = false;
                }

                if (!isValid) return;

                const latitude = parseFloat(latVal);
                const longitude = parseFloat(lngVal);
                const base = baseInput.checked;

                // Optimistic edit
                const oldBranch = { ...b };
                b.name = name;
                b.address = address;
                b.latitude = latitude;
                b.longitude = longitude;
                b.base = base;
                renderActiveTab();
                ui.closeModal();

                try {
                    await apiFetch('/api/v1/locations', {
                        method: 'PUT',
                        body: JSON.stringify({ id: b.id, name, address, latitude, longitude, base })
                    });
                    ui.showToast(getLanguage() === 'ar' ? 'تم تحديث الفرع بنجاح' : 'Branch updated successfully', 'success');
                    await refreshBranches();
                    if (activeTab === 'branches') renderActiveTab();
                } catch (err) {
                    console.error('Failed to update branch:', err);
                    Object.assign(b, oldBranch);
                    renderActiveTab();
                    ui.showToast((getLanguage() === 'ar' ? 'فشل تحديث الفرع: ' : 'Failed to update branch: ') + err.message, 'error');
                }
            }
        },
        { text: t('cancel'), type: 'secondary', onClick: ui.closeModal }
    ]);
}

function handleDeleteBranch(b) {
    const confirmMsg = getLanguage() === 'ar' 
        ? `هل أنت متأكد من حذف الفرع "${b.name}"؟`
        : `Are you sure you want to delete branch "${b.name}"?`;
        
    const body = ui.createElementWithText('p', confirmMsg);
    ui.showModal(
        getLanguage() === 'ar' ? 'تأكيد الحذف' : 'Confirm Delete',
        body,
        [
            {
                text: getLanguage() === 'ar' ? 'حذف' : 'Delete',
                type: 'danger',
                closeOnClick: false,
                onClick: async () => {
                    const originalBranches = [...branches];
                    try {
                        branches = branches.filter(x => x.id !== b.id);
                        renderActiveTab();
                        ui.closeModal();
                        await apiFetch(`/api/v1/locations/${b.id}`, { method: 'DELETE' });
                        ui.showToast(getLanguage() === 'ar' ? 'تم حذف الفرع بنجاح' : 'Branch deleted successfully', 'success');
                        await refreshBranches();
                        if (activeTab === 'branches') renderActiveTab();
                    } catch (err) {
                        console.error('Failed to delete branch:', err);
                        branches = originalBranches;
                        renderActiveTab();
                        ui.showToast((getLanguage() === 'ar' ? 'فشل حذف الفرع: ' : 'Failed to delete branch: ') + err.message, 'error');
                    }
                }
            },
            {
                text: t('cancel'),
                type: 'secondary',
                onClick: ui.closeModal
            }
        ]
    );
}

function showMarketChatSelection(order) {
    const body = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.75rem;' });
    
    const custBtn = ui.createElementWithText('button', getLanguage() === 'ar' ? `💬 دردشة مع العميل (${order.customerName})` : `💬 Chat with Customer (${order.customerName})`, ['btn', 'btn-primary', 'btn-block']);
    custBtn.addEventListener('click', () => {
        ui.closeModal();
        openDashboardChat(order.customerId || order.userId, order.customerName);
    });
    body.appendChild(custBtn);

    if (order.captainName) {
        const driverBtn = ui.createElementWithText('button', getLanguage() === 'ar' ? `💬 دردشة مع السائق (${order.captainName})` : `💬 Chat with Driver (${order.captainName})`, ['btn', 'btn-success', 'btn-block']);
        driverBtn.addEventListener('click', () => {
            ui.closeModal();
            openDashboardChat(order.captainId || order.updatorId, order.captainName);
        });
        body.appendChild(driverBtn);
    }

    ui.showModal(
        getLanguage() === 'ar' ? 'اختر مستلم المحادثة' : 'Select Chat Recipient',
        body,
        [{ text: t('cancel'), type: 'secondary', onClick: ui.closeModal }]
    );
}

async function renderChatsTab(parent) {
    const wrapper = ui.createElement('div', ['chat-panel-wrapper']);

    const leftPane = ui.createElement('div', ['chat-left-pane']);
    const rightPane = ui.createElement('div', ['chat-right-pane']);

    // Empty state
    const emptyState = ui.createElement('div', ['chat-empty-state']);
    const emptyIcon = ui.createElement('div', ['chat-empty-state-icon']);
    emptyIcon.textContent = '💬';
    const emptyText = ui.createElement('div', ['chat-empty-state-text']);
    emptyText.textContent = getLanguage() === 'ar' ? 'اختر محادثة للبدء' : 'Select a chat to start';
    emptyState.appendChild(emptyIcon);
    emptyState.appendChild(emptyText);
    rightPane.appendChild(emptyState);

    // Left pane header
    const paneHeader = ui.createElement('div', ['chat-pane-header']);
    const headerIcon = ui.createElement('div', ['chat-pane-header-icon']);
    headerIcon.style.background = 'rgba(46,213,115,0.15)';
    headerIcon.textContent = '💬';
    const headerTitle = ui.createElement('div', ['chat-pane-header-title']);
    headerTitle.textContent = getLanguage() === 'ar' ? 'المحادثات النشطة' : 'Active Chats';
    paneHeader.appendChild(headerIcon);
    paneHeader.appendChild(headerTitle);
    leftPane.appendChild(paneHeader);

    const listContainer = ui.createElement('div', ['chat-list-container']);
    leftPane.appendChild(listContainer);

    wrapper.appendChild(leftPane);
    wrapper.appendChild(rightPane);
    parent.appendChild(wrapper);

    try {
        const data = await apiFetch('/api/v1/chats', {
            method: 'PATCH',
            body: JSON.stringify({ pageNumber: 1, pageSize: 30 })
        });
        const chatsList = data && data.result ? data.result : [];

        if (chatsList.length === 0) {
            const noItems = ui.createElement('div', ['chat-no-items']);
            noItems.innerHTML = '<span style="font-size:2rem;opacity:0.3">📭</span>' +
                (getLanguage() === 'ar' ? 'لا توجد محادثات' : 'No active chats');
            listContainer.appendChild(noItems);
            return;
        }

        const userJson = localStorage.getItem('qs_vendor_user');
        let myId = 0;
        try { if (userJson) myId = JSON.parse(userJson).id; } catch(e){}

        let activeItem = null;
        chatsList.forEach(chat => {
            const otherUser = chat.creatorId === myId ? chat.recipient : chat.creator;
            const recipientName = otherUser ? otherUser.name : (getLanguage() === 'ar' ? 'مستخدم' : 'User');
            const recipientId = otherUser ? otherUser.id : 0;
            const lastMsgContent = (chat.lastMessage && chat.lastMessage.content) ? chat.lastMessage.content : '';
            const initials = recipientName ? recipientName.charAt(0).toUpperCase() : '?';

            const item = ui.createElement('div', ['chat-item-row']);

            const avatar = ui.createElement('div', ['chat-item-avatar']);
            if (otherUser && otherUser.photo) {
                const img = document.createElement('img');
                img.src = otherUser.photo.startsWith('http') ? otherUser.photo : `https://quick-service.runasp.net/api/v1/stream/public/${otherUser.photo}`;
                img.onerror = () => { avatar.textContent = initials; };
                avatar.appendChild(img);
            } else {
                avatar.textContent = initials;
                avatar.style.background = 'rgba(46,213,115,0.15)';
                avatar.style.color = 'var(--mkt-color)';
                avatar.style.fontWeight = '700';
            }

            const info = ui.createElement('div', ['chat-item-info']);
            const nameEl = ui.createElement('div', ['chat-item-name']);
            nameEl.textContent = recipientName;
            const lastMsgEl = ui.createElement('div', ['chat-item-last-msg']);
            lastMsgEl.textContent = lastMsgContent.length > 35 ? lastMsgContent.slice(0, 32) + '...' : lastMsgContent;

            info.appendChild(nameEl);
            info.appendChild(lastMsgEl);
            item.appendChild(avatar);
            item.appendChild(info);

            item.addEventListener('click', () => {
                if (activeItem) activeItem.classList.remove('active');
                item.classList.add('active');
                activeItem = item;
                renderChatRoom(rightPane, recipientId, recipientName);
            });

            listContainer.appendChild(item);
        });

    } catch (e) {
        console.error('Failed to load chats list:', e);
    }
}

function renderChatRoom(container, recipientId, recipientName) {
    if (activeDashboardChatInterval) {
        clearInterval(activeDashboardChatInterval);
        activeDashboardChatInterval = null;
    }

    container.replaceChildren();
    container.className = 'chat-right-pane';
    container.style.padding = '0';
    container.style.justifyContent = 'flex-start';
    container.style.alignItems = 'stretch';

    // Header
    const roomHeader = ui.createElement('div', ['chat-room-header']);
    const headerAvatar = ui.createElement('div', ['chat-item-avatar']);
    headerAvatar.style.width = '36px';
    headerAvatar.style.height = '36px';
    headerAvatar.style.fontSize = '14px';
    headerAvatar.style.background = 'rgba(46,213,115,0.15)';
    headerAvatar.style.color = 'var(--mkt-color)';
    headerAvatar.style.fontWeight = '700';
    headerAvatar.textContent = recipientName ? recipientName.charAt(0).toUpperCase() : '?';
    const roomNameEl = ui.createElement('div', ['chat-room-name']);
    roomNameEl.textContent = recipientName;
    roomHeader.appendChild(headerAvatar);
    roomHeader.appendChild(roomNameEl);
    container.appendChild(roomHeader);

    const messagesContainer = ui.createElement('div', ['chat-messages-area']);
    container.appendChild(messagesContainer);

    const inputRow = ui.createElement('div', ['chat-input-row']);
    const textIn = ui.createElement('input', ['chat-text-input'], {
        type: 'text',
        placeholder: getLanguage() === 'ar' ? 'اكتب رسالة...' : 'Type a message...'
    });
    const sendBtn = ui.createElementWithText('button', getLanguage() === 'ar' ? 'إرسال' : 'Send', ['btn', 'btn-primary']);
    inputRow.appendChild(textIn);
    inputRow.appendChild(sendBtn);
    container.appendChild(inputRow);

    const userJson = localStorage.getItem('qs_vendor_user');
    let myId = 0;
    try { if (userJson) myId = JSON.parse(userJson).id; } catch(e){}

    const appendMessages = (messages) => {
        messagesContainer.replaceChildren();
        if (messages.length === 0) {
            const noMsg = ui.createElement('div', ['chat-no-items']);
            noMsg.style.marginTop = 'auto';
            noMsg.style.marginBottom = 'auto';
            noMsg.textContent = getLanguage() === 'ar' ? 'لا توجد رسائل بعد' : 'No messages yet';
            messagesContainer.appendChild(noMsg);
            return;
        }
        messages.forEach(msg => {
            const isMe = msg.creatorId === myId;
            const wrapper = ui.createElement('div', ['chat-bubble-wrapper', isMe ? 'mine' : 'theirs']);
            const bubble = ui.createElement('div', ['chat-bubble', isMe ? 'mine' : 'theirs']);
            if (isMe) bubble.style.background = 'var(--mkt-color)';
            bubble.textContent = msg.content || '';
            wrapper.appendChild(bubble);
            messagesContainer.appendChild(wrapper);
        });
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    };

    let lastMessageCount = 0;
    const loadMessages = async () => {
        try {
            const data = await apiFetch('/api/v1/messages', {
                method: 'PATCH',
                body: JSON.stringify({
                    pageNumber: 1,
                    pageSize: 40,
                    targetUserId: recipientId,
                    userId: recipientId
                })
            });
            const list = data && data.result ? data.result : [];
            list.sort((a,b) => (a.id || 0) - (b.id || 0));
            if (list.length !== lastMessageCount) {
                lastMessageCount = list.length;
                appendMessages(list);
            }
        } catch(e) {
            console.error('Failed to load chat messages:', e);
        }
    };

    const handleSend = async () => {
        const text = textIn.value.trim();
        if (!text) return;
        textIn.value = '';

        const wrapper = ui.createElement('div', ['chat-bubble-wrapper', 'mine']);
        const bubble = ui.createElement('div', ['chat-bubble', 'mine']);
        bubble.style.background = 'var(--mkt-color)';
        bubble.textContent = text;
        wrapper.appendChild(bubble);
        messagesContainer.appendChild(wrapper);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        try {
            await apiFetch('/api/v1/messages', {
                method: 'POST',
                body: JSON.stringify({ recipientId, content: text, messageType: 0 })
            });
            await loadMessages();
        } catch(e) {
            console.error('Failed to send message:', e);
        }
    };

    sendBtn.addEventListener('click', handleSend);
    textIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSend(); });

    loadMessages();
    activeDashboardChatInterval = setInterval(loadMessages, 4000);
}

async function openDashboardChat(recipientId, recipientName) {
    if (chatPollInterval) {
        clearInterval(chatPollInterval);
        chatPollInterval = null;
    }

    const modalBody = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; height: 400px; justify-content: space-between;' });
    
    const messagesContainer = ui.createElement('div', [], { 
        id: 'chat-messages-container', 
        style: 'flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: #f8f9fa; margin-bottom: 12px;' 
    });
    modalBody.appendChild(messagesContainer);

    const inputRow = ui.createElement('div', [], { style: 'display: flex; gap: 8px; align-items: center;' });
    const textIn = ui.createElement('input', ['search-input'], { 
        type: 'text', 
        placeholder: getLanguage() === 'ar' ? 'اكتب رسالة...' : 'Type a message...',
        style: 'flex: 1; margin: 0;'
    });
    const sendBtn = ui.createElementWithText('button', getLanguage() === 'ar' ? 'إرسال' : 'Send', ['btn', 'btn-primary']);
    
    inputRow.appendChild(textIn);
    inputRow.appendChild(sendBtn);
    modalBody.appendChild(inputRow);

    const userJson = localStorage.getItem('qs_vendor_user');
    let myId = 0;
    try {
        if (userJson) myId = JSON.parse(userJson).id;
    } catch(e){}

    const appendMessages = (messages) => {
        messagesContainer.replaceChildren();
        if (messages.length === 0) {
            messagesContainer.appendChild(ui.createElementWithText('div', getLanguage() === 'ar' ? 'لا توجد رسائل بعد' : 'No messages yet', [], { style: 'text-align: center; color: var(--text-muted); font-size: 0.85rem; margin-top: auto; margin-bottom: auto;' }));
            return;
        }
        messages.forEach(msg => {
            const isMe = msg.creatorId === myId;
            const bubbleWrapper = ui.createElement('div', [], { style: `display: flex; justify-content: ${isMe ? 'flex-end' : 'flex-start'}; width: 100%;` });
            const bubble = ui.createElementWithText('div', msg.content || '', [], {
                style: `padding: 8px 12px; border-radius: 12px; max-width: 75%; font-size: 0.85rem; word-break: break-word; ${
                    isMe 
                    ? 'background: var(--mkt-color); color: white; border-bottom-right-radius: 2px;' 
                    : 'background: #e9ecef; color: var(--color-text-primary); border-bottom-left-radius: 2px;'
                }`
            });
            bubbleWrapper.appendChild(bubble);
            messagesContainer.appendChild(bubbleWrapper);
        });
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    };

    let lastMessageCount = 0;
    const loadMessages = async () => {
        try {
            const data = await apiFetch('/api/v1/messages', {
                method: 'PATCH',
                body: JSON.stringify({
                    pageNumber: 1,
                    pageSize: 40,
                    targetUserId: recipientId,
                    userId: recipientId
                })
            });
            const list = data && data.result ? data.result : [];
            list.sort((a,b) => (a.id || 0) - (b.id || 0));
            if (list.length !== lastMessageCount) {
                lastMessageCount = list.length;
                appendMessages(list);
            }
        } catch(e) {
            console.error('Failed to load chat messages:', e);
        }
    };

    const handleSend = async () => {
        const text = textIn.value.trim();
        if (!text) return;
        textIn.value = '';

        const bubbleWrapper = ui.createElement('div', [], { style: 'display: flex; justify-content: flex-end; width: 100%;' });
        const bubble = ui.createElementWithText('div', text, [], {
            style: 'padding: 8px 12px; border-radius: 12px; max-width: 75%; font-size: 0.85rem; word-break: break-word; background: var(--mkt-color); color: white; border-bottom-right-radius: 2px;'
        });
        bubbleWrapper.appendChild(bubble);
        messagesContainer.appendChild(bubbleWrapper);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        try {
            await apiFetch('/api/v1/messages', {
                method: 'POST',
                body: JSON.stringify({
                    recipientId: recipientId,
                    content: text,
                    messageType: 0
                })
            });
            await loadMessages();
        } catch(e) {
            console.error('Failed to send message:', e);
        }
    };

    sendBtn.addEventListener('click', handleSend);
    textIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleSend();
    });

    await loadMessages();
    chatPollInterval = setInterval(loadMessages, 4000);

    ui.showModal(
        getLanguage() === 'ar' ? `المحادثة مع ${recipientName}` : `Chat with ${recipientName}`,
        modalBody,
        [
            {
                text: getLanguage() === 'ar' ? 'إغلاق' : 'Close',
                type: 'secondary',
                onClick: () => {
                    if (chatPollInterval) {
                        clearInterval(chatPollInterval);
                        chatPollInterval = null;
                    }
                    ui.closeModal();
                }
            }
        ]
    );
}

// ─── Autostart ────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        try { initMarket(); } catch (e) { console.error('initMarket error:', e); }
    });
} else {
    try { initMarket(); } catch (e) { console.error('initMarket error:', e); }
}
