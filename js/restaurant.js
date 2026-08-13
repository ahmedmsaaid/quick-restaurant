/**
 * Quick Service Portal - Restaurant Dashboard Module
 * Manages live incoming order queues, Web Audio loops buzzer alarms, Kitchen Kanban boards,
 * menu customizer modifiers, and emergency closure overlays.
 */

import * as ui from './ui-utils.js';
import { t, getLanguage, setLanguage, initTranslations, subscribeLangChange } from './translations.js';
import { ApiClient, ImageService, Logger } from './core.js';
import { initFCMNotificationService } from './fcm-helper.js';
console.log('🚀 restaurant.js module loaded');

let activeTab = 'queue';
let myRestaurantId = null;
let restaurantMenu = [];
let orders = [];
let categories = []; // In-memory categories state
let discounts = []; // In-memory discounts state
let offers = [];    // In-memory offers state
let branches = [];  // In-memory branches state
let categoriesLoaded = false;
let discountsLoaded = false;
let offersLoaded = false;
let branchesLoaded = false;
let profileLoaded = false;
let knownOrderIds = null;

// Initialize Core OOP classes
const apiClient = new ApiClient('restaurant');
const imageService = new ImageService(apiClient);

// Mock Handlers Configuration
apiClient.registerMockHandler('/api/v1/users', (path, options) => {
    return { success: true, result: { id: 1, name: 'Mock Restaurant Manager', role: 0 } };
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
    Logger.logHttp(method, url, reqBody, status, resBody, 'restaurant');
}

// Helper: Parse description for modifiers and custom category
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
                return {
                    desc: parsed.desc || '',
                    category: parsed.category || 'Burgers',
                    mods: parsed.mods || []
                };
            } catch (e) {
                console.error('Failed to parse description JSON', e);
            }
        }
    }
    return {
        desc: rawDesc || '',
        category: 'Burgers',
        mods: []
    };
}

// Helper: Parse user description for settings
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
                    hours: parsed.hours || '12:00 PM - 11:30 PM'
                };
            } catch (e) {
                console.error('Failed to parse settings JSON', e);
            }
        }
    }
    return {
        description: rawDesc || '',
        days: 'Sat - Thu',
        hours: '12:00 PM - 11:30 PM'
    };
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

// Helper: Update user settings on profile (days/hours/description only)
async function updateUserSettings(days, hours, descriptionText) {
    const rawDescription = '__SETTINGS__:' + JSON.stringify({
        days,
        hours,
        description: descriptionText
    });
    const profile = JSON.parse(localStorage.getItem('qs_vendor_user') || '{}');
    await apiFetch('/api/v1/users/update-profile', {
        method: 'PUT',
        body: JSON.stringify({
            name: profile.name || 'Vendor',
            photo: profile.photo || '',
            description: rawDescription
        })
    });
    // Update local user object
    profile.description = rawDescription;
    localStorage.setItem('qs_vendor_user', JSON.stringify(profile));
}

// Status Mappings
function mapBackendStatusToLocal(backendStatus) {
    switch (backendStatus) {
        case 0: // Created — new order, needs restaurant accept/decline
            return 'new';
        case 1: // PendingForPayment — online payment pending
            return 'pending_payment';
        case 2: // PendingForDelivery — restaurant accepted (cash), waiting for captain
            return 'waiting_for_driver';
        case 3: // Confirmed — captain accepted, restaurant can start preparing
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

function mapLocalStatusToBackend(localStatus) {
    switch (localStatus) {
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

// Refresh Categories from backend
async function refreshCategories() {
    try {
        const data = await apiFetch('/api/v1/categories', {
            method: 'PATCH',
            body: JSON.stringify({
                pageNumber: 1,
                pageSize: 1000,
                enablePagination: false,
                filters: {
                    CreatorId: myRestaurantId ? parseInt(myRestaurantId) : 0
                }
            })
        });
        if (data && data.result) {
            categories = data.result
                .filter(c => c.type === 0) // Filter restaurant categories client-side
                .map(c => ({
                    id: c.id,
                    name: c.name,
                    description: c.description || '',
                    photo: c.photo || '',
                    type: c.type
                }));
            categoriesLoaded = true;
        }
    } catch (e) {
        console.error('Failed to load categories:', e);
    }
}

// Refresh Discounts from backend
async function refreshDiscounts() {
    try {
        const data = await apiFetch('/api/v1/discounts', {
            method: 'PATCH',
            body: JSON.stringify({
                pageNumber: 1,
                pageSize: 1000,
                enablePagination: false,
                filters: {
                    CreatorId: myRestaurantId ? parseInt(myRestaurantId) : 0
                }
            })
        });
        if (data && data.result) {
            discounts = data.result.map(d => ({
                id: d.id,
                name: d.name,
                description: d.description || '',
                percentage: d.percentage,
                type: d.type,
                startDate: d.startDate,
                endDate: d.endDate,
                isActive: d.isActive
            }));
            discountsLoaded = true;
        }
    } catch (e) {
        console.error('Failed to load discounts:', e);
    }
}

// Refresh Offers from backend
async function refreshOffers() {
    try {
        const data = await apiFetch('/api/v1/offers', {
            method: 'PATCH',
            body: JSON.stringify({
                pageNumber: 1, pageSize: 1000, enablePagination: false,
                includesPath: ['OfferProducts.Product'],
                filters: { CreatorId: myRestaurantId ? parseInt(myRestaurantId) : 0 }
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
                        const localProd = restaurantMenu.find(mp => mp.id.toString() === p.id.toString());
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

// Refresh Profile from backend
async function refreshProfile() {
    try {
        const profileData = await apiFetch('/api/v1/users', { method: 'GET' });
        if (profileData && profileData.result) {
            // Preserve any locally-saved settings that may not be on the server yet
            const existing = JSON.parse(localStorage.getItem('qs_vendor_user') || '{}');
            const merged = { ...existing, ...profileData.result };
            localStorage.setItem('qs_vendor_user', JSON.stringify(merged));
            myRestaurantId = parseInt(profileData.result.id);
            profileLoaded = true;
            updateHeaderVendorName();
        }
    } catch (e) {
        console.error('Failed to refresh profile:', e);
    }
}

// Refresh Menu Items from backend
async function refreshMenu() {
    if (!myRestaurantId) return;
    try {
        const data = await apiFetch('/api/v1/products/paginate', {
            method: 'PATCH',
            body: JSON.stringify({
                pageNumber: 1,
                pageSize: 1000,
                enablePagination: false,
                filters: {
                    creatorId: myRestaurantId
                }
            })
        });
        if (data && data.result) {
            restaurantMenu = data.result.map(p => {
                const parsed = parseProductDescription(p.description);
                const matchedCategory = categories.find(c => c.id === p.categoryId);
                const categoryName = matchedCategory ? matchedCategory.name : (parsed.category || 'Burgers');
                return {
                    id: p.id.toString(),
                    name: p.name,
                    price: p.price,
                    category: categoryName,
                    description: parsed.desc,
                    isOutOfStock: !p.isAvailable,
                    image: p.photo || '',
                    modifiers: [],
                    rawProduct: p
                };
            });
        }
    } catch (e) {
        console.error('Failed to load menu products:', e);
    }
}

// Refresh Orders from backend
async function refreshOrders() {
    if (!myRestaurantId) return;
    try {
        // Ensure menu is loaded to verify product IDs
        if (restaurantMenu.length === 0) {
            await refreshMenu();
        }
        const myProductIds = new Set(restaurantMenu.map(p => parseInt(p.id)));

        const data = await apiFetch('/api/v1/orders', {
            method: 'PATCH',
            body: JSON.stringify({
                pageNumber: 1,
                pageSize: 1000,
                enablePagination: false,
                includesPath: ["OrderProducts.Product", "User"],
                filters: {}
            })
        });
        if (data && data.result) {
            console.log("DEBUG - raw orders from backend:", data.result);
            console.log("DEBUG - myProductIds Set:", Array.from(myProductIds));
            const fetchedOrders = data.result.filter(ord => {
                if (!ord.products || ord.products.length === 0) {
                    console.log(`Order ${ord.id} filtered out: products list is empty/null.`);
                    return false;
                }
                const matches = ord.products.some(p => myProductIds.has(p.productId));
                if (!matches) {
                    console.log(`Order ${ord.id} filtered out: none of its products (${ord.products.map(p => p.productId).join(',')}) match vendor product IDs.`);
                }
                return matches;
            }).map(ord => {
                const items = ord.products.map(p => {
                    const menuItem = restaurantMenu.find(m => m.id === p.productId.toString());
                    const mods = menuItem ? menuItem.modifiers.map(m => m.name) : [];
                    return {
                        name: p.productName || 'Dish',
                        qty: p.quantity,
                        price: p.price,
                        modifiers: mods
                    };
                });
                return {
                    id: ord.id.toString(),
                    vendorId: myRestaurantId.toString(),
                    status: mapBackendStatusToLocal(ord.status),
                    items: items,
                    totalPrice: ord.totalPrice - (ord.deliveryFee || 0) - (ord.orderFee || 0),
                    notes: ord.address || '',
                    customerName: ord.user ? ord.user.name : (getLanguage() === 'ar' ? 'عميل' : 'Customer'),
                    customerPhone: ord.user ? ord.user.phone : '',
                    prepTime: 20,
                    captainName: '',
                    rawOrder: ord
                };
            });

            // Detect new incoming pending orders for notifications
            if (knownOrderIds !== null) {
                const newIncoming = fetchedOrders.filter(o => !knownOrderIds.has(o.id) && (o.status === 'new' || o.status === 'pending_payment' || o.status === 'pending'));
                if (newIncoming.length > 0) {
                    console.log('🍔 New incoming food orders detected:', newIncoming);
                    ui.showFullScreenOrderAlert(newIncoming[0].id, () => {
                        const queueTab = document.getElementById('rest-menu-queue');
                        if (queueTab) queueTab.click();
                    });
                    
                    newIncoming.forEach(ord => {
                        const title = getLanguage() === 'ar' 
                            ? `🍔 طلب طعام جديد! (#${ord.id})` 
                            : `🍔 New Food Order! (#${ord.id})`;
                        const body = getLanguage() === 'ar'
                            ? `طلب جديد من ${ord.customerName} - الإجمالي: ${ord.totalPrice} د.ع`
                            : `New food order from ${ord.customerName} - Total: ${ord.totalPrice} IQD`;
                        
                        ui.sendDesktopNotification(title, body, { tag: 'order-' + ord.id });
                        ui.showToast(getLanguage() === 'ar' ? `وصل طلب جديد! #${ord.id}` : `New order received! #${ord.id}`, 'info');
                    });
                }
            }

            knownOrderIds = new Set(fetchedOrders.map(o => o.id));
            orders = fetchedOrders;
        }
    } catch (e) {
        console.error('Failed to load orders:', e);
    }
}

// Status Updates
async function updateStatus(orderId, localStatus, extra = {}) {
    try {
        let backendStatus = mapLocalStatusToBackend(localStatus);
        const order = orders.find(o => o.id === orderId.toString());
        
        const rowVersion = order && order.rawOrder ? order.rawOrder.rowVersion : null;

        await apiFetch('/api/v1/orders/status', {
            method: 'PUT',
            body: JSON.stringify({
                id: parseInt(orderId),
                status: backendStatus,
                rowVersion: rowVersion
            })
        });

        await refreshOrders();
        updateBadges();
        checkBuzzerAlarm();
        renderActiveTab();
    } catch (e) {
        console.error('Failed to update order status:', e);
        ui.showToast(t('error_generic') + ': ' + e.message, 'error');
    }
}

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
        const name = profile.name || profile.storeName || (getLanguage() === 'ar' ? 'المطعم' : 'Restaurant');
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

export async function initRestaurant() {
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
    
    // Wire logout button in header
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('qs_vendor_token');
            localStorage.removeItem('qs_vendor_user');
            window.location.replace('login.html?role=restaurant');
        });
    }

    // Wire language switcher in header
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
            renderActiveTab();
        });
    }

    // Wire dismissed button in global footer alarm banner
    const dismissBtn = document.getElementById('btn-dismiss-alarm');
    if (dismissBtn) {
        dismissBtn.addEventListener('click', () => {
            ui.stopAlarmSound();
        });
    }

    // Fetch initial profile
    const userJson = localStorage.getItem('qs_vendor_user');
    if (userJson) {
        try {
            const u = JSON.parse(userJson);
            myRestaurantId = parseInt(u.id);
        } catch(e) {}
    }
    
    try {
        const profileData = await apiFetch('/api/v1/users', { method: 'GET' });
        if (profileData && profileData.result) {
            localStorage.setItem('qs_vendor_user', JSON.stringify(profileData.result));
            myRestaurantId = parseInt(profileData.result.id);
            profileLoaded = true;
            updateHeaderVendorName();
        }
    } catch (e) {
        console.error('Failed to refresh profile on load:', e);
    }

    // Subscribe to external language switches
    subscribeLangChange(() => {
        initTranslations();
        updateHeaderVendorName();
        if (document.getElementById('notifications-dropdown') && !document.getElementById('notifications-dropdown').classList.contains('hidden')) {
            loadNotificationsList();
        }
        renderActiveTab();
    });

    // Load initial data and render
    try {
        const container = document.getElementById('rest-tab-container');
        if (container) ui.renderShimmerGrid(container);
        await Promise.all([
            refreshCategories(),
            refreshMenu(),
            refreshOrders(),
            refreshDiscounts(),
            refreshOffers(),
            refreshBranches()
        ]);
    } catch (err) {
        console.error('Failed to load initial data:', err);
    }
    updateBadges();
    checkBuzzerAlarm();
    renderActiveTab();

    // Start live polling every 10 seconds
    // Only re-render the active tab if it's an order-related view to avoid
    // flickering on non-live tabs (menu, categories, discounts, schedule).
    setInterval(async () => {
        try {
            await refreshOrders();
            updateBadges();
            checkBuzzerAlarm();
            if (activeTab === 'queue' || activeTab === 'progress') {
                renderActiveTab();
            }
        } catch (e) {
            console.error('Error polling orders in restaurant:', e);
        }
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

// ─── Navigation & Headers ─────────────────────────────────────────────────────
function updateBadges() {
    const qBadge = document.getElementById('rest-badge-queue') || document.getElementById('rest-badge-incoming');
    const pBadge = document.getElementById('rest-badge-progress');
    
    const countQueue = orders.filter(o => o.status === 'new' || o.status === 'pending_payment' || o.status === 'pending').length;
    const countProgress = orders.filter(o => o.status === 'preparing' || o.status === 'ready_for_pickup').length;
    
    if (qBadge) {
        qBadge.textContent = countQueue;
        qBadge.style.display = countQueue > 0 ? 'inline-flex' : 'none';
    }
    if (pBadge) {
        pBadge.textContent = countProgress;
        pBadge.style.display = countProgress > 0 ? 'inline-flex' : 'none';
    }
    updateNotificationCount();
}

function setupSidebarNavigation() {
    const links = document.querySelectorAll('.sidebar-link');
    links.forEach(link => {
        link.addEventListener('click', (e) => {
            links.forEach(l => l.classList.remove('active'));
            e.currentTarget.classList.add('active');
            
            if (activeDashboardChatInterval) {
                clearInterval(activeDashboardChatInterval);
                activeDashboardChatInterval = null;
            }
            
            activeTab = e.currentTarget.dataset.tab;
            updateHeaders();
            renderActiveTab();
        });
    });
}

function updateHeaders() {
    const title = document.getElementById('rest-section-title');
    const subtitle = document.getElementById('rest-section-subtitle');
    if (title && subtitle) {
        title.textContent = t(`rest_section_${activeTab}_title`);
        subtitle.textContent = t(`rest_section_${activeTab}_sub`);
    }
}

function renderActiveTab() {
    updateHeaders();
    const container = document.getElementById('rest-tab-container');
    container.replaceChildren();
    
    // Check if store is inactive to display closed banner
    const userJson = localStorage.getItem('qs_vendor_user');
    const u = JSON.parse(userJson || '{}');
    const isStoreClosed = (u.active === 0 || u.active === false);
    
    if (isStoreClosed) {
        const closedBanner = ui.createElementWithText('div', t('rest_closed_banner'), ['store-closed-banner']);
        container.appendChild(closedBanner);
    }
    
    if (activeTab === 'queue') {
        renderQueueTab(container);
    } else if (activeTab === 'progress') {
        renderProgressTab(container);
    } else if (activeTab === 'menu') {
        renderMenuTab(container);
    } else if (activeTab === 'schedule') {
        renderScheduleTab(container);
    } else if (activeTab === 'categories') {
        const render = () => {
            container.replaceChildren();
            if (isStoreClosed) {
                const closedBanner = ui.createElementWithText('div', t('rest_closed_banner'), ['store-closed-banner']);
                container.appendChild(closedBanner);
            }
            renderCategoriesTab(container);
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
            if (isStoreClosed) {
                const closedBanner = ui.createElementWithText('div', t('rest_closed_banner'), ['store-closed-banner']);
                container.appendChild(closedBanner);
            }
            renderDiscountsTab(container);
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
            if (isStoreClosed) {
                const closedBanner = ui.createElementWithText('div', t('rest_closed_banner'), ['store-closed-banner']);
                container.appendChild(closedBanner);
            }
            renderOffersTab(container);
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
    } else if (activeTab === 'branches') {
        const render = () => {
            container.replaceChildren();
            if (isStoreClosed) {
                const closedBanner = ui.createElementWithText('div', t('rest_closed_banner'), ['store-closed-banner']);
                container.appendChild(closedBanner);
            }
            renderBranchesTab(container);
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
    } else if (activeTab === 'profile') {
        const render = () => {
            container.replaceChildren();
            if (isStoreClosed) {
                const closedBanner = ui.createElementWithText('div', t('rest_closed_banner'), ['store-closed-banner']);
                container.appendChild(closedBanner);
            }
            renderProfileTab(container);
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
    } else if (activeTab === 'chats') {
        renderChatsTab(container);
    }
}

/* ==========================================================================
   Tab 1: Live Incoming Orders Queue
   ========================================================================== */
function renderQueueTab(parent) {
    // Show only brand new orders (status=0) and pending payment orders (status=1) that need restaurant action
    const incomingOrders = orders.filter(o => o.status === 'new' || o.status === 'pending_payment');
    
    if (incomingOrders.length === 0) {
        const emptyBlock = ui.createElement('div', ['glass-panel'], { style: 'text-align: center; padding: 4rem 2rem;' });
        emptyBlock.appendChild(ui.createElementWithText('h3', t('rest_queue_empty_title'), [], { style: 'margin-bottom: 0.5rem;' }));
        emptyBlock.appendChild(ui.createElementWithText('p', t('rest_queue_empty_desc'), ['text-secondary']));
        parent.appendChild(emptyBlock);
        return;
    }
    
    incomingOrders.forEach(ord => {
        const card = ui.createElement('div', ['glass-panel'], { style: 'margin-bottom: 1rem;' });
        
        // Header
        const header = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 0.75rem; margin-bottom: 0.75rem;' });
        const orderText = getLanguage() === 'ar' ? `طلب رقم ${ord.id}` : `Order ${ord.id}`;
        header.appendChild(ui.createElementWithText('strong', orderText, [], { style: 'font-size: 1.15rem;' }));
        header.appendChild(ui.createElementWithText('span', t('rest_queue_order_mode'), ['badge', 'badge-info']));
        card.appendChild(header);
        
        // Items list
        const itemsList = ui.createElement('ul', [], { style: 'list-style: none; margin-bottom: 1rem;' });
        ord.items.forEach(it => {
            const li = ui.createElement('li', [], { style: 'padding: 0.25rem 0; font-size: 0.95rem;' });
            li.appendChild(ui.createElementWithText('span', `${it.qty}x `, [], { style: 'font-weight: bold; color: var(--rest-color);' }));
            li.appendChild(document.createTextNode(it.name));
            
            if (it.modifiers && it.modifiers.length > 0) {
                const labelMod = getLanguage() === 'ar' ? ' + الإضافات: ' : ' + Modifiers: ';
                const mods = ui.createElementWithText('div', labelMod + it.modifiers.join(', '), ['text-secondary'], { style: 'font-size: 0.8rem; margin-left: 1.5rem;' });
                li.appendChild(mods);
            }
            itemsList.appendChild(li);
        });
        card.appendChild(itemsList);
        
        // Notes
        if (ord.notes) {
            const noteBox = ui.createElement('div', [], { style: 'background: rgba(255,165,0,0.05); border-left: 3px solid var(--color-pending); padding: 0.5rem; margin-bottom: 1rem; font-size: 0.85rem;' });
            noteBox.appendChild(ui.createElementWithText('strong', t('rest_queue_order_notes')));
            noteBox.appendChild(document.createTextNode(ord.notes));
            card.appendChild(noteBox);
        }
        
        // Total
        const totalLine = ui.createElement('div', [], { style: 'font-size: 1rem; font-weight: 700; margin-bottom: 1rem; border-top: 1px dashed var(--border-color); padding-top: 0.75rem;' });
        totalLine.appendChild(ui.createElementWithText('span', t('rest_queue_order_total'), ['text-secondary'], { style: 'font-weight: normal;' }));
        totalLine.appendChild(ui.createElementWithText('strong', `$${ord.totalPrice.toFixed(2)}`));
        card.appendChild(totalLine);
        
        // Action Buttons
        const actionRow = ui.createElement('div', [], { style: 'display: flex; gap: 0.75rem;' });
        
        const acceptBtn = ui.createElementWithText('button', t('rest_queue_btn_accept'), ['btn', 'btn-success']);
        acceptBtn.addEventListener('click', async () => {
            ui.stopAlarmSound();
            const prepTime = 20;
            const paymentMethod = ord.rawOrder ? ord.rawOrder.paymentMethod : 0;
            const acceptStatus = paymentMethod === 1 ? 'pending_payment' : 'waiting_for_driver';
            
            await updateStatus(ord.id, acceptStatus, { prepTime });
            ui.showToast(getLanguage() === 'ar' ? 'تم قبول الطلب بنجاح!' : 'Order accepted successfully!', 'success');
            
            // Switch directly to Kitchen Kanban / Active Orders tab
            const targetTabBtn = document.getElementById('rest-menu-kanban') || document.getElementById('rest-menu-queue');
            if (targetTabBtn) targetTabBtn.click();
        });
        
        actionRow.appendChild(acceptBtn);
        card.appendChild(actionRow);
        
        parent.appendChild(card);
    });
}

function showAcceptTimeModal(order) {
    const modalBody = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.75rem;' });
    modalBody.appendChild(ui.createElementWithText('p', t('rest_queue_modal_accept_desc', { id: order.id })));
    
    const timeSelect = ui.createElement('select', ['select-input'], { id: 'rest-prep-time' });
    timeSelect.appendChild(ui.createElementWithText('option', getLanguage() === 'ar' ? '15 دقيقة' : '15 minutes', [], { value: '15' }));
    timeSelect.appendChild(ui.createElementWithText('option', getLanguage() === 'ar' ? '20 دقيقة (قياسي)' : '20 minutes (Standard)', [], { value: '20' }));
    timeSelect.appendChild(ui.createElementWithText('option', getLanguage() === 'ar' ? '30 دقيقة' : '30 minutes', [], { value: '30' }));
    timeSelect.appendChild(ui.createElementWithText('option', getLanguage() === 'ar' ? '45 دقيقة (ذروة)' : '45 minutes (Peak)', [], { value: '45' }));
    modalBody.appendChild(timeSelect);
    
    ui.showModal(t('rest_queue_modal_accept_title'), modalBody, [
        {
            text: t('rest_queue_modal_accept_btn'),
            type: 'success',
            onClick: async () => {
                const prepTime = parseInt(document.getElementById('rest-prep-time').value);
                // Cash (paymentMethod=0) → PendingForDelivery(2), Online (paymentMethod=1) → PendingForPayment(1)
                const paymentMethod = order.rawOrder ? order.rawOrder.paymentMethod : 0;
                const acceptStatus = paymentMethod === 1 ? 'pending_payment' : 'waiting_for_driver';
                await updateStatus(order.id, acceptStatus, { prepTime });
                ui.closeModal();
                ui.stopAlarmSound();
            }
        },
        {
            text: t('cancel'),
            type: 'secondary',
            onClick: ui.closeModal
        }
    ]);
}

function showDeclineReasonModal(order) {
    const modalBody = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.75rem;' });
    modalBody.appendChild(ui.createElementWithText('p', t('rest_queue_modal_decline_desc')));
    
    const reasonSelect = ui.createElement('select', ['select-input'], { id: 'rest-decline-reason' });
    reasonSelect.appendChild(ui.createElementWithText('option', t('rest_queue_modal_decline_option_out'), [], { value: 'out_of_stock' }));
    reasonSelect.appendChild(ui.createElementWithText('option', t('rest_queue_modal_decline_option_busy'), [], { value: 'busy' }));
    reasonSelect.appendChild(ui.createElementWithText('option', t('rest_queue_modal_decline_option_closing'), [], { value: 'closing' }));
    modalBody.appendChild(reasonSelect);
    
    ui.showModal(t('rest_queue_modal_decline_title'), modalBody, [
        {
            text: t('rest_queue_modal_decline_btn'),
            type: 'danger',
            onClick: async () => {
                const reason = document.getElementById('rest-decline-reason').value;
                await updateStatus(order.id, 'declined', { declineReason: reason });
                ui.closeModal();
                ui.stopAlarmSound();
            }
        },
        {
            text: t('cancel'),
            type: 'secondary',
            onClick: ui.closeModal
        }
    ]);
}

/* ==========================================================================
   Tab 2: Kitchen Progress Board (Kanban Columns)
   ========================================================================== */
function renderProgressTab(parent) {
    const kanban = ui.createElement('div', ['kanban-board']);
    
    const columns = [
        { title: getLanguage() === 'ar' ? '⏳ بانتظار السائق' : '⏳ Awaiting Driver', status: 'waiting_for_driver' },
        { title: getLanguage() === 'ar' ? '✅ مؤكد - ابدأ التحضير' : '✅ Confirmed - Start Prep', status: 'confirmed' },
        { title: t('rest_progress_col_preparing'), status: 'preparing' },
        { title: t('rest_progress_col_ready'), status: 'ready_for_pickup' },
        { title: t('rest_progress_col_way'), status: 'on_the_way' },
        { title: t('rest_progress_col_completed'), status: 'completed' }
    ];
    
    columns.forEach(col => {
        const colDiv = ui.createElement('div', ['kanban-column']);
        const colOrders = orders.filter(o => o.status === col.status);
        
        // Header
        const header = ui.createElement('div', ['kanban-column-title']);
        header.appendChild(ui.createElementWithText('span', col.title));
        header.appendChild(ui.createElementWithText('span', colOrders.length.toString(), ['sidebar-badge']));
        colDiv.appendChild(header);
        
        const cardList = ui.createElement('div', ['kanban-card-list']);
        
        if (colOrders.length === 0) {
            cardList.appendChild(ui.createElementWithText('div', t('rest_progress_empty_col'), [], { style: 'text-align: center; color: var(--text-muted); font-size: 0.75rem; padding: 2rem 0;' }));
        } else {
            colOrders.forEach(ord => {
                const card = ui.createElement('div', ['kanban-card']);
                
                const cardHeader = ui.createElement('div', ['kanban-card-header']);
                const ordHeader = getLanguage() === 'ar' ? `طلب #${ord.id}` : `Order #${ord.id}`;
                cardHeader.appendChild(ui.createElementWithText('span', ordHeader));
                cardHeader.appendChild(ui.createElementWithText('span', `$${ord.totalPrice.toFixed(2)}`, [], { style: 'color: var(--color-success);' }));
                card.appendChild(cardHeader);
                
                const cardItems = ui.createElement('div', ['kanban-card-items']);
                const itemsText = ord.items.map(i => `${i.qty}x ${i.name}`).join(', ');
                cardItems.appendChild(ui.createElementWithText('p', itemsText.length > 50 ? itemsText.slice(0, 47) + '...' : itemsText));
                card.appendChild(cardItems);
                
                // Footer
                const footer = ui.createElement('div', ['kanban-card-footer']);
                
                if (col.status === 'waiting_for_driver') {
                    // Status=2: Restaurant accepted, waiting for captain to confirm
                    const info = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.25rem; width: 100%;' });
                    info.appendChild(ui.createElementWithText('span', getLanguage() === 'ar' ? '🚗 بانتظار قبول سائق للتوصيل...' : '🚗 Awaiting delivery captain...', [], { style: 'color: var(--color-pending); font-size: 0.78rem; font-style: italic;' }));
                    footer.appendChild(info);
                } else if (col.status === 'confirmed') {
                    // Status=3: Captain confirmed → restaurant can now start preparing
                    const actionBtn = ui.createElementWithText('button', getLanguage() === 'ar' ? '🍳 ابدأ التحضير' : '🍳 Start Preparing', ['btn', 'btn-primary', 'btn-sm'], { style: 'width: 100%; justify-content: center;' });
                    actionBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await updateStatus(ord.id, 'preparing');
                    });
                    footer.appendChild(actionBtn);
                } else if (col.status === 'preparing') {
                    footer.appendChild(ui.createElementWithText('span', t('rest_progress_est', { time: ord.prepTime || 20 }), [], { style: 'color: var(--color-pending); font-weight: bold;' }));
                    
                    const actionBtn = ui.createElementWithText('button', t('rest_progress_btn_ready'), ['btn', 'btn-primary', 'btn-sm']);
                    actionBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await updateStatus(ord.id, 'ready_for_pickup');
                    });
                    footer.appendChild(actionBtn);
                } else if (col.status === 'ready_for_pickup') {
                    const statusInfo = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem; width: 100%;' });
                    statusInfo.appendChild(ui.createElementWithText('span', t('rest_progress_awaiting'), [], { style: 'color: var(--text-muted); font-style: italic; font-size: 0.75rem;' }));
                    footer.appendChild(statusInfo);
                } else if (col.status === 'on_the_way') {
                    const statusInfo = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem; width: 100%;' });
                    statusInfo.appendChild(ui.createElementWithText('span', t('rest_progress_deliver', { name: ord.captainName || (getLanguage() === 'ar' ? 'سائق' : 'Driver') }), [], { style: 'color: var(--color-info); font-size: 0.75rem;' }));
                    footer.appendChild(statusInfo);
                } else if (col.status === 'completed') {
                    footer.appendChild(ui.createElementWithText('span', t('rest_progress_delivered'), [], { style: 'color: var(--color-success); font-weight: bold;' }));
                }
                
                card.appendChild(footer);
                
                card.addEventListener('click', () => {
                    showOrderDetailModal(ord);
                });
                
                cardList.appendChild(card);
            });
        }
        
        colDiv.appendChild(cardList);
        kanban.appendChild(colDiv);
    });
    
    parent.appendChild(kanban);
}

function showOrderDetailModal(order) {
    const modalBody = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.75rem;' });
    let statusText = order.status;
    if (order.status === 'preparing') statusText = t('rest_progress_col_preparing');
    else if (order.status === 'ready_for_pickup') statusText = t('rest_progress_col_ready');
    else if (order.status === 'on_the_way') statusText = t('rest_progress_col_way');
    else if (order.status === 'completed') statusText = t('rest_progress_col_completed');
    
    modalBody.appendChild(ui.createElementWithText('h4', t('rest_progress_modal_status', { status: statusText }), [], { style: 'color: var(--color-info);' }));
    
    const customerBlock = ui.createElement('div', [], { style: 'border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center;' });
    const customerInfo = ui.createElement('div');
    customerInfo.appendChild(ui.createElementWithText('strong', t('rest_progress_modal_cust_title')));
    customerInfo.appendChild(ui.createElementWithText('div', t('rest_progress_modal_cust_name', { name: order.customerName })));
    customerInfo.appendChild(ui.createElementWithText('div', t('rest_progress_modal_cust_phone', { phone: ui.maskPII(order.customerPhone, 'phone') })));
    customerBlock.appendChild(customerInfo);

    const chatCustBtn = ui.createElementWithText('button', getLanguage() === 'ar' ? '💬 دردشة' : '💬 Chat', ['btn', 'btn-primary', 'btn-sm']);
    chatCustBtn.addEventListener('click', () => openDashboardChat(order.customerId || order.userId, order.customerName));
    customerBlock.appendChild(chatCustBtn);
    modalBody.appendChild(customerBlock);
    
    if (order.captainName) {
        const driverBlock = ui.createElement('div', [], { style: 'border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center;' });
        const driverInfo = ui.createElement('div');
        driverInfo.appendChild(ui.createElementWithText('strong', t('rest_progress_modal_driver_title')));
        driverInfo.appendChild(ui.createElementWithText('div', t('rest_progress_modal_driver_name', { name: order.captainName })));
        const distText = getLanguage() === 'ar' ? 'المسافة إلى المطبخ: ~1.2 كم' : 'Distance to kitchen: ~1.2 km away';
        driverInfo.appendChild(ui.createElementWithText('div', distText));
        driverBlock.appendChild(driverInfo);

        const chatDriverBtn = ui.createElementWithText('button', getLanguage() === 'ar' ? '💬 دردشة' : '💬 Chat', ['btn', 'btn-primary', 'btn-sm']);
        chatDriverBtn.addEventListener('click', () => openDashboardChat(order.captainId || order.updatorId, order.captainName));
        driverBlock.appendChild(chatDriverBtn);
        modalBody.appendChild(driverBlock);
    }
    
    const itemsBlock = ui.createElement('div');
    itemsBlock.appendChild(ui.createElementWithText('strong', t('rest_progress_modal_items_title')));
    order.items.forEach(i => {
        itemsBlock.appendChild(ui.createElementWithText('div', `• ${i.qty}x ${i.name} ($${(i.qty * i.price).toFixed(2)})`));
    });
    modalBody.appendChild(itemsBlock);

    const printBtn = ui.createElementWithText('button', getLanguage() === 'ar' ? '🖨️ طباعة الفاتورة' : '🖨️ Print Receipt', ['btn', 'btn-primary'], {
        style: 'margin-top: 1rem; width: 100%; font-weight: 700;'
    });
    printBtn.addEventListener('click', () => ui.printOrderReceipt(order));
    modalBody.appendChild(printBtn);
    
    const labelHeader = getLanguage() === 'ar' ? `تفاصيل طلب ${order.id}` : `Order ${order.id} Breakdown`;
    ui.showModal(labelHeader, modalBody);
}

/* ==========================================================================
   Tab 3: Menu Customizer
   ========================================================================== */
function renderMenuTab(parent) {
    // 1. Create a toolbar wrapper
    const toolbar = ui.createElement('div', ['filter-bar'], { style: 'margin-bottom: 1.5rem; display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; width: 100%;' });

    const searchInput = ui.createElement('input', ['search-input'], {
        id: 'rest-menu-search',
        placeholder: t('rest_menu_search_placeholder'),
        type: 'text'
    });

    const catFilter = ui.createElement('select', ['select-input'], { id: 'rest-menu-cat-filter' });
    catFilter.appendChild(ui.createElementWithText('option', t('rest_menu_cat_all'), [], { value: 'all' }));
    if (categories.length === 0) {
        const nocat = ui.createElementWithText('option',
            getLanguage() === 'ar' ? '— أضف أقساماً من تبويب الأقسام أولاً —' : '— Add categories from the Categories tab first —',
            [], { value: '', disabled: 'disabled' });
        catFilter.appendChild(nocat);
    } else {
        categories.forEach(c => {
            catFilter.appendChild(ui.createElementWithText('option', c.name, [], { value: c.name }));
        });
    }

    const addBtn = ui.createElementWithText('button', t('rest_menu_btn_add'), ['btn', 'btn-success']);
    addBtn.addEventListener('click', showAddRestaurantMenuModal);

    toolbar.appendChild(searchInput);
    toolbar.appendChild(catFilter);
    toolbar.appendChild(addBtn);
    parent.appendChild(toolbar);

    // 2. Grid container
    const grid = ui.createElement('div', ['analytics-grid']);
    parent.appendChild(grid);

    // 3. Filter binding
    const runFilter = () => {
        grid.replaceChildren();
        const query = searchInput.value.toLowerCase();
        const selectedCat = catFilter.value;

        const filtered = restaurantMenu.filter(item => {
            const matchesQuery = item.name.toLowerCase().includes(query) || 
                                 (item.description && item.description.toLowerCase().includes(query));
            const matchesCat = selectedCat === 'all' || item.category === selectedCat;
            return matchesQuery && matchesCat;
        });

        if (filtered.length === 0) {
            grid.appendChild(ui.createElementWithText('p', getLanguage() === 'ar' ? 'لا توجد وجبات مطابقة للبحث.' : 'No menu items match your query.', [], {
                style: 'text-align: center; padding: 2rem; color: var(--text-muted); grid-column: 1 / -1;'
            }));
            return;
        }

        filtered.forEach(item => {
            const card = ui.createElement('div', ['summary-card'], { style: item.isOutOfStock ? 'opacity: 0.65;' : '' });
            
            // Item Image Rendering
            if (item.image) {
                const img = ui.createElement('img', [], {
                    src: getImageUrl(item.image),
                    style: 'width: 100%; height: 100px; object-fit: cover; border-radius: 6px; margin-bottom: 1rem; border: 1px solid var(--border-color);'
                });
                card.appendChild(img);
            } else {
                const imgMock = ui.createElement('div', [], { style: 'height: 100px; background: linear-gradient(135deg, #e74c3c, #f39c12); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 2rem; margin-bottom: 1rem;' });
                imgMock.textContent = item.category === 'Burgers' ? '🍔' : (item.category === 'Sides' ? '🍟' : '🥤');
                card.appendChild(imgMock);
            }
            
            card.appendChild(ui.createElementWithText('strong', item.name, [], { style: 'font-size: 1.05rem; display: block; margin-bottom: 0.25rem;' }));
            card.appendChild(ui.createElementWithText('div', `$${item.price.toFixed(2)}`, [], { style: 'font-weight: 800; color: var(--color-success); margin-bottom: 0.5rem;' }));
            card.appendChild(ui.createElementWithText('p', item.description || '', ['text-muted'], { style: 'font-size: 0.8rem; margin-bottom: 0.75rem; line-height: 1.4;' }));
            
            // Actions
            const actions = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-color); padding-top: 0.75rem; margin-top: 0.75rem;' });
            
            // Out of stock switch
            const switchLabel = ui.createElement('label', ['switch-container']);
            const switchInput = ui.createElement('input', ['switch-input'], {
                type: 'checkbox',
                checked: !item.isOutOfStock ? 'checked' : ''
            });
            switchInput.addEventListener('change', async (e) => {
                const isChecked = e.target.checked;
                try {
                    const matchedCategory = categories.find(c => c.name === item.category);
                    const categoryId = matchedCategory ? matchedCategory.id : 3;
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
                            type: 0,
                            categoryId: categoryId,
                            discountIds: []
                        })
                    });
                    item.isOutOfStock = !isChecked;
                    renderActiveTab();
                } catch (err) {
                    console.error('Failed to toggle product availability:', err);
                    ui.showToast(t('error_generic') + ': ' + err.message, 'error');
                    e.target.checked = !isChecked; // revert
                }
            });
            const slider = ui.createElement('span', ['switch-slider']);
            switchLabel.appendChild(switchInput);
            switchLabel.appendChild(slider);
            switchLabel.appendChild(ui.createElementWithText('span', !item.isOutOfStock ? t('rest_menu_in_stock') : t('rest_menu_stock_out'), [], { style: 'font-size: 0.75rem;' }));
            
            const editBtn = ui.createElementWithText('button', t('rest_menu_btn_edit'), ['btn', 'btn-secondary', 'btn-sm']);
            editBtn.addEventListener('click', () => showEditItemModal(item));
            
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

function showEditItemModal(item) {
    const modalBody = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.75rem;' });
    
    modalBody.appendChild(ui.createElementWithText('label', t('rest_menu_modal_name'), [], { style: 'font-size: 0.85rem;' }));
    const nameIn = ui.createElement('input', ['search-input'], { value: item.name, type: 'text', style: 'width: 100%' });
    modalBody.appendChild(nameIn);
    
    modalBody.appendChild(ui.createElementWithText('label', t('rest_menu_modal_price'), [], { style: 'font-size: 0.85rem;' }));
    const priceIn = ui.createElement('input', ['search-input'], { value: item.price, type: 'number', style: 'width: 100%' });
    modalBody.appendChild(priceIn);
    
    modalBody.appendChild(ui.createElementWithText('label', t('rest_menu_modal_desc'), [], { style: 'font-size: 0.85rem;' }));
    const descIn = ui.createElement('input', ['search-input'], { value: item.description || '', type: 'text', style: 'width: 100%' });
    modalBody.appendChild(descIn);

    // Quantity Input
    const currentQty = item.rawProduct && item.rawProduct.quantity !== undefined ? item.rawProduct.quantity : 999;
    modalBody.appendChild(ui.createElementWithText('label', t('rest_add_modal_quantity'), [], { style: 'font-size: 0.85rem;' }));
    const qtyIn = ui.createElement('input', ['search-input'], { value: currentQty, type: 'number', style: 'width: 100%', min: '0', step: '1' });
    modalBody.appendChild(qtyIn);

    // Discount Dropdown Selector
    let activeDiscountId = '';
    if (item.rawProduct) {
        if (item.rawProduct.discountIds && item.rawProduct.discountIds.length > 0) {
            activeDiscountId = item.rawProduct.discountIds[0].toString();
        } else if (item.rawProduct.discountPercentage) {
            const matched = discounts.find(d => d.percentage === item.rawProduct.discountPercentage);
            if (matched) activeDiscountId = matched.id.toString();
        }
    }

    modalBody.appendChild(ui.createElementWithText('label', t('rest_add_modal_discount'), [], { style: 'font-size: 0.85rem;' }));
    const discountSel = ui.createElement('select', ['select-input'], { style: 'width: 100%' });
    discountSel.appendChild(ui.createElementWithText('option', t('rest_add_modal_no_discount'), [], { value: '' }));
    discounts.forEach(d => {
        const option = ui.createElementWithText('option', `${d.name} (${d.percentage}%)`, [], { value: d.id.toString() });
        if (d.id.toString() === activeDiscountId) {
            option.selected = true;
        }
        discountSel.appendChild(option);
    });
    modalBody.appendChild(discountSel);

    // Edit Category Dropdown
    modalBody.appendChild(ui.createElementWithText('label', t('rest_add_modal_category'), [], { style: 'font-size: 0.85rem;' }));
    const catSel = ui.createElement('select', ['select-input'], { style: 'width: 100%' });
    if (categories.length === 0) {
        catSel.appendChild(ui.createElementWithText('option', t('rest_menu_cat_burgers'), [], { value: 'Burgers' }));
        catSel.appendChild(ui.createElementWithText('option', t('rest_menu_cat_sides'), [], { value: 'Sides' }));
        catSel.appendChild(ui.createElementWithText('option', t('rest_menu_cat_beverages'), [], { value: 'Beverages' }));
    } else {
        categories.forEach(c => {
            catSel.appendChild(ui.createElementWithText('option', c.name, [], { value: c.name }));
        });
    }
    catSel.value = item.category || 'Burgers';
    modalBody.appendChild(catSel);

    // Edit Image Row
    modalBody.appendChild(ui.createElementWithText('label', t('rest_add_modal_image'), [], { style: 'font-size: 0.85rem;' }));
    const imgRow = ui.createElement('div', [], { style: 'display: flex; gap: 1rem; align-items: center;' });
    const imgInput = ui.createElement('input', [], { type: 'file', accept: 'image/*', style: 'display: none;' });
    const uploadImgBtn = ui.createElementWithText('button', getLanguage() === 'ar' ? 'اختر صورة' : 'Choose Image', ['btn', 'btn-secondary']);
    uploadImgBtn.addEventListener('click', () => imgInput.click());
    
    const previewImg = ui.createElement('img', [], {
        src: getImageUrl(item.image || ''),
        style: 'width: 50px; height: 50px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); object-fit: cover;'
    });
    if (!item.image) {
        previewImg.style.display = 'none';
    }
    
    let uploadedPhotoKey = item.image || '';
    imgInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            // Local preview
            previewImg.src = URL.createObjectURL(file);
            previewImg.style.display = 'block';
            try {
                const result = await uploadImage(file);
                if (result) {
                    uploadedPhotoKey = result;
                    previewImg.src = getImageUrl(uploadedPhotoKey);
                }
            } catch (err) {
                console.error('Failed to upload image:', err);
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
                const newPhoto = uploadedPhotoKey;
                const selectedCatName = catSel.value;
                const matchedCategory = categories.find(c => c.name === selectedCatName);
                const categoryId = matchedCategory ? matchedCategory.id : 3;

                // Optimistic local update
                const originalMenu = [...restaurantMenu];
                const index = restaurantMenu.findIndex(p => p.id === item.id);
                if (index !== -1) {
                    restaurantMenu[index] = {
                        ...restaurantMenu[index],
                        name: newName,
                        price: newPrice,
                        category: selectedCatName,
                        description: newDescText,
                        image: newPhoto,
                        modifiers: [],
                        isOutOfStock: quantity === 0,
                        rawProduct: {
                            ...restaurantMenu[index].rawProduct,
                            quantity: quantity,
                            discountIds: discountSel.value ? [parseInt(discountSel.value)] : []
                        }
                    };
                    renderActiveTab();
                }
                ui.closeModal();

                try {
                    await apiFetch('/api/v1/products', {
                        method: 'PUT',
                        body: JSON.stringify({
                            id: parseInt(item.id),
                            name: newName,
                            photo: newPhoto,
                            description: newDescText,
                            quantity: quantity,
                            limit: false,
                            price: newPrice,
                            size: null,
                            type: 0,
                            categoryId: categoryId,
                            creatorId: item.rawProduct ? item.rawProduct.creatorId : (myRestaurantId || 0),
                            discountIds: discountSel.value ? [parseInt(discountSel.value)] : []
                        })
                    });
                    ui.showToast(getLanguage() === 'ar' ? 'تم تحديث المنتج بنجاح' : 'Product updated successfully', 'success');
                    await refreshMenu();
                    if (activeTab === 'menu') renderActiveTab();
                } catch (err) {
                    console.error('Failed to update product:', err);
                    restaurantMenu = originalMenu;
                    renderActiveTab();
                    ui.showToast((getLanguage() === 'ar' ? 'فشل تحديث المنتج: ' : 'Failed to update product: ') + err.message, 'error');
                }
            }
        },
        {
            text: getLanguage() === 'ar' ? '🗑️ حذف الطبق' : '🗑️ Delete Dish',
            type: 'danger',
            onClick: async () => {
                if (confirm(getLanguage() === 'ar' ? 'هل أنت متأكد من حذف هذا الطبق؟' : 'Are you sure you want to delete this dish?')) {
                    const originalMenu = [...restaurantMenu];
                    restaurantMenu = restaurantMenu.filter(p => p.id !== item.id);
                    renderActiveTab();
                    ui.closeModal();

                    try {
                        await apiFetch(`/api/v1/products/${item.id}`, {
                            method: 'DELETE'
                        });
                        ui.showToast(getLanguage() === 'ar' ? 'تم حذف المنتج بنجاح' : 'Product deleted successfully', 'success');
                        await refreshMenu();
                        if (activeTab === 'menu') renderActiveTab();
                    } catch (err) {
                        console.error('Failed to delete product:', err);
                        restaurantMenu = originalMenu;
                        renderActiveTab();
                        ui.showToast((getLanguage() === 'ar' ? 'فشل حذف المنتج: ' : 'Failed to delete product: ') + err.message, 'error');
                    }
                }
            }
        },
        {
            text: t('cancel'),
            type: 'secondary',
            onClick: ui.closeModal
        }
    ]);
}

function showAddRestaurantMenuModal() {
    const form = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; min-width: 320px; max-width: 500px;' });

    // 1. Name & Category
    const nameWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    nameWrap.appendChild(ui.createElementWithText('label', t('rest_add_modal_name'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const nameIn = ui.createElement('input', ['search-input'], { type: 'text', placeholder: 'e.g. Double Cheese Burger' });
    nameWrap.appendChild(nameIn);

    const catWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    catWrap.appendChild(ui.createElementWithText('label', t('rest_add_modal_category'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const catSel = ui.createElement('select', ['select-input']);
    if (categories.length === 0) {
        catSel.appendChild(ui.createElementWithText('option', t('rest_menu_cat_burgers'), [], { value: 'Burgers' }));
        catSel.appendChild(ui.createElementWithText('option', t('rest_menu_cat_sides'), [], { value: 'Sides' }));
        catSel.appendChild(ui.createElementWithText('option', t('rest_menu_cat_beverages'), [], { value: 'Beverages' }));
    } else {
        categories.forEach(c => {
            catSel.appendChild(ui.createElementWithText('option', c.name, [], { value: c.name }));
        });
    }
    catWrap.appendChild(catSel);

    const row1 = ui.createElement('div', [], { style: 'display: grid; grid-template-columns: 2fr 1fr; gap: 1rem;' });
    row1.appendChild(nameWrap);
    row1.appendChild(catWrap);

    // 2. Description
    const descWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    descWrap.appendChild(ui.createElementWithText('label', t('rest_add_modal_desc'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const descIn = ui.createElement('textarea', ['search-input'], {
        style: 'min-height: 60px; font-family: inherit; resize: vertical;',
        placeholder: 'e.g. Juicy double beef patty with melted cheddar...'
    });
    descWrap.appendChild(descIn);

    // 3. Price & Quantity (row2)
    const priceWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    priceWrap.appendChild(ui.createElementWithText('label', t('rest_add_modal_price'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const priceIn = ui.createElement('input', ['search-input'], { type: 'number', step: '0.01', min: '0', value: '10.00' });
    priceWrap.appendChild(priceIn);

    const qtyWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    qtyWrap.appendChild(ui.createElementWithText('label', t('rest_add_modal_quantity'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const qtyIn = ui.createElement('input', ['search-input'], { type: 'number', min: '0', step: '1', value: '999' });
    qtyWrap.appendChild(qtyIn);

    const row2 = ui.createElement('div', [], { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;' });
    row2.appendChild(priceWrap);
    row2.appendChild(qtyWrap);

    // 3.5 Discount Dropdown Selector
    const discountWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    discountWrap.appendChild(ui.createElementWithText('label', t('rest_add_modal_discount'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const discountSel = ui.createElement('select', ['select-input']);
    discountSel.appendChild(ui.createElementWithText('option', t('rest_add_modal_no_discount'), [], { value: '' }));
    discounts.forEach(d => {
        discountSel.appendChild(ui.createElementWithText('option', `${d.name} (${d.percentage}%)`, [], { value: d.id.toString() }));
    });
    discountWrap.appendChild(discountSel);

    // Image upload row
    const imgWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    imgWrap.appendChild(ui.createElementWithText('label', t('rest_add_modal_image'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    
    const imgRow = ui.createElement('div', [], { style: 'display: flex; gap: 1rem; align-items: center;' });
    const imgInput = ui.createElement('input', [], { type: 'file', accept: 'image/*', style: 'display: none;' });
    const uploadImgBtn = ui.createElementWithText('button', getLanguage() === 'ar' ? 'اختر صورة' : 'Choose Image', ['btn', 'btn-secondary']);
    uploadImgBtn.addEventListener('click', () => imgInput.click());
    
    const previewImg = ui.createElement('img', [], {
        style: 'width: 50px; height: 50px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); object-fit: cover; display: none;'
    });
    
    let uploadedPhotoKey = '';
    imgInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            previewImg.src = URL.createObjectURL(file);
            previewImg.style.display = 'block';
            try {
                const result = await uploadImage(file);
                if (result) {
                    uploadedPhotoKey = result;
                    previewImg.src = getImageUrl(uploadedPhotoKey);
                }
            } catch (err) {
                console.error('Failed to upload image:', err);
                ui.showToast(getLanguage() === 'ar' ? 'فشل رفع الصورة' : 'Failed to upload image', 'error');
            }
        }
    });
    imgRow.appendChild(uploadImgBtn);
    imgRow.appendChild(imgInput);
    imgRow.appendChild(previewImg);
    imgWrap.appendChild(imgRow);
    const imgHint = ui.createElementWithText('span', getLanguage() === 'ar' ? 'الأبعاد الموصى بها: 600 × 600 بكسل (نسبة 1:1)' : 'Recommended dimensions: 600 × 600 px (1:1)', [], { style: 'font-size: 0.75rem; color: var(--text-muted); display: block; margin-top: 0.25rem;' });
    imgWrap.appendChild(imgHint);

    // Availability switch
    const availLabel = ui.createElement('label', ['switch-container'], { style: 'margin-top: 0.5rem;' });
    const availInput = ui.createElement('input', ['switch-input'], { type: 'checkbox', checked: 'true' });
    const availSlider = ui.createElement('div', ['switch-slider']);
    availLabel.appendChild(availInput);
    availLabel.appendChild(availSlider);
    availLabel.appendChild(ui.createElementWithText('span', t('rest_add_modal_available'), [], { style: 'font-size: 0.85rem;' }));

    // Toggle Quantity field status based on availability switch
    availInput.addEventListener('change', (e) => {
        qtyIn.disabled = !e.target.checked;
        if (!e.target.checked) {
            qtyIn.value = '0';
        } else if (qtyIn.value === '0') {
            qtyIn.value = '999';
        }
    });

    // Assemble form
    form.appendChild(row1);
    form.appendChild(descWrap);
    form.appendChild(row2);
    form.appendChild(discountWrap);
    form.appendChild(imgWrap);
    form.appendChild(availLabel);

    ui.showModal(t('rest_add_modal_title'), form, [
        {
            text: t('rest_add_modal_save_btn'),
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
                const matchedCategory = categories.find(c => c.name === selectedCatName);
                const categoryId = matchedCategory ? matchedCategory.id : 3;

                // Optimistic local update
                const newProductObj = {
                    id: 'temp-' + Date.now(),
                    name: name,
                    price: price,
                    category: selectedCatName,
                    description: description,
                    isOutOfStock: !availInput.checked || quantity === 0,
                    image: uploadedPhotoKey,
                    modifiers: [],
                    rawProduct: {
                        quantity: quantity,
                        discountIds: discountSel.value ? [parseInt(discountSel.value)] : []
                    }
                };
                restaurantMenu.push(newProductObj);
                renderActiveTab();
                ui.closeModal();

                try {
                    await apiFetch('/api/v1/products', {
                        method: 'POST',
                        body: JSON.stringify({
                            id: 0,
                            name: name,
                            photo: uploadedPhotoKey,
                            description: description,
                            quantity: quantity,
                            limit: false,
                            price: price,
                            size: null,
                            type: 0,
                            categoryId: categoryId,
                            creatorId: myRestaurantId || 0,
                            discountIds: discountSel.value ? [parseInt(discountSel.value)] : []
                        })
                    });
                    ui.showToast(getLanguage() === 'ar' ? 'تمت إضافة المنتج بنجاح' : 'Product added successfully', 'success');
                    await refreshMenu();
                    if (activeTab === 'menu') renderActiveTab();
                } catch (err) {
                    console.error('Failed to create product:', err);
                    restaurantMenu = restaurantMenu.filter(p => p.id !== newProductObj.id);
                    renderActiveTab();
                    ui.showToast((getLanguage() === 'ar' ? 'فشل إضافة المنتج: ' : 'Failed to add product: ') + err.message, 'error');
                }
            }
        },
        {
            text: t('cancel'),
            type: 'secondary',
            onClick: ui.closeModal
        }
    ]);
}

/* ==========================================================================
   Tab 4: Operations Weekly Scheduler
   ========================================================================== */
function renderScheduleTab(parent) {
    // Re-read from localStorage each time so values are never stale
    const getUserSettings = () => {
        const userJson = localStorage.getItem('qs_vendor_user');
        const u = JSON.parse(userJson || '{}');
        return parseUserDescription(u.description);
    };
    let settings = getUserSettings();

    const panel = ui.createElement('div', ['glass-panel']);
    panel.appendChild(ui.createElementWithText('h3', t('rest_sched_closure_title'), [], { style: 'font-size: 1.1rem; margin-bottom: 0.5rem; color: var(--color-danger);' }));
    panel.appendChild(ui.createElementWithText('p', t('rest_sched_closure_desc'), ['text-secondary'], { style: 'font-size: 0.85rem; margin-bottom: 1rem;' }));
    
    // Toggle closure row — uses toggle-activity API
    const userJsonNow = localStorage.getItem('qs_vendor_user');
    const uNow = JSON.parse(userJsonNow || '{}');
    const isCurrentlyClosed = (uNow.active === 0 || uNow.active === false);

    const container = ui.createElement('div', [], { style: 'padding: 1.5rem; background: rgba(255, 71, 87, 0.05); border: 1px solid rgba(255, 71, 87, 0.15); border-radius: 6px; margin-bottom: 2rem;' });
    const switchLabel = ui.createElement('label', ['switch-container']);
    const switchInput = ui.createElement('input', ['switch-input', 'switch-danger'], {
        type: 'checkbox',
        checked: isCurrentlyClosed ? 'checked' : ''
    });
    
    switchInput.addEventListener('change', async (e) => {
        switchInput.disabled = true;
        try {
            await toggleActivityStatus();
            const updatedUser = JSON.parse(localStorage.getItem('qs_vendor_user') || '{}');
            const nowClosed = (updatedUser.active === 0 || updatedUser.active === false);
            switchLabel.querySelector('span:last-child').textContent = nowClosed ? t('rest_sched_closure_on') : t('rest_sched_closure_off');
            renderActiveTab();
        } catch (err) {
            console.error('Failed to toggle activity status:', err);
            ui.showToast(t('error_generic') + ': ' + err.message, 'error');
            e.target.checked = !e.target.checked; // revert
        } finally {
            switchInput.disabled = false;
        }
    });
    
    const slider = ui.createElement('span', ['switch-slider']);
    switchLabel.appendChild(switchInput);
    switchLabel.appendChild(slider);
    switchLabel.appendChild(ui.createElementWithText('span', isCurrentlyClosed ? t('rest_sched_closure_on') : t('rest_sched_closure_off'), [], { style: 'font-weight: bold;' }));
    container.appendChild(switchLabel);
    panel.appendChild(container);
    
    // Weekly Schedule Selector
    panel.appendChild(ui.createElementWithText('h3', t('rest_sched_hours_title'), [], { style: 'font-size: 1.1rem; margin-bottom: 1rem;' }));
    
    const schedBlock = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; max-width: 450px;' });
    
    const selectDays = ui.createElement('select', ['select-input']);
    selectDays.appendChild(ui.createElementWithText('option', t('rest_sched_hours_days_opt_standard'), [], { value: 'Sat - Thu' }));
    selectDays.appendChild(ui.createElementWithText('option', t('rest_sched_hours_days_opt_everyday'), [], { value: 'Everyday' }));
    selectDays.value = settings.days;
    
    const inputHours = ui.createElement('input', ['search-input'], {
        type: 'text',
        value: settings.hours,
        placeholder: 'e.g. 12:00 PM - 11:30 PM'
    });
    
    schedBlock.appendChild(ui.createElementWithText('label', t('rest_sched_hours_days_label'), [], { style: 'font-size: 0.85rem;' }));
    schedBlock.appendChild(selectDays);
    schedBlock.appendChild(ui.createElementWithText('label', t('rest_sched_hours_window_label'), [], { style: 'font-size: 0.85rem;' }));
    schedBlock.appendChild(inputHours);
    
    const saveSchedBtn = ui.createElementWithText('button', t('rest_sched_hours_btn'), ['btn', 'btn-primary'], { style: 'align-self: flex-start; margin-top: 0.5rem;' });
    saveSchedBtn.addEventListener('click', async () => {
        // Read fresh settings at save time, overwrite only days/hours
        const fresh = getUserSettings();
        try {
            await updateUserSettings(fresh.isClosed, selectDays.value, inputHours.value, fresh.description);
            settings = getUserSettings();
            const success = ui.createElementWithText('span', t('rest_sched_hours_saved'), [], { style: 'color: var(--color-success); font-size: 0.85rem; margin-left: 1rem;' });
            schedBlock.appendChild(success);
            setTimeout(() => success.remove(), 2000);
        } catch (err) {
            console.error('Failed to update schedule hours:', err);
            ui.showToast(t('error_generic') + ': ' + err.message, 'error');
        }
    });
    schedBlock.appendChild(saveSchedBtn);
    
    panel.appendChild(schedBlock);
    parent.appendChild(panel);
}

/* ==========================================================================
   Tab 5: Manage Categories
   ========================================================================== */
function renderCategoriesTab(parent) {
    const wrapper = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; width: 100%;' });

    // Top Bar with Add Category Button
    const topBar = ui.createElement('div', [], { style: 'display: flex; justify-content: flex-end;' });
    const addCatBtn = ui.createElementWithText('button', t('rest_cat_add_btn'), ['btn', 'btn-primary']);
    addCatBtn.addEventListener('click', () => showAddCategoryModal());
    topBar.appendChild(addCatBtn);
    wrapper.appendChild(topBar);

    // Card Grid Container
    const grid = ui.createElement('div', ['analytics-grid'], { style: 'margin-top: 1rem; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1.5rem; width: 100%;' });

    if (categories.length === 0) {
        const emptyState = ui.createElement('div', ['glass-panel'], { style: 'text-align: center; padding: 3rem 1.5rem; width: 100%; grid-column: 1 / -1;' });
        emptyState.appendChild(ui.createElementWithText('h3', getLanguage() === 'ar' ? '📂 لا توجد أقسام' : '📂 No Categories', [], { style: 'margin-bottom: 0.5rem; font-size: 1.25rem;' }));
        emptyState.appendChild(ui.createElementWithText('p', getLanguage() === 'ar' ? 'أضف قسمًا جديدًا لتنظيم قائمة طعامك.' : 'Add a new category to organize your menu.', ['text-secondary'], { style: 'font-size: 0.85rem;' }));
        grid.appendChild(emptyState);
    } else {
        // Category emoji map for visual flair
        const catEmojis = ['🍔', '🍕', '🌮', '🍜', '🥗', '🍣', '🥩', '🍰', '🥤', '🍟', '🌯', '🥪'];

        categories.forEach((cat, idx) => {
            const count = restaurantMenu.filter(p => p.category === cat.name).length;
            const emoji = catEmojis[idx % catEmojis.length];

            const card = ui.createElement('div', ['summary-card'], { style: 'display: flex; flex-direction: column; justify-content: space-between; min-height: 200px; position: relative; overflow: hidden;' });

            // Decorative background accent
            const accent = ui.createElement('div', [], { style: 'position: absolute; top: -20px; right: -20px; width: 90px; height: 90px; border-radius: 50%; background: var(--rest-color, #e74c3c); opacity: 0.08; pointer-events: none;' });
            card.appendChild(accent);

            // Emoji or Photo Icon
            const iconWrap = ui.createElement('div', [], { style: 'margin-bottom: 0.5rem; line-height: 1;' });
            if (cat.photo) {
                const img = ui.createElement('img', [], {
                    src: getImageUrl(cat.photo),
                    style: 'width: 50px; height: 50px; object-fit: cover; border-radius: 8px; border: 1px solid var(--border-color);'
                });
                iconWrap.appendChild(img);
            } else {
                iconWrap.style.fontSize = '2rem';
                iconWrap.textContent = emoji;
            }
            card.appendChild(iconWrap);

            // Category Name
            card.appendChild(ui.createElementWithText('strong', cat.name, [], { style: 'font-size: 1.1rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.25rem; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;' }));

            // Description
            card.appendChild(ui.createElementWithText('p', cat.description || (getLanguage() === 'ar' ? 'بدون وصف' : 'No description'), ['text-secondary'], { style: 'font-size: 0.8rem; flex-grow: 1; margin: 0.25rem 0 0.75rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;' }));

            // Product count badge
            const countBadge = ui.createElement('div', [], { style: 'display: inline-flex; align-items: center; gap: 0.35rem; background: rgba(var(--rest-rgb, 231, 76, 60), 0.1); border: 1px solid rgba(var(--rest-rgb, 231, 76, 60), 0.2); border-radius: 20px; padding: 0.2rem 0.65rem; font-size: 0.78rem; font-weight: 600; color: var(--rest-color, #e74c3c); margin-bottom: 1rem; width: fit-content;' });
            countBadge.textContent = `🍽️ ${count} ${getLanguage() === 'ar' ? (count === 1 ? 'منتج' : 'منتجات') : (count === 1 ? 'item' : 'items')}`;
            card.appendChild(countBadge);

            // Footer Actions
            const footer = ui.createElement('div', [], { style: 'display: flex; gap: 0.5rem; border-top: 1px solid var(--border-color); padding-top: 0.75rem; margin-top: auto;' });

            const editBtn = ui.createElementWithText('button', getLanguage() === 'ar' ? '✏️ تعديل' : '✏️ Edit', ['btn', 'btn-secondary', 'btn-sm'], { style: 'flex: 1; justify-content: center;' });
            editBtn.addEventListener('click', () => showEditCategoryModal(cat));

            const deleteBtn = ui.createElementWithText('button', '🗑️', ['btn', 'btn-danger', 'btn-sm']);
            deleteBtn.addEventListener('click', () => handleDeleteCategory(cat));

            footer.appendChild(editBtn);
            footer.appendChild(deleteBtn);
            card.appendChild(footer);

            grid.appendChild(card);
        });
    }

    wrapper.appendChild(grid);
    parent.appendChild(wrapper);
}

function showAddCategoryModal() {
    const form = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; min-width: 320px;' });
    
    const nameWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    nameWrap.appendChild(ui.createElementWithText('label', t('rest_cat_modal_name'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const nameIn = ui.createElement('input', ['search-input'], { type: 'text', placeholder: getLanguage() === 'ar' ? 'مثال: وجبات رئيسية' : 'e.g. Main Dishes' });
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
                const newCat = {
                    id: tempId,
                    name,
                    description,
                    photo: uploadedPhotoKey,
                    type: 0
                };
                categories.push(newCat);
                ui.closeModal();
                renderActiveTab();
                
                try {
                    const response = await apiFetch('/api/v1/categories', {
                        method: 'POST',
                        body: JSON.stringify({
                            name,
                            description,
                            photo: uploadedPhotoKey,
                            type: 0 // Restaurant
                        })
                    });
                    ui.showToast(getLanguage() === 'ar' ? 'تمت إضافة القسم بنجاح' : 'Category created successfully', 'success');
                    
                    const idx = categories.findIndex(c => c.id === tempId);
                    if (idx !== -1 && response.result?.id) {
                        categories[idx].id = response.result.id;
                    }
                    
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
        {
            text: t('cancel'),
            type: 'secondary',
            onClick: ui.closeModal
        }
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
                restaurantMenu.forEach(p => {
                    if (p.category === oldName) {
                        p.category = name;
                    }
                });
                
                cat.name = name;
                cat.description = description;
                cat.photo = uploadedPhotoKey;
                
                ui.closeModal();
                renderActiveTab();
                
                try {
                    await apiFetch('/api/v1/categories', {
                        method: 'PUT',
                        body: JSON.stringify({
                            id: cat.id,
                            name,
                            photo: uploadedPhotoKey,
                            description,
                            type: 0 // Restaurant
                        })
                    });
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
        {
            text: t('cancel'),
            type: 'secondary',
            onClick: ui.closeModal
        }
    ]);
}

async function handleDeleteCategory(cat) {
    const confirmMsg = getLanguage() === 'ar' 
        ? `هل أنت متأكد من حذف قسم "${cat.name}"؟ سيتم نقل المنتجات المرتبطة به ليكون بدون قسم.`
        : `Are you sure you want to delete category "${cat.name}"? Products inside will remain category-less.`;
        
    if (confirm(confirmMsg)) {
        const originalMenu = [...restaurantMenu];
        const originalCats = [...categories];
        
        restaurantMenu.forEach(p => {
            if (p.category === cat.name) {
                p.category = 'Burgers';
            }
        });
        categories = categories.filter(c => c.id !== cat.id);
        renderActiveTab();
        
        try {
            await apiFetch(`/api/v1/categories/${cat.id}`, {
                method: 'DELETE'
            });
            ui.showToast(getLanguage() === 'ar' ? 'تم حذف القسم بنجاح' : 'Category deleted successfully', 'success');
            await refreshCategories();
            if (activeTab === 'categories') renderActiveTab();
        } catch (err) {
            console.error('Failed to delete category:', err);
            restaurantMenu = originalMenu;
            categories = originalCats;
            renderActiveTab();
            ui.showToast((getLanguage() === 'ar' ? 'فشل حذف القسم: ' : 'Failed to delete category: ') + err.message, 'error');
        }
    }
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleString(getLanguage() === 'ar' ? 'ar-EG' : 'en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return dateStr;
    }
}

/* ==========================================================================
   Tab 6: Manage Discounts
   ========================================================================== */
function renderDiscountsTab(parent) {
    const wrapper = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; width: 100%;' });
    
    // Top Bar with Add Discount Button
    const topBar = ui.createElement('div', [], { style: 'display: flex; justify-content: flex-end;' });
    const addDiscountBtn = ui.createElementWithText('button', t('rest_discount_add_btn'), ['btn', 'btn-primary']);
    addDiscountBtn.addEventListener('click', () => showAddDiscountModal());
    topBar.appendChild(addDiscountBtn);
    wrapper.appendChild(topBar);

    // Grid Container for cards
    const grid = ui.createElement('div', ['analytics-grid'], { style: 'margin-top: 1rem; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.5rem; width: 100%;' });
    
    if (discounts.length === 0) {
        const emptyState = ui.createElement('div', ['glass-panel'], { style: 'text-align: center; padding: 3rem 1.5rem; width: 100%; grid-column: 1 / -1;' });
        emptyState.appendChild(ui.createElementWithText('h3', t('rest_discount_empty_title') || '🎟️ No Discounts', [], { style: 'margin-bottom: 0.5rem; font-size: 1.25rem;' }));
        emptyState.appendChild(ui.createElementWithText('p', t('rest_discount_empty_desc'), ['text-secondary'], { style: 'font-size: 0.85rem;' }));
        grid.appendChild(emptyState);
    } else {
        discounts.forEach(disc => {
            const card = ui.createElement('div', ['summary-card'], { style: 'display: flex; flex-direction: column; justify-content: space-between; min-height: 220px; position: relative;' });
            
            // Header: Name and Delete button
            const header = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; width: 100%;' });
            const name = ui.createElementWithText('strong', disc.name || '-', [], { style: 'font-size: 1.1rem; font-weight: 700; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;' });
            const deleteBtn = ui.createElementWithText('button', '🗑️', ['btn', 'btn-danger', 'btn-sm'], { style: 'padding: 0.25rem 0.5rem; font-size: 0.85rem; border-radius: 4px;' });
            deleteBtn.addEventListener('click', () => handleDeleteDiscount(disc));
            
            header.appendChild(name);
            header.appendChild(deleteBtn);
            card.appendChild(header);
            
            // Description
            const desc = ui.createElementWithText('p', disc.description || '-', ['text-secondary'], { style: 'font-size: 0.8rem; margin: 0.5rem 0; flex-grow: 1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;' });
            card.appendChild(desc);
            
            // Large Percentage Value
            const percentContainer = ui.createElement('div', [], { style: 'display: flex; align-items: baseline; gap: 0.35rem; margin: 0.75rem 0;' });
            const percentVal = ui.createElementWithText('span', `${disc.percentage}%`, [], { style: 'font-size: 2.25rem; font-weight: 800; color: var(--rest-color); font-family: "Outfit", sans-serif;' });
            const percentLabel = ui.createElementWithText('span', getLanguage() === 'ar' ? 'خصم' : 'OFF', [], { style: 'font-size: 0.85rem; font-weight: 600; color: var(--text-secondary); text-transform: uppercase;' });
            percentContainer.appendChild(percentVal);
            percentContainer.appendChild(percentLabel);
            card.appendChild(percentContainer);
            
            // Footer: Start and End Times formatted beautifully
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
    
    const nameWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    nameWrap.appendChild(ui.createElementWithText('label', t('rest_discount_modal_name'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const nameIn = ui.createElement('input', ['search-input'], { type: 'text', placeholder: getLanguage() === 'ar' ? 'مثال: خصم الصيف' : 'e.g. Summer Discount' });
    nameWrap.appendChild(nameIn);
    
    const descWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    descWrap.appendChild(ui.createElementWithText('label', t('rest_discount_modal_desc'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const descIn = ui.createElement('input', ['search-input'], { type: 'text', placeholder: getLanguage() === 'ar' ? 'وصف الخصم...' : 'Discount description...' });
    descWrap.appendChild(descIn);

    const pctWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    pctWrap.appendChild(ui.createElementWithText('label', t('rest_discount_modal_percentage'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const pctIn = ui.createElement('input', ['search-input'], { type: 'number', min: '1', max: '100', placeholder: '15' });
    pctWrap.appendChild(pctIn);

    const startWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    startWrap.appendChild(ui.createElementWithText('label', t('rest_discount_modal_start'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const startIn = ui.createElement('input', ['search-input'], { type: 'datetime-local' });
    startWrap.appendChild(startIn);

    const endWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    endWrap.appendChild(ui.createElementWithText('label', t('rest_discount_modal_end'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const endIn = ui.createElement('input', ['search-input'], { type: 'datetime-local' });
    endWrap.appendChild(endIn);
    
    form.appendChild(nameWrap);
    form.appendChild(descWrap);
    form.appendChild(pctWrap);
    form.appendChild(startWrap);
    form.appendChild(endWrap);
    
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
                const newDisc = {
                    id: tempId,
                    name,
                    description,
                    percentage,
                    type: 0,
                    startDate,
                    endDate,
                    isActive: true
                };
                discounts.push(newDisc);
                ui.closeModal();
                renderActiveTab();
                
                try {
                    const response = await apiFetch('/api/v1/discounts', {
                        method: 'POST',
                        body: JSON.stringify({
                            name,
                            description,
                            percentage,
                            type: 0, // Restaurant
                            startDate,
                            endDate
                        })
                    });
                    ui.showToast(getLanguage() === 'ar' ? 'تمت إضافة الخصم بنجاح' : 'Discount created successfully', 'success');
                    
                    const idx = discounts.findIndex(d => d.id === tempId);
                    if (idx !== -1 && response.result?.id) {
                        discounts[idx].id = response.result.id;
                    }
                    
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
        {
            text: t('cancel'),
            type: 'secondary',
            onClick: ui.closeModal
        }
    ]);
}

async function handleDeleteDiscount(disc) {
    const confirmMsg = getLanguage() === 'ar' 
        ? `هل أنت متأكد من حذف الخصم "${disc.name}"؟`
        : `Are you sure you want to delete discount "${disc.name}"?`;
        
    if (confirm(confirmMsg)) {
        const originalDiscounts = [...discounts];
        discounts = discounts.filter(d => d.id !== disc.id);
        renderActiveTab();
        
        try {
            await apiFetch(`/api/v1/discounts/${disc.id}`, {
                method: 'DELETE'
            });
            ui.showToast(getLanguage() === 'ar' ? 'تم حذف الخصم بنجاح' : 'Discount deleted successfully', 'success');
            await refreshDiscounts();
            if (activeTab === 'discounts') renderActiveTab();
        } catch (err) {
            console.error('Failed to delete discount:', err);
            discounts = originalDiscounts;
            renderActiveTab();
            ui.showToast((getLanguage() === 'ar' ? 'فشل حذف الخصم: ' : 'Failed to delete discount: ') + err.message, 'error');
        }
    }
}

/* ==========================================================================
   Tab 7: Promotional Offers
   ========================================================================== */
function renderOffersTab(parent) {
    const wrapper = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; width: 100%;' });

    const topBar = ui.createElement('div', [], { style: 'display: flex; justify-content: flex-end;' });
    const addOfferBtn = ui.createElementWithText('button', t('offer_add_btn'), ['btn', 'btn-primary']);
    addOfferBtn.addEventListener('click', showAddRestOfferModal);
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
            const accent = ui.createElement('div', [], { style: 'position: absolute; top: -20px; right: -20px; width: 90px; height: 90px; border-radius: 50%; background: var(--rest-color, #e74c3c); opacity: 0.08; pointer-events: none;' });
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
                    style: 'height: 110px; background: linear-gradient(135deg, var(--rest-color, #e74c3c) 0%, #f39c12 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 2.5rem; margin-bottom: 0.75rem;'
                });
                imgPlaceholder.textContent = '🏷️';
                card.appendChild(imgPlaceholder);
            }

            // Header row: name + delete
            const headerRow = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.4rem;' });
            headerRow.appendChild(ui.createElementWithText('strong', offer.name || '-', [], { style: 'font-size: 1.05rem; font-weight: 700; color: var(--text-primary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' }));
            const delBtn = ui.createElementWithText('button', '🗑️', ['btn', 'btn-danger', 'btn-sm'], { style: 'padding: 0.25rem 0.5rem; font-size: 0.85rem; border-radius: 4px; flex-shrink: 0;' });
            delBtn.addEventListener('click', () => handleRestDeleteOffer(offer));
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
                        item.appendChild(ui.createElementWithText('span', `$${p.price.toFixed(2)}`, ['text-muted'], { style: 'font-family: "Outfit", sans-serif; font-size: 0.68rem;' }));
                    }
                    prodList.appendChild(item);
                });
                prodContainer.appendChild(prodList);
                card.appendChild(prodContainer);
            }

            // Price
            const priceEl = ui.createElement('div', [], { style: 'display: flex; align-items: baseline; gap: 0.35rem; margin: 0.5rem 0;' });
            priceEl.appendChild(ui.createElementWithText('span', `$${(offer.price || 0).toFixed(2)}`, [], { style: 'font-size: 1.6rem; font-weight: 800; color: var(--rest-color, #e74c3c); font-family: "Outfit", sans-serif;' }));
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
            statsRow.appendChild(makeStatEl('👆', offer.numberOfClicks || 0, t('offer_clicks')));
            statsRow.appendChild(makeStatEl('👁️', offer.numberOfWatches || 0, t('offer_watches')));
            statsRow.appendChild(makeStatEl('📋', offer.numberOfBooking || 0, t('offer_bookings')));
            card.appendChild(statsRow);

            grid.appendChild(card);
        });
    }

    wrapper.appendChild(grid);
    parent.appendChild(wrapper);
}

function showAddRestOfferModal() {
    const form = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; min-width: 320px; max-width: 480px;' });

    // Name
    const nameWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    nameWrap.appendChild(ui.createElementWithText('label', t('offer_modal_name'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const nameIn = ui.createElement('input', ['search-input'], { type: 'text', placeholder: getLanguage() === 'ar' ? 'مثال: صحن مشويات خاص' : 'e.g. Special Grills Combo' });
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
    const priceIn = ui.createElement('input', ['search-input'], { type: 'number', step: '0.01', min: '0', value: '25.00' });
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

    // Linked menu items checkboxes
    const prodWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.5rem;' });
    prodWrap.appendChild(ui.createElementWithText('label', t('offer_modal_products'), [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const prodNote = ui.createElementWithText('small', getLanguage() === 'ar' ? '(اختياري - اختر المنتجات المشمولة في هذا العرض)' : '(Optional - Select products to include in this offer)', [], { style: 'color: var(--text-muted); font-size: 0.75rem;' });
    prodWrap.appendChild(prodNote);

    const checkboxContainer = ui.createElement('div', [], {
        style: 'display: flex; flex-direction: column; gap: 0.4rem; max-height: 160px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 0.5rem; background: rgba(255, 255, 255, 0.02);'
    });

    const checkboxes = [];
    if (restaurantMenu.length === 0) {
        const noProds = ui.createElementWithText('span', getLanguage() === 'ar' ? 'لا توجد منتجات متوفرة' : 'No products available', ['text-muted'], { style: 'font-size: 0.85rem; padding: 0.25rem;' });
        checkboxContainer.appendChild(noProds);
    } else {
        restaurantMenu.forEach(p => {
            const itemWrap = ui.createElement('div', [], {
                style: 'display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; padding: 0.35rem 0.5rem; border-radius: var(--radius-sm); transition: background-color 0.2s; user-select: none;'
            });
            itemWrap.addEventListener('mouseover', () => { itemWrap.style.backgroundColor = 'rgba(255, 255, 255, 0.04)'; });
            itemWrap.addEventListener('mouseout', () => { itemWrap.style.backgroundColor = 'transparent'; });

            const leftPart = ui.createElement('label', [], {
                style: 'display: flex; align-items: center; gap: 0.6rem; cursor: pointer; flex: 1; margin: 0;'
            });

            const chk = ui.createElement('input', [], { type: 'checkbox', value: p.id.toString(), style: 'cursor: pointer;' });
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
                disabled: true
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
                            const localProd = restaurantMenu.find(mp => mp.id.toString() === id.toString());
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
                if (!name) {
                    ui.setInputInvalid(nameIn, getLanguage() === 'ar' ? 'الاسم مطلوب' : 'Name is required');
                    isValid = false;
                }
                const price = parseFloat(priceVal);
                if (!priceVal || isNaN(price) || price < 0) {
                    ui.setInputInvalid(priceIn, getLanguage() === 'ar' ? 'السعر يجب أن يكون 0 أو أكثر' : 'Price must be 0 or more');
                    isValid = false;
                }
                if (!description) {
                    ui.setInputInvalid(descIn, getLanguage() === 'ar' ? 'الوصف مطلوب' : 'Description is required');
                    isValid = false;
                }
                if (!uploadedPhotoKey) {
                    ui.showToast(getLanguage() === 'ar' ? 'يرجى اختيار صورة للعرض' : 'Please select an image for the offer', 'error');
                    isValid = false;
                }
                if (selectedProductIds.length === 0) {
                    ui.showToast(getLanguage() === 'ar' ? 'يرجى اختيار منتج واحد على الأقل' : 'Please select at least one product', 'error');
                    isValid = false;
                }

                if (!isValid) return;

                const isEditable = editableInput.checked ? 1 : 0;

                // Optimistic add
                const tempOffer = {
                    id: 'temp-' + Date.now(), name, price, description,
                    featuredPhoto: uploadedPhotoKey,
                    active: activeInput.checked, approved: false,
                    offerType: isEditable, type: 0,
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
                            type: 0,   // Restaurant
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
                    ui.showToast((getLanguage() === 'ar' ? 'فشل إضافة العرض: ' : 'Failed to create offer: ') + err.message, 'error');
                }
            }
        },
        { text: t('cancel'), type: 'secondary', onClick: ui.closeModal }
    ]);
}

async function handleRestDeleteOffer(offer) {
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
   Tab 8: My Restaurant Profile
   ========================================================================== */
function renderProfileTab(parent) {
    const getUserSettings = () => {
        const userJson = localStorage.getItem('qs_vendor_user');
        const u = JSON.parse(userJson || '{}');
        return { user: u, settings: parseUserDescription(u.description) };
    };
    const { user, settings } = getUserSettings();

    const wrapper = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1.5rem; max-width: 640px; width: 100%;' });

    // ── Section 1: Basic Information ──────────────────────────────────────
    const infoPanel = ui.createElement('div', ['glass-panel']);
    infoPanel.appendChild(ui.createElementWithText('h3', `👤 ${t('rest_profile_section_info')}`, [], { style: 'font-size: 1.05rem; font-weight: 700; margin-bottom: 1.25rem; padding-bottom: 0.75rem; border-bottom: 1px solid var(--border-color);' }));

    // Profile photo row
    const photoRow = ui.createElement('div', [], { style: 'display: flex; align-items: center; gap: 1.25rem; margin-bottom: 1.25rem;' });
    
    let currentPhoto = user.photo || '';
    const photoPreview = ui.createElement('div', [], { style: 'width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(135deg, var(--rest-color, #e74c3c), #f39c12); display: flex; align-items: center; justify-content: center; font-size: 2rem; flex-shrink: 0; overflow: hidden; border: 3px solid var(--border-color);' });
    if (currentPhoto) {
        const img = ui.createElement('img', [], { src: getImageUrl(currentPhoto), style: 'width: 100%; height: 100%; object-fit: cover;' });
        photoPreview.appendChild(img);
    } else {
        photoPreview.textContent = '🍔';
    }

    const photoInput = ui.createElement('input', [], { type: 'file', accept: 'image/*', style: 'display: none;' });
    const photoBtn = ui.createElementWithText('button', t('rest_profile_photo_btn'), ['btn', 'btn-secondary', 'btn-sm']);
    photoBtn.addEventListener('click', () => photoInput.click());
    
    photoInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const objUrl = URL.createObjectURL(file);
        photoPreview.innerHTML = '';
        const img = ui.createElement('img', [], { src: objUrl, style: 'width: 100%; height: 100%; object-fit: cover;' });
        photoPreview.appendChild(img);
        try {
            const result = await uploadImage(file);
            if (result) {
                currentPhoto = result;
                img.src = getImageUrl(currentPhoto);
            }
        } catch (err) {
            console.error('Photo upload failed:', err);
            ui.showToast(t('rest_profile_photo_upload_error'), 'error');
        }
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

    // Name field
    const nameWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 1rem;' });
    nameWrap.appendChild(ui.createElementWithText('label', t('rest_profile_name_label'), [], { style: 'font-size: 0.85rem; font-weight: 600;' }));
    const nameIn = ui.createElement('input', ['search-input'], {
        type: 'text',
        value: user.name || '',
        placeholder: t('rest_profile_name_placeholder')
    });
    nameWrap.appendChild(nameIn);
    infoPanel.appendChild(nameWrap);

    // Description field
    const descWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 1.25rem;' });
    descWrap.appendChild(ui.createElementWithText('label', t('rest_profile_desc_label'), [], { style: 'font-size: 0.85rem; font-weight: 600;' }));
    const descIn = ui.createElement('textarea', ['search-input'], {
        placeholder: t('rest_profile_desc_placeholder'),
        style: 'min-height: 80px; font-family: inherit; resize: vertical;'
    });
    descIn.value = settings.description || '';
    descWrap.appendChild(descIn);
    infoPanel.appendChild(descWrap);

    // Save button + feedback
    const saveInfoBtn = ui.createElementWithText('button', t('rest_profile_save_btn'), ['btn', 'btn-primary'], { style: 'align-self: flex-start;' });
    const infoFeedback = ui.createElement('span', [], { style: 'font-size: 0.85rem; margin-left: 1rem;' });
    
    const infoFooter = ui.createElement('div', [], { style: 'display: flex; align-items: center;' });
    infoFooter.appendChild(saveInfoBtn);
    infoFooter.appendChild(infoFeedback);
    infoPanel.appendChild(infoFooter);

    saveInfoBtn.addEventListener('click', async () => {
        const name = nameIn.value.trim();
        if (!name) {
            nameIn.style.borderColor = 'var(--color-danger)';
            nameIn.focus();
            return;
        }
        nameIn.style.borderColor = '';
        saveInfoBtn.disabled = true;
        saveInfoBtn.textContent = getLanguage() === 'ar' ? 'جارٍ الحفظ...' : 'Saving...';

        // Preserve schedule settings while updating description text
        const fresh = getUserSettings();
        const newRawDesc = '__SETTINGS__:' + JSON.stringify({
            isClosed: fresh.settings.isClosed,
            days: fresh.settings.days,
            hours: fresh.settings.hours,
            description: descIn.value.trim()
        });

        try {
            await apiFetch('/api/v1/users/update-profile', {
                method: 'PUT',
                body: JSON.stringify({
                    name,
                    photo: currentPhoto,
                    description: newRawDesc
                })
            });
            // Update localStorage
            const profile = JSON.parse(localStorage.getItem('qs_vendor_user') || '{}');
            profile.name = name;
            profile.photo = currentPhoto;
            profile.description = newRawDesc;
            localStorage.setItem('qs_vendor_user', JSON.stringify(profile));
            updateHeaderVendorName();

            infoFeedback.textContent = '✅ ' + t('rest_profile_saved');
            infoFeedback.style.color = 'var(--color-success)';
            setTimeout(() => { infoFeedback.textContent = ''; }, 3000);
        } catch (err) {
            console.error('Profile save failed:', err);
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

    const profileNow = JSON.parse(localStorage.getItem('qs_vendor_user') || '{}');
    const isActivePr = !(profileNow.active === 0 || profileNow.active === false);

    const cSwLabel = ui.createElement('label', ['switch-container']);
    const cSwInput = ui.createElement('input', ['switch-input', 'switch-danger'], {
        type: 'checkbox',
        checked: !isActivePr ? 'checked' : ''
    });
    cSwInput.addEventListener('change', async (e) => {
        cSwInput.disabled = true;
        try {
            await toggleActivityStatus();
            const updatedUser = JSON.parse(localStorage.getItem('qs_vendor_user') || '{}');
            const nowClosed = (updatedUser.active === 0 || updatedUser.active === false);
            cSwLabel.querySelector('span:last-child').textContent = nowClosed ? t('rest_sched_closure_on') : t('rest_sched_closure_off');
        } catch (err) {
            console.error('Failed to toggle activity:', err);
            ui.showToast(t('error_generic') + ': ' + err.message, 'error');
            e.target.checked = !e.target.checked;
        } finally {
            cSwInput.disabled = false;
        }
    });
    cSwLabel.appendChild(cSwInput);
    cSwLabel.appendChild(ui.createElement('span', ['switch-slider']));
    cSwLabel.appendChild(ui.createElementWithText('span', !isActivePr ? t('rest_sched_closure_on') : t('rest_sched_closure_off'), [], { style: 'font-weight: 600;' }));
    closureBox.appendChild(cSwLabel);
    schedPanel.appendChild(closureBox);

    // Days + Hours fields
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
    const inputHours = ui.createElement('input', ['search-input'], {
        type: 'text',
        value: settings.hours || '',
        placeholder: 'e.g. 12:00 PM - 11:30 PM'
    });
    hoursWrap.appendChild(inputHours);
    schedPanel.appendChild(hoursWrap);

    const saveSchedBtn = ui.createElementWithText('button', t('rest_sched_hours_btn'), ['btn', 'btn-primary'], { style: 'align-self: flex-start;' });
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
            console.error('Failed to save hours:', err);
            schedFeedback.textContent = '❌ ' + (t('error_generic') + ': ' + err.message);
            schedFeedback.style.color = 'var(--color-danger)';
        } finally {
            saveSchedBtn.disabled = false;
        }
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
                    creatorId: myRestaurantId ? parseInt(myRestaurantId) : 0
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
                onClick: async () => {
                    ui.closeModal();
                    const originalBranches = [...branches];
                    branches = branches.filter(x => x.id !== b.id);
                    renderActiveTab();
                    
                    try {
                        await apiFetch(`/api/v1/locations/${b.id}`, {
                            method: 'DELETE'
                        });
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
let activeDashboardChatInterval = null;
async function renderChatsTab(parent) {
    const wrapper = ui.createElement('div', ['chat-panel-wrapper']);

    const leftPane = ui.createElement('div', ['chat-left-pane']);
    const rightPane = ui.createElement('div', ['chat-right-pane']);

    // Empty state placeholder
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
    headerIcon.style.background = 'rgba(255,71,87,0.15)';
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
                avatar.style.background = 'rgba(255,71,87,0.15)';
                avatar.style.color = 'var(--rest-color)';
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
    headerAvatar.style.background = 'rgba(255,71,87,0.15)';
    headerAvatar.style.color = 'var(--rest-color)';
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
            if (isMe) bubble.style.background = 'var(--rest-color)';
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
        bubble.style.background = 'var(--rest-color)';
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

let chatPollInterval = null;
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
                    ? 'background: var(--rest-color); color: white; border-bottom-right-radius: 2px;' 
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
            style: 'padding: 8px 12px; border-radius: 12px; max-width: 75%; font-size: 0.85rem; word-break: break-word; background: var(--rest-color); color: white; border-bottom-right-radius: 2px;'
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


// Autostart on standalone load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        try { initRestaurant(); }
        catch (e) { console.error('initRestaurant error:', e); }
    });
} else {
    try { initRestaurant(); }
    catch (e) { console.error('initRestaurant error:', e); }
}
