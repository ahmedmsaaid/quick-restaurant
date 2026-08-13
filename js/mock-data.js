/**
 * Quick Service Portal - Persistent & Syncing Mock Data Store
 * Coordinates dashboard state across separate pages/tabs using localStorage
 * and window storage event listeners.
 */

// Subscribers registry
const listeners = {};

// Subscribe to state change events
export function subscribe(event, callback) {
    if (!listeners[event]) {
        listeners[event] = [];
    }
    listeners[event].push(callback);
}

// Broadcast state changes
export function emit(event, data) {
    if (listeners[event]) {
        listeners[event].forEach(cb => cb(data));
    }
}

/**
 * LocalStorage Helpers
 */
function getStored(key, defaultVal) {
    const stored = localStorage.getItem(key);
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch (e) {
            console.error(`Error parsing stored key "${key}":`, e);
        }
    }
    localStorage.setItem(key, JSON.stringify(defaultVal));
    return defaultVal;
}

function saveStored(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
}

// Default static lists
const initialCategories = [
    { id: 'cat-1', name: 'Restaurants', icon: '🍔', commissionRate: 10 },
    { id: 'cat-2', name: 'Supermarkets', icon: '🛒', commissionRate: 5 },
    { id: 'cat-3', name: 'Grills & Barbecue', icon: '🍢', commissionRate: 8 },
    { id: 'cat-4', name: 'Desserts & Sweets', icon: '🍰', commissionRate: 10 }
];

const initialBanners = [
    { id: 'ban-1', imageUrl: 'assets/promo1.jpg', title: 'Free Delivery on Grills!', startDate: '2026-06-01', endDate: '2026-06-30' },
    { id: 'ban-2', imageUrl: 'assets/promo2.jpg', title: 'Supermarket Super Deals', startDate: '2026-06-05', endDate: '2026-06-12' }
];

const initialVendors = [
    { id: 'rest-1', name: 'Tasty Burger Palace', type: 'Restaurants', isClosed: false, days: 'Sat - Thu', hours: '12:00 PM - 11:30 PM', rating: 4.8, reviewsCount: 120 },
    { id: 'rest-2', name: 'Cairo Grills Express', type: 'Grills & Barbecue', isClosed: false, days: 'Everyday', hours: '01:00 PM - 02:00 AM', rating: 4.5, reviewsCount: 85 },
    { id: 'mkt-1', name: 'Super Fresh Mart', type: 'Supermarkets', isClosed: false, days: 'Everyday', hours: '08:00 AM - 12:00 AM', rating: 4.6, reviewsCount: 310 }
];

const initialUsers = [
    { id: 'usr-1', name: 'Ahmed Ali', phone: '+966 50 123 4567', email: 'ahmed.ali@quick.com', role: 'Customer', isBlocked: false, blockReason: '' },
    { id: 'usr-2', name: 'Sarah Mansour', phone: '+966 54 987 6543', email: 'sarah.m@quick.com', role: 'Customer', isBlocked: false, blockReason: '' },
    { id: 'usr-3', name: 'Captain Hani', phone: '+966 53 444 5555', email: 'hani.driver@quick.com', role: 'Captain', isBlocked: false, blockReason: '' },
    { id: 'usr-4', name: 'Captain Tariq', phone: '+966 55 888 9999', email: 'tariq.d@quick.com', role: 'Captain', isBlocked: false, blockReason: '' },
    { id: 'usr-5', name: 'Tasty Burger Manager', phone: '+966 56 333 4444', email: 'tb_manager@tasty.com', role: 'Vendor', isBlocked: false, blockReason: '' },
    { id: 'usr-6', name: 'Super Fresh Manager', phone: '+966 59 777 8888', email: 'manager@superfresh.com', role: 'Vendor', isBlocked: false, blockReason: '' }
];

const initialPendingApprovals = [
    {
        id: 'p-capt-1',
        name: 'Khalid Mansour',
        role: 'Captain',
        phone: '+966 55 111 2222',
        vehicle: 'Toyota Yaris (Plate: ABD-8877)',
        documents: {
            driverLicense: 'DL-998822 (Valid)',
            vehicleRegistration: 'VR-773344 (Valid)'
        }
    },
    {
        id: 'p-vend-1',
        name: 'Gourmet Burger Kitchen',
        role: 'Vendor',
        phone: '+966 55 222 3333',
        category: 'Restaurants',
        documents: {
            businessRegistry: 'BR-556677 (Saudi Commercial)',
            taxRecord: 'TR-112233 (VAT Registered)'
        }
    }
];

const initialWithdrawRequests = [
    { id: 'req-1', requesterName: 'Captain Hani', role: 'Captain', amount: 250.00, date: '2026-06-07', status: 'pending', details: 'STC Pay: 0534445555' },
    { id: 'req-2', requesterName: 'Tasty Burger Palace', role: 'Vendor', amount: 1450.00, date: '2026-06-08', status: 'pending', details: 'Al Rajhi Bank: SA90800000010928374' },
    { id: 'req-3', requesterName: 'Captain Tariq', role: 'Captain', amount: 120.00, date: '2026-06-05', status: 'paid', details: 'STC Pay: 0558889999', receipt: 'REF-TX-998811' }
];

const initialInventory = [
    { sku: 'MKT-1001', barcode: '628100100223', name: 'Fresh Almarai Milk (1L)', category: 'Dairy', regularPrice: 6.50, salePrice: 6.00, stockCount: 15 },
    { sku: 'MKT-1002', barcode: '628100200334', name: 'Lulu sliced Toast (White)', category: 'Bakery', regularPrice: 4.00, salePrice: 4.00, stockCount: 3 },
    { sku: 'MKT-1003', barcode: '628100300445', name: 'Nadec Orange Juice (1.5L)', category: 'Dairy', regularPrice: 8.50, salePrice: 7.25, stockCount: 0 },
    { sku: 'MKT-1004', barcode: '628100400556', name: 'Heinz Tomato Ketchup', category: 'Canned', regularPrice: 12.00, salePrice: 10.50, stockCount: 22 },
    { sku: 'MKT-1005', barcode: '628100500667', name: 'Nova Bottled Water (6x1.5L)', category: 'Dairy', regularPrice: 9.00, salePrice: 9.00, stockCount: 4 },
    { sku: 'MKT-1006', barcode: '628100600778', name: 'Sadia Chicken Breasts (1kg)', category: 'Canned', regularPrice: 28.00, salePrice: 24.90, stockCount: 8 }
];

const initialPromoCodes = [
    { code: 'QUICKMARKET5', discountType: 'percentage', value: 15, expiry: '2026-06-30', minOrderValue: 50.00, totalUsageCap: 100, currentUsage: 22 },
    { code: 'BOGOMILK', discountType: 'bogo', value: 0, expiry: '2026-06-15', minOrderValue: 0.00, totalUsageCap: 50, currentUsage: 12 }
];

const initialRestaurantMenu = [
    { id: 'menu-1', name: 'Double Cheese Dynamite Burger', price: 28.00, category: 'Burgers', description: 'Double beef patty, spicy cheddar sauce, pickled jalapeno', isOutOfStock: false, modifiers: [] },
    { id: 'menu-2', name: 'Crispy Chicken Strips (4pcs)', price: 18.00, category: 'Sides', description: 'Hand-breaded breast strips with honey mustard dip', isOutOfStock: false, modifiers: [] },
    { id: 'menu-3', name: 'Classic Garlic French Fries', price: 10.00, category: 'Sides', description: 'Tossed in garlic oil, parmesan cheese, and parsley', isOutOfStock: false, modifiers: [] },
    { id: 'menu-4', name: 'Mocha Chocolate Shake', price: 15.00, category: 'Beverages', description: 'Vanilla ice cream blended with dark chocolate and espresso', isOutOfStock: true, modifiers: [] }
];

const initialCaptains = [
    { id: 'capt-1', name: 'Hani Al-Harbi', phone: '+966 53 444 5555', status: 'online', vehicle: 'Toyota Yaris (Plate: ABD-8877)', coords: { x: 120, y: 90 } },
    { id: 'capt-2', name: 'Tariq Al-Saudi', phone: '+966 55 888 9999', status: 'online', vehicle: 'Hyundai Accent (Plate: ZYX-1122)', coords: { x: 310, y: 160 } },
    { id: 'capt-3', name: 'Yasir Al-Sudani', phone: '+966 57 222 3333', status: 'online', vehicle: 'Kia Pegas (Plate: KKL-9900)', coords: { x: 200, y: 280 } }
];

const initialOrders = [
    {
        id: 'ord-101',
        vendorId: 'rest-1',
        vendorName: 'Tasty Burger Palace',
        type: 'restaurant',
        items: [
            { name: 'Double Cheese Dynamite Burger', qty: 2, price: 28.00, modifiers: [] },
            { name: 'Classic Garlic French Fries', qty: 1, price: 10.00, modifiers: [] }
        ],
        notes: 'Please separate spicy sauce',
        totalPrice: 70.00,
        commission: 7.00,
        status: 'preparing',
        captainId: 'capt-1',
        captainName: 'Hani Al-Harbi',
        customerName: 'Ahmed Ali',
        customerPhone: '+966 50 123 4567',
        customerCoords: { name: 'Ahmed Ali', phone: '+966 50 123 4567', x: 250, y: 140 },
        createdAt: Date.now() - 600000
    },
    {
        id: 'ord-102',
        vendorId: 'mkt-1',
        vendorName: 'Super Fresh Mart',
        type: 'market',
        items: [
            { name: 'Fresh Almarai Milk (1L)', qty: 3, price: 6.00, picked: true },
            { name: 'Heinz Tomato Ketchup', qty: 1, price: 10.50, picked: false }
        ],
        notes: 'Check expiry dates please',
        totalPrice: 28.50,
        commission: 1.43,
        status: 'pending',
        captainId: null,
        captainName: null,
        customerName: 'Sarah Mansour',
        customerPhone: '+966 54 987 6543',
        customerCoords: { name: 'Sarah Mansour', phone: '+966 54 987 6543', x: 420, y: 290 },
        createdAt: Date.now() - 300000
    }
];

// Initialize live data arrays
export const categories = getStored('qs_categories', initialCategories);
export const banners = getStored('qs_banners', initialBanners);
export const vendors = getStored('qs_vendors', initialVendors);
export const users = getStored('qs_users', initialUsers);
export const pendingApprovals = getStored('qs_pendingApprovals', initialPendingApprovals);
export const withdrawRequests = getStored('qs_withdrawRequests', initialWithdrawRequests);
export const inventory = getStored('qs_inventory', initialInventory);
export const promoCodes = getStored('qs_promoCodes', initialPromoCodes);
export const restaurantMenu = getStored('qs_restaurantMenu', initialRestaurantMenu);
export const captains = getStored('qs_captains', initialCaptains);
export const orders = getStored('qs_orders', initialOrders);

/* ==========================================================================
   State Modifier Functions with LocalStorage Persistence
   ========================================================================== */

export function addOrder(order) {
    orders.unshift(order);
    saveStored('qs_orders', orders);
    emit('orders_updated', orders);
}

export function updateOrderStatus(orderId, status, extraFields = {}) {
    const order = orders.find(o => o.id === orderId);
    if (order) {
        order.status = status;
        Object.assign(order, extraFields);
        saveStored('qs_orders', orders);
        emit('orders_updated', orders);
    }
}

export function assignCaptainToOrder(orderId, captainId) {
    const order = orders.find(o => o.id === orderId);
    const captain = captains.find(c => c.id === captainId);
    
    if (order && captain) {
        order.captainId = captain.id;
        order.captainName = captain.name;
        order.status = 'on_the_way';
        captain.status = 'delivering';
        
        saveStored('qs_orders', orders);
        saveStored('qs_captains', captains);
        
        emit('orders_updated', orders);
        emit('captains_updated', captains);
    }
}

export function verifyPartner(approvalId, decision, reason) {
    const idx = pendingApprovals.findIndex(p => p.id === approvalId);
    if (idx !== -1) {
        const item = pendingApprovals[idx];
        pendingApprovals.splice(idx, 1);
        
        if (decision === 'approve') {
            if (item.role === 'Captain') {
                const newId = `capt-${captains.length + 1}`;
                captains.push({
                    id: newId,
                    name: item.name,
                    phone: item.phone,
                    status: 'online',
                    vehicle: item.vehicle,
                    coords: { x: 100 + Math.random() * 300, y: 100 + Math.random() * 200 }
                });
                users.push({
                    id: `usr-${users.length + 1}`,
                    name: item.name,
                    phone: item.phone,
                    email: `${item.name.toLowerCase().replace(/\s+/g, '')}@quick.com`,
                    role: 'Captain',
                    isBlocked: false,
                    blockReason: ''
                });
            } else if (item.role === 'Vendor') {
                const newId = `vend-${vendors.length + 1}`;
                vendors.push({
                    id: newId,
                    name: item.name,
                    type: item.category,
                    isClosed: false,
                    days: 'Sat - Thu',
                    hours: '12:00 PM - 11:30 PM',
                    rating: 5.0,
                    reviewsCount: 0
                });
                users.push({
                    id: `usr-${users.length + 1}`,
                    name: item.name,
                    phone: item.phone,
                    email: `${item.name.toLowerCase().replace(/\s+/g, '')}@quick.com`,
                    role: 'Vendor',
                    isBlocked: false,
                    blockReason: ''
                });
            }
        }
        
        saveStored('qs_pendingApprovals', pendingApprovals);
        saveStored('qs_captains', captains);
        saveStored('qs_users', users);
        saveStored('qs_vendors', vendors);
        
        emit('approvals_updated', pendingApprovals);
        emit('captains_updated', captains);
        emit('users_updated', users);
        emit('vendors_updated', vendors);
    }
}

export function toggleBlockAccount(userId, isBlocked, reason = '') {
    const user = users.find(u => u.id === userId);
    if (user) {
        user.isBlocked = isBlocked;
        user.blockReason = isBlocked ? reason : '';
        saveStored('qs_users', users);
        emit('users_updated', users);
    }
}

export function updateWithdrawStatus(requestId, status, receipt = '') {
    const req = withdrawRequests.find(w => w.id === requestId);
    if (req) {
        req.status = status;
        if (receipt) req.receipt = receipt;
        saveStored('qs_withdrawRequests', withdrawRequests);
        emit('withdraw_updated', withdrawRequests);
    }
}

export function updateStoreClosure(vendorId, isClosed) {
    const vendor = vendors.find(v => v.id === vendorId);
    if (vendor) {
        vendor.isClosed = isClosed;
        saveStored('qs_vendors', vendors);
        emit('vendors_updated', vendors);
    }
}

export function updateStoreSchedule(vendorId, days, hours) {
    const vendor = vendors.find(v => v.id === vendorId);
    if (vendor) {
        vendor.days = days;
        vendor.hours = hours;
        saveStored('qs_vendors', vendors);
        emit('vendors_updated', vendors);
    }
}

export function updateCommissionRate(catId, newRate) {
    const cat = categories.find(c => c.id === catId);
    if (cat) {
        cat.commissionRate = parseFloat(newRate) || 0;
        saveStored('qs_categories', categories);
        emit('config_updated', categories);
    }
}

export function updateInventoryStock(sku, delta) {
    const item = inventory.find(i => i.sku === sku);
    if (item) {
        item.stockCount = Math.max(0, item.stockCount + delta);
        saveStored('qs_inventory', inventory);
        emit('inventory_updated', inventory);
    }
}

export function bulkUpdateInventory(newItems) {
    newItems.forEach(updatedItem => {
        const item = inventory.find(i => i.sku === updatedItem.sku);
        if (item) {
            Object.assign(item, updatedItem);
        } else {
            inventory.push(updatedItem);
        }
    });
    saveStored('qs_inventory', inventory);
    emit('inventory_updated', inventory);
}

export function addInventoryItem(item) {
    // Generate unique SKU
    const maxSkuNum = inventory.reduce((max, i) => {
        const num = parseInt(i.sku.replace('MKT-', ''));
        return isNaN(num) ? max : Math.max(max, num);
    }, 1000);
    const nextSku = `MKT-${maxSkuNum + 1}`;
    
    // Generate barcode if not provided
    const barcode = item.barcode || `628${Math.floor(100000000 + Math.random() * 900000000)}`;
    
    const newItem = {
        sku: nextSku,
        barcode: barcode,
        name: item.name,
        category: item.category || 'Dairy',
        regularPrice: parseFloat(item.regularPrice) || 0,
        salePrice: parseFloat(item.salePrice) || parseFloat(item.regularPrice) || 0,
        stockCount: parseInt(item.stockCount) || 0,
        description: item.description || '',
        image: item.image || '', // Base64 data URI
        weight: item.weight || '',
        isAvailable: item.isAvailable !== undefined ? item.isAvailable : true,
        hasDiscount: item.hasDiscount !== undefined ? item.hasDiscount : false
    };
    
    inventory.push(newItem);
    saveStored('qs_inventory', inventory);
    emit('inventory_updated', inventory);
}

export function addRestaurantMenuItem(item) {
    // Generate unique ID
    const maxIdNum = restaurantMenu.reduce((max, i) => {
        const num = parseInt(i.id.replace('menu-', ''));
        return isNaN(num) ? max : Math.max(max, num);
    }, 0);
    const nextId = `menu-${maxIdNum + 1}`;
    
    const newItem = {
        id: nextId,
        name: item.name,
        price: parseFloat(item.price) || 0,
        category: item.category || 'Burgers',
        description: item.description || '',
        isOutOfStock: item.isOutOfStock !== undefined ? item.isOutOfStock : false,
        image: item.image || '', // Base64 data URI
        modifiers: item.modifiers || []
    };
    
    restaurantMenu.push(newItem);
    saveStored('qs_restaurantMenu', restaurantMenu);
    // Piggyback on orders_updated to sync across tabs/instances
    emit('orders_updated', orders);
}

export function addPromoCode(promo) {
    promoCodes.push(promo);
    saveStored('qs_promoCodes', promoCodes);
    emit('promos_updated', promoCodes);
}


/**
 * Cross-tab Reactivity Storage Synchronizer
 */
window.addEventListener('storage', (e) => {
    if (!e.newValue) return;
    
    let parsedData = null;
    try {
        parsedData = JSON.parse(e.newValue);
    } catch (err) {
        return; // Skip invalid JSON
    }

    if (e.key === 'qs_orders') {
        orders.length = 0;
        orders.push(...parsedData);
        emit('orders_updated', orders);
    } else if (e.key === 'qs_pendingApprovals') {
        pendingApprovals.length = 0;
        pendingApprovals.push(...parsedData);
        emit('approvals_updated', pendingApprovals);
    } else if (e.key === 'qs_captains') {
        captains.length = 0;
        captains.push(...parsedData);
        emit('captains_updated', captains);
    } else if (e.key === 'qs_users') {
        users.length = 0;
        users.push(...parsedData);
        emit('users_updated', users);
    } else if (e.key === 'qs_vendors') {
        vendors.length = 0;
        vendors.push(...parsedData);
        emit('vendors_updated', vendors);
    } else if (e.key === 'qs_withdrawRequests') {
        withdrawRequests.length = 0;
        withdrawRequests.push(...parsedData);
        emit('withdraw_updated', withdrawRequests);
    } else if (e.key === 'qs_inventory') {
        inventory.length = 0;
        inventory.push(...parsedData);
        emit('inventory_updated', inventory);
    } else if (e.key === 'qs_promoCodes') {
        promoCodes.length = 0;
        promoCodes.push(...parsedData);
        emit('promos_updated', promoCodes);
    } else if (e.key === 'qs_categories') {
        categories.length = 0;
        categories.push(...parsedData);
        emit('config_updated', categories);
    } else if (e.key === 'qs_banners') {
        banners.length = 0;
        banners.push(...parsedData);
        emit('config_updated', banners);
    } else if (e.key === 'qs_restaurantMenu') {
        restaurantMenu.length = 0;
        restaurantMenu.push(...parsedData);
        emit('orders_updated', orders);
    } else if (e.key === 'qs_main_categories') {
        mainCategories.length = 0;
        mainCategories.push(...parsedData);
        emit('main_categories_updated', mainCategories);
    }
});

// ─── Main Categories & CMS Mock Stores ──────────────────────────────────────
export let mainCategories = getStored('qs_main_categories', [
    { id: 1, name: 'مطاعم ومأكولات', photo: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=500', description: 'جميع المطاعم والمأكولات السريعة والشعبية', userRole: 4, createdOn: '2026-06-01T10:00:00Z' },
    { id: 2, name: 'سوبر ماركت ومواد غذائية', photo: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=500', description: 'بقالة، خضراوات، وفواكه ومستلزمات منزلية', userRole: 4, createdOn: '2026-06-01T10:00:00Z' },
    { id: 3, name: 'صيدليات ومستلزمات طبية', photo: 'https://images.unsplash.com/photo-1586015555751-63bb77f4322a?w=500', description: 'أدوية ومستحضرات تجميل ومستلزمات صحية', userRole: 4, createdOn: '2026-06-02T10:00:00Z' },
    { id: 4, name: 'خدمات التوصيل والشحن', photo: 'https://images.unsplash.com/photo-1580674684081-7617fbf3d745?w=500', description: 'خدمات الطيارين والكباتن للتوصيل السريع', userRole: 3, createdOn: '2026-06-03T10:00:00Z' }
]);

export function saveMainCategories(list) {
    mainCategories.length = 0;
    mainCategories.push(...list);
    saveStored('qs_main_categories', list);
    emit('main_categories_updated', list);
}

export let aboutUsData = getStored('qs_about_us', {
    id: 1,
    active: true,
    aboutUsSections: [
        { id: 'sec-1', titleAr: 'من نحن - كويك سرفيس', titleEn: 'About Us - Quick Service', contentAr: 'تطبيق كويك سرفيس هو منصة سريعة ورائدة في خدمات التوصيل والمتاجر والمطاعم، تهدف لتقديم أفضل تجربة للمستخدمين والكباتن والشركاء.', contentEn: 'Quick Service is a leading delivery and marketplace platform connecting customers, stores, and captains seamlessly.' },
        { id: 'sec-2', titleAr: 'رؤيتنا وهدفنا', titleEn: 'Our Vision & Mission', contentAr: 'أن نكون المنصة الأكثر موثوقية وسرعة للتوصيل في المملكة والمنطقة.', contentEn: 'To be the most trusted and fastest delivery ecosystem in the region.' }
    ]
});

export function saveAboutUs(data) {
    aboutUsData = data;
    saveStored('qs_about_us', data);
    emit('about_us_updated', data);
}

export let termsData = getStored('qs_terms_and_conditions', {
    id: 1,
    active: true,
    policySections: [
        { id: 'term-1', titleAr: 'الشروط والأحكام العامة', titleEn: 'General Terms & Conditions', contentAr: 'باستخدامك لتطبيق كويك سرفيس فإنك توافق على الالتزام بجميع القوانين واللوائح التنفيذية المعمول بها.', contentEn: 'By using Quick Service app, you agree to comply with all applicable terms and regulations.' },
        { id: 'term-2', titleAr: 'حسابات المستخدمين والمسؤولية', titleEn: 'User Accounts & Responsibilities', contentAr: 'يتحمل المستخدم مسئولية الحفاظ على سرية معلومات حسابه وكلمة المرور.', contentEn: 'Users are responsible for maintaining confidentiality of account credentials.' }
    ]
});

export function saveTerms(data) {
    termsData = data;
    saveStored('qs_terms_and_conditions', data);
    emit('terms_updated', data);
}

export let privacyData = getStored('qs_privacy_policy', {
    id: 1,
    active: true,
    policySections: [
        { id: 'priv-1', titleAr: 'سياسة الخصوصية وحماية البيانات', titleEn: 'Privacy Policy & Data Protection', contentAr: 'نحن نلتزم بحماية بياناتك الشخصية وعدم مشاركتها مع أي طرف ثالث إلا وفقاً للشروط المحددة.', contentEn: 'We are committed to protecting your personal data and privacy at all times.' },
        { id: 'priv-2', titleAr: 'الموقع الجغرافي والإذونات', titleEn: 'Geolocation & Permissions', contentAr: 'يتم استخدام الموقع الجغرافي فقط لتحديد العناوين وتوجيه كباتن التوصيل بدقة.', contentEn: 'Location data is used solely for address determination and order dispatching.' }
    ]
});

export function savePrivacy(data) {
    privacyData = data;
    saveStored('qs_privacy_policy', data);
    emit('privacy_updated', data);
}

export let contactUsData = getStored('qs_contact_us', {
    id: 1,
    active: true,
    contactUsFields: [
        { id: 'cnt-1', label: 'رقم هاتف الدعم الفني', value: '+966 50 000 0000', icon: 'phone' },
        { id: 'cnt-2', label: 'البريد الإلكتروني', value: 'support@quick-service.com', icon: 'email' },
        { id: 'cnt-3', label: 'العنوان الرئيسي', value: 'الرياض - المملكة العربية السعودية', icon: 'location' },
        { id: 'cnt-4', label: 'أوقات العمل', value: 'على مدار 24 ساعة - طوال أيام الأسبوع', icon: 'clock' }
    ]
});

export function saveContactUs(data) {
    contactUsData = data;
    saveStored('qs_contact_us', data);
    emit('contact_us_updated', data);
}

