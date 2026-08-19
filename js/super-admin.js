/**
 * Quick Service Portal - Super Admin Dashboard Module
 * Handles system analytics, account activation & blocking,
 * Leaflet GPS driver tracking, and live orders pipeline management.
 */

import * as db from './mock-data.js?v=27';
import * as ui from './ui-utils.js?v=27';
import { t, getLanguage, setLanguage, initTranslations, subscribeLangChange } from './translations.js?v=27';
import { ApiClient, ImageService, Logger } from './core.js?v=27';

let activeTab = 'analytics';
let activeChartInstances = [];

// Initialize Core OOP classes
const apiClient = new ApiClient('admin');
const imageService = new ImageService(apiClient);

// Mock Handlers Configuration
apiClient.registerMockHandler('/api/v1/settings', (path, options) => {
    const method = options.method || 'GET';
    const getMockSettings = () => {
        const stored = localStorage.getItem('qs_mock_settings');
        const defaults = { id: 1, orderFee: 15.0, orderMinFee: 5.0, orderMaxFee: 50.0, deliveryFee: 12.0, deliveryMinFee: 15.0, categoryNameEn: 'Exclusive Offers', categoryNameAr: 'عروض حصرية', orderInterval: 60, allowedAreaLatitude: 30.0444, allowedAreaLongitude: 31.2357, allowedAreaRadiusKm: 10.0 };
        if (stored) {
            const parsed = JSON.parse(stored);
            // Reset if stale (missing new fields)
            if (parsed.categoryNameEn === undefined) {
                localStorage.setItem('qs_mock_settings', JSON.stringify({ ...defaults, ...parsed }));
                return { ...defaults, ...parsed };
            }
            return parsed;
        }
        localStorage.setItem('qs_mock_settings', JSON.stringify(defaults));
        return defaults;
    };
    if (method === 'GET') {
        return { success: true, result: getMockSettings() };
    }
    if (method === 'PUT') {
        const body = JSON.parse(options.body);
        localStorage.setItem('qs_mock_settings', JSON.stringify(body));
        return { success: true, result: body };
    }
});

apiClient.registerMockHandler('/api/v1/users/paginate', (path, options) => {
    return { success: true, result: [] };
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
    Logger.logHttp(method, url, reqBody, status, resBody, 'admin');
}

// Initialize and mount Super Admin views
export function initSuperAdmin() {
    ui.initTheme();
    initTranslations();
    setupSidebarNavigation();
    renderActiveTab();
    
    // Wire language switcher in header
    const langBtn = document.getElementById('btn-lang-toggle');
    if (langBtn) {
        const updateLangBtnText = () => {
            const current = getLanguage();
            langBtn.textContent = current === 'en' ? '\u0627\u0644\u0639\u0631\u0628\u064A\u0629' : 'English';
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

    // Wire logout button in header
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('qs_admin_token');
            localStorage.removeItem('qs_admin_user');
            window.location.href = 'login.html';
        });
    }

    // Subscribe to database changes to refresh tables/map reactively
    db.subscribe('orders_updated', () => {
        if (activeTab === 'analytics') renderActiveTab();
    });
    db.subscribe('users_updated', () => {
        if (activeTab === 'users') renderActiveTab();
    });
    db.subscribe('offers_updated', () => {
        if (activeTab === 'offers') renderActiveTab();
    });
    
    // Subscribe to external language switches
    subscribeLangChange(() => {
        initTranslations();
        renderActiveTab();
    });
}

function updateBadges() {}

// Bind menu item clicks
function setupSidebarNavigation() {
    const links = document.querySelectorAll('.sidebar-link');
    links.forEach(link => {
        link.addEventListener('click', () => {
            links.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            activeTab = link.getAttribute('data-tab');
            renderActiveTab();
        });
    });
}

// Re-run translations and setup section headers
function updateHeaders() {
    const titleEl = document.getElementById('section-title');
    const descEl = document.getElementById('section-desc');
    
    if (titleEl && descEl) {
        titleEl.setAttribute('data-i18n', `sa_section_${activeTab}_title`);
        descEl.setAttribute('data-i18n', `sa_section_${activeTab}_sub`);
        
        initTranslations();
    }
}

// Render dynamic sub-content area
function renderActiveTab() {
    updateHeaders();
    const container = document.getElementById('sa-tab-container');
    container.replaceChildren();
    
    // Clear active charts memory
    activeChartInstances.forEach(c => { if(c) c.destroy(); });
    activeChartInstances = [];

    if (activeTab === 'analytics') {
        renderAnalyticsTab(container);
    } else if (activeTab === 'main-categories') {
        renderMainCategoriesTab(container);
    } else if (activeTab === 'offers') {
        renderOffersTab(container);
    } else if (activeTab === 'cms') {
        renderCmsTab(container);
    } else if (activeTab === 'captains') {
        renderCaptainsTab(container);
    } else if (activeTab === 'users') {
        renderUsersTab(container);
    } else if (activeTab === 'dispatch') {
        renderDispatchTab(container);
    } else if (activeTab === 'orders') {
        renderOrdersTab(container);
    } else if (activeTab === 'settings') {
        renderSettingsTab(container);
    }
}

/* ==========================================================================
   Tab 1: Analytics Overview
   ========================================================================== */
function renderAnalyticsTab(parent) {
    // Math indicators
    const totalOrders = db.orders.length;
    const completedOrders = db.orders.filter(o => o.status === 'completed');
    const gmv = db.orders.reduce((sum, o) => sum + o.totalPrice, 0);
    const commissionEarned = db.orders.reduce((sum, o) => sum + o.commission, 0);
    const totalUsers = db.users.filter(u => u.role === 'Customer' || u.role === 'Captain').length;
    const totalVendors = db.vendors.length;

    // Grid container
    const grid = ui.createElement('div', ['analytics-grid']);
    
    // Summary Cards
    const card1 = ui.createElement('div', ['summary-card']);
    card1.appendChild(ui.createElementWithText('div', t('sa_analytics_gmv'), ['card-title']));
    const gmvText = getLanguage() === 'ar' ? `${gmv.toFixed(2)} \u062C.\u0645` : `${gmv.toFixed(2)} EGP`;
    card1.appendChild(ui.createElementWithText('div', gmvText, ['card-value']));
    const trendText = getLanguage() === 'ar' ? '\u25B2 +12.4% \u0645\u0642\u0627\u0631\u0646\u0629 \u0628\u0627\u0644\u0623\u0633\u0628\u0648\u0639 \u0627\u0644\u0645\u0627\u0636\u064A' : '\u25B2 +12.4% vs last week';
    const trend1 = ui.createElementWithText('div', trendText, ['card-subtext', 'trend-up']);
    card1.appendChild(trend1);
    
    const card2 = ui.createElement('div', ['summary-card']);
    card2.appendChild(ui.createElementWithText('div', t('sa_analytics_revenue'), ['card-title']));
    const revText = getLanguage() === 'ar' ? `${commissionEarned.toFixed(2)} \u062C.\u0645` : `${commissionEarned.toFixed(2)} EGP`;
    card2.appendChild(ui.createElementWithText('div', revText, ['card-value']));
    card2.appendChild(ui.createElementWithText('div', t('sa_analytics_revenue_sub'), ['card-subtext']));
    
    const card3 = ui.createElement('div', ['summary-card']);
    card3.appendChild(ui.createElementWithText('div', t('sa_analytics_orders'), ['card-title']));
    card3.appendChild(ui.createElementWithText('div', totalOrders.toString(), ['card-value']));
    card3.appendChild(ui.createElementWithText('div', t('sa_analytics_orders_sub', { completed: completedOrders.length }), ['card-subtext']));
    
    const card4 = ui.createElement('div', ['summary-card']);
    card4.appendChild(ui.createElementWithText('div', t('sa_analytics_partners'), ['card-title']));
    card4.appendChild(ui.createElementWithText('div', `${totalUsers + totalVendors}`, ['card-value']));
    card4.appendChild(ui.createElementWithText('div', t('sa_analytics_partners_sub', { users: totalUsers, vendors: totalVendors }), ['card-subtext']));

    grid.appendChild(card1);
    grid.appendChild(card2);
    grid.appendChild(card3);
    grid.appendChild(card4);
    parent.appendChild(grid);

    // Filters and Charts
    const chartsWrapper = ui.createElement('div', ['charts-row']);
    
    // Chart Container Left
    const chartPanel1 = ui.createElement('div', ['glass-panel']);
    const cpHeader1 = ui.createElement('div', ['panel-header']);
    cpHeader1.appendChild(ui.createElementWithText('div', t('sa_analytics_chart_sales'), ['panel-title']));
    
    // Add simple filter elements
    const filterSelect = ui.createElement('select', ['select-input']);
    filterSelect.appendChild(ui.createElementWithText('option', t('sa_analytics_chart_sales_all'), [], { value: 'all' }));
    filterSelect.appendChild(ui.createElementWithText('option', t('sa_analytics_chart_sales_c'), [], { value: 'c' }));
    filterSelect.appendChild(ui.createElementWithText('option', t('sa_analytics_chart_sales_w'), [], { value: 'w' }));
    cpHeader1.appendChild(filterSelect);
    
    chartPanel1.appendChild(cpHeader1);
    
    const canvasContainer1 = ui.createElement('div', ['chart-container']);
    const canvas1 = ui.createElement('canvas', [], { id: 'sa-chart-sales' });
    canvasContainer1.appendChild(canvas1);
    chartPanel1.appendChild(canvasContainer1);
    
    // Chart Container Right (Commission shares)
    const chartPanel2 = ui.createElement('div', ['glass-panel']);
    chartPanel2.appendChild(ui.createElementWithText('div', t('sa_analytics_chart_categories'), ['panel-title', 'panel-header']));
    
    const canvasContainer2 = ui.createElement('div', ['chart-container']);
    const canvas2 = ui.createElement('canvas', [], { id: 'sa-chart-categories' });
    canvasContainer2.appendChild(canvas2);
    chartPanel2.appendChild(canvasContainer2);

    chartsWrapper.appendChild(chartPanel1);
    chartsWrapper.appendChild(chartPanel2);
    parent.appendChild(chartsWrapper);

    // Render Chart.js figures safely
    setTimeout(() => {
        const ctx1 = document.getElementById('sa-chart-sales');
        const ctx2 = document.getElementById('sa-chart-categories');
        
        if (ctx1 && ctx2 && window.Chart) {
            const chart1 = ui.renderChart(ctx1, {
                type: 'line',
                data: {
                    labels: getLanguage() === 'ar' ? ['\u0625\u062B\u0646\u064A\u0646', '\u062B\u0644\u0627\u062B\u0627\u0621', '\u0623\u0631\u0628\u0639\u0627\u0621', '\u062E\u0645\u064A\u0633', '\u062C\u0645\u0639\u0629', '\u0633\u0628\u062A', '\u0623\u062D\u062F'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                    datasets: [
                        {
                            label: getLanguage() === 'ar' ? '\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0645\u0628\u064A\u0639\u0627\u062A (\u062C.\u0645)' : 'Gross GMV (EGP)',
                            data: [320, 410, 390, 580, 720, 680, 890],
                            borderColor: '#8b5cf6',
                            backgroundColor: 'rgba(139, 92, 246, 0.1)',
                            fill: true,
                            tension: 0.4
                        },
                        {
                            label: getLanguage() === 'ar' ? '\u062D\u062C\u0645 \u0627\u0644\u0637\u0644\u0628\u0627\u062A' : 'Order Volume',
                            data: [15, 21, 18, 30, 42, 38, 55],
                            borderColor: '#2ed573',
                            backgroundColor: 'rgba(46, 213, 115, 0.1)',
                            fill: false,
                            tension: 0.2,
                            yAxisID: 'y1'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { type: 'linear', display: true, position: getLanguage() === 'ar' ? 'right' : 'left', grid: { color: 'rgba(255,255,255,0.05)' } },
                        y1: { type: 'linear', display: true, position: getLanguage() === 'ar' ? 'left' : 'right', grid: { drawOnChartArea: false } }
                    }
                }
            });
            activeChartInstances.push(chart1);

            const labelRest = getLanguage() === 'ar' ? '\u0627\u0644\u0645\u0637\u0627\u0639\u0645' : 'Restaurants';
            const labelMkt = getLanguage() === 'ar' ? '\u0627\u0644\u0633\u0648\u0628\u0631\u0645\u0627\u0631\u0643\u062A' : 'Supermarkets';
            const labelGrill = getLanguage() === 'ar' ? '\u0627\u0644\u0645\u0634\u0648\u064A\u0627\u062A' : 'Grills';

            const chart2 = ui.renderChart(ctx2, {
                type: 'doughnut',
                data: {
                    labels: [labelRest, labelMkt, labelGrill],
                    datasets: [{
                        data: [55, 30, 15],
                        backgroundColor: ['#8b5cf6', '#2ed573', '#ff4757'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { color: '#a0aec0' } }
                    }
                }
            });
            activeChartInstances.push(chart2);
        }
    }, 100);
}

/* ==========================================================================
   Tab 2: Account Rejection Reasons Helpers
   ========================================================================== */
function saveRejectionReason(userId, reason) {
    const reasons = JSON.parse(localStorage.getItem('qs_rejection_reasons') || '{}');
    reasons[userId] = reason;
    localStorage.setItem('qs_rejection_reasons', JSON.stringify(reasons));
}

function getRejectionReason(userId) {
    const reasons = JSON.parse(localStorage.getItem('qs_rejection_reasons') || '{}');
    return reasons[userId] || '';
}

function showRejectReasonModal(userId, userName, onRejectCallback) {
    const modalBody = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.75rem;' });
    
    const descText = t('sa_approvals_reject_desc', { name: userName });
    modalBody.appendChild(ui.createElementWithText('p', descText, [], { style: 'font-weight: 500;' }));
    
    const textarea = ui.createElement('textarea', ['select-input'], {
        placeholder: t('sa_approvals_reject_placeholder'),
        rows: '4',
        style: 'width: 100%; resize: vertical; margin-top: 0.5rem; font-family: inherit; font-size: 0.9rem; padding: 0.75rem;'
    });
    
    modalBody.appendChild(textarea);
    
    ui.showModal(t('sa_approvals_reject_title'), modalBody, [
        {
            text: t('sa_approvals_reject_confirm'),
            type: 'danger',
            onClick: async () => {
                const reason = textarea.value.trim();
                if (!reason) {
                    ui.showToast(getLanguage() === 'ar' ? '\u064A\u0631\u062C\u064A \u0625\u062F\u062E\u0627\u0644 \u0633\u0628\u0628 \u0627\u0644\u0631\u0641\u0636' : 'Please specify a rejection reason', 'warning');
                    return;
                }
                
                try {
                    await apiFetch('/api/v1/users/toggle-status', {
                        method: 'PATCH',
                        body: JSON.stringify({ id: parseInt(userId), status: 2 })
                    });
                    
                    saveRejectionReason(userId, reason);
                    
                    ui.closeModal();
                    if (onRejectCallback) onRejectCallback(reason);
                    
                    renderActiveTab();
                    ui.showToast(getLanguage() === 'ar' ? '\u062A\u0645 \u0631\u0641\u0636 \u0627\u0644\u062D\u0633\u0627\u0628 \u0628\u0646\u062C\u0627\u062D' : 'Account rejected successfully', 'success');
                } catch (err) {
                    console.error('Reject account error:', err);
                    ui.showToast('Error: ' + err.message, 'error');
                }
            },
            closeOnClick: false
        },
        {
            text: t('cancel'),
            type: 'secondary',
            onClick: ui.closeModal
        }
    ]);
}

/* ==========================================================================
   Tab 3: Account activation & User Management
   ========================================================================== */
let cachedAccounts = [];

async function fetchAccounts(status = 0) {
    try {
        let usersData = [];
        if (status === 'all') {
            const results = await Promise.all([
                apiFetch('/api/v1/users/paginate?pageNumber=1&pageSize=1000&userStatus=0&role=0'),
                apiFetch('/api/v1/users/paginate?pageNumber=1&pageSize=1000&userStatus=0&role=1'),
                apiFetch('/api/v1/users/paginate?pageNumber=1&pageSize=1000&userStatus=1&role=0'),
                apiFetch('/api/v1/users/paginate?pageNumber=1&pageSize=1000&userStatus=1&role=1'),
                apiFetch('/api/v1/users/paginate?pageNumber=1&pageSize=1000&userStatus=2&role=0'),
                apiFetch('/api/v1/users/paginate?pageNumber=1&pageSize=1000&userStatus=2&role=1')
            ]);
            usersData = [
                ...(results[0]?.result || []),
                ...(results[1]?.result || []),
                ...(results[2]?.result || []),
                ...(results[3]?.result || []),
                ...(results[4]?.result || []),
                ...(results[5]?.result || [])
            ];
        } else {
            const results = await Promise.all([
                apiFetch(`/api/v1/users/paginate?pageNumber=1&pageSize=1000&userStatus=${status}&role=0`),
                apiFetch(`/api/v1/users/paginate?pageNumber=1&pageSize=1000&userStatus=${status}&role=1`)
            ]);
            usersData = [
                ...(results[0]?.result || []),
                ...(results[1]?.result || [])
            ];
        }

        return usersData.map(u => {
            const roleVal = parseInt(u.role);

            let roleName = 'User';
            let vendorType = '';
            let isVendor = false;

            if (roleVal === 3) {
                roleName = 'Captain';
            } else if (roleVal === 0) {
                roleName = 'Vendor';
                vendorType = 'Restaurant';
                isVendor = true;
            } else if (roleVal === 1) {
                roleName = 'Vendor';
                vendorType = 'Market';
                isVendor = true;
            } else if (roleVal === 2) {
                roleName = 'Customer';
            } else if (roleVal === 4) {
                roleName = 'Admin';
            }

            const statusVal = parseInt(u.status) || 0;
            return {
                id: u.id?.toString() || '',
                name: u.name || 'N/A',
                phone: u.phone || '',
                email: u.email || '',
                role: roleName,
                vendorType: vendorType,
                status: statusVal,        // 0=pending, 1=active, 2=rejected
                isActive: statusVal === 1,
                isBlocked: statusVal === 2,
                isPending: statusVal === 0,
                isVendor: isVendor
            };
        }).filter(u => u !== null);
    } catch (e) {
        console.error("Failed to fetch accounts from API:", e);
        return [];
    }
}

function renderUsersTab(parent) {
    const panel = ui.createElement('div', ['glass-panel']);
    
    // Search filter block + Create Vendor Button
    const filterRow = ui.createElement('div', ['filter-bar']);
    
    const searchInput = ui.createElement('input', ['search-input'], {
        id: 'user-search-field',
        placeholder: t('sa_users_search_placeholder'),
        type: 'text'
    });
    
    const roleFilter = ui.createElement('select', ['select-input'], { id: 'user-role-select' });
    roleFilter.appendChild(ui.createElementWithText('option', t('sa_users_role_all'), [], { value: 'all' }));
    roleFilter.appendChild(ui.createElementWithText('option', t('sa_users_role_customer'), [], { value: 'Customer' }));
    roleFilter.appendChild(ui.createElementWithText('option', t('sa_users_role_vendor'), [], { value: 'Vendor' }));
    
    const statusFilter = ui.createElement('select', ['select-input'], { id: 'user-status-select' });
    statusFilter.appendChild(ui.createElementWithText('option', getLanguage() === 'ar' ? '\u0645\u0639\u0644\u0642 (\u064A\u062D\u062A\u0627\u062C \u062A\u0641\u0639\u064A\u0644)' : 'Pending Activation', [], { value: '0' }));
    statusFilter.appendChild(ui.createElementWithText('option', getLanguage() === 'ar' ? '\u0646\u0634\u0637' : 'Active', [], { value: '1' }));
    statusFilter.appendChild(ui.createElementWithText('option', getLanguage() === 'ar' ? '\u0645\u0631\u0641\u0648\u0636' : 'Rejected', [], { value: '2' }));
    statusFilter.appendChild(ui.createElementWithText('option', getLanguage() === 'ar' ? '\u0643\u0644 \u0627\u0644\u062D\u0627\u0644\u0627\u062A' : 'All Statuses', [], { value: 'all' }));
    
    const createVendorBtn = ui.createElementWithText('button', t('btn_create_vendor'), ['btn', 'btn-primary'], { id: 'btn-create-vendor' });
    createVendorBtn.addEventListener('click', showCreateVendorModal);
    
    filterRow.appendChild(searchInput);
    filterRow.appendChild(roleFilter);
    filterRow.appendChild(statusFilter);
    filterRow.appendChild(createVendorBtn);
    panel.appendChild(filterRow);

    // List Container
    const listContainer = ui.createElement('div', ['table-responsive']);
    
    // Initial loading spinner
    const loadingBlock = ui.createElement('div', [], { style: 'text-align: center; padding: 3rem 1rem;' });
    const spinner = ui.createElement('div', ['spinner'], { style: 'display: inline-block; width: 30px; height: 30px; border: 3px solid rgba(255,255,255,0.1); border-top-color: var(--admin-color); border-radius: 50%; animation: spin 0.8s linear infinite;' });
    loadingBlock.appendChild(spinner);
    loadingBlock.appendChild(ui.createElementWithText('p', getLanguage() === 'ar' ? '\u062C\u0627\u0631\u064A \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u062D\u0633\u0627\u0628\u0627\u062A...' : 'Loading accounts...', [], { style: 'margin-top: 0.75rem; color: var(--text-secondary); font-size: 0.9rem;' }));
    listContainer.appendChild(loadingBlock);
    
    panel.appendChild(listContainer);
    parent.appendChild(panel);
    
    // Filter trigger logic
    const applyFilters = () => {
        const query = searchInput.value.toLowerCase();
        const role = roleFilter.value;
        const statusVal = statusFilter.value;
        
        const filtered = cachedAccounts.filter(u => {
            const matchesQuery = u.name.toLowerCase().includes(query) || 
                                 u.phone.includes(query) || 
                                 u.email.toLowerCase().includes(query) ||
                                 u.id.toLowerCase().includes(query);
            
            const matchesRole = role === 'all' || u.role === role;
            const matchesStatus = statusVal === 'all' || u.status === parseInt(statusVal);
            return matchesQuery && matchesRole && matchesStatus;
        });
        
        renderUsersTable(listContainer, filtered);
    };

    searchInput.addEventListener('input', applyFilters);
    roleFilter.addEventListener('change', applyFilters);
    
    statusFilter.addEventListener('change', () => {
        listContainer.replaceChildren();
        const loadingBlock = ui.createElement('div', [], { style: 'text-align: center; padding: 3rem 1rem;' });
        const spinner = ui.createElement('div', ['spinner'], { style: 'display: inline-block; width: 30px; height: 30px; border: 3px solid rgba(255,255,255,0.1); border-top-color: var(--admin-color); border-radius: 50%; animation: spin 0.8s linear infinite;' });
        loadingBlock.appendChild(spinner);
        loadingBlock.appendChild(ui.createElementWithText('p', getLanguage() === 'ar' ? '\u062C\u0627\u0631\u064A \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u062D\u0633\u0627\u0628\u0627\u062A...' : 'Loading accounts...', [], { style: 'margin-top: 0.75rem; color: var(--text-secondary); font-size: 0.9rem;' }));
        listContainer.appendChild(loadingBlock);

        const statusVal = statusFilter.value;
        fetchAccounts(statusVal).then(accounts => {
            cachedAccounts = accounts;
            applyFilters();
        });
    });
    
    // Fetch and display data (defaults to status 0 / Pending)
    fetchAccounts(0).then(accounts => {
        cachedAccounts = accounts;
        applyFilters();
    });
}

function renderUsersTable(targetEl, usersList) {
    targetEl.replaceChildren();
    
    if (usersList.length === 0) {
        targetEl.appendChild(ui.createElementWithText('p', t('sa_users_empty'), [], { style: 'text-align: center; padding: 2rem; color: var(--text-muted);' }));
        return;
    }
    
    const table = ui.createElement('table', ['custom-table']);
    const thead = ui.createElement('thead');
    const headRow = ui.createElement('tr');
    headRow.appendChild(ui.createElementWithText('th', t('sa_users_col_id')));
    headRow.appendChild(ui.createElementWithText('th', t('sa_users_col_name')));
    headRow.appendChild(ui.createElementWithText('th', t('sa_users_col_role')));
    headRow.appendChild(ui.createElementWithText('th', t('sa_users_col_phone')));
    headRow.appendChild(ui.createElementWithText('th', t('sa_users_col_email')));
    headRow.appendChild(ui.createElementWithText('th', t('sa_users_col_status')));
    headRow.appendChild(ui.createElementWithText('th', t('sa_users_col_action')));
    thead.appendChild(headRow);
    table.appendChild(thead);
    
    const tbody = ui.createElement('tbody');
    usersList.forEach(u => {
        const row = ui.createElement('tr');
        
        row.appendChild(ui.createElementWithText('td', u.id, [], { style: 'font-family: monospace; color: var(--text-muted);' }));
        row.appendChild(ui.createElementWithText('td', u.name, [], { style: 'font-weight: 600;' }));
        
        const roleCell = ui.createElement('td');
        let roleBadgeClass = 'badge-info';
        let roleTextTrans = t('sa_users_role_captain');
        if (u.role === 'Customer') {
            roleBadgeClass = 'badge-success';
            roleTextTrans = t('sa_users_role_customer');
        } else if (u.role === 'Vendor') {
            roleBadgeClass = 'badge-pending';
            roleTextTrans = u.vendorType ? `${t('sa_users_role_vendor')} (${getLanguage() === 'ar' && u.vendorType === 'Restaurant' ? '\u0645\u0637\u0639\u0645' : (getLanguage() === 'ar' && u.vendorType === 'Market' ? '\u0645\u0627\u0631\u0643\u062A' : u.vendorType)})` : t('sa_users_role_vendor');
        } else if (u.role === 'Admin') {
            roleBadgeClass = 'badge-success';
            roleTextTrans = 'Admin';
        } else if (u.role === 'User') {
            roleBadgeClass = 'badge-info';
            roleTextTrans = 'User';
        }
        
        const rBadge = ui.createElementWithText('span', roleTextTrans, ['badge', roleBadgeClass]);
        roleCell.appendChild(rBadge);
        row.appendChild(roleCell);
        
        row.appendChild(ui.createElementWithText('td', u.phone));
        row.appendChild(ui.createElementWithText('td', u.email));
        
        const statusCell = ui.createElement('td');
        let sBadgeClass = 'badge-pending';
        let sBadgeText = getLanguage() === 'ar' ? '\u0645\u0639\u0644\u0642' : 'Pending';
        if (u.status === 1) {
            sBadgeClass = 'badge-success';
            sBadgeText = t('sa_users_status_active');
        } else if (u.status === 2) {
            sBadgeClass = 'badge-danger';
            sBadgeText = t('sa_users_status_blocked');
        }
        const sBadge = ui.createElementWithText('span', sBadgeText, ['badge', sBadgeClass]);
        statusCell.appendChild(sBadge);
        
        const rejectionReason = getRejectionReason(u.id);
        if (rejectionReason) {
            const reasonEl = ui.createElementWithText('div', rejectionReason, [], {
                style: 'font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem; max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
                title: rejectionReason
            });
            statusCell.appendChild(reasonEl);
        }
        row.appendChild(statusCell);
        
        const actionCell = ui.createElement('td');
        actionCell.style.display = 'flex';
        actionCell.style.gap = '0.4rem';
        actionCell.style.flexWrap = 'wrap';
        
        if (u.status === 0) {
            const approveBtn = ui.createElementWithText('button',
                getLanguage() === 'ar' ? '\u2705 \u0642\u0628\u0648\u0644' : '\u2705 Approve',
                ['btn', 'btn-success', 'btn-sm']);
            approveBtn.addEventListener('click', async () => {
                if (!u.isVendor) {
                    ui.showToast(getLanguage() === 'ar' ? '\u064A\u0631\u062C\u064A \u062A\u0641\u0639\u064A\u0644 \u062D\u0633\u0627\u0628 \u0627\u0644\u0645\u062A\u062C\u0631 \u0623\u0648 \u0627\u0644\u0645\u0637\u0639\u0645 \u0641\u0642\u0637' : 'Account role must be Restaurant or Market to activate', 'error');
                    return;
                }
                approveBtn.disabled = true;
                try {
                    await apiFetch('/api/v1/users/toggle-status', {
                        method: 'PATCH',
                        body: JSON.stringify({ id: parseInt(u.id), status: 1 })
                    });
                    u.status = 1; u.isActive = true; u.isPending = false;
                    renderActiveTab();
                    ui.showToast(getLanguage() === 'ar' ? '\u062A\u0645 \u0642\u0628\u0648\u0644 \u0627\u0644\u062D\u0633\u0627\u0628 \u0628\u0646\u062C\u0627\u062D' : 'Account approved successfully', 'success');
                } catch (err) {
                    console.error('Approve error:', err);
                    ui.showToast('Error: ' + err.message, 'error');
                    approveBtn.disabled = false;
                }
            });
            
            const rejectBtn = ui.createElementWithText('button',
                getLanguage() === 'ar' ? '\u274C \u0631\u0641\u0636' : '\u274C Reject',
                ['btn', 'btn-danger', 'btn-sm']);
            rejectBtn.addEventListener('click', () => {
                showRejectReasonModal(u.id, u.name, () => {
                    u.status = 2;
                    u.isPending = false;
                    u.isBlocked = true;
                });
            });
            
            actionCell.appendChild(approveBtn);
            actionCell.appendChild(rejectBtn);
            
        } else if (u.status === 1) {
            const blockBtn = ui.createElementWithText('button',
                getLanguage() === 'ar' ? '\uD83D\uDEAB \u062D\u0638\u0631' : '\uD83D\uDEAB Block',
                ['btn', 'btn-danger', 'btn-sm']);
            blockBtn.addEventListener('click', () => showBlockReasonModal(u));
            actionCell.appendChild(blockBtn);
            
        } else if (u.status === 2) {
            const restoreBtn = ui.createElementWithText('button',
                getLanguage() === 'ar' ? '\u21A9 \u0627\u0633\u062A\u0639\u0627\u062F\u0629' : '\u21A9 Restore',
                ['btn', 'btn-secondary', 'btn-sm']);
            restoreBtn.addEventListener('click', async () => {
                restoreBtn.disabled = true;
                try {
                    await apiFetch('/api/v1/users/toggle-status', {
                        method: 'PATCH',
                        body: JSON.stringify({ id: parseInt(u.id), status: 1 })
                    });
                    u.status = 1; u.isActive = true; u.isBlocked = false;
                    renderActiveTab();
                    ui.showToast(getLanguage() === 'ar' ? '\u062A\u0645 \u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0627\u0644\u062D\u0633\u0627\u0628 \u0628\u0646\u062C\u0627\u062D' : 'Account restored successfully', 'success');
                } catch (err) {
                    console.error('Restore error:', err);
                    ui.showToast('Error: ' + err.message, 'error');
                    restoreBtn.disabled = false;
                }
            });
            actionCell.appendChild(restoreBtn);
        }
        
        // Add Delete Button for all accounts
        const deleteBtn = ui.createElementWithText('button',
            t('sa_users_delete_btn'),
            ['btn', 'btn-danger', 'btn-sm']);
        deleteBtn.addEventListener('click', () => showDeleteAccountModal(u));
        actionCell.appendChild(deleteBtn);
        
        row.appendChild(actionCell);
        tbody.appendChild(row);
    });
    
    table.appendChild(tbody);
    targetEl.appendChild(table);
}

function showBlockReasonModal(user) {
    const modalBody = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.75rem;' });
    modalBody.appendChild(ui.createElementWithText('p', t('sa_users_block_desc', { name: user.name })));
    
    const textarea = ui.createElement('textarea', ['select-input'], {
        placeholder: t('sa_users_block_placeholder'),
        rows: '4',
        style: 'width: 100%; resize: vertical; margin-top: 0.5rem; font-family: inherit; font-size: 0.9rem; padding: 0.75rem;'
    });
    modalBody.appendChild(textarea);
    
    ui.showModal(t('sa_users_block_title'), modalBody, [
        {
            text: t('sa_users_block_btn'),
            type: 'danger',
            onClick: async () => {
                const reason = textarea.value.trim();
                if (!reason) {
                    ui.showToast(getLanguage() === 'ar' ? '\u064A\u0631\u062C\u064A \u0625\u062F\u062E\u0627\u0644 \u0633\u0628\u0628 \u0627\u0644\u062D\u0638\u0631' : 'Please specify a block reason', 'warning');
                    return;
                }
                
                try {
                    await apiFetch('/api/v1/users/toggle-status', {
                        method: 'PATCH',
                        body: JSON.stringify({
                            id: parseInt(user.id),
                            status: 2
                        })
                    });
                    
                    saveRejectionReason(user.id, reason);
                    
                    user.status = 2;
                    user.isActive = false;
                    user.isBlocked = true;
                    ui.closeModal();
                    renderActiveTab();
                    ui.showToast(getLanguage() === 'ar' ? '\u062A\u0645 \u062D\u0638\u0631 \u0627\u0644\u062D\u0633\u0627\u0628 \u0628\u0646\u062C\u0627\u062D' : 'Account blocked successfully', 'success');
                } catch (err) {
                    console.error("Block account error:", err);
                    ui.showToast("Error: " + err.message, 'error');
                    ui.closeModal();
                }
            },
            closeOnClick: false
        },
        {
            text: t('cancel'),
            type: 'secondary',
            onClick: ui.closeModal
        }
    ]);
}

function showDeleteAccountModal(user) {
    const modalBody = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.75rem;' });
    
    const descText = t('sa_users_delete_confirm', { name: user.name });
    modalBody.appendChild(ui.createElementWithText('p', descText, [], { style: 'font-weight: 500;' }));
    
    ui.showModal(getLanguage() === 'ar' ? 'حذف الحساب' : 'Delete Account', modalBody, [
        {
            text: getLanguage() === 'ar' ? 'تأكيد الحذف' : 'Confirm Delete',
            type: 'danger',
            onClick: async () => {
                try {
                    await apiFetch(`/api/v1/users/delete-account?id=${user.id}`, {
                        method: 'DELETE'
                    });
                    
                    ui.closeModal();
                    
                    // Remove from local list and refresh layout
                    cachedAccounts = cachedAccounts.filter(a => a.id !== user.id);
                    renderActiveTab();
                    
                    ui.showToast(t('sa_users_delete_success'), 'success');
                } catch (err) {
                    console.error('Delete account error:', err);
                    ui.showToast('Error: ' + err.message, 'error');
                    ui.closeModal();
                }
            },
            closeOnClick: false
        },
        {
            text: t('cancel'),
            type: 'secondary',
            onClick: ui.closeModal
        }
    ]);
}

/* ==========================================================================
   Tab: Captains Verification & Document Approval
   ========================================================================== */
async function renderCaptainsTab(parent) {
    const isAr = getLanguage() === 'ar';

    const panel = ui.createElement('div', ['glass-panel'], { style: 'padding: 1.5rem;' });

    // Header Title
    const headerTitle = ui.createElement('div', [], { style: 'margin-bottom: 1.25rem;' });
    headerTitle.innerHTML = `
        <h2 style="font-size: 1.4rem; font-weight: 700; color: var(--text-primary); margin: 0 0 0.3rem 0; display: flex; align-items: center; gap: 0.5rem;">
            🛵 ${isAr ? 'حسابات الطيارين ومراجعة التوثيق' : 'Captains Accounts & Document Verification'}
        </h2>
        <p style="font-size: 0.88rem; color: var(--text-muted); margin: 0;">
            ${isAr ? 'مراجعة أوراق ورخص كباتن التوصيل، وقبول أو رفض طلبات التسجيل' : 'Inspect uploaded captain documents, driving licenses, and approve or reject join requests.'}
        </p>
    `;
    panel.appendChild(headerTitle);

    // Stats Toolbar (Pending, Active, Rejected, Total)
    const statsToolbar = ui.createElement('div', [], {
        style: 'display: flex; gap: 0.8rem; margin-bottom: 1.25rem; flex-wrap: wrap; align-items: center;'
    });
    panel.appendChild(statsToolbar);

    // Filter Bar (Search + Status Filter Pills)
    const filterRow = ui.createElement('div', [], {
        style: 'display: flex; gap: 0.8rem; margin-bottom: 1.5rem; flex-wrap: wrap; justify-content: space-between; align-items: center;'
    });

    const searchInput = ui.createElement('input', ['search-input'], {
        placeholder: isAr ? '🔍 البحث باسم الكابتن، الهاتـف، أو رقم الموديل...' : '🔍 Search by Name, Phone, ID...',
        type: 'text',
        style: 'max-width: 320px; flex: 1;'
    });

    const statusPillsContainer = ui.createElement('div', [], {
        style: 'display: flex; gap: 0.4rem; flex-wrap: wrap;'
    });

    filterRow.appendChild(searchInput);
    filterRow.appendChild(statusPillsContainer);
    panel.appendChild(filterRow);

    // Grid Container for Captains Cards
    const cardsGrid = ui.createElement('div', [], {
        style: 'display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.25rem;'
    });

    const loadingBlock = ui.createElement('div', [], { style: 'grid-column: 1 / -1; text-align: center; padding: 3rem 1rem;' });
    loadingBlock.innerHTML = `<div class="spinner" style="display: inline-block; width: 32px; height: 32px; border: 3px solid rgba(255,255,255,0.1); border-top-color: var(--admin-color); border-radius: 50%; animation: spin 0.8s linear infinite;"></div><p style="margin-top: 0.75rem; color: var(--text-secondary);">${isAr ? 'جاري تحميل قائمة الطيارين...' : 'Loading captains...'}</p>`;
    cardsGrid.appendChild(loadingBlock);
    panel.appendChild(cardsGrid);

    parent.appendChild(panel);

    let allCaptains = [];
    let activeStatusFilter = 'all';

    async function loadCaptainsData() {
        try {
            // Fetch users with role 3 (Captains) and deliveries endpoints in parallel
            const [usersRes, deliveriesRes] = await Promise.allSettled([
                apiFetch('/api/v1/users/paginate?pageNumber=1&pageSize=1000&role=3&enablePagination=false'),
                apiFetch('/api/v1/deliveries/paginate?pageNumber=1&pageSize=1000&enablePagination=false')
                    .catch(() => apiFetch('/api/v1/deliveries', { method: 'PATCH', body: JSON.stringify({ pageNumber: 1, pageSize: 1000, enablePagination: false }) }))
            ]);

            const rawUsers = usersRes.status === 'fulfilled' ? (usersRes.value?.result || (Array.isArray(usersRes.value) ? usersRes.value : [])) : [];
            const rawDeliveries = deliveriesRes.status === 'fulfilled' ? (deliveriesRes.value?.result || (Array.isArray(deliveriesRes.value) ? deliveriesRes.value : [])) : [];

            // Index deliveries by id or creatorId or userId
            const deliveriesMap = {};
            rawDeliveries.forEach(d => {
                const key = d.id || d.creatorId || d.userId;
                if (key) deliveriesMap[key.toString()] = d;
            });

            // Merge user and delivery records
            allCaptains = rawUsers.map(c => {
                const cId = c.id?.toString() || '';
                const delObj = deliveriesMap[cId] || {};

                return {
                    id: cId,
                    name: c.name || delObj.name || (isAr ? 'كابتن بدون اسم' : 'Unnamed Captain'),
                    phone: c.phone || delObj.phone || '-',
                    email: c.email || delObj.email || '-',
                    photo: c.photo || c.avatar || delObj.photo || delObj.avatar || '',
                    status: parseInt(c.status) ?? parseInt(delObj.status) ?? 0,
                    createdOn: c.createdOn ? new Date(c.createdOn).toLocaleDateString(isAr ? 'ar-EG' : 'en-US') : '-',
                    description: c.description || delObj.description || '',
                    raw: { ...c, ...delObj }
                };
            });

            renderStatsAndGrid();
        } catch (err) {
            console.error('Failed to load captains data:', err);
            cardsGrid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:2rem; color:var(--color-danger);">${isAr ? '❌ فشل تحميل قائمة الطيارين' : '❌ Failed to load captains'}</div>`;
        }
    }

    function renderStatsAndGrid() {
        // Counts
        const pendingCount = allCaptains.filter(c => c.status === 0).length;
        const activeCount = allCaptains.filter(c => c.status === 1).length;
        const rejectedCount = allCaptains.filter(c => c.status === 2).length;
        const totalCount = allCaptains.length;

        // Render Toolbar Chips
        statsToolbar.innerHTML = `
            <div class="category-badge-chip" style="background: rgba(241, 196, 15, 0.15); color: #f1c40f; border: 1px solid rgba(241, 196, 15, 0.3);">
                ⏳ ${isAr ? 'بانتظار التوثيق:' : 'Pending:'} <strong>${pendingCount}</strong>
            </div>
            <div class="category-badge-chip" style="background: rgba(46, 204, 113, 0.15); color: #2ecc71; border: 1px solid rgba(46, 204, 113, 0.3);">
                ✅ ${isAr ? 'كباتن معتمدين:' : 'Active:'} <strong>${activeCount}</strong>
            </div>
            <div class="category-badge-chip" style="background: rgba(231, 76, 60, 0.15); color: #e74c3c; border: 1px solid rgba(231, 76, 60, 0.3);">
                ❌ ${isAr ? 'طلبات مرفوضة:' : 'Rejected:'} <strong>${rejectedCount}</strong>
            </div>
            <div class="category-badge-chip" style="background: rgba(255,255,255,0.05); color: var(--text-secondary); border: 1px solid var(--border-color);">
                🛵 ${isAr ? 'الإجمالي:' : 'Total:'} <strong>${totalCount}</strong>
            </div>
        `;

        // Render Filter Pills
        statusPillsContainer.innerHTML = '';
        const pills = [
            { id: 'all', label: isAr ? 'الكل' : 'All', count: totalCount },
            { id: '0', label: isAr ? '⏳ بانتظار الاعتماد' : 'Pending', count: pendingCount },
            { id: '1', label: isAr ? '✅ معتمدين' : 'Active', count: activeCount },
            { id: '2', label: isAr ? '❌ مرفوضين' : 'Rejected', count: rejectedCount }
        ];

        pills.forEach(p => {
            const btn = ui.createElement('button', ['btn', 'btn-sm'], {
                style: `border-radius: 20px; font-weight: 600; font-size: 0.82rem; transition: all 0.2s; ${activeStatusFilter === p.id ? 'background: var(--admin-color); color: #fff;' : 'background: rgba(255,255,255,0.05); color: var(--text-secondary);'}`
            });
            btn.textContent = `${p.label} (${p.count})`;
            btn.addEventListener('click', () => {
                activeStatusFilter = p.id;
                renderStatsAndGrid();
            });
            statusPillsContainer.appendChild(btn);
        });

        // Filter Grid items
        const query = searchInput.value.toLowerCase().trim();
        const filtered = allCaptains.filter(c => {
            const matchesQuery = c.name.toLowerCase().includes(query) ||
                                 c.phone.includes(query) ||
                                 c.email.toLowerCase().includes(query) ||
                                 c.id.includes(query);
            const matchesStatus = activeStatusFilter === 'all' || c.status.toString() === activeStatusFilter;
            return matchesQuery && matchesStatus;
        });

        cardsGrid.replaceChildren();

        if (filtered.length === 0) {
            cardsGrid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
                    <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🛵</div>
                    <p style="font-size: 1rem; font-weight: 600; margin: 0;">${isAr ? 'لا يوجد طيارين يطابقون البحث' : 'No captains found'}</p>
                </div>
            `;
            return;
        }

        filtered.forEach(c => {
            const card = createCaptainCard(c);
            cardsGrid.appendChild(card);
        });
    }

    searchInput.addEventListener('input', renderStatsAndGrid);

    function createCaptainCard(c) {
        const card = ui.createElement('div', ['category-card', 'admin-theme'], {
            style: 'display: flex; flex-direction: column; height: 100%; position: relative;'
        });

        // Header status badge
        let sColor = '#f1c40f', sBg = 'rgba(241, 196, 15, 0.15)', sText = isAr ? '⏳ بانتظار الاعتماد' : 'Pending Approval';
        if (c.status === 1) {
            sColor = '#2ecc71'; sBg = 'rgba(46, 204, 113, 0.15)'; sText = isAr ? '✅ كابتن معتمد' : 'Approved Captain';
        } else if (c.status === 2) {
            sColor = '#e74c3c'; sBg = 'rgba(231, 76, 60, 0.15)'; sText = isAr ? '❌ طلب مرفوض' : 'Rejected';
        }

        // Top info row with avatar
        const topRow = ui.createElement('div', [], { style: 'display: flex; gap: 1rem; align-items: center; margin-bottom: 0.8rem;' });
        
        const avatarWrapper = ui.createElement('div', [], {
            style: 'width: 58px; height: 58px; border-radius: 12px; overflow: hidden; background: rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: center; border: 1px solid var(--border-color); flex-shrink: 0;'
        });
        if (c.photo) {
            const img = ui.createElement('img', [], {
                src: getImageUrl(c.photo),
                style: 'width: 100%; height: 100%; object-fit: cover;',
                onerror: (e) => { e.target.style.display = 'none'; avatarWrapper.textContent = '🛵'; }
            });
            avatarWrapper.appendChild(img);
        } else {
            avatarWrapper.innerHTML = `<span style="font-size: 1.8rem;">🛵</span>`;
        }

        const nameDetails = ui.createElement('div', [], { style: 'flex: 1; overflow: hidden;' });
        const nameEl = ui.createElementWithText('h4', c.name, [], {
            style: 'margin: 0 0 0.25rem 0; font-size: 1rem; font-weight: 700; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;'
        });
        const phoneEl = ui.createElementWithText('div', `📞 ${c.phone}`, [], { style: 'font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 0.2rem;' });
        const dateEl = ui.createElementWithText('div', `📅 ${c.createdOn}`, [], { style: 'font-size: 0.75rem; color: var(--text-muted);' });

        nameDetails.appendChild(nameEl);
        nameDetails.appendChild(phoneEl);
        nameDetails.appendChild(dateEl);

        topRow.appendChild(avatarWrapper);
        topRow.appendChild(nameDetails);
        card.appendChild(topRow);

        // Status Badge Pill
        const badgeEl = ui.createElementWithText('div', sText, [], {
            style: `display: inline-block; padding: 0.25rem 0.6rem; border-radius: 6px; font-size: 0.78rem; font-weight: 700; background: ${sBg}; color: ${sColor}; margin-bottom: 0.8rem; border: 1px solid ${sColor}44; text-align: center;`
        });
        card.appendChild(badgeEl);

        // Inspection & Action Buttons Box
        const actionsBox = ui.createElement('div', [], { style: 'margin-top: auto; display: flex; flex-direction: column; gap: 0.5rem; padding-top: 0.75rem; border-top: 1px solid var(--border-color);' });

        // 📄 Inspect Documents Button
        const inspectBtn = ui.createElementWithText('button', isAr ? '📄 معاينة أوراق ومستندات الكابتن' : '📄 Inspect Captain Documents', ['btn', 'btn-secondary', 'btn-sm'], {
            style: 'width: 100%; border-radius: 8px; font-weight: 600; background: rgba(52, 152, 219, 0.12); color: #3498db; border: 1px solid rgba(52, 152, 219, 0.3);'
        });
        inspectBtn.addEventListener('click', () => openCaptainDocumentsModal(c));
        actionsBox.appendChild(inspectBtn);

        const statusBtnsRow = ui.createElement('div', [], { style: 'display: flex; gap: 0.4rem;' });

        if (c.status === 0 || c.status === 2) {
            const approveBtn = ui.createElementWithText('button', isAr ? '✅ قبول' : '✅ Approve', ['btn', 'btn-success', 'btn-sm'], { style: 'flex: 1; border-radius: 8px;' });
            approveBtn.addEventListener('click', async () => {
                approveBtn.disabled = true;
                try {
                    await apiFetch('/api/v1/users/toggle-status', {
                        method: 'PATCH',
                        body: JSON.stringify({ id: parseInt(c.id), status: 1 })
                    });
                    ui.showToast(isAr ? '✅ تم تفعيل وثائق الكابتن بنجاح' : '✅ Captain approved successfully', 'success');
                    await loadCaptainsData();
                } catch (err) {
                    console.error('Approve captain error:', err);
                    ui.showToast('Error: ' + err.message, 'error');
                    approveBtn.disabled = false;
                }
            });
            statusBtnsRow.appendChild(approveBtn);
        }

        if (c.status === 0 || c.status === 1) {
            const rejectBtn = ui.createElementWithText('button', isAr ? '❌ رفض' : '❌ Reject', ['btn', 'btn-danger', 'btn-sm'], { style: 'flex: 1; border-radius: 8px;' });
            rejectBtn.addEventListener('click', () => {
                showRejectReasonModal(c.id, c.name, async () => {
                    await loadCaptainsData();
                });
            });
            statusBtnsRow.appendChild(rejectBtn);
        }

        const delBtn = ui.createElementWithText('button', '🗑️', ['btn', 'btn-secondary', 'btn-sm'], { style: 'border-radius: 8px;' });
        delBtn.addEventListener('click', () => showDeleteAccountModal(c));
        statusBtnsRow.appendChild(delBtn);

        actionsBox.appendChild(statusBtnsRow);
        card.appendChild(actionsBox);

        return card;
    }

    // Modal to View/Inspect Uploaded Captain Documents
    async function openCaptainDocumentsModal(c) {
        const title = isAr ? `مستندات وأوراق الكابتن: ${c.name}` : `Captain Documents: ${c.name}`;
        
        const modalContent = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; max-height: 70vh; overflow-y: auto; padding-right: 0.3rem;' });
        
        const loadingIndicator = ui.createElement('div', [], { style: 'text-align: center; padding: 2rem;' });
        loadingIndicator.innerHTML = `<div class="spinner" style="display:inline-block; width:28px; height:28px; border:3px solid rgba(255,255,255,0.1); border-top-color:var(--admin-color); border-radius:50%; animation:spin 0.8s linear infinite;"></div><p style="margin-top:0.5rem;">${isAr ? 'جاري جلب ملفات الكابتن...' : 'Fetching captain files...'}</p>`;
        modalContent.appendChild(loadingIndicator);

        ui.showModal(title, modalContent, [
            {
                text: isAr ? '✅ قبول وتفعيل الكابتن' : '✅ Approve Captain',
                type: 'success',
                closeOnClick: false,
                onClick: async () => {
                    try {
                        await apiFetch('/api/v1/users/toggle-status', {
                            method: 'PATCH',
                            body: JSON.stringify({ id: parseInt(c.id), status: 1 })
                        });
                        ui.showToast(isAr ? '✅ تم تفعيل حساب الكابتن بنجاح' : '✅ Captain approved!', 'success');
                        ui.closeModal();
                        await loadCaptainsData();
                    } catch (err) {
                        ui.showToast('Error: ' + err.message, 'error');
                    }
                }
            },
            {
                text: isAr ? '❌ رفض الطلب' : '❌ Reject',
                type: 'danger',
                closeOnClick: false,
                onClick: () => {
                    ui.closeModal();
                    showRejectReasonModal(c.id, c.name, async () => {
                        await loadCaptainsData();
                    });
                }
            },
            {
                text: isAr ? 'إغلاق' : 'Close',
                type: 'secondary',
                onClick: ui.closeModal
            }
        ]);

        // Fetch detailed record & Delivery-specific data
        try {
            let fullUser = c.raw;
            let deliveryData = null;

            // 1. Try User GET endpoint
            try {
                const userRes = await apiFetch(`/api/v1/users/get-by-id/${c.id}`);
                if (userRes && userRes.result) fullUser = userRes.result;
            } catch (e) {
                console.warn('user get-by-id failed:', e);
            }

            // 2. Try Delivery endpoints for captain-specific licenses & documents
            try {
                const delRes = await apiFetch(`/api/v1/deliveries/get-by-id/${c.id}`);
                if (delRes && delRes.result) deliveryData = delRes.result;
            } catch (e1) {
                try {
                    const delRes2 = await apiFetch('/api/v1/deliveries', {
                        method: 'PATCH',
                        body: JSON.stringify({ pageNumber: 1, pageSize: 1, enablePagination: false, filters: { creatorId: c.id } })
                    });
                    if (delRes2 && delRes2.result && delRes2.result.length > 0) {
                        deliveryData = delRes2.result[0];
                    }
                } catch (e2) {
                    console.warn('Delivery PATCH fallback failed:', e2);
                }
            }

            modalContent.replaceChildren();

            // Helpers for Delivery fields
            const getVehicleTypeName = (v) => {
                const val = parseInt(v);
                if (val === 1) return isAr ? '🚲 دراجة هوائية' : '🚲 Bicycle';
                if (val === 2) return isAr ? '🏍️ دراجة نارية / توك توك' : '🏍️ Motorcycle / TukTuk';
                if (val === 3) return isAr ? '🚗 سيارة' : '🚗 Car';
                return '-';
            };

            const getWalletTypeName = (w) => {
                const val = parseInt(w);
                if (val === 1) return 'فودافون كاش (Vodafone Cash)';
                if (val === 2) return 'أورنج كاش (Orange Cash)';
                if (val === 3) return 'اتصالات كاش (Etisalat Cash)';
                if (val === 4) return 'WE كاش (WE Cash)';
                if (val === 5) return 'InstaPay (انستا باي)';
                return '-';
            };

            const getAvailabilityName = (a) => {
                const val = parseInt(a);
                if (val === 1) return isAr ? 'دوام جزئي' : 'Part-time';
                if (val === 2) return isAr ? 'دوام كامل' : 'Full-time';
                return '-';
            };

            // Combined metadata object
            const dataObj = { ...fullUser, ...(deliveryData || {}) };

            // Captain Main Information Box
            const infoBox = ui.createElement('div', ['glass-panel'], {
                style: 'background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: 10px; padding: 1rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.8rem; font-size: 0.85rem;'
            });

            infoBox.innerHTML = `
                <div><strong>📱 ${isAr ? 'الهاتف:' : 'Phone:'}</strong> ${dataObj.phone || c.phone}</div>
                <div><strong>✉️ ${isAr ? 'البريد:' : 'Email:'}</strong> ${dataObj.email || c.email}</div>
                <div><strong>🪪 ${isAr ? 'رقم الهوية:' : 'National ID #:'}</strong> ${dataObj.nationalIdNumber || '-'}</div>
                <div><strong>🪪 ${isAr ? 'رقم رخصة القيادة:' : 'License #:'}</strong> ${dataObj.drivingLicenseNumber || '-'}</div>
                <div><strong>🚲 ${isAr ? 'نوع المركبة:' : 'Vehicle:'}</strong> ${getVehicleTypeName(dataObj.vehicleType)}</div>
                <div><strong>💳 ${isAr ? 'المحفظة:' : 'Wallet:'}</strong> ${dataObj.walletNumber ? `${dataObj.walletNumber} (${getWalletTypeName(dataObj.walletType)})` : '-'}</div>
                <div><strong>👤 ${isAr ? 'صاحب المحفظة:' : 'Wallet Owner:'}</strong> ${dataObj.walletOwnerName || '-'}</div>
                <div><strong>⏱️ ${isAr ? 'نظام التوفر:' : 'Availability:'}</strong> ${getAvailabilityName(dataObj.availability)}</div>
            `;
            modalContent.appendChild(infoBox);

            // Document Cards Container
            const docsGrid = ui.createElement('div', [], {
                style: 'display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem; margin-top: 0.5rem;'
            });

            // Gather all document images from User and Delivery payloads
            const documentsList = [];

            if (dataObj.nationalIdFrontImage || dataObj.nationalIdFront) {
                documentsList.push({ label: isAr ? '🪪 بطاقة الهوية (الوجه الأمامي)' : 'National ID (Front)', url: dataObj.nationalIdFrontImage || dataObj.nationalIdFront });
            }
            if (dataObj.nationalIdBackImage || dataObj.nationalIdBack) {
                documentsList.push({ label: isAr ? '🪪 بطاقة الهوية (الوجه الخلفي)' : 'National ID (Back)', url: dataObj.nationalIdBackImage || dataObj.nationalIdBack });
            }
            if (dataObj.drivingLicenseImage || dataObj.drivingLicense) {
                documentsList.push({ label: isAr ? '📄 رخصة القيادة' : 'Driving License', url: dataObj.drivingLicenseImage || dataObj.drivingLicense });
            }
            if (dataObj.photo) {
                documentsList.push({ label: isAr ? '👤 الصورة الشخصية' : 'Profile Photo', url: dataObj.photo });
            }
            if (dataObj.avatar) {
                documentsList.push({ label: isAr ? '🖼️ صورة الرمز / الهوية' : 'Avatar Photo', url: dataObj.avatar });
            }

            // Parse description JSON or text if any additional files are saved inside
            if (dataObj.description) {
                try {
                    const parsedDesc = JSON.parse(dataObj.description);
                    if (typeof parsedDesc === 'object') {
                        Object.keys(parsedDesc).forEach(k => {
                            if (typeof parsedDesc[k] === 'string' && (parsedDesc[k].includes('/') || parsedDesc[k].includes('.'))) {
                                documentsList.push({ label: k, url: parsedDesc[k] });
                            }
                        });
                    }
                } catch (e) {
                    const descCard = ui.createElement('div', ['glass-panel'], {
                        style: 'grid-column: 1 / -1; padding: 0.75rem; background: rgba(0,0,0,0.1); border: 1px solid var(--border-color); border-radius: 8px;'
                    });
                    descCard.innerHTML = `<strong>📝 ${isAr ? 'ملاحظات وصفية:' : 'Description:'}</strong><p style="margin: 0.4rem 0 0 0; color: var(--text-secondary); font-size: 0.85rem;">${dataObj.description}</p>`;
                    modalContent.appendChild(descCard);
                }
            }

            // Remove duplicates by URL
            const uniqueDocs = [];
            const seenUrls = new Set();
            documentsList.forEach(d => {
                if (d.url && !seenUrls.has(d.url)) {
                    seenUrls.add(d.url);
                    uniqueDocs.push(d);
                }
            });

            if (uniqueDocs.length === 0) {
                docsGrid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:1.5rem; color:var(--text-muted);">${isAr ? 'لم يتم العثور على أوراق أو صور مرفوعة لهذا الكابتن.' : 'No document images found for this captain.'}</div>`;
            } else {
                uniqueDocs.forEach(doc => {
                    const docCard = ui.createElement('div', ['glass-panel'], {
                        style: 'background: rgba(0,0,0,0.25); border: 1px solid var(--border-color); border-radius: 10px; padding: 0.75rem; display: flex; flex-direction: column; align-items: center; text-align: center;'
                    });

                    const fullUrl = getImageUrl(doc.url);
                    docCard.innerHTML = `
                        <strong style="font-size: 0.82rem; color: var(--admin-color); margin-bottom: 0.5rem; word-break: break-word;">${doc.label}</strong>
                        <div style="width: 100%; height: 150px; border-radius: 8px; overflow: hidden; background: #000; display: flex; align-items: center; justify-content: center; margin-bottom: 0.5rem; border: 1px solid rgba(255,255,255,0.1);">
                            <img src="${fullUrl}" style="max-width: 100%; max-height: 100%; object-fit: contain;" onerror="this.onerror=null; this.parentNode.innerHTML='<span style=\\'color:var(--text-muted); font-size:0.75rem;\\'>❌ تعذر تحميل الصورة</span>';" />
                        </div>
                        <a href="${fullUrl}" target="_blank" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; width: 100%; border-radius: 6px; text-decoration: none;">🔍 ${isAr ? 'فتح الصورة بحجم كامل' : 'View Full Image'}</a>
                    `;
                    docsGrid.appendChild(docCard);
                });
            }

            modalContent.appendChild(docsGrid);

        } catch (err) {
            console.error('Failed to load captain documents modal content:', err);
            modalContent.innerHTML = `<div style="color:var(--color-danger); text-align:center; padding:2rem;">❌ ${isAr ? 'فشل تحميل بيانات الأوراق' : 'Failed to load documents'}</div>`;
        }
    }

    await loadCaptainsData();
}

function showCreateVendorModal() {
    const modalBody = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.75rem; width: 100%; max-width: 480px; max-height: 70vh; overflow-y: auto; padding-right: 0.5rem;' });
    
    modalBody.appendChild(ui.createElementWithText('label', t('vendor_label_name'), [], { style: 'font-weight: 500; font-size: 0.85rem;' }));
    const nameInput = ui.createElement('input', ['search-input'], { placeholder: t('vendor_placeholder_name'), type: 'text', required: 'true' });
    modalBody.appendChild(nameInput);
    
    modalBody.appendChild(ui.createElementWithText('label', t('vendor_label_phone'), [], { style: 'font-weight: 500; font-size: 0.85rem;' }));
    const phoneInput = ui.createElement('input', ['search-input'], { placeholder: t('vendor_placeholder_phone'), type: 'tel', required: 'true' });
    modalBody.appendChild(phoneInput);
    
    modalBody.appendChild(ui.createElementWithText('label', t('vendor_label_password'), [], { style: 'font-weight: 500; font-size: 0.85rem;' }));
    const passWrapper = ui.createElement('div', ['password-wrapper']);
    const passInput = ui.createElement('input', ['search-input'], { placeholder: t('vendor_placeholder_password'), type: 'password', required: 'true', style: 'width: 100%' });
    const togglePassBtn = ui.createElementWithText('button', '👁️', ['password-toggle-btn'], { type: 'button', 'aria-label': 'Toggle Password Visibility' });
    togglePassBtn.addEventListener('click', () => {
        const isPassword = passInput.getAttribute('type') === 'password';
        passInput.setAttribute('type', isPassword ? 'text' : 'password');
        togglePassBtn.textContent = isPassword ? '🙈' : '👁️';
    });
    passWrapper.appendChild(passInput);
    passWrapper.appendChild(togglePassBtn);
    modalBody.appendChild(passWrapper);
    
    modalBody.appendChild(ui.createElementWithText('label', t('vendor_label_confirm_password'), [], { style: 'font-weight: 500; font-size: 0.85rem;' }));
    const confirmPassWrapper = ui.createElement('div', ['password-wrapper']);
    const confirmPassInput = ui.createElement('input', ['search-input'], { placeholder: t('vendor_placeholder_confirm_password'), type: 'password', required: 'true', style: 'width: 100%' });
    const toggleConfirmPassBtn = ui.createElementWithText('button', '👁️', ['password-toggle-btn'], { type: 'button', 'aria-label': 'Toggle Password Visibility' });
    toggleConfirmPassBtn.addEventListener('click', () => {
        const isPassword = confirmPassInput.getAttribute('type') === 'password';
        confirmPassInput.setAttribute('type', isPassword ? 'text' : 'password');
        toggleConfirmPassBtn.textContent = isPassword ? '🙈' : '👁️';
    });
    confirmPassWrapper.appendChild(confirmPassInput);
    confirmPassWrapper.appendChild(toggleConfirmPassBtn);
    modalBody.appendChild(confirmPassWrapper);
    
    const emailLabel = ui.createElement('label', [], { style: 'font-weight: 500; font-size: 0.85rem;' });
    emailLabel.textContent = (getLanguage() === 'ar' ? '\u0627\u0644\u0628\u0631\u064A\u062F \u0627\u0644\u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A *' : 'Email *');
    modalBody.appendChild(emailLabel);
    const emailInput = ui.createElement('input', ['search-input'], { placeholder: t('vendor_placeholder_email'), type: 'email', required: 'true' });
    modalBody.appendChild(emailInput);
    
    modalBody.appendChild(ui.createElementWithText('label', t('vendor_label_type') + ' *', [], { style: 'font-weight: 500; font-size: 0.85rem;' }));
    const typeSelect = ui.createElement('select', ['select-input']);
    const placeholderOption = ui.createElementWithText('option', (getLanguage() === 'ar' ? '\u0627\u062E\u062A\u0631 \u0646\u0648\u0639 \u0627\u0644\u062D\u0633\u0627\u0628 (\u0645\u0637\u0639\u0645 \u0623\u0648 \u0645\u0627\u0631\u0643\u062A)...' : 'Select Account Role (Restaurant or Market)...'), [], { value: '' });
    placeholderOption.disabled = true;
    placeholderOption.selected = true;
    typeSelect.appendChild(placeholderOption);
    typeSelect.appendChild(ui.createElementWithText('option', t('vendor_label_type_rest'), [], { value: '0' }));
    typeSelect.appendChild(ui.createElementWithText('option', t('vendor_label_type_mkt'), [], { value: '1' }));
    modalBody.appendChild(typeSelect);

    modalBody.appendChild(ui.createElementWithText('label', (getLanguage() === 'ar' ? '\u0627\u0644\u0642\u0633\u0645 \u0627\u0644\u0631\u0626\u064A\u0633\u064A *' : 'Main Category *'), [], { style: 'font-weight: 500; font-size: 0.85rem;' }));
    const mainCategorySelect = ui.createElement('select', ['select-input']);
    const catPlaceholder = ui.createElementWithText('option', (getLanguage() === 'ar' ? '\u0627\u062E\u062A\u0631 \u0627\u0644\u0642\u0633\u0645 \u0627\u0644\u0631\u0626\u064A\u0633\u064A...' : 'Select Main Category...'), [], { value: '' });
    catPlaceholder.disabled = true;
    catPlaceholder.selected = true;
    mainCategorySelect.appendChild(catPlaceholder);
    modalBody.appendChild(mainCategorySelect);

    let allMainCategories = [];
    apiFetch('/api/v1/main-categories', {
        method: 'PATCH',
        body: JSON.stringify({ pageNumber: 1, pageSize: 1000, enablePagination: false })
    }).then(res => {
        if (res && res.result) {
            allMainCategories = res.result;
            updateMainCategoryDropdown();
        }
    }).catch(err => {
        console.error("Failed to load main categories for signup select", err);
    });

    function updateMainCategoryDropdown() {
        mainCategorySelect.replaceChildren(catPlaceholder);
        const selectedRoleVal = typeSelect.value;
        if (selectedRoleVal === '') return;
        
        const role = parseInt(selectedRoleVal);
        const filtered = allMainCategories.filter(c => c.userRole === role);
        
        filtered.forEach(c => {
            mainCategorySelect.appendChild(ui.createElementWithText('option', c.name, [], { value: c.id.toString() }));
        });
    }
    
    typeSelect.addEventListener('change', () => {
        updateMainCategoryDropdown();
    });
    
    modalBody.appendChild(ui.createElementWithText('label', t('vendor_label_desc'), [], { style: 'font-weight: 500; font-size: 0.85rem;' }));
    const descInput = ui.createElement('textarea', ['search-input'], { placeholder: t('vendor_placeholder_desc'), style: 'height: 60px; resize: none;', required: 'true' });
    modalBody.appendChild(descInput);

    const errorBox = ui.createElement('div', [], { style: 'display: none; color: var(--color-danger); font-size: 0.85rem; padding: 0.5rem; background: rgba(255, 71, 87, 0.1); border-radius: 4px; margin-top: 0.5rem; border: 1px solid rgba(255, 71, 87, 0.2);' });
    modalBody.appendChild(errorBox);
    
    const showError = (msg) => {
        errorBox.textContent = msg;
        errorBox.style.display = 'block';
        modalBody.scrollTop = modalBody.scrollHeight;
    };

    const clearError = () => {
        errorBox.style.display = 'none';
        errorBox.textContent = '';
    };

    nameInput.addEventListener('input', clearError);
    phoneInput.addEventListener('input', clearError);
    passInput.addEventListener('input', clearError);
    confirmPassInput.addEventListener('input', clearError);
    emailInput.addEventListener('input', clearError);
    typeSelect.addEventListener('change', clearError);
    mainCategorySelect.addEventListener('change', clearError);
    descInput.addEventListener('input', clearError);
    
    ui.showModal(t('vendor_create_title'), modalBody, [
        {
            text: t('submit'),
            type: 'primary',
            closeOnClick: false,
            onClick: async (e) => {
                const submitBtn = e.target;
                errorBox.style.display = 'none';
                
                const name = nameInput.value.trim();
                let phone = phoneInput.value.trim();
                const password = passInput.value;
                const confirmedPassword = confirmPassInput.value;
                const email = emailInput.value.trim();
                const typeVal = typeSelect.value;
                const description = descInput.value.trim();
                const mainCategoryIdVal = mainCategorySelect.value;
                
                if (!name || !phone || !email || !password || !confirmedPassword || !description || typeVal === '' || !mainCategoryIdVal) {
                    showError(getLanguage() === 'ar' ? '\u064A\u0631\u062C\u064A \u0645\u0644\u0621 \u062C\u0645\u064A\u0635 \u0627\u0644\u062D\u0642\u0648\u0644 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629' : 'Please fill in all required fields.');
                    return;
                }
                const type = parseInt(typeVal);
                const mainCategoryId = parseInt(mainCategoryIdVal);
                
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    showError(getLanguage() === 'ar' ? '\u0625\u062F\u062E\u0644 \u0628\u0631\u064A\u062F \u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A \u0635\u062D\u064A\u062D' : 'Please enter a valid email address.');
                    return;
                }
                
                phone = phone.replace(/[\s\-\(\)]/g, '');

                if (phone.startsWith('01') && phone.length === 11) {
                    phone = '+2' + phone;
                } else if (phone.startsWith('1') && phone.length === 10) {
                    phone = '+20' + phone;
                } else if (phone.startsWith('201') && phone.length === 12) {
                    phone = '+' + phone;
                } else if (phone.startsWith('00201') && phone.length === 14) {
                    phone = '+' + phone.substring(2);
                } else if (phone.startsWith('+01') && phone.length === 12) {
                    phone = '+2' + phone.substring(1);
                } else if (phone.startsWith('+1') && phone.length === 11) {
                    phone = '+20' + phone.substring(1);
                }
                
                const phoneRegex = /^\+201[0125]\d{8}$/;
                if (!phoneRegex.test(phone)) {
                    showError(getLanguage() === 'ar' 
                        ? '\u0631\u0642\u0645 \u0647\u0627\u062A\u0641 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D' 
                        : 'Invalid Egyptian phone format.');
                    return;
                }

                if (password.length < 6) {
                    showError(getLanguage() === 'ar' ? '\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0642\u0635\u064A\u0631\u0629' : 'Password must be at least 6 characters.');
                    return;
                }
                if (password !== confirmedPassword) {
                    showError(getLanguage() === 'ar' ? '\u0643\u0644\u0645\u062A\u0627 \u0627\u0644\u0645\u0631\u0648\u0631 \u063A\u064A\u0631 \u0645\u062A\u0637\u0627\u0628\u0642\u062A\u064A\u0646' : 'Passwords do not match.');
                    return;
                }
                
                submitBtn.disabled = true;
                submitBtn.textContent = getLanguage() === 'ar' ? '\u062C\u0627\u0631\u064A \u0627\u0644\u062A\u0633\u062C\u064A\u0644...' : 'Creating...';
                
                try {
                    await apiFetch('/api/v1/users/signup', {
                        method: 'POST',
                        body: JSON.stringify({
                            phone,
                            email: email || null,
                            name,
                            photo: "",
                            description,
                            role: type,
                            password,
                            confirmedPassword,
                            categoryId: mainCategoryId
                        })
                    });
                    
                    ui.closeModal();
                    ui.showToast(t('vendor_create_success'), 'success');
                    renderActiveTab();
                } catch (err) {
                    console.error("Create vendor error:", err);
                    submitBtn.disabled = false;
                    submitBtn.textContent = t('submit');
                    showError(t('vendor_create_error') + ': ' + err.message);
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
   Tab 4: Captains Locations Map
   ========================================================================== */
function renderDispatchTab(parent) {
    const layout = ui.createElement('div', [], { 
        style: 'display: flex; gap: 1rem; width: 100%; height: 550px; align-items: stretch;' 
    });

    const sidebar = ui.createElement('div', ['captains-sidebar'], {
        style: 'flex: 0 0 320px; display: flex; flex-direction: column; gap: 0.75rem; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 1rem; overflow-y: auto;'
    });

    const sidebarTitle = ui.createElementWithText('h3', getLanguage() === 'ar' ? '\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0637\u064A\u0627\u0631\u064A\u0646' : 'Captains List', [], {
        style: 'font-size: 1rem; font-weight: 700; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem; margin: 0;'
    });
    sidebar.appendChild(sidebarTitle);

    const listContainer = ui.createElement('div', [], {
        style: 'display: flex; flex-direction: column; gap: 0.5rem; flex: 1;'
    });
    sidebar.appendChild(listContainer);

    const mapContainer = ui.createElement('div', [], { 
        id: 'sa-captains-map', 
        style: 'flex: 1; height: 100%; border-radius: var(--radius-md); border: 1px solid var(--border-color); box-shadow: var(--shadow-sm); z-index: 1;' 
    });

    layout.appendChild(sidebar);
    layout.appendChild(mapContainer);
    parent.appendChild(layout);

    const map = L.map('sa-captains-map').setView([30.0444, 31.2357], 12);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    apiFetch('/api/v1/users/paginate?pageNumber=1&pageSize=1000&role=3&userStatus=1')
        .then(async data => {
            listContainer.innerHTML = '';
            if (data && data.result && data.result.length > 0) {
                const markerGroup = [];
                const markersMap = {}; 

                // Fetch locations for each captain in parallel via PATCH /api/v1/locations with creatorId filter
                const captainsWithLocations = await Promise.all(
                    data.result.map(async c => {
                        try {
                            const locData = await apiFetch('/api/v1/locations', {
                                method: 'PATCH',
                                body: JSON.stringify({
                                    pageNumber: 1,
                                    pageSize: 10,
                                    enablePagination: false,
                                    filters: {
                                        creatorId: c.id
                                    }
                                })
                            });

                            let coords = null;
                            if (locData && locData.result && locData.result.length > 0) {
                                // Find base location or take first location
                                const baseLoc = locData.result.find(l => l.base) || locData.result[0];
                                if (baseLoc && baseLoc.latitude && baseLoc.longitude) {
                                    coords = {
                                        lat: parseFloat(baseLoc.latitude),
                                        lng: parseFloat(baseLoc.longitude),
                                        address: baseLoc.address || ''
                                    };
                                }
                            }
                            return { ...c, coords };
                        } catch (err) {
                            console.error(`Failed to fetch location for captain ${c.id}:`, err);
                            return { ...c, coords: null };
                        }
                    })
                );

                captainsWithLocations.forEach(c => {
                    const card = ui.createElement('div', ['captain-list-card'], {
                        style: 'padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: rgba(255, 255, 255, 0.01); display: flex; flex-direction: column; gap: 0.25rem; transition: background 0.2s;'
                    });

                    const nameRow = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; align-items: center;' });
                    nameRow.appendChild(ui.createElementWithText('span', c.name || '-', [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
                    
                    const activeText = c.active ? (getLanguage() === 'ar' ? '\u0646\u0634\u0637' : 'Active') : (getLanguage() === 'ar' ? '\u063A\u064A\u0631 \u0646\u0634\u0637' : 'Inactive');
                    const activeBadge = ui.createElementWithText('span', activeText, [], {
                        style: `font-size: 0.65rem; padding: 0.1rem 0.4rem; border-radius: 10px; background: ${c.active ? 'rgba(46, 213, 115, 0.15)' : 'rgba(231, 76, 60, 0.15)'}; color: ${c.active ? '#2ecc71' : '#e74c3c'};`
                    });
                    nameRow.appendChild(activeBadge);
                    card.appendChild(nameRow);

                    card.appendChild(ui.createElementWithText('span', `📞 ${c.phone || '-'}`, [], { style: 'font-size: 0.75rem; color: var(--text-secondary);' }));

                    if (c.coords) {
                        const locBadge = ui.createElementWithText('span', getLanguage() === 'ar' ? '\uD83D\uDCCD \u0645\u0648\u0642\u0639 \u0646\u0634\u0637' : '📍 Active Location', [], {
                            style: 'font-size: 0.7rem; color: #2ecc71; font-weight: 500; margin-top: 0.25rem;'
                        });
                        card.appendChild(locBadge);

                        card.style.cursor = 'pointer';
                        card.addEventListener('mouseenter', () => { card.style.background = 'rgba(255, 255, 255, 0.05)'; });
                        card.addEventListener('mouseleave', () => { card.style.background = 'rgba(255, 255, 255, 0.01)'; });
                        card.addEventListener('click', () => {
                            map.setView([c.coords.lat, c.coords.lng], 15);
                            if (markersMap[c.id]) {
                                markersMap[c.id].openPopup();
                            }
                        });

                        const marker = L.marker([c.coords.lat, c.coords.lng]).addTo(map);
                        marker.bindPopup(`
                            <div style="font-family: var(--font-family); font-size: 0.85rem; color: #fff;">
                                <strong style="color: var(--admin-color);">👨‍✈️ ${c.name}</strong><br/>
                                <strong>📞:</strong> ${c.phone || '-'}<br/>
                                <strong>الحالة:</strong> ${activeText}<br/>
                                📍 Lat: ${c.coords.lat.toFixed(5)}, Lng: ${c.coords.lng.toFixed(5)}
                            </div>
                        `);
                        markersMap[c.id] = marker;
                        markerGroup.push([c.coords.lat, c.coords.lng]);
                    } else {
                        const noLocBadge = ui.createElementWithText('span', getLanguage() === 'ar' ? '\u26A0\uFE0F \u0628\u062F\u0648\u0646 \u0625\u062D\u062F\u0627\u062B\u064A\u0627\u062A' : '⚠️ No Location set', [], {
                            style: 'font-size: 0.7rem; color: var(--text-muted); font-weight: 500; margin-top: 0.25rem;'
                        });
                        card.appendChild(noLocBadge);
                    }

                    listContainer.appendChild(card);
                });

                if (markerGroup.length > 0) {
                    map.fitBounds(markerGroup, { padding: [50, 50] });
                }
            } else {
                listContainer.appendChild(ui.createElementWithText('div', getLanguage() === 'ar' ? '\u0644\u0627 \u064A\u0648\u062C\u062F \u0637\u064A\u0627\u0631\u064A\u0646' : 'No captains found', [], {
                    style: 'font-size: 0.8rem; color: var(--text-muted); text-align: center; padding: 2rem 0;'
                }));
            }
        })
        .catch(err => {
            console.error('Failed to load captains locations:', err);
            ui.showToast(getLanguage() === 'ar' ? '\u0641\u0634\u0644 \u062A\u062D\u0645\u064A\u0644 \u0645\u0648\u0627\u0642\u0639 \u0627\u0644\u0637\u064A\u0627\u0631\u064A\u0646' : 'Failed to load captains locations', 'error');
        });
}

/* ==========================================================================
   Tab 5: Orders Management
   ========================================================================== */
function getStatusLabel(status) {
    if (getLanguage() === 'ar') {
        switch(status) {
            case 0: return { text: '\u062C\u062F\u064A\u062F (\u0644\u0645 \u064A\u0642\u0628\u0644 \u0628\u0639\u062F)', color: '#3498db' };
            case 1: return { text: '\u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0627\u0644\u062F\u0641\u0639', color: '#f1c40f' };
            case 2: return { text: '\u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0627\u0644\u0633\u0627\u0626\u0642', color: '#e67e22' };
            case 3: return { text: '\u062A\u0645 \u0627\u0644\u062A\u0623\u0643\u064A\u062F', color: '#2ecc71' };
            case 4: return { text: '\u0642\u064A\u062F \u0627\u0644\u062A\u062D\u0636\u064A\u0631', color: '#9b59b6' };
            case 5: return { text: '\u062C\u0627\u0647\u0632 \u0644\u0644\u0627\u0633\u062A\u0644\u0627\u0645', color: '#1abc9c' };
            case 6: return { text: '\u0641\u064A \u0627\u0644\u0637\u0631\u064A\u0642', color: '#e74c3c' };
            case 7: return { text: '\u062A\u0645 \u0627\u0644\u062A\u0648\u0635\u064A\u0644', color: '#27ae60' };
            case 8: return { text: '\u0645\u0644\u063A\u064A', color: '#95a5a6' };
            case 9: return { text: '\u0645\u0631\u0641\u0648\u0636', color: '#7f8c8d' };
            default: return { text: '\u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641', color: '#95a5a6' };
        }
    } else {
        switch(status) {
            case 0: return { text: 'New (Unaccepted)', color: '#3498db' };
            case 1: return { text: 'Pending Payment', color: '#f1c40f' };
            case 2: return { text: 'Waiting for Driver', color: '#e67e22' };
            case 3: return { text: 'Confirmed', color: '#2ecc71' };
            case 4: return { text: 'Preparing', color: '#9b59b6' };
            case 5: return { text: 'Ready for Pickup', color: '#1abc9c' };
            case 6: return { text: 'Out for Delivery', color: '#e74c3c' };
            case 7: return { text: 'Delivered', color: '#27ae60' };
            case 8: return { text: 'Cancelled', color: '#95a5a6' };
            case 9: return { text: 'Rejected', color: '#7f8c8d' };
            default: return { text: 'Unknown', color: '#95a5a6' };
        }
    }
}

async function renderOrdersTab(parent) {
    const container = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1.5rem; width: 100%;' });
    parent.appendChild(container);
    await renderRestaurantList(container);
}

/* ── Level 1: Restaurant Grid ── */
async function renderRestaurantList(container) {
    container.replaceChildren();
    const isAr = getLanguage() === 'ar';

    const topRow = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;' });
    topRow.appendChild(ui.createElementWithText('h3', isAr ? '🏪 اختر مطعمًا لعرض طلباته' : '🏪 Select a Restaurant to View Orders', [], { style: 'margin: 0; font-size: 1.1rem;' }));
    const refreshBtn = ui.createElementWithText('button', isAr ? '🔄 تحديث' : '🔄 Refresh', ['btn', 'btn-secondary'], { style: 'font-size: 0.8rem;' });
    topRow.appendChild(refreshBtn);
    container.appendChild(topRow);

    const loadingEl = ui.createElementWithText('div', isAr ? 'جاري تحميل المطاعم...' : 'Loading restaurants...', ['text-secondary'], { style: 'padding: 3rem; text-align: center;' });
    container.appendChild(loadingEl);

    const load = async () => {
        const existingGrid = container.querySelector('.vendors-grid');
        if (existingGrid) existingGrid.remove();
        loadingEl.style.display = 'block';
        loadingEl.textContent = isAr ? 'جاري تحميل المطاعم...' : 'Loading restaurants...';

        try {
            const [restActive, mktActive] = await Promise.all([
                apiFetch('/api/v1/users/paginate?pageNumber=1&pageSize=500&role=0&userStatus=1'),
                apiFetch('/api/v1/users/paginate?pageNumber=1&pageSize=500&role=1&userStatus=1'),
            ]);
            loadingEl.style.display = 'none';

            const restaurants = [
                ...(restActive?.result || []).map(r => ({ ...r, vendorType: 'restaurant' })),
                ...(mktActive?.result  || []).map(r => ({ ...r, vendorType: 'market' })),
            ];

            if (restaurants.length === 0) {
                loadingEl.textContent = isAr ? 'لا يوجد مطاعم' : 'No restaurants found';
                loadingEl.style.display = 'block';
                return;
            }

            const grid = ui.createElement('div', ['vendors-grid'], {
                style: 'display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 1rem;'
            });

            restaurants.forEach(r => {
                const card = ui.createElement('div', [], {
                    style: [
                        'background: rgba(255,255,255,0.04)',
                        'border: 1px solid var(--border-color)',
                        'border-radius: var(--radius-md)',
                        'padding: 1.25rem 1rem',
                        'cursor: pointer',
                        'transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s',
                        'display: flex',
                        'flex-direction: column',
                        'gap: 0.5rem',
                    ].join('; ')
                });

                card.addEventListener('mouseenter', () => {
                    card.style.transform = 'translateY(-3px)';
                    card.style.borderColor = 'var(--admin-color)';
                    card.style.boxShadow = '0 6px 24px rgba(0,0,0,0.35)';
                });
                card.addEventListener('mouseleave', () => {
                    card.style.transform = '';
                    card.style.borderColor = 'var(--border-color)';
                    card.style.boxShadow = '';
                });

                const icon = r.vendorType === 'restaurant' ? '🍽️' : '🛒';
                const typeLabel = r.vendorType === 'restaurant'
                    ? (isAr ? 'مطعم' : 'Restaurant')
                    : (isAr ? 'ماركت' : 'Market');

                card.appendChild(ui.createElementWithText('div', `${icon} ${r.name || 'N/A'}`, [], {
                    style: 'font-weight: 700; font-size: 0.95rem; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;'
                }));
                card.appendChild(ui.createElementWithText('div', typeLabel, [], {
                    style: 'font-size: 0.72rem; color: var(--admin-color); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;'
                }));
                card.appendChild(ui.createElementWithText('div', `📞 ${r.phone || '-'}`, [], {
                    style: 'font-size: 0.78rem; color: var(--text-secondary);'
                }));
                card.appendChild(ui.createElementWithText('div', isAr ? 'عرض الطلبات ←' : 'View Orders →', [], {
                    style: 'margin-top: 0.4rem; font-size: 0.78rem; color: var(--admin-color); font-weight: 600;'
                }));

                card.addEventListener('click', () => renderRestaurantOrders(container, r));
                grid.appendChild(card);
            });

            container.appendChild(grid);
        } catch (e) {
            loadingEl.style.display = 'block';
            loadingEl.textContent = (isAr ? 'فشل تحميل المطاعم: ' : 'Failed to load restaurants: ') + e.message;
        }
    };

    refreshBtn.addEventListener('click', () => load());
    await load();
}

/* ── Level 2: Orders for a specific restaurant ── */
async function renderRestaurantOrders(container, restaurant) {
    container.replaceChildren();
    const isAr = getLanguage() === 'ar';
    const name = restaurant.name || 'N/A';

    // Top bar with back + title + refresh
    const topRow = ui.createElement('div', [], { style: 'display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;' });
    const backBtn = ui.createElementWithText('button', isAr ? '← رجوع' : '← Back', ['btn', 'btn-secondary'], { style: 'font-size: 0.82rem;' });
    backBtn.addEventListener('click', () => renderRestaurantList(container));
    topRow.appendChild(backBtn);
    topRow.appendChild(ui.createElementWithText('h3', `📦 ${isAr ? 'طلبات' : 'Orders /'} ${name}`, [], { style: 'margin: 0; font-size: 1.05rem; flex: 1;' }));
    const refreshBtn = ui.createElementWithText('button', isAr ? '🔄 تحديث' : '🔄 Refresh', ['btn', 'btn-secondary'], { style: 'font-size: 0.8rem;' });
    topRow.appendChild(refreshBtn);
    container.appendChild(topRow);

    const loadingEl = ui.createElementWithText('div', isAr ? 'جاري تحميل الطلبات...' : 'Loading orders...', ['text-secondary'], { style: 'padding: 3rem; text-align: center;' });
    container.appendChild(loadingEl);

    const load = async () => {
        const existingGrid = container.querySelector('.orders-grid');
        if (existingGrid) existingGrid.remove();
        const existingSummary = container.querySelector('.orders-summary-bar');
        if (existingSummary) existingSummary.remove();
        loadingEl.style.display = 'block';
        loadingEl.textContent = isAr ? 'جاري تحميل الطلبات...' : 'Loading orders...';

        try {
            // 1. Fetch products of this restaurant
            const productsData = await apiFetch('/api/v1/products/paginate', {
                method: 'PATCH',
                body: JSON.stringify({
                    pageNumber: 1,
                    pageSize: 1000,
                    enablePagination: false,
                    filters: {
                        creatorId: parseInt(restaurant.id)
                    }
                })
            });

            const restaurantProductIds = new Set(
                (productsData?.result || []).map(p => parseInt(p.id))
            );

            // 2. Fetch all orders
            const data = await apiFetch('/api/v1/orders', {
                method: 'PATCH',
                body: JSON.stringify({
                    pageNumber: 1,
                    pageSize: 1000,
                    enablePagination: false,
                    includesPath: ['OrderProducts.Product', 'User', 'Creator'],
                    filters: {}
                })
            });

            loadingEl.style.display = 'none';
            const rawOrders = data?.result || [];
            
            // 3. Filter orders in frontend using product IDs
            const allOrders = rawOrders.filter(o => {
                if (!o.products || o.products.length === 0) return false;
                return o.products.some(p => restaurantProductIds.has(parseInt(p.productId)));
            });

            const unaccepted = allOrders.filter(o => o.status === 0);
            const active     = allOrders.filter(o => o.status >= 1 && o.status <= 6);
            const completed  = allOrders.filter(o => o.status === 7);
            const cancelled  = allOrders.filter(o => o.status === 8 || o.status === 9);

            // Summary chips
            const summaryBar = ui.createElement('div', ['orders-summary-bar'], {
                style: 'display: flex; gap: 0.75rem; flex-wrap: wrap; padding: 0.5rem 0;'
            });
            [
                { label: isAr ? 'إجمالي' : 'Total',     value: allOrders.length,                   color: 'var(--text-primary)' },
                { label: isAr ? 'نشطة'   : 'Active',    value: active.length + unaccepted.length,  color: 'var(--admin-color)' },
                { label: isAr ? 'مكتملة' : 'Completed', value: completed.length,                   color: 'var(--color-success)' },
                { label: isAr ? 'ملغية'  : 'Cancelled', value: cancelled.length,                   color: 'var(--text-muted)' },
            ].forEach(item => {
                const chip = ui.createElement('div', [], {
                    style: 'background: rgba(255,255,255,0.04); border: 1px solid var(--border-color); border-radius: 99px; padding: 0.25rem 0.9rem; display: flex; gap: 0.4rem; align-items: center; font-size: 0.8rem;'
                });
                chip.appendChild(ui.createElementWithText('span', item.label, [], { style: 'color: var(--text-secondary);' }));
                chip.appendChild(ui.createElementWithText('strong', item.value.toString(), [], { style: `color: ${item.color};` }));
                summaryBar.appendChild(chip);
            });
            container.appendChild(summaryBar);

            if (allOrders.length === 0) {
                container.appendChild(ui.createElementWithText('div', isAr ? 'لا توجد طلبات لهذا المطعم' : 'No orders for this restaurant', ['text-secondary'], { style: 'text-align: center; padding: 3rem; font-size: 0.9rem;' }));
                return;
            }

            // Kanban grid
            const grid = ui.createElement('div', ['orders-grid'], {
                style: 'display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; align-items: start; width: 100%;'
            });

            const columns = [
                { title: isAr ? '⏳ غير مقبولة' : '⏳ Unaccepted', orders: unaccepted, border: 'var(--color-info)' },
                { title: isAr ? '⚡ نشطة'       : '⚡ Active',     orders: active,     border: 'var(--admin-color)' },
                { title: isAr ? '✅ مكتملة'     : '✅ Completed',  orders: completed,  border: 'var(--color-success)' },
                { title: isAr ? '❌ ملغية'      : '❌ Cancelled',  orders: cancelled,  border: 'var(--text-muted)' },
            ];

            columns.forEach(col => {
                const colWrapper = ui.createElement('div', [], {
                    style: 'background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 0.75rem; display: flex; flex-direction: column; gap: 0.75rem; min-height: 280px;'
                });

                const colHeader = ui.createElement('div', [], { style: `display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid ${col.border}; padding-bottom: 0.5rem; margin-bottom: 0.25rem;` });
                colHeader.appendChild(ui.createElementWithText('span', col.title, [], { style: 'font-weight: 700; font-size: 0.85rem;' }));
                colHeader.appendChild(ui.createElementWithText('span', col.orders.length.toString(), ['badge'], { style: `background: ${col.border}; color: #fff; font-size: 0.7rem;` }));
                colWrapper.appendChild(colHeader);

                const listContainer = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.75rem; max-height: 600px; overflow-y: auto;' });

                if (col.orders.length === 0) {
                    listContainer.appendChild(ui.createElementWithText('div', isAr ? 'لا يوجد طلبات' : 'No orders', ['text-secondary'], { style: 'text-align: center; padding: 2rem 0; font-size: 0.8rem;' }));
                } else {
                    col.orders.forEach(o => {
                        const card = ui.createElement('div', [], {
                            style: 'background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 0.75rem; display: flex; flex-direction: column; gap: 0.45rem; font-size: 0.8rem;'
                        });

                        // Order ID + Status
                        const infoRow = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; font-weight: 700;' });
                        infoRow.appendChild(ui.createElementWithText('span', `#${o.id}`, [], { style: 'color: var(--admin-color);' }));
                        const statusInfo = getStatusLabel(o.status);
                        infoRow.appendChild(ui.createElementWithText('span', statusInfo.text, [], { style: `color: ${statusInfo.color}; font-size: 0.7rem;` }));
                        card.appendChild(infoRow);

                        // Customer
                        const custRow = ui.createElement('div', [], { style: 'color: var(--text-secondary); font-size: 0.75rem;' });
                        custRow.innerHTML = `👤 <strong>${o.user ? o.user.name : (isAr ? 'عميل' : 'Customer')}</strong> (${o.user?.phone || '-'})`;
                        card.appendChild(custRow);

                        // Address
                        if (o.address) {
                            const addrRow = ui.createElement('div', [], { style: 'color: var(--text-muted); font-size: 0.72rem;' });
                            addrRow.innerHTML = `📍 <span>${o.address}</span>`;
                            card.appendChild(addrRow);
                        }

                        // Products
                        if (o.products && o.products.length > 0) {
                            const prodBox = ui.createElement('div', [], {
                                style: 'border-top: 1px dashed var(--border-color); border-bottom: 1px dashed var(--border-color); padding: 0.3rem 0.4rem; margin: 0.2rem 0; display: flex; flex-direction: column; gap: 0.2rem; background: rgba(0,0,0,0.1); border-radius: 4px;'
                            });
                            o.products.forEach(p => {
                                const prodItem = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; font-size: 0.72rem; color: var(--text-secondary);' });
                                prodItem.appendChild(ui.createElementWithText('span', `• ${p.productName || 'Product'} x${p.quantity}`));
                                prodItem.appendChild(ui.createElementWithText('span', isAr ? `${(p.price||0).toFixed(2)} ج.م` : `${(p.price||0).toFixed(2)} EGP`, [], { style: 'font-family: "Outfit", sans-serif;' }));
                                prodBox.appendChild(prodItem);
                            });
                            card.appendChild(prodBox);
                        }

                        // Footer: date + total
                        const footerRow = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; align-items: center; margin-top: 0.1rem;' });
                        const dateStr = o.createdOn ? new Date(o.createdOn).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
                        footerRow.appendChild(ui.createElementWithText('span', dateStr, ['text-muted'], { style: 'font-size: 0.68rem;' }));
                        footerRow.appendChild(ui.createElementWithText('span', isAr ? `${(o.totalPrice||0).toFixed(2)} ج.م` : `${(o.totalPrice||0).toFixed(2)} EGP`, [], { style: 'font-weight: 800; font-size: 0.9rem; color: var(--color-success); font-family: "Outfit", sans-serif;' }));
                        card.appendChild(footerRow);

                        listContainer.appendChild(card);
                    });
                }

                colWrapper.appendChild(listContainer);
                grid.appendChild(colWrapper);
            });

            container.appendChild(grid);
        } catch (e) {
            console.error(e);
            loadingEl.style.display = 'block';
            loadingEl.textContent = (isAr ? 'فشل تحميل الطلبات: ' : 'Failed to load orders: ') + e.message;
        }
    };

    refreshBtn.addEventListener('click', () => load());
    await load();
}

/* ==========================================================================
   Tab: Main Categories Management
   ========================================================================== */
async function renderMainCategoriesTab(container) {
    const isAr = getLanguage() === 'ar';
    const STREAM_URL = 'https://uzpvlmgqwpxcuvngsayb.supabase.co/storage/v1/object/public/quick-service-photos/';

    function getPhotoUrl(photo) {
        if (!photo) return null;
        if (photo.startsWith('http')) return photo;
        return `${STREAM_URL}${photo}`;
    }

    function getRoleBadge(role) {
        if (role === 4 || role === 'Vendor')    return { emoji: '🏪', label: isAr ? 'المتاجر والمطاعم' : 'Vendors',   color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' };
        if (role === 3 || role === 'Captain')   return { emoji: '🛵', label: isAr ? 'كباتن التوصيل' : 'Captains',   color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' };
        if (role === 2 || role === 'Customer')  return { emoji: '👤', label: isAr ? 'العملاء' : 'Customers',         color: '#10b981', bg: 'rgba(16,185,129,0.15)' };
        return { emoji: '📁', label: isAr ? 'عام' : 'General', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)' };
    }

    const wrapper = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1.25rem; width: 100%;' });

    // Top Summary & Filter Toolbar
    const toolbar = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; background: var(--bg-surface-glass); border: 1px solid var(--border-color); border-radius: 16px; padding: 1.25rem; backdrop-filter: blur(12px);' });

    const topRow = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;' });

    // Stats Chips
    const statsBox = ui.createElement('div', [], { style: 'display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;' });
    const mainChip = ui.createElement('div', [], { style: 'display: flex; align-items: center; gap: 0.4rem; background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 20px; padding: 0.35rem 0.85rem; font-size: 0.82rem; font-weight: 700; color: var(--admin-color, #8b5cf6);' });
    mainChip.id = 'stat-main-categories-count';
    mainChip.textContent = `📁 ${isAr ? 'الأقسام الرئيسية' : 'Categories'}`;
    statsBox.appendChild(mainChip);

    topRow.appendChild(statsBox);

    // Search + Add Button
    const actionsBox = ui.createElement('div', [], { style: 'display: flex; align-items: center; gap: 0.75rem; flex: 1; justify-content: flex-end; max-width: 500px;' });
    const searchInput = ui.createElement('input', ['search-input'], {
        type: 'text',
        placeholder: isAr ? '🔍 البحث في الأقسام الرئيسية...' : '🔍 Search main categories...',
        style: 'max-width: 260px; font-size: 0.85rem;'
    });

    const addBtn = ui.createElement('button', ['btn', 'btn-primary'], {
        style: 'display: flex; align-items: center; gap: 0.4rem; white-space: nowrap; box-shadow: 0 4px 14px var(--admin-glow, rgba(139, 92, 246, 0.35)); font-weight: 700;'
    });
    addBtn.innerHTML = isAr ? '➕ إضافة قسم رئيسي' : '➕ Add Main Category';
    addBtn.addEventListener('click', () => openMainCategoryModal());

    actionsBox.appendChild(searchInput);
    actionsBox.appendChild(addBtn);
    topRow.appendChild(actionsBox);
    toolbar.appendChild(topRow);

    // Role Filter Bar
    const filterRow = ui.createElement('div', [], { style: 'display: flex; gap: 0.5rem; flex-wrap: wrap; border-top: 1px solid var(--border-color); padding-top: 0.85rem;' });
    const rolesFilterList = [
        { id: 'all', label: isAr ? '🌐 الكل' : '🌐 All', roleVal: null },
        { id: 'vendor', label: isAr ? '🏪 المتاجر والمطاعم' : '🏪 Vendors', roleVal: 4 },
        { id: 'captain', label: isAr ? '🛵 الكباتن' : '🛵 Captains', roleVal: 3 },
        { id: 'customer', label: isAr ? '👤 العملاء' : '👤 Customers', roleVal: 2 }
    ];

    let currentRoleFilter = null;

    rolesFilterList.forEach(rf => {
        const btn = ui.createElementWithText('button', rf.label, ['btn', 'btn-secondary', 'btn-sm'], {
            style: `font-size: 0.78rem; border-radius: 20px; font-weight: 600; ${rf.roleVal === currentRoleFilter ? 'background: var(--admin-color); color: #fff; border-color: var(--admin-color);' : ''}`
        });
        btn.addEventListener('click', () => {
            currentRoleFilter = rf.roleVal;
            filterRow.querySelectorAll('button').forEach(b => {
                b.style.background = '';
                b.style.color = '';
                b.style.borderColor = '';
            });
            btn.style.background = 'var(--admin-color)';
            btn.style.color = '#fff';
            btn.style.borderColor = 'var(--admin-color)';
            applyFilters();
        });
        filterRow.appendChild(btn);
    });
    toolbar.appendChild(filterRow);
    wrapper.appendChild(toolbar);

    // ── Cards Grid ───────────────────────────────────────────────────────────
    const grid = ui.createElement('div', [], {
        style: 'display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1.25rem; width: 100%;'
    });
    wrapper.appendChild(grid);
    container.appendChild(wrapper);

    let categoriesList = [];

    async function loadCategories() {
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:3.5rem; color:var(--text-muted);">${isAr ? 'جاري تحميل الأقسام الرئيسية...' : 'Loading main categories...'}</div>`;
        try {
            const res = await apiFetch('/api/v1/main-categories', {
                method: 'PATCH',
                body: JSON.stringify({ pageNumber: 1, pageSize: 100, enablePagination: false, orderBeforPagination: false })
            });
            categoriesList = Array.isArray(res) ? res : (res?.result ?? []);
        } catch (err) {
            console.error('Failed to load main-categories:', err);
            grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:3.5rem; color:var(--color-danger);">⚠️ ${isAr ? 'فشل تحميل الأقسام الرئيسية' : 'Failed to load categories'}</div>`;
            return;
        }
        applyFilters();
    }

    function applyFilters() {
        const query = searchInput.value.toLowerCase().trim();
        let filtered = categoriesList;
        if (currentRoleFilter !== null) {
            filtered = filtered.filter(c => c.userRole === currentRoleFilter || (currentRoleFilter === 4 && (c.userRole === 'Vendor' || c.userRole === 4)));
        }
        if (query) {
            filtered = filtered.filter(c => (c.name || '').toLowerCase().includes(query));
        }

        const statChipEl = document.getElementById('stat-main-categories-count');
        if (statChipEl) {
            statChipEl.textContent = `📁 ${categoriesList.length} ${isAr ? 'قسم رئيسي' : 'Categories'}`;
        }

        renderCards(filtered);
    }

    function renderCards(list) {
        grid.replaceChildren();
        if (!list || list.length === 0) {
            const empty = ui.createElement('div', ['glass-panel'], { style: 'text-align: center; padding: 3.5rem 1.5rem; width: 100%; grid-column: 1 / -1; border-radius: 16px;' });
            empty.appendChild(ui.createElementWithText('h3', isAr ? '📁 لا توجد أقسام رئيسية مطابقة' : '📁 No Categories Found', [], { style: 'margin-bottom: 0.5rem; font-size: 1.25rem;' }));
            empty.appendChild(ui.createElementWithText('p', isAr ? 'أضف قسماً رئيسياً جديداً للنظام لتحديد أدوار ومجالات المستخدمين.' : 'Add a new main category to define system navigation roles.', ['text-secondary'], { style: 'font-size: 0.85rem;' }));
            grid.appendChild(empty);
            return;
        }
        list.forEach(item => grid.appendChild(buildCard(item)));
    }

    function buildCard(item) {
        const photoUrl = getPhotoUrl(item.photo);
        const role = getRoleBadge(item.userRole);

        const card = ui.createElement('div', ['category-card', 'admin-theme']);

        // ── Photo Header Wrapper ──
        const photoWrap = ui.createElement('div', ['category-image-wrapper']);
        photoWrap.style.background = `linear-gradient(135deg, ${role.bg} 0%, rgba(18, 18, 38, 0.9) 100%)`;

        if (photoUrl) {
            const img = ui.createElement('img', [], {
                src: photoUrl,
                alt: item.name || 'Category'
            });
            img.onerror = () => {
                img.remove();
                photoWrap.innerHTML = `<span style="font-size:3.2rem; filter: drop-shadow(0 4px 12px ${role.color}44);">${role.emoji}</span>`;
            };
            photoWrap.appendChild(img);
        } else {
            photoWrap.innerHTML = `<span style="font-size:3.2rem; filter: drop-shadow(0 4px 12px ${role.color}44);">${role.emoji}</span>`;
        }

        // Role badge chip overlay
        const badgeChip = ui.createElement('div', ['category-badge-chip'], {
            style: `background: ${role.color}25; border: 1px solid ${role.color}66; color: ${role.color};`
        });
        badgeChip.textContent = `${role.emoji} ${role.label}`;
        photoWrap.appendChild(badgeChip);
        card.appendChild(photoWrap);

        // ── Card Body ──
        const body = ui.createElement('div', ['category-card-body']);
        body.appendChild(ui.createElementWithText('h4', item.name || '-', ['category-title']));
        body.appendChild(ui.createElementWithText('p', isAr ? `قسم رئيسي مخصص لـ (${role.label})` : `Main category assigned to (${role.label})`, ['category-description']));

        // ── Actions Footer ──
        const actions = ui.createElement('div', ['category-card-actions']);

        const editBtn = ui.createElementWithText('button', isAr ? '✏️ تعديل' : '✏️ Edit', ['btn', 'btn-secondary', 'btn-sm'], {
            style: 'flex: 1; justify-content: center; font-size: 0.8rem; font-weight: 600;'
        });
        editBtn.addEventListener('click', () => openMainCategoryModal(item));

        const delBtn = ui.createElementWithText('button', '🗑️', ['btn', 'btn-danger', 'btn-sm'], {
            style: 'padding: 0.35rem 0.65rem; border-radius: 8px;'
        });
        delBtn.title = isAr ? 'حذف القسم' : 'Delete Category';
        delBtn.addEventListener('click', () => deleteCategory(item));

        actions.appendChild(editBtn);
        actions.appendChild(delBtn);
        body.appendChild(actions);
        card.appendChild(body);

        return card;
    }

    searchInput.addEventListener('input', applyFilters);

    async function deleteCategory(item) {
        if (!confirm(isAr ? `هل أنت متأكد من حذف "${item.name}"؟` : `Delete "${item.name}"?`)) return;
        try {
            await apiFetch(`/api/v1/main-categories/${item.id}`, { method: 'DELETE' });
            ui.showToast(isAr ? '✅ تم الحذف' : '✅ Deleted');
            await loadCategories();
        } catch (err) {
            console.error('Delete failed:', err);
            ui.showToast(isAr ? '❌ فشل الحذف' : '❌ Delete failed');
        }
    }

    function openMainCategoryModal(cat = null) {
        const isEdit = !!cat;
        const title = isEdit ? (isAr ? 'تعديل القسم' : 'Edit Category') : (isAr ? 'إضافة قسم جديد' : 'Add Category');
        const content = ui.createElement('div', [], { style: 'display:flex; flex-direction:column; gap:1rem;' });

        // ── Name ──
        const nameGroup = ui.createElement('div', ['form-group']);
        nameGroup.appendChild(ui.createElementWithText('label', isAr ? 'اسم القسم *' : 'Category Name *', ['form-label']));
        const nameInput = ui.createElement('input', ['search-input'], { type: 'text', value: cat?.name || '', placeholder: isAr ? 'مثال: مشويات' : 'e.g. Grills', style: 'width:100%;' });
        nameGroup.appendChild(nameInput);
        content.appendChild(nameGroup);

        // ── Image Upload ──
        const imgGroup = ui.createElement('div', ['form-group']);
        imgGroup.appendChild(ui.createElementWithText('label', isAr ? 'صورة القسم' : 'Category Image', ['form-label']));

        const imgRow = ui.createElement('div', [], { style: 'display:flex; gap:0.8rem; align-items:center;' });
        const imgInput = ui.createElement('input', [], { type: 'file', accept: 'image/*', style: 'display:none;' });
        const chooseBtn = ui.createElementWithText('button', isAr ? 'اختر صورة' : 'Choose Image', ['btn', 'btn-secondary']);
        chooseBtn.type = 'button';
        chooseBtn.addEventListener('click', () => imgInput.click());

        const previewImg = ui.createElement('img', [], {
            src: getImageUrl(cat?.photo || ''),
            style: 'width:54px; height:54px; border-radius:10px; object-fit:cover; border:1px solid var(--border-color); display: none;'
        });
        if (cat?.photo) previewImg.style.display = 'block';

        const uploadStatus = ui.createElement('span', [], { style: 'font-size:0.78rem; color:var(--text-muted);' });

        let uploadedPhotoKey = cat?.photo || '';

        imgInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            previewImg.src = URL.createObjectURL(file);
            previewImg.style.display = 'block';
            uploadStatus.textContent = isAr ? '⏳ جاري الرفع...' : '⏳ Uploading...';
            try {
                uploadedPhotoKey = await uploadImage(file);
                previewImg.src = getImageUrl(uploadedPhotoKey);
                uploadStatus.textContent = isAr ? '✅ تم الرفع' : '✅ Uploaded';
            } catch (err) {
                uploadStatus.textContent = isAr ? '❌ فشل الرفع' : '❌ Upload failed';
                ui.showToast(isAr ? 'فشل رفع الصورة' : 'Image upload failed', 'error');
            }
        });

        imgRow.appendChild(chooseBtn);
        imgRow.appendChild(imgInput);
        imgRow.appendChild(previewImg);
        imgRow.appendChild(uploadStatus);
        imgGroup.appendChild(imgRow);
        imgGroup.appendChild(ui.createElementWithText('span', isAr ? 'المقاس الموصى به: 600×600 بكسل' : 'Recommended: 600×600 px', [], { style: 'font-size:0.72rem; color:var(--text-muted); margin-top:0.25rem; display:block;' }));
        content.appendChild(imgGroup);

        // ── Description ──
        const descGroup = ui.createElement('div', ['form-group']);
        descGroup.appendChild(ui.createElementWithText('label', isAr ? 'الوصف' : 'Description', ['form-label']));
        const descInput = ui.createElement('textarea', ['search-input'], { rows: '3', placeholder: isAr ? 'وصف مختصر...' : 'Short description...', style: 'width:100%; resize:vertical;' });
        descInput.value = cat?.description || '';
        descGroup.appendChild(descInput);
        content.appendChild(descGroup);

        // ── Role ──
        const roleGroup = ui.createElement('div', ['form-group']);
        roleGroup.appendChild(ui.createElementWithText('label', isAr ? 'الدور المستهدف' : 'Target Role', ['form-label']));
        const roleSelect = ui.createElement('select', ['select-input'], { style: 'width:100%;' });
        [
            { val: 4, label: `🏪 ${isAr ? 'متاجر ومطاعم' : 'Vendor'}` },
            { val: 3, label: `🛵 ${isAr ? 'كباتن توصيل' : 'Captain'}` },
            { val: 2, label: `👤 ${isAr ? 'عملاء' : 'Customer'}` }
        ].forEach(({ val, label }) => {
            const opt = ui.createElement('option', [], { value: String(val) });
            opt.textContent = label;
            if (cat?.userRole == val) opt.selected = true;
            roleSelect.appendChild(opt);
        });
        roleGroup.appendChild(roleSelect);
        content.appendChild(roleGroup);

        ui.showModal(title, content, [
            {
                text: isAr ? '💾 حفظ' : '💾 Save',
                type: 'primary',
                closeOnClick: false,
                onClick: async () => {
                    const nameVal = nameInput.value.trim();
                    if (!nameVal) {
                        ui.setInputInvalid(nameInput, isAr ? 'الاسم مطلوب' : 'Name is required');
                        return;
                    }

                    const body = {
                        name: nameVal,
                        photo: uploadedPhotoKey || null,
                        description: descInput.value.trim() || null,
                        userRole: parseInt(roleSelect.value, 10)
                    };

                    try {
                        if (isEdit) {
                            await apiFetch(`/api/v1/main-categories/${cat.id}`, {
                                method: 'PUT',
                                body: JSON.stringify({ ...body, id: cat.id })
                            });
                        } else {
                            await apiFetch('/api/v1/main-categories', {
                                method: 'POST',
                                body: JSON.stringify(body)
                            });
                        }
                        ui.showToast(isAr ? '✅ تم الحفظ بنجاح' : '✅ Saved successfully', 'success');
                        ui.closeModal();
                        await loadCategories();
                    } catch (err) {
                        console.error('Save category failed:', err);
                        ui.showToast((isAr ? '❌ فشل الحفظ: ' : '❌ Save failed: ') + err.message, 'error');
                    }
                }
            },
            {
                text: isAr ? 'إلغاء' : 'Cancel',
                type: 'secondary',
                onClick: ui.closeModal
            }
        ]);
    }

    await loadCategories();
}

/* ==========================================================================
   Tab: CMS & Legal Pages Management (Terms, Privacy, About, Contact)
   ========================================================================== */
async function renderCmsTab(container) {
    const isAr = getLanguage() === 'ar';
    let currentCmsSubTab = 'privacy'; // 'privacy' | 'about' | 'contact'

    // Sub navigation bar
    const subNav = ui.createElement('div', [], {
        style: 'display: flex; gap: 0.5rem; margin-bottom: 1.5rem; border-bottom: 2px solid var(--border-color); padding-bottom: 0.6rem; overflow-x: auto;'
    });

    const subTabs = [
        { id: 'privacy', label: isAr ? '🔒 سياسة الخصوصية' : '🔒 Privacy Policy' },
        { id: 'about', label: isAr ? 'ℹ️ من نحن' : 'ℹ️ About Us' },
        { id: 'contact', label: isAr ? '📞 تواصل معنا' : '📞 Contact Us' }
    ];

    const subNavBtns = {};

    subTabs.forEach(st => {
        const btn = ui.createElement('button', ['btn', 'btn-sm'], {
            style: 'border-radius: 20px; font-weight: 600; font-size: 0.88rem; transition: all 0.2s;'
        });
        btn.textContent = st.label;
        btn.addEventListener('click', () => {
            currentCmsSubTab = st.id;
            updateSubNavState();
            renderCmsSubContent();
        });
        subNavBtns[st.id] = btn;
        subNav.appendChild(btn);
    });

    container.appendChild(subNav);

    const cmsContentArea = ui.createElement('div', ['cms-content-area']);
    container.appendChild(cmsContentArea);

    function updateSubNavState() {
        Object.keys(subNavBtns).forEach(key => {
            if (key === currentCmsSubTab) {
                subNavBtns[key].classList.remove('btn-secondary');
                subNavBtns[key].classList.add('btn-primary');
            } else {
                subNavBtns[key].classList.remove('btn-primary');
                subNavBtns[key].classList.add('btn-secondary');
            }
        });
    }

    updateSubNavState();

    async function renderCmsSubContent() {
        cmsContentArea.replaceChildren();

        if (currentCmsSubTab === 'privacy') {
            await renderPoliciesSubEditor(cmsContentArea, 'privacy');
        } else if (currentCmsSubTab === 'about') {
            await renderAboutUsSubEditor(cmsContentArea);
        } else if (currentCmsSubTab === 'contact') {
            await renderContactUsSubEditor(cmsContentArea);
        }
    }

    // Helper for valid v4 UUID generation
    function generateUUID() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    function isValidUUID(str) {
        return typeof str === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(str);
    }

    // Sub-editor for Policies (Terms & Conditions & Privacy Policy)
    async function renderPoliciesSubEditor(parent, type) {
        const pageTitle = type === 'terms' ? (isAr ? 'الشروط والأحكام' : 'Terms & Conditions') : (isAr ? 'سياسة الخصوصية' : 'Privacy Policy');
        let policyObj = { active: true, policySections: [] };

        try {
            const res = await apiFetch('/api/v1/policies', {
                method: 'PATCH',
                body: JSON.stringify({ pageNumber: 1, pageSize: 50, enablePagination: false })
            });
            const policies = Array.isArray(res) ? res : (res?.result ?? []);
            
            // Heuristic classification: Privacy policy contains keywords "privacy" or "خصوصية"
            const matchedPolicy = policies.find(p => {
                const hasPrivacyKeyword = p.policySections && p.policySections.some(sec => 
                    (sec.titleAr && sec.titleAr.includes('خصوصية')) || 
                    (sec.titleEn && sec.titleEn.toLowerCase().includes('privacy')) ||
                    (sec.contentAr && sec.contentAr.includes('خصوصية')) ||
                    (sec.contentEn && sec.contentEn.toLowerCase().includes('privacy'))
                );
                return type === 'privacy' ? hasPrivacyKeyword : !hasPrivacyKeyword;
            });
            
            if (matchedPolicy) {
                policyObj = matchedPolicy;
            } else if (policies.length > 0) {
                policyObj = type === 'terms' ? policies[0] : (policies[1] || policies[0]);
            }
        } catch (e) {
            console.error('API policies fetch failed:', e);
        }

        const panel = ui.createElement('div', ['glass-panel'], { style: 'padding: 1.5rem;' });

        const headerRow = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem;' });
        headerRow.innerHTML = `<h3>${pageTitle}</h3>`;

        const activeToggle = ui.createElement('label', [], { style: 'display: flex; align-items: center; gap: 0.5rem; cursor: pointer;' });
        const activeCheckbox = ui.createElement('input', [], { type: 'checkbox' });
        activeCheckbox.checked = policyObj.active !== false;
        activeToggle.appendChild(activeCheckbox);
        activeToggle.appendChild(document.createTextNode(isAr ? 'الصفحة مفعلة' : 'Page Active'));
        headerRow.appendChild(activeToggle);
        panel.appendChild(headerRow);

        const sectionsContainer = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.5rem;' });
        let sectionsList = Array.isArray(policyObj.policySections) ? [...policyObj.policySections] : [];

        function renderSectionsUI() {
            sectionsContainer.innerHTML = '';
            if (sectionsList.length === 0) {
                sectionsContainer.innerHTML = `<div style="text-align:center; padding: 1.5rem; color: var(--text-muted);">${isAr ? 'لا توجد فقرات مضافة بعد.' : 'No sections added yet.'}</div>`;
                return;
            }

            sectionsList.forEach((sec, idx) => {
                const secCard = ui.createElement('div', ['glass-panel'], {
                    style: 'background: var(--bg-card); border: 1px solid var(--border-color); border-top: 4px solid var(--brand-teal); border-radius: 12px; padding: 1.1rem; position: relative; box-shadow: var(--card-shadow);'
                });

                const topRow = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem;' });
                topRow.innerHTML = `<strong style="color: var(--admin-color); font-size: 0.95rem;">${isAr ? `الفقرة #${idx + 1}` : `Section #${idx + 1}`}</strong>`;

                const removeBtn = ui.createElement('button', ['btn', 'btn-danger', 'btn-sm']);
                removeBtn.innerHTML = '🗑️ ' + (isAr ? 'حذف الفقرة' : 'Remove');
                removeBtn.addEventListener('click', () => {
                    sectionsList.splice(idx, 1);
                    renderSectionsUI();
                });
                topRow.appendChild(removeBtn);
                secCard.appendChild(topRow);

                const titleGroupAr = ui.createElement('div', ['form-group'], { style: 'margin-bottom: 0.6rem;' });
                titleGroupAr.innerHTML = `<label class="form-label">${isAr ? 'عنوان الفقرة (بالعربية)' : 'Title (Arabic)'}</label>`;
                const titleInputAr = ui.createElement('input', ['search-input'], { type: 'text', value: sec.titleAr || sec.title || '' });
                titleInputAr.addEventListener('input', (e) => { sec.titleAr = e.target.value; });
                titleGroupAr.appendChild(titleInputAr);
                secCard.appendChild(titleGroupAr);

                const contentGroupAr = ui.createElement('div', ['form-group'], { style: 'margin-bottom: 0.6rem;' });
                contentGroupAr.innerHTML = `<label class="form-label">${isAr ? 'محتوى الفقرة (بالعربية)' : 'Content (Arabic)'}</label>`;
                const contentTextAr = ui.createElement('textarea', ['search-input'], { rows: 3 });
                contentTextAr.value = sec.contentAr || sec.content || '';
                contentTextAr.addEventListener('input', (e) => { sec.contentAr = e.target.value; });
                contentGroupAr.appendChild(contentTextAr);
                secCard.appendChild(contentGroupAr);

                sectionsContainer.appendChild(secCard);
            });
        }

        renderSectionsUI();
        panel.appendChild(sectionsContainer);

        const actionsRow = ui.createElement('div', [], { style: 'display: flex; gap: 1rem; justify-content: space-between; flex-wrap: wrap;' });

        const addSecBtn = ui.createElement('button', ['btn', 'btn-secondary']);
        addSecBtn.innerHTML = '➕ ' + (isAr ? 'إضافة فقرة جديدة' : 'Add New Section');
        addSecBtn.addEventListener('click', () => {
            sectionsList.push({ id: generateUUID(), titleAr: '', contentAr: '' });
            renderSectionsUI();
        });

        const saveBtn = ui.createElement('button', ['btn', 'btn-primary']);
        saveBtn.innerHTML = '💾 ' + (isAr ? `حفظ ${pageTitle}` : `Save ${pageTitle}`);
        saveBtn.addEventListener('click', async () => {
            const formattedSections = sectionsList.map(sec => ({
                id: isValidUUID(sec.id) ? sec.id : generateUUID(),
                titleAr: sec.titleAr || sec.title || '',
                contentAr: sec.contentAr || sec.content || '',
                titleEn: sec.titleEn || '',
                contentEn: sec.contentEn || '',
                titleTr: sec.titleTr || '',
                contentTr: sec.contentTr || '',
                subTitleAr: sec.subTitleAr || '',
                subTitleEn: sec.subTitleEn || '',
                subTitleTr: sec.subTitleTr || ''
            }));

            const isUpdate = !!(policyObj && policyObj.id);
            const payload = {
                active: activeCheckbox.checked,
                policySections: formattedSections
            };
            if (isUpdate) {
                payload.id = policyObj.id;
            }

            try {
                await apiFetch('/api/v1/policies', {
                    method: isUpdate ? 'PUT' : 'POST',
                    body: JSON.stringify(payload)
                });
                ui.showToast(isAr ? `تم حفظ ${pageTitle} بنجاح` : `${pageTitle} saved successfully`);
            } catch (err) {
                console.error('API save policy failed:', err);
                ui.showToast(isAr ? `فشل حفظ ${pageTitle}` : `Failed to save ${pageTitle}`);
            }
        });

        actionsRow.appendChild(addSecBtn);
        actionsRow.appendChild(saveBtn);
        panel.appendChild(actionsRow);

        parent.appendChild(panel);
    }

    // Sub-editor for About Us
    async function renderAboutUsSubEditor(parent) {
        let aboutObj = { active: true, aboutUsSections: [] };

        try {
            const res = await apiFetch('/api/v1/about-us');
            if (res && res.result) {
                aboutObj = res.result;
            }
        } catch (e) {
            console.error('API about-us fetch failed:', e);
        }

        const panel = ui.createElement('div', ['glass-panel'], { style: 'padding: 1.5rem;' });

        const headerRow = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem;' });
        headerRow.innerHTML = `<h3>${isAr ? 'صفحة من نحن' : 'About Us Page'}</h3>`;

        const activeToggle = ui.createElement('label', [], { style: 'display: flex; align-items: center; gap: 0.5rem; cursor: pointer;' });
        const activeCheckbox = ui.createElement('input', [], { type: 'checkbox' });
        activeCheckbox.checked = aboutObj.active !== false;
        activeToggle.appendChild(activeCheckbox);
        activeToggle.appendChild(document.createTextNode(isAr ? 'الصفحة مفعلة' : 'Page Active'));
        headerRow.appendChild(activeToggle);
        panel.appendChild(headerRow);

        const sectionsContainer = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.5rem;' });
        let sectionsList = Array.isArray(aboutObj.aboutUsSections) ? [...aboutObj.aboutUsSections] : [];

        function renderSectionsUI() {
            sectionsContainer.innerHTML = '';
            if (sectionsList.length === 0) {
                sectionsContainer.innerHTML = `<div style="text-align:center; padding: 1.5rem; color: var(--text-muted);">${isAr ? 'لا توجد أقسام مضافة بعد.' : 'No sections added yet.'}</div>`;
                return;
            }

            sectionsList.forEach((sec, idx) => {
                const secCard = ui.createElement('div', ['glass-panel'], {
                    style: 'background: var(--bg-card); border: 1px solid var(--border-color); border-top: 4px solid var(--brand-teal); border-radius: 12px; padding: 1.1rem; box-shadow: var(--card-shadow);'
                });

                const topRow = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem;' });
                topRow.innerHTML = `<strong style="color: var(--admin-color); font-size: 0.95rem;">${isAr ? `القسم #${idx + 1}` : `Section #${idx + 1}`}</strong>`;

                const removeBtn = ui.createElement('button', ['btn', 'btn-danger', 'btn-sm']);
                removeBtn.innerHTML = '🗑️ ' + (isAr ? 'حذف القسم' : 'Remove');
                removeBtn.addEventListener('click', () => {
                    sectionsList.splice(idx, 1);
                    renderSectionsUI();
                });
                topRow.appendChild(removeBtn);
                secCard.appendChild(topRow);

                const titleGroupAr = ui.createElement('div', ['form-group'], { style: 'margin-bottom: 0.6rem;' });
                titleGroupAr.innerHTML = `<label class="form-label">${isAr ? 'عنوان القسم (بالعربية)' : 'Title (Arabic)'}</label>`;
                const titleInputAr = ui.createElement('input', ['search-input'], { type: 'text', value: sec.titleAr || sec.title || '' });
                titleInputAr.addEventListener('input', (e) => { sec.titleAr = e.target.value; });
                titleGroupAr.appendChild(titleInputAr);
                secCard.appendChild(titleGroupAr);

                const contentGroupAr = ui.createElement('div', ['form-group'], { style: 'margin-bottom: 0.6rem;' });
                contentGroupAr.innerHTML = `<label class="form-label">${isAr ? 'محتوى القسم (بالعربية)' : 'Content (Arabic)'}</label>`;
                const contentTextAr = ui.createElement('textarea', ['search-input'], { rows: 3 });
                contentTextAr.value = sec.contentAr || sec.content || '';
                contentTextAr.addEventListener('input', (e) => { sec.contentAr = e.target.value; });
                contentGroupAr.appendChild(contentTextAr);
                secCard.appendChild(contentGroupAr);

                sectionsContainer.appendChild(secCard);
            });
        }

        renderSectionsUI();
        panel.appendChild(sectionsContainer);

        const actionsRow = ui.createElement('div', [], { style: 'display: flex; gap: 1rem; justify-content: space-between; flex-wrap: wrap;' });

        const addSecBtn = ui.createElement('button', ['btn', 'btn-secondary']);
        addSecBtn.innerHTML = '➕ ' + (isAr ? 'إضافة قسم جديد' : 'Add New Section');
        addSecBtn.addEventListener('click', () => {
            sectionsList.push({ id: generateUUID(), titleAr: '', contentAr: '' });
            renderSectionsUI();
        });

        const saveBtn = ui.createElement('button', ['btn', 'btn-primary']);
        saveBtn.innerHTML = '💾 ' + (isAr ? 'حفظ صفحة من نحن' : 'Save About Us');
        saveBtn.addEventListener('click', async () => {
            const formattedSections = sectionsList.map(sec => ({
                id: isValidUUID(sec.id) ? sec.id : generateUUID(),
                titleAr: sec.titleAr || sec.title || '',
                contentAr: sec.contentAr || sec.content || '',
                titleEn: sec.titleEn || '',
                contentEn: sec.contentEn || '',
                titleTr: sec.titleTr || '',
                contentTr: sec.contentTr || '',
                subTitleAr: sec.subTitleAr || '',
                subTitleEn: sec.subTitleEn || '',
                subTitleTr: sec.subTitleTr || ''
            }));

            const isUpdate = !!(aboutObj && aboutObj.id);
            const payload = {
                active: activeCheckbox.checked,
                aboutUsSections: formattedSections
            };
            if (isUpdate) {
                payload.id = aboutObj.id;
            }

            try {
                await apiFetch('/api/v1/about-us', {
                    method: isUpdate ? 'PUT' : 'POST',
                    body: JSON.stringify(payload)
                });
                ui.showToast(isAr ? 'تم حفظ صفحة من نحن بنجاح' : 'About Us saved successfully');
            } catch (err) {
                console.error('API save about-us failed:', err);
                ui.showToast(isAr ? 'فشل حفظ صفحة من نحن' : 'Failed to save About Us');
            }
        });

        actionsRow.appendChild(addSecBtn);
        actionsRow.appendChild(saveBtn);
        panel.appendChild(actionsRow);

        parent.appendChild(panel);
    }

    // Sub-editor for Contact Us
    async function renderContactUsSubEditor(parent) {
        let contactObj = { active: true, contactUsFields: [] };

        try {
            const res = await apiFetch('/api/v1/contact-us');
            if (res && res.result) {
                contactObj = res.result;
            }
        } catch (e) {
            console.error('API contact-us fetch failed:', e);
        }

        const panel = ui.createElement('div', ['glass-panel'], { style: 'padding: 1.5rem;' });

        const headerRow = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem;' });
        headerRow.innerHTML = `<h3>${isAr ? 'صفحة تواصل معنا' : 'Contact Us Page'}</h3>`;

        const activeToggle = ui.createElement('label', [], { style: 'display: flex; align-items: center; gap: 0.5rem; cursor: pointer;' });
        const activeCheckbox = ui.createElement('input', [], { type: 'checkbox' });
        activeCheckbox.checked = contactObj.active !== false;
        activeToggle.appendChild(activeCheckbox);
        activeToggle.appendChild(document.createTextNode(isAr ? 'الصفحة مفعلة' : 'Page Active'));
        headerRow.appendChild(activeToggle);
        panel.appendChild(headerRow);

        const fieldsContainer = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.5rem;' });
        let fieldsList = Array.isArray(contactObj.contactUsFields) ? [...contactObj.contactUsFields] : [];

        function renderFieldsUI() {
            fieldsContainer.innerHTML = '';
            if (fieldsList.length === 0) {
                fieldsContainer.innerHTML = `<div style="text-align:center; padding: 1.5rem; color: var(--text-muted);">${isAr ? 'لا توجد وسائل تواصل مضافة بعد.' : 'No contact fields added yet.'}</div>`;
                return;
            }

            const typeOptions = [
                { value: 0, label: isAr ? '📞 هاتف (Phone)' : '📞 Phone' },
                { value: 1, label: isAr ? '✉️ بريد إلكتروني (Email)' : '✉️ Email' },
                { value: 2, label: isAr ? '📍 عنوان (Location)' : '📍 Address/Location' },
                { value: 3, label: isAr ? '🌐 موقع إلكتروني (Website)' : '🌐 Website' },
                { value: 4, label: isAr ? '📘 فيسبوك (Facebook)' : '📘 Facebook' },
                { value: 5, label: isAr ? '📸 إنستغرام (Instagram)' : '📸 Instagram' },
                { value: 6, label: isAr ? '🐦 تويتر / إكس (Twitter/X)' : '🐦 Twitter/X' },
                { value: 7, label: isAr ? '💬 واتساب (WhatsApp)' : '💬 WhatsApp' },
                { value: 8, label: isAr ? '✈️ تليجرام (Telegram)' : '✈️ Telegram' }
            ];

            fieldsList.forEach((field, idx) => {
                const fieldCard = ui.createElement('div', ['glass-panel'], {
                    style: 'background: var(--bg-card); border: 1px solid var(--border-color); border-top: 4px solid var(--brand-teal); border-radius: 12px; padding: 1.1rem; box-shadow: var(--card-shadow);'
                });

                const topRow = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem;' });
                topRow.innerHTML = `<strong style="color: var(--admin-color); font-size: 0.95rem;">${isAr ? `وسيلة تواصل #${idx + 1}` : `Contact Field #${idx + 1}`}</strong>`;

                const removeBtn = ui.createElement('button', ['btn', 'btn-danger', 'btn-sm']);
                removeBtn.innerHTML = '🗑️ ' + (isAr ? 'حذف' : 'Remove');
                removeBtn.addEventListener('click', () => {
                    fieldsList.splice(idx, 1);
                    renderFieldsUI();
                });
                topRow.appendChild(removeBtn);
                fieldCard.appendChild(topRow);

                const grid = ui.createElement('div', [], { style: 'display: grid; grid-template-columns: 1fr 2fr; gap: 0.8rem;' });

                const typeGroup = ui.createElement('div', ['form-group']);
                typeGroup.innerHTML = `<label class="form-label">${isAr ? 'نوع الوسيلة' : 'Contact Type'}</label>`;
                const typeSelect = ui.createElement('select', ['select-input']);
                typeOptions.forEach(opt => {
                    const selected = (field.type !== undefined && field.type == opt.value) ? 'selected' : '';
                    typeSelect.innerHTML += `<option value="${opt.value}" ${selected}>${opt.label}</option>`;
                });
                typeSelect.addEventListener('change', (e) => { field.type = parseInt(e.target.value, 10); });
                typeGroup.appendChild(typeSelect);
                grid.appendChild(typeGroup);

                const valGroup = ui.createElement('div', ['form-group']);
                valGroup.innerHTML = `<label class="form-label">${isAr ? 'القيمة / الرقم / الرابط' : 'Value / URL / Phone'}</label>`;
                const valInput = ui.createElement('input', ['search-input'], { type: 'text', value: field.url || field.value || '' });
                valInput.addEventListener('input', (e) => { field.url = e.target.value; field.value = e.target.value; });
                valGroup.appendChild(valInput);
                grid.appendChild(valGroup);

                fieldCard.appendChild(grid);
                fieldsContainer.appendChild(fieldCard);
            });
        }

        renderFieldsUI();
        panel.appendChild(fieldsContainer);

        const actionsRow = ui.createElement('div', [], { style: 'display: flex; gap: 1rem; justify-content: space-between; flex-wrap: wrap;' });

        const addFieldBtn = ui.createElement('button', ['btn', 'btn-secondary']);
        addFieldBtn.innerHTML = '➕ ' + (isAr ? 'إضافة وسيلة تواصل' : 'Add Contact Field');
        addFieldBtn.addEventListener('click', () => {
            fieldsList.push({ id: generateUUID(), type: 0, url: '' });
            renderFieldsUI();
        });

        const saveBtn = ui.createElement('button', ['btn', 'btn-primary']);
        saveBtn.innerHTML = '💾 ' + (isAr ? 'حفظ صفحة تواصل معنا' : 'Save Contact Us');
        saveBtn.addEventListener('click', async () => {
            const formattedFields = fieldsList.map(field => ({
                id: isValidUUID(field.id) ? field.id : generateUUID(),
                type: parseInt(field.type !== undefined ? field.type : 0, 10),
                url: field.url || field.value || ''
            }));

            const isUpdate = !!(contactObj && contactObj.id);
            const payload = {
                active: activeCheckbox.checked,
                contactUsFields: formattedFields
            };
            if (isUpdate) {
                payload.id = contactObj.id;
            }

            try {
                await apiFetch('/api/v1/contact-us', {
                    method: isUpdate ? 'PUT' : 'POST',
                    body: JSON.stringify(payload)
                });
                ui.showToast(isAr ? 'تم حفظ صفحة تواصل معنا بنجاح' : 'Contact Us saved successfully');
            } catch (err) {
                console.error('API save contact-us failed:', err);
                ui.showToast(isAr ? 'فشل حفظ صفحة تواصل معنا' : 'Failed to save Contact Us');
            }
        });

        actionsRow.appendChild(addFieldBtn);
        actionsRow.appendChild(saveBtn);
        panel.appendChild(actionsRow);

        parent.appendChild(panel);
    }

    await renderCmsSubContent();
}

/* ==========================================================================
   Tab 7: Offers Management
   ========================================================================== */
let adminOffers = [];
let activeVendorsList = [];

async function fetchActiveVendors() {
    try {
        const [restRes, mktRes] = await Promise.all([
            apiFetch('/api/v1/users/paginate?pageNumber=1&pageSize=500&role=0&userStatus=1'),
            apiFetch('/api/v1/users/paginate?pageNumber=1&pageSize=500&role=1&userStatus=1')
        ]);
        const restaurants = (restRes && restRes.result) ? restRes.result : [];
        const markets = (mktRes && mktRes.result) ? mktRes.result : [];
        
        restaurants.forEach(r => { r.vendorType = 'Restaurant'; });
        markets.forEach(m => { m.vendorType = 'Market'; });
        
        activeVendorsList = [...restaurants, ...markets];
    } catch (e) {
        console.error('Failed to fetch vendors for offers:', e);
        activeVendorsList = [];
    }
}

async function refreshOffers() {
    try {
        const res = await apiFetch('/api/v1/offers', {
            method: 'PATCH',
            body: JSON.stringify({ pageNumber: 1, pageSize: 100, enablePagination: false })
        });
        adminOffers = Array.isArray(res) ? res : (res?.result ?? []);
    } catch (e) {
        console.error('Failed to load admin offers:', e);
        adminOffers = [];
    }
}

async function handleApproveOffer(offerId) {
    const isAr = getLanguage() === 'ar';
    try {
        await apiFetch(`/api/v1/offers/toggle-approval/${offerId}`, {
            method: 'POST'
        });
        ui.showToast(isAr ? 'تم تعديل حالة اعتماد العرض بنجاح' : 'Offer approval status toggled successfully', 'success');
        await refreshOffers();
        renderActiveTab();
    } catch (e) {
        console.error('Failed to toggle offer approval:', e);
        ui.showToast(isAr ? 'فشل تعديل حالة اعتماد العرض' : 'Failed to toggle offer approval', 'error');
    }
}

async function handleDeleteOffer(offer) {
    const isAr = getLanguage() === 'ar';
    const confirmMsg = isAr 
        ? `هل أنت متأكد من رغبتك في حذف العرض "${offer.name}"؟` 
        : `Are you sure you want to delete the offer "${offer.name}"?`;
        
    if (!confirm(confirmMsg)) return;

    try {
        await apiFetch(`/api/v1/offers/${offer.id}`, {
            method: 'DELETE'
        });
        ui.showToast(isAr ? 'تم حذف العرض بنجاح' : 'Offer deleted successfully', 'success');
        await refreshOffers();
        renderActiveTab();
    } catch (e) {
        console.error('Failed to delete offer:', e);
        ui.showToast(isAr ? 'فشل حذف العرض' : 'Failed to delete offer', 'error');
    }
}

async function renderOffersTab(container) {
    const isAr = getLanguage() === 'ar';
    const wrapper = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; width: 100%;' });

    const topBar = ui.createElement('div', [], { style: 'display: flex; justify-content: flex-end;' });
    const addOfferBtn = ui.createElementWithText('button', isAr ? '➕ إضافة عرض جديد' : '➕ Create New Offer', ['btn', 'btn-primary']);
    addOfferBtn.addEventListener('click', showAddOfferModal);
    topBar.appendChild(addOfferBtn);
    wrapper.appendChild(topBar);

    const grid = ui.createElement('div', ['analytics-grid'], { style: 'margin-top: 1rem; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.5rem; width: 100%;' });

    await refreshOffers();

    if (adminOffers.length === 0) {
        const emptyState = ui.createElement('div', ['glass-panel'], { style: 'text-align: center; padding: 3rem 1.5rem; width: 100%; grid-column: 1 / -1;' });
        emptyState.appendChild(ui.createElementWithText('h3', isAr ? 'لا توجد عروض ترويجية مضافة' : 'No Offers Found', [], { style: 'margin-bottom: 0.5rem; font-size: 1.25rem;' }));
        emptyState.appendChild(ui.createElementWithText('p', isAr ? 'لا توجد عروض نشطة أو معلقة حالياً في النظام.' : 'There are no active or pending offers in the system.', ['text-secondary'], { style: 'font-size: 0.85rem;' }));
        grid.appendChild(emptyState);
    } else {
        adminOffers.forEach(offer => {
            const card = ui.createElement('div', ['summary-card'], { style: 'display: flex; flex-direction: column; min-height: 280px; position: relative; overflow: hidden;' });

            const accent = ui.createElement('div', [], { style: 'position: absolute; top: -20px; right: -20px; width: 90px; height: 90px; border-radius: 50%; background: var(--admin-color, #8b5cf6); opacity: 0.08; pointer-events: none;' });
            card.appendChild(accent);

            // Image
            if (offer.featuredPhoto) {
                const img = ui.createElement('img', [], {
                    src: getImageUrl(offer.featuredPhoto),
                    style: 'width: 100%; height: 110px; object-fit: cover; border-radius: 8px; margin-bottom: 0.75rem; border: 1px solid var(--border-color);'
                });
                card.appendChild(img);
            } else {
                const imgPlaceholder = ui.createElement('div', [], {
                    style: 'height: 110px; background: linear-gradient(135deg, var(--admin-color, #8b5cf6) 0%, #1e90ff 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 2.5rem; margin-bottom: 0.75rem;'
                });
                imgPlaceholder.textContent = '🏷️';
                card.appendChild(imgPlaceholder);
            }

            // Header: title + delete
            const headerRow = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.4rem;' });
            headerRow.appendChild(ui.createElementWithText('strong', offer.name || '-', [], { style: 'font-size: 1.05rem; font-weight: 700; color: var(--text-primary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' }));
            
            const delBtn = ui.createElementWithText('button', '🗑️', ['btn', 'btn-danger', 'btn-sm'], { style: 'padding: 0.25rem 0.5rem; font-size: 0.85rem; border-radius: 4px; flex-shrink: 0;' });
            delBtn.addEventListener('click', () => handleDeleteOffer(offer));
            headerRow.appendChild(delBtn);
            card.appendChild(headerRow);

            // Vendor Ownership label
            const vendorName = offer.creator ? (offer.creator.name || offer.creator.phoneNumber) : null;
            const vendorRole = offer.creator ? offer.creator.role : null;
            const typeLabel = vendorName 
                ? `${vendorRole === 0 ? '🍔' : '🛒'} ${vendorName}`
                : `👑 ${isAr ? 'مسؤول النظام (أدمن)' : 'System Admin'}`;
            card.appendChild(ui.createElementWithText('div', typeLabel, ['text-muted'], { style: 'font-size: 0.75rem; font-weight: 600; margin-bottom: 0.5rem;' }));

            // Description
            if (offer.description) {
                card.appendChild(ui.createElementWithText('p', offer.description, ['text-secondary'], { style: 'font-size: 0.78rem; margin-bottom: 0.5rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;' }));
            }

            // Price
            const priceEl = ui.createElement('div', [], { style: 'margin-bottom: 0.75rem;' });
            priceEl.appendChild(ui.createElementWithText('span', `$${(parseFloat(offer.price) || 0).toFixed(2)}`, [], { style: 'font-size: 1.3rem; font-weight: 800; color: var(--color-success);' }));
            card.appendChild(priceEl);

            // Status badges
            const badgeRow = ui.createElement('div', [], { style: 'display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.75rem;' });
            if (offer.active) {
                badgeRow.appendChild(ui.createElementWithText('span', isAr ? 'نشط' : 'Active', ['badge', 'badge-success']));
            } else {
                badgeRow.appendChild(ui.createElementWithText('span', isAr ? 'غير نشط' : 'Inactive', ['badge', 'badge-danger']));
            }
            if (offer.approved) {
                badgeRow.appendChild(ui.createElementWithText('span', isAr ? 'معتمد' : 'Approved', ['badge', 'badge-success'], { style: 'background: rgba(46, 213, 115, 0.2); color: #2ed573;' }));
            } else {
                badgeRow.appendChild(ui.createElementWithText('span', isAr ? 'بانتظار الاعتماد' : 'Pending Approval', ['badge', 'badge-pending']));
            }
            if (offer.offerType === 1) {
                badgeRow.appendChild(ui.createElementWithText('span', '🛠️ ' + (isAr ? 'عرض مرن' : 'Editable'), ['badge', 'badge-secondary']));
            } else {
                badgeRow.appendChild(ui.createElementWithText('span', '🔒 ' + (isAr ? 'عرض ثابت' : 'Fixed'), ['badge', 'badge-secondary'], { style: 'background-color: #7f8c8d;' }));
            }
            card.appendChild(badgeRow);

            // Approve/Reject toggle action
            const actionBtn = ui.createElementWithText(
                'button', 
                offer.approved 
                    ? (isAr ? '🔴 إلغاء الاعتماد' : '🔴 Revoke Approval')
                    : (isAr ? '✅ اعتماد العرض' : '✅ Approve Offer'),
                ['btn', offer.approved ? 'btn-secondary' : 'btn-primary'],
                { style: 'width: 100%; margin-top: auto; font-size: 0.8rem; padding: 0.4rem 0.5rem; font-weight: 600;' }
            );
            actionBtn.addEventListener('click', () => handleApproveOffer(offer.id));
            card.appendChild(actionBtn);

            grid.appendChild(card);
        });
    }

    wrapper.appendChild(grid);
    container.appendChild(wrapper);
}
async function showAddOfferModal() {
    const isAr = getLanguage() === 'ar';
    const form = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 1rem; min-width: 320px; max-width: 480px;' });

    // Fetch vendors list first
    await fetchActiveVendors();

    // Name
    const nameWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    nameWrap.appendChild(ui.createElementWithText('label', isAr ? 'عنوان العرض' : 'Offer Title', [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const nameIn = ui.createElement('input', ['search-input'], { type: 'text', placeholder: isAr ? 'مثال: عرض نهاية الأسبوع' : 'e.g. Weekend Bundle Deal' });
    nameWrap.appendChild(nameIn);
    form.appendChild(nameWrap);

    // Description
    const descWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    descWrap.appendChild(ui.createElementWithText('label', isAr ? 'تفاصيل ووصف العرض' : 'Offer Details/Description', [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const descIn = ui.createElement('textarea', ['search-input'], { style: 'min-height: 60px; font-family: inherit; resize: vertical;', placeholder: isAr ? 'وصف العرض...' : 'Offer description...' });
    descWrap.appendChild(descIn);
    form.appendChild(descWrap);

    // Price
    const priceWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    priceWrap.appendChild(ui.createElementWithText('label', isAr ? 'السعر' : 'Price', [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const priceIn = ui.createElement('input', ['search-input'], { type: 'number', step: '0.01', min: '0', value: '10.00' });
    priceWrap.appendChild(priceIn);
    form.appendChild(priceWrap);

    // Featured Photo
    const imgWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem;' });
    imgWrap.appendChild(ui.createElementWithText('label', isAr ? 'الصورة الرئيسية للعرض' : 'Featured Image', [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    const imgRow = ui.createElement('div', [], { style: 'display: flex; gap: 1rem; align-items: center;' });
    const imgInput = ui.createElement('input', [], { type: 'file', accept: 'image/*', style: 'display: none;' });
    const uploadImgBtn = ui.createElementWithText('button', isAr ? 'اختر صورة' : 'Choose Image', ['btn', 'btn-secondary']);
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
                if (result) { 
                    uploadedPhotoKey = result; 
                    previewImg.src = getImageUrl(uploadedPhotoKey); 
                }
            } catch (_) {
                ui.showToast(isAr ? 'فشل رفع الصورة' : 'Failed to upload image', 'error');
            }
        }
    });
    imgRow.appendChild(uploadImgBtn);
    imgRow.appendChild(imgInput);
    imgRow.appendChild(previewImg);
    imgWrap.appendChild(imgRow);
    const imgHint = ui.createElementWithText('span', isAr ? 'الأبعاد الموصى بها: 1050 × 450 بكسل' : 'Recommended dimensions: 1050 × 450 px', [], { style: 'font-size: 0.75rem; color: var(--text-muted); display: block; margin-top: 0.25rem;' });
    imgWrap.appendChild(imgHint);
    form.appendChild(imgWrap);

    // Linked Searchable Vendor Dropdown (Optional)
    const vendorWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.35rem; position: relative;' });
    vendorWrap.appendChild(ui.createElementWithText('label', isAr ? 'ربط العرض بمحل / متجر (اختياري)' : 'Link Offer to Vendor (Optional)', [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    
    let selectedVendorId = null;
    let selectedVendorRole = null;

    const dropdownWrap = ui.createElement('div', [], { style: 'position: relative; width: 100%;' });
    const searchIn = ui.createElement('input', ['search-input'], { 
        type: 'text', 
        placeholder: isAr ? 'ابحث عن محل (مطعم أو ماركت)...' : 'Search for a store (restaurant/market)...',
        style: 'width: 100%;'
    });
    const clearBtn = ui.createElementWithText('button', '❌', ['btn', 'btn-secondary', 'btn-sm'], {
        style: 'position: absolute; right: 8px; top: 8px; padding: 2px 6px; font-size: 0.75rem; border-radius: 4px; display: none;'
    });
    if (isAr) {
        clearBtn.style.right = 'auto';
        clearBtn.style.left = '8px';
    }

    const listContainer = ui.createElement('div', [], {
        style: 'position: absolute; top: 100%; left: 0; right: 0; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-sm); max-height: 180px; overflow-y: auto; z-index: 100; display: none; margin-top: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);'
    });

    dropdownWrap.appendChild(searchIn);
    dropdownWrap.appendChild(clearBtn);
    dropdownWrap.appendChild(listContainer);
    vendorWrap.appendChild(dropdownWrap);
    form.appendChild(vendorWrap);

    // Linked Products Selection Container
    const prodWrap = ui.createElement('div', [], { style: 'display: flex; flex-direction: column; gap: 0.5rem;' });
    prodWrap.appendChild(ui.createElementWithText('label', isAr ? 'المنتجات المشمولة في العرض' : 'Products Included in Offer', [], { style: 'font-weight: 600; font-size: 0.85rem;' }));
    
    const checkboxContainer = ui.createElement('div', [], {
        style: 'display: flex; flex-direction: column; gap: 0.4rem; max-height: 160px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 0.5rem; background: rgba(255, 255, 255, 0.02);'
    });
    
    const showSelectVendorFirstMessage = () => {
        checkboxContainer.replaceChildren();
        checkboxContainer.appendChild(ui.createElementWithText('span', isAr ? 'الرجاء اختيار محل أولاً لعرض منتجاته' : 'Please select a vendor first to load products', ['text-muted'], { style: 'font-size: 0.85rem; padding: 0.25rem;' }));
    };
    
    showSelectVendorFirstMessage();
    prodWrap.appendChild(checkboxContainer);
    form.appendChild(prodWrap);

    let selectedProductsCheckboxes = [];

    const loadVendorProducts = async (vendorId) => {
        checkboxContainer.replaceChildren();
        selectedProductsCheckboxes = [];
        
        const loadingEl = ui.createElementWithText('span', isAr ? 'جاري تحميل المنتجات...' : 'Loading products...', ['text-muted'], { style: 'font-size: 0.85rem; padding: 0.25rem;' });
        checkboxContainer.appendChild(loadingEl);
        
        try {
            const res = await apiFetch('/api/v1/products/paginate', {
                method: 'PATCH',
                body: JSON.stringify({
                    pageNumber: 1,
                    pageSize: 1000,
                    enablePagination: false,
                    filters: { creatorId: vendorId }
                })
            });
            const products = res && res.result ? res.result : [];
            
            checkboxContainer.replaceChildren();
            if (products.length === 0) {
                checkboxContainer.appendChild(ui.createElementWithText('span', isAr ? 'لا توجد منتجات متوفرة لهذا المحل' : 'No products available for this vendor', ['text-muted'], { style: 'font-size: 0.85rem; padding: 0.25rem;' }));
            } else {
                products.forEach(p => {
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

                    if (p.photo) {
                        const img = ui.createElement('img', [], {
                            src: getImageUrl(p.photo),
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
                    const qtyLabel = ui.createElementWithText('span', isAr ? 'العدد:' : 'Qty:', [], { style: 'font-size: 0.75rem; color: var(--text-muted);' });
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
                    selectedProductsCheckboxes.push({ chk, qtyInput, name: p.name, price: p.price, photo: p.photo });
                });
            }
        } catch (e) {
            console.error('Failed to load products:', e);
            checkboxContainer.replaceChildren();
            checkboxContainer.appendChild(ui.createElementWithText('span', isAr ? 'فشل تحميل المنتجات' : 'Failed to load products', ['text-danger'], { style: 'font-size: 0.85rem; padding: 0.25rem;' }));
        }
    };

    const filterAndShowOptions = () => {
        const query = searchIn.value.toLowerCase().trim();
        listContainer.replaceChildren();
        
        const filtered = activeVendorsList.filter(v => 
            (v.name && v.name.toLowerCase().includes(query)) ||
            (v.phoneNumber && v.phoneNumber.includes(query)) ||
            (v.email && v.email.toLowerCase().includes(query))
        );
        
        if (filtered.length === 0) {
            listContainer.appendChild(ui.createElementWithText('div', isAr ? 'لا توجد نتائج' : 'No results found', [], { style: 'padding: 8px 12px; color: var(--text-muted); font-size: 0.85rem;' }));
        } else {
            filtered.forEach(v => {
                const typeIcon = v.vendorType === 'Restaurant' ? '🍔' : '🛒';
                const typeLabel = isAr ? (v.vendorType === 'Restaurant' ? 'مطعم' : 'ماركت') : v.vendorType;
                const optionEl = ui.createElement('div', [], {
                    style: 'padding: 8px 12px; cursor: pointer; font-size: 0.85rem; border-bottom: 1px solid var(--border-color); transition: background 0.2s;'
                });
                optionEl.innerHTML = `<strong>${typeIcon} ${v.name}</strong> <span style="font-size: 0.75rem; color: var(--text-muted); margin-inline-start: 5px;">(${typeLabel})</span>`;
                
                optionEl.addEventListener('mouseover', () => { optionEl.style.background = 'rgba(255,255,255,0.05)'; });
                optionEl.addEventListener('mouseout', () => { optionEl.style.background = 'transparent'; });
                
                optionEl.addEventListener('click', () => {
                    selectedVendorId = v.id;
                    selectedVendorRole = v.vendorType === 'Restaurant' ? 0 : 1;
                    searchIn.value = `${typeIcon} ${v.name} (${typeLabel})`;
                    clearBtn.style.display = 'block';
                    listContainer.style.display = 'none';
                    loadVendorProducts(v.id);
                });
                listContainer.appendChild(optionEl);
            });
        }
        listContainer.style.display = 'block';
    };

    searchIn.addEventListener('focus', filterAndShowOptions);
    searchIn.addEventListener('input', filterAndShowOptions);
    
    clearBtn.addEventListener('click', () => {
        selectedVendorId = null;
        selectedVendorRole = null;
        searchIn.value = '';
        clearBtn.style.display = 'none';
        listContainer.style.display = 'none';
        showSelectVendorFirstMessage();
        selectedProductsCheckboxes = [];
    });

    document.addEventListener('click', (e) => {
        if (!dropdownWrap.contains(e.target)) {
            listContainer.style.display = 'none';
        }
    });

    // Active toggle
    const activeLabel = ui.createElement('label', ['switch-container'], { style: 'margin-top: 0.5rem;' });
    const activeInput = ui.createElement('input', ['switch-input'], { type: 'checkbox' });
    activeInput.checked = true;
    const activeSlider = ui.createElement('div', ['switch-slider']);
    activeLabel.appendChild(activeInput);
    activeLabel.appendChild(activeSlider);
    activeLabel.appendChild(ui.createElementWithText('span', isAr ? 'العرض نشط' : 'Active Offer', [], { style: 'font-size: 0.85rem;' }));
    form.appendChild(activeLabel);

    // Editable toggle
    const editableLabel = ui.createElement('label', ['switch-container'], { style: 'margin-top: 0.5rem;' });
    const editableInput = ui.createElement('input', ['switch-input'], { type: 'checkbox' });
    editableInput.checked = false;
    const editableSlider = ui.createElement('div', ['switch-slider']);
    editableLabel.appendChild(editableInput);
    editableLabel.appendChild(editableSlider);
    editableLabel.appendChild(ui.createElementWithText('span', isAr ? 'قابل للتعديل بواسطة العميل' : 'Editable by Customer', [], { style: 'font-size: 0.85rem;' }));
    form.appendChild(editableLabel);

    const clearInvalid = (el) => ui.clearInputInvalid(el);

    ui.showModal(isAr ? 'إضافة عرض ترويجي جديد' : 'Create Promo Offer', form, [
        {
            text: isAr ? 'حفظ العرض' : 'Create Offer',
            type: 'success',
            closeOnClick: false,
            onClick: async () => {
                const name = nameIn.value.trim();
                const priceVal = priceIn.value.trim();
                const description = descIn.value.trim();

                let isValid = true;
                clearInvalid(nameIn);
                clearInvalid(priceIn);
                clearInvalid(descIn);

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
                    ui.showToast(isAr ? '⚠️ يرجى رفع صورة العرض الترويجي' : '⚠️ Please upload a featured image first', 'warning');
                    isValid = false;
                }

                const productObjectsList = [];
                selectedProductsCheckboxes.forEach(item => {
                    if (item.chk.checked) {
                        const id = parseInt(item.chk.value, 10);
                        if (!isNaN(id) && id > 0) {
                            const qty = parseInt(item.qtyInput.value, 10) || 1;
                            productObjectsList.push({
                                productId: id,
                                quantity: qty
                            });
                        }
                    }
                });

                if (selectedVendorId !== null && productObjectsList.length === 0) {
                    ui.showToast(isAr ? '⚠️ يرجى تحديد منتج واحد على الأقل مشمول في العرض' : '⚠️ Please select at least one product for this offer', 'warning');
                    checkboxContainer.style.border = '2px solid var(--color-danger)';
                    isValid = false;
                }

                if (!isValid) return;

                const payload = {
                    name,
                    price,
                    description,
                    featuredPhoto: uploadedPhotoKey,
                    otherPhotos: [],
                    active: activeInput.checked,
                    offerType: editableInput.checked ? 1 : 0,
                    productId: productObjectsList,
                    type: selectedVendorRole !== null ? selectedVendorRole : 0
                };

                try {
                    await apiFetch('/api/v1/offers', {
                        method: 'POST',
                        body: JSON.stringify(payload)
                    });
                    ui.showToast(isAr ? 'تمت إضافة العرض بنجاح' : 'Offer created successfully', 'success');
                    ui.closeModal();
                    await refreshOffers();
                    renderActiveTab();
                } catch (err) {
                    console.error('Failed to create offer:', err);
                    ui.showToast(isAr ? 'فشل إضافة العرض الترويجي' : 'Failed to create offer', 'error');
                }
            }
        },
        {
            text: isAr ? 'إلغاء' : 'Cancel',
            type: 'secondary',
            onClick: () => ui.closeModal()
        }
    ]);
}

/* ==========================================================================
   Tab 9: System Settings & Price Calculation
   ========================================================================== */
async function renderSettingsTab(parent) {
    const isAr = getLanguage() === 'ar';

    const containerGrid = ui.createElement('div', ['settings-grid'], {
        style: 'display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.5rem; width: 100%; align-items: start;'
    });

    // Panel 1: App Preferences (Language, Theme & Logout)
    const prefsPanel = ui.createElement('div', ['glass-panel'], {
        style: 'padding: 1.8rem; display: flex; flex-direction: column; gap: 1.2rem;'
    });

    const prefsHeader = ui.createElement('div', []);
    prefsHeader.appendChild(ui.createElementWithText('h3', isAr ? '⚙️ تفضيلات اللوحة والحساب' : '⚙️ Dashboard Preferences', [], { style: 'margin: 0 0 0.4rem 0; color: var(--text-primary); font-size: 1.2rem;' }));
    prefsHeader.appendChild(ui.createElementWithText('p', isAr ? 'التحكم في لغة اللوحة والمظهر الفاتح/الليلي وإدارة الجلسة' : 'Manage interface language, theme mode, and session logout', [], { style: 'margin: 0; color: var(--text-secondary); font-size: 0.85rem;' }));
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
        parent.replaceChildren();
        renderSettingsTab(parent);
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
            localStorage.removeItem('qs_admin_token');
            window.location.replace('login.html');
        }
    });
    logoutRow.appendChild(logoutBtn);
    prefsPanel.appendChild(logoutRow);

    containerGrid.appendChild(prefsPanel);

    // ── Form Panel (System Pricing & App Settings) ──────────────────────────
    const formPanel = ui.createElement('div', ['glass-panel'], {
        style: 'padding: 1.8rem; display: flex; flex-direction: column; gap: 1.2rem;'
    });

    const header = ui.createElement('div', [], { style: 'margin-bottom: 0.5rem;' });
    header.appendChild(ui.createElementWithText('h3', t('sa_settings_title'), [], { style: 'margin: 0 0 0.4rem 0; color: var(--text-primary); font-size: 1.2rem;' }));
    header.appendChild(ui.createElementWithText('p', t('sa_settings_sub'), [], { style: 'margin: 0; color: var(--text-secondary); font-size: 0.85rem;' }));
    formPanel.appendChild(header);

    // ── Default values (always rendered immediately) ─────────────────────────
    let settingsData = {
        id: 1,
        orderFee: 15.0, orderMinFee: 5.0, orderMaxFee: 50.0,
        deliveryFee: 12.0, deliveryMinFee: 15.0,
        categoryNameEn: 'Exclusive Offers', categoryNameAr: 'عروض حصرية',
        orderInterval: 60,
        allowedAreaLatitude: 30.0444, allowedAreaLongitude: 31.2357, allowedAreaRadiusKm: 10.0
    };

    // ── Fee Inputs ────────────────────────────────────────────────────────────
    const group1 = ui.createElement('div', ['form-group']);
    group1.appendChild(ui.createElementWithText('label', t('sa_settings_order_fee'), ['form-label']));
    const inputOrderFee = ui.createElement('input', ['search-input'], { type: 'number', step: '0.01', min: '0', value: settingsData.orderFee });
    group1.appendChild(inputOrderFee);
    formPanel.appendChild(group1);

    const group2 = ui.createElement('div', ['form-group']);
    group2.appendChild(ui.createElementWithText('label', t('sa_settings_min_fee'), ['form-label']));
    const inputMinFee = ui.createElement('input', ['search-input'], { type: 'number', step: '0.01', min: '0', value: settingsData.orderMinFee });
    group2.appendChild(inputMinFee);
    formPanel.appendChild(group2);

    const group3 = ui.createElement('div', ['form-group']);
    group3.appendChild(ui.createElementWithText('label', t('sa_settings_max_fee'), ['form-label']));
    const inputMaxFee = ui.createElement('input', ['search-input'], { type: 'number', step: '0.01', min: '0', value: settingsData.orderMaxFee });
    group3.appendChild(inputMaxFee);
    formPanel.appendChild(group3);

    const group4 = ui.createElement('div', ['form-group']);
    group4.appendChild(ui.createElementWithText('label', t('sa_settings_delivery_fee'), ['form-label']));
    const inputDeliveryFee = ui.createElement('input', ['search-input'], { type: 'number', step: '0.01', min: '0', value: settingsData.deliveryFee });
    group4.appendChild(inputDeliveryFee);
    formPanel.appendChild(group4);

    const group5 = ui.createElement('div', ['form-group']);
    group5.appendChild(ui.createElementWithText('label', t('sa_settings_delivery_min_fee'), ['form-label']));
    const inputDeliveryMinFee = ui.createElement('input', ['search-input'], { type: 'number', step: '0.01', min: '0', value: settingsData.deliveryMinFee });
    group5.appendChild(inputDeliveryMinFee);
    formPanel.appendChild(group5);

    // ── Divider ───────────────────────────────────────────────────────────────
    formPanel.appendChild(ui.createElement('div', [], { style: 'height: 1px; background: var(--border-color); margin: 0.4rem 0;' }));

    // ── Category Name fields ──────────────────────────────────────────────────
    formPanel.appendChild(ui.createElementWithText('p', t('sa_settings_category_hint'), [], {
        style: 'margin: 0 0 0.6rem 0; font-size: 0.8rem; color: var(--text-secondary); background: var(--bg-container); border-radius: 8px; padding: 0.6rem 0.9rem; border-left: 3px solid var(--brand-teal);'
    }));

    const groupCatEn = ui.createElement('div', ['form-group']);
    groupCatEn.appendChild(ui.createElementWithText('label', t('sa_settings_category_name_en'), ['form-label']));
    const inputCatEn = ui.createElement('input', ['search-input'], { type: 'text', placeholder: 'Exclusive Offers', value: settingsData.categoryNameEn });
    groupCatEn.appendChild(inputCatEn);
    formPanel.appendChild(groupCatEn);

    const groupCatAr = ui.createElement('div', ['form-group']);
    groupCatAr.appendChild(ui.createElementWithText('label', t('sa_settings_category_name_ar'), ['form-label']));
    const inputCatAr = ui.createElement('input', ['search-input'], { type: 'text', dir: 'rtl', placeholder: 'عروض حصرية', value: settingsData.categoryNameAr });
    groupCatAr.appendChild(inputCatAr);
    formPanel.appendChild(groupCatAr);

    // ── Order Interval ────────────────────────────────────────────────────────
    const groupInterval = ui.createElement('div', ['form-group']);
    groupInterval.appendChild(ui.createElementWithText('label', t('sa_settings_order_interval'), ['form-label']));
    const inputInterval = ui.createElement('input', ['search-input'], { type: 'number', step: '1', min: '10', max: '3600', value: settingsData.orderInterval });
    groupInterval.appendChild(inputInterval);
    groupInterval.appendChild(ui.createElementWithText('small', t('sa_settings_order_interval_hint'), [], {
        style: 'color: var(--text-secondary); font-size: 0.75rem; margin-top: 4px; display: block;'
    }));
    formPanel.appendChild(groupInterval);

    // ── Save Button ───────────────────────────────────────────────────────────
    const saveBtn = ui.createElement('button', ['btn', 'btn-primary'], {
        style: 'margin-top: 0.5rem; padding: 0.75rem 1.5rem; font-weight: 600; width: 100%;'
    });
    saveBtn.textContent = t('sa_settings_save_btn');
    saveBtn.addEventListener('click', async () => {
        const payload = {
            id: settingsData.id || 1,
            orderFee: parseFloat(inputOrderFee.value) || 0,
            orderMinFee: parseFloat(inputMinFee.value) || 0,
            orderMaxFee: parseFloat(inputMaxFee.value) || 0,
            deliveryFee: parseFloat(inputDeliveryFee.value) || 0,
            deliveryMinFee: parseFloat(inputDeliveryMinFee.value) || 0,
            categoryNameEn: inputCatEn.value.trim() || 'Exclusive Offers',
            categoryNameAr: inputCatAr.value.trim() || 'عروض حصرية',
            orderInterval: parseInt(inputInterval.value) || 60,
            allowedAreaLatitude: settingsData.allowedAreaLatitude ?? 30.0444,
            allowedAreaLongitude: settingsData.allowedAreaLongitude ?? 31.2357,
            allowedAreaRadiusKm: settingsData.allowedAreaRadiusKm ?? 10.0
        };

        if (payload.orderMinFee > payload.orderMaxFee) {
            ui.showToast(isAr ? '⚠️ الحد الأدنى لرسوم الطلب لا يمكن أن يكون أكبر من الحد الأقصى' : '⚠️ Minimum fee cap cannot exceed maximum fee cap', 'warning');
            return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = isAr ? 'جاري الحفظ...' : 'Saving...';

        try {
            const res = await apiFetch('/api/v1/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res && (res.success || res.result || res.id !== undefined || typeof res === 'object')) {
                ui.showToast(t('sa_settings_saved'), 'success');
                const resData = res.result || (res.id !== undefined ? res : null);
                if (resData) settingsData = { ...settingsData, ...resData };
            } else {
                ui.showToast(res?.message || (isAr ? 'فشل حفظ الإعدادات' : 'Failed to save settings'), 'error');
            }
        } catch (err) {
            console.error('Error saving settings:', err);
            ui.showToast(isAr ? 'حدث خطأ أثناء الاتصال بالسيرفر' : 'Network error saving settings', 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = t('sa_settings_save_btn');
        }
    });

    formPanel.appendChild(saveBtn);

    // ── Loading status (inline, non-blocking) ─────────────────────────────────
    const loadingBadge = ui.createElementWithText('div',
        isAr ? '⟳ جاري تحميل القيم المحفوظة...' : '⟳ Loading saved values...',
        [], { style: 'font-size: 0.78rem; color: var(--text-muted); text-align: center; padding: 0.3rem 0;' }
    );
    formPanel.appendChild(loadingBadge);

    // ── Append EVERYTHING synchronously first ──────────────────────────────────
    containerGrid.appendChild(formPanel);
    parent.appendChild(containerGrid);

    // ── Then fetch API and update input values ────────────────────────────────
    try {
        const response = await apiFetch('/api/v1/settings');
        const fetchedData = response ? (response.result || response.data || (response.id !== undefined ? response : (typeof response === 'object' ? response : null))) : null;
        if (fetchedData) {
            settingsData = { ...settingsData, ...fetchedData };
            const d = settingsData;
            inputOrderFee.value       = (d.orderFee !== null && d.orderFee !== undefined) ? d.orderFee : 15.0;
            inputMinFee.value         = (d.orderMinFee !== null && d.orderMinFee !== undefined) ? d.orderMinFee : 5.0;
            inputMaxFee.value         = (d.orderMaxFee !== null && d.orderMaxFee !== undefined) ? d.orderMaxFee : 50.0;
            inputDeliveryFee.value    = (d.deliveryFee !== null && d.deliveryFee !== undefined) ? d.deliveryFee : 12.0;
            inputDeliveryMinFee.value = (d.deliveryMinFee !== null && d.deliveryMinFee !== undefined) ? d.deliveryMinFee : 15.0;

            inputCatEn.value = (d.categoryNameEn && d.categoryNameEn !== 'string') ? d.categoryNameEn : 'Exclusive Offers';
            inputCatAr.value = (d.categoryNameAr && d.categoryNameAr !== 'string') ? d.categoryNameAr : 'عروض حصرية';
            inputInterval.value = (d.orderInterval && d.orderInterval > 0) ? d.orderInterval : 60;
        }
    } catch (err) {
        console.error('Failed to load settings:', err);
    } finally {
        loadingBadge.remove();
    }

    // Live Simulator Panel
    const simPanel = ui.createElement('div', ['glass-panel'], {
        style: 'padding: 1.8rem; display: flex; flex-direction: column; gap: 1.2rem; background: var(--bg-card); border-top: 4.5px solid var(--brand-teal);'
    });

    const simHeader = ui.createElement('div', []);
    simHeader.appendChild(ui.createElementWithText('h3', t('sa_settings_calc_title'), [], { style: 'margin: 0 0 0.4rem 0; color: var(--brand-teal); font-size: 1.2rem;' }));
    simHeader.appendChild(ui.createElementWithText('p', t('sa_settings_calc_desc'), [], { style: 'margin: 0; color: var(--text-secondary); font-size: 0.85rem;' }));
    simPanel.appendChild(simHeader);

    const formulaCard = ui.createElement('div', [], {
        style: 'background: var(--bg-container); border: 1px solid var(--border-color); border-radius: 10px; padding: 1rem; font-family: monospace; font-size: 0.85rem; color: var(--brand-teal); line-height: 1.5; font-weight: 600;'
    });
    formulaCard.innerHTML = `
        <div style="color: var(--brand-teal); margin-bottom: 0.3rem;">// C# UpdateOrderPreProcessor Calculation</div>
        <div>OrderFee = <span style="color:#20a66a;">Clamp</span>(TotalPrice × OrderFee %, OrderMinFee, OrderMaxFee);</div>
        <div>CalculatedDelivery = DistanceKm × DeliveryRate;</div>
        <div>DeliveryFee = <span style="color:#20a66a;">Max</span>(CalculatedDelivery, DeliveryMinFee);</div>
        <div style="color: var(--brand-orange-dark); font-weight: bold; margin-top: 0.3rem;">FinalTotal = TotalPrice + DeliveryFee + OrderFee;</div>
    `;
    simPanel.appendChild(formulaCard);

    const simInputsRow = ui.createElement('div', [], { style: 'display: flex; gap: 1rem; align-items: flex-end;' });
    
    const sampleTotalGroup = ui.createElement('div', ['form-group'], { style: 'flex: 1; margin: 0;' });
    sampleTotalGroup.appendChild(ui.createElementWithText('label', t('sa_settings_sample_total'), ['form-label']));
    const inputSampleTotal = ui.createElement('input', ['search-input'], { type: 'number', step: '1', min: '0', value: '100', style: 'width: 100%;' });
    sampleTotalGroup.appendChild(inputSampleTotal);
    simInputsRow.appendChild(sampleTotalGroup);

    const sampleDistGroup = ui.createElement('div', ['form-group'], { style: 'flex: 0 0 110px; margin: 0;' });
    sampleDistGroup.appendChild(ui.createElementWithText('label', t('sa_settings_sample_dist'), ['form-label'], { style: 'font-size: 0.78rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;' }));
    const inputSampleDist = ui.createElement('input', ['search-input'], { type: 'number', step: '0.5', min: '0', value: '5', style: 'width: 100%;' });
    sampleDistGroup.appendChild(inputSampleDist);
    simInputsRow.appendChild(sampleDistGroup);

    simPanel.appendChild(simInputsRow);

    const resultsContainer = ui.createElement('div', [], {
        style: 'display: flex; flex-direction: column; gap: 0.8rem; background: var(--brand-teal-light); border-radius: 12px; padding: 1.2rem; border: 1px solid rgba(0, 77, 64, 0.2);'
    });

    const resRow1 = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; font-size: 0.9rem;' });
    resRow1.appendChild(ui.createElementWithText('span', t('sa_settings_result_order_fee'), [], { style: 'color: var(--text-secondary);' }));
    const valOrderFee = ui.createElementWithText('span', '0.00 EGP', [], { style: 'color: var(--text-primary); font-weight: 600;' });
    resRow1.appendChild(valOrderFee);
    resultsContainer.appendChild(resRow1);

    const resRow2 = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; font-size: 0.9rem;' });
    resRow2.appendChild(ui.createElementWithText('span', t('sa_settings_result_delivery_fee'), [], { style: 'color: var(--text-secondary);' }));
    const valDeliveryFee = ui.createElementWithText('span', '0.00 EGP', [], { style: 'color: var(--text-primary); font-weight: 600;' });
    resRow2.appendChild(valDeliveryFee);
    resultsContainer.appendChild(resRow2);

    const divider = ui.createElement('div', [], { style: 'height: 1px; background: var(--border-color); margin: 0.2rem 0;' });
    resultsContainer.appendChild(divider);

    const resRow3 = ui.createElement('div', [], { style: 'display: flex; justify-content: space-between; font-size: 1.05rem;' });
    resRow3.appendChild(ui.createElementWithText('span', t('sa_settings_result_final_total'), [], { style: 'color: var(--color-success); font-weight: bold;' }));
    const valFinalTotal = ui.createElementWithText('span', '0.00 EGP', [], { style: 'color: var(--color-success); font-weight: bold; font-size: 1.2rem;' });
    resRow3.appendChild(valFinalTotal);
    resultsContainer.appendChild(resRow3);

    simPanel.appendChild(resultsContainer);
    containerGrid.appendChild(simPanel);

    function updateSimulation() {
        const subtotal = parseFloat(inputSampleTotal.value) || 0;
        const dist = parseFloat(inputSampleDist.value) || 0;
        const rateFee = parseFloat(inputOrderFee.value) || 0;
        const minFee = parseFloat(inputMinFee.value) || 0;
        const maxFee = parseFloat(inputMaxFee.value) || 0;
        const rateDelivery = parseFloat(inputDeliveryFee.value) || 0;
        const delMinFee = parseFloat(inputDeliveryMinFee.value) || 0;

        const rawOrderFee = (subtotal * rateFee) / 100;
        const calculatedOrderFee = Math.min(Math.max(rawOrderFee, minFee), maxFee);
        const calcDel = rateDelivery > 0 ? dist * rateDelivery : rateDelivery;
        const calculatedDeliveryFee = Math.max(calcDel, delMinFee);
        const finalTotal = subtotal + calculatedOrderFee + calculatedDeliveryFee;

        const curr = isAr ? ' ج.م' : ' EGP';
        valOrderFee.textContent = `${calculatedOrderFee.toFixed(2)}${curr}`;
        valDeliveryFee.textContent = `${calculatedDeliveryFee.toFixed(2)}${curr}`;
        valFinalTotal.textContent = `${finalTotal.toFixed(2)}${curr}`;
    }

    [inputOrderFee, inputMinFee, inputMaxFee, inputDeliveryFee, inputDeliveryMinFee, inputSampleTotal, inputSampleDist].forEach(input => {
        input.addEventListener('input', updateSimulation);
    });

    updateSimulation();

    /* ---- Service Zone Map Panel ---- */
    const mapPanel = ui.createElement('div', ['glass-panel'], {
        style: 'padding: 1.8rem; display: flex; flex-direction: column; gap: 1.2rem; grid-column: 1 / -1;'
    });

    const mapHeader = ui.createElement('div', [], { style: 'margin-bottom: 0.5rem;' });
    mapHeader.appendChild(ui.createElementWithText('h3', t('sa_settings_zone_title'), [], { style: 'margin: 0 0 0.4rem 0; color: var(--text-primary); font-size: 1.2rem;' }));
    mapHeader.appendChild(ui.createElementWithText('p', t('sa_settings_zone_sub'), [], { style: 'margin: 0; color: var(--text-secondary); font-size: 0.85rem;' }));
    mapPanel.appendChild(mapHeader);

    const zoneHint = ui.createElementWithText('p', t('sa_settings_zone_hint'), [], {
        style: 'margin: 0 0 0.8rem 0; font-size: 0.8rem; color: var(--text-secondary); background: var(--bg-container); border-radius: 8px; padding: 0.6rem 0.9rem; border-left: 3px solid var(--brand-orange, #FF9800);'
    });
    mapPanel.appendChild(zoneHint);

    // Coordinate inputs row
    const zoneInputsRow = ui.createElement('div', [], {
        style: 'display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; align-items: end;'
    });

    const latGroup = ui.createElement('div', ['form-group'], { style: 'margin: 0;' });
    latGroup.appendChild(ui.createElementWithText('label', t('sa_settings_zone_lat'), ['form-label']));
    const inputZoneLat = ui.createElement('input', ['search-input'], {
        type: 'number', step: '0.0001', id: 'zone-lat-input',
        value: settingsData.allowedAreaLatitude ?? 30.0444
    });
    latGroup.appendChild(inputZoneLat);
    zoneInputsRow.appendChild(latGroup);

    const lngGroup = ui.createElement('div', ['form-group'], { style: 'margin: 0;' });
    lngGroup.appendChild(ui.createElementWithText('label', t('sa_settings_zone_lng'), ['form-label']));
    const inputZoneLng = ui.createElement('input', ['search-input'], {
        type: 'number', step: '0.0001', id: 'zone-lng-input',
        value: settingsData.allowedAreaLongitude ?? 31.2357
    });
    lngGroup.appendChild(inputZoneLng);
    zoneInputsRow.appendChild(lngGroup);

    const radiusGroup = ui.createElement('div', ['form-group'], { style: 'margin: 0;' });
    radiusGroup.appendChild(ui.createElementWithText('label', t('sa_settings_zone_radius'), ['form-label']));
    const inputZoneRadius = ui.createElement('input', ['search-input'], {
        type: 'number', step: '0.5', min: '0.5', id: 'zone-radius-input',
        value: settingsData.allowedAreaRadiusKm ?? 10.0
    });
    radiusGroup.appendChild(inputZoneRadius);
    zoneInputsRow.appendChild(radiusGroup);

    mapPanel.appendChild(zoneInputsRow);

    // Location Search Row
    const mapSearchRow = ui.createElement('div', [], {
        style: 'display: flex; gap: 0.5rem; margin-top: 0.4rem;'
    });
    const mapSearchInput = ui.createElement('input', ['search-input'], {
        type: 'text',
        placeholder: isAr ? '🔍 ابحث عن مدينة، منطقة، أو شارع (مثال: مدينة نصر، القاهرة)...' : '🔍 Search city, district or street (e.g. Cairo, Nasr City)...',
        style: 'flex: 1;'
    });
    const mapSearchBtn = ui.createElement('button', ['btn', 'btn-secondary'], {
        style: 'padding: 0.5rem 1.2rem; flex-shrink: 0; font-weight: 600;'
    });
    mapSearchBtn.textContent = isAr ? 'بحث' : 'Search';
    mapSearchRow.appendChild(mapSearchInput);
    mapSearchRow.appendChild(mapSearchBtn);
    mapPanel.appendChild(mapSearchRow);

    // Map container
    const mapContainerId = 'sa-zone-map-' + Date.now();
    const mapContainer = ui.createElement('div', [], {
        id: mapContainerId,
        style: 'height: 380px; border-radius: 14px; overflow: hidden; border: 2px solid var(--border-color); background: #e8edf0; margin-top: 0.5rem;'
    });
    mapPanel.appendChild(mapContainer);

    // Radius slider
    const sliderRow = ui.createElement('div', [], { style: 'display: flex; align-items: center; gap: 1rem;' });
    sliderRow.appendChild(ui.createElementWithText('span', isAr ? 'نطاق (km):' : 'Radius (km):', [], { style: 'font-size: 0.85rem; color: var(--text-secondary); flex-shrink: 0;' }));
    const radiusSlider = ui.createElement('input', [], {
        type: 'range', min: '0.5', max: '100', step: '0.5',
        value: settingsData.allowedAreaRadiusKm ?? 10.0,
        style: 'flex: 1; accent-color: var(--brand-teal, #00796B); cursor: pointer;'
    });
    const radiusLabel = ui.createElementWithText('span', `${(settingsData.allowedAreaRadiusKm ?? 10).toFixed(1)} km`, [], {
        style: 'font-weight: 700; color: var(--brand-teal); min-width: 55px; text-align: center;'
    });
    sliderRow.appendChild(radiusSlider);
    sliderRow.appendChild(radiusLabel);
    mapPanel.appendChild(sliderRow);

    // Save zone button
    const zoneSaveBtn = ui.createElement('button', ['btn', 'btn-primary'], {
        style: 'padding: 0.75rem 1.5rem; font-weight: 600; width: 100%; max-width: 300px; margin-top: 0.5rem;'
    });
    zoneSaveBtn.textContent = t('sa_settings_zone_save_btn');
    zoneSaveBtn.addEventListener('click', async () => {
        const zonePayload = {
            id: settingsData.id || 1,
            orderFee: parseFloat(inputOrderFee.value) || 0,
            orderMinFee: parseFloat(inputMinFee.value) || 0,
            orderMaxFee: parseFloat(inputMaxFee.value) || 0,
            deliveryFee: parseFloat(inputDeliveryFee.value) || 0,
            deliveryMinFee: parseFloat(inputDeliveryMinFee.value) || 0,
            categoryNameEn: inputCatEn.value.trim() || 'Exclusive Offers',
            categoryNameAr: inputCatAr.value.trim() || 'عروض حصرية',
            orderInterval: parseInt(inputInterval.value) || 60,
            allowedAreaLatitude: parseFloat(inputZoneLat.value) || 30.0444,
            allowedAreaLongitude: parseFloat(inputZoneLng.value) || 31.2357,
            allowedAreaRadiusKm: parseFloat(inputZoneRadius.value) || 10.0
        };
        zoneSaveBtn.disabled = true;
        zoneSaveBtn.textContent = isAr ? 'جاري الحفظ...' : 'Saving...';
        try {
            const res = await apiFetch('/api/v1/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(zonePayload)
            });
            if (res && (res.success || res.result || res.id !== undefined || typeof res === 'object')) {
                settingsData = { ...settingsData, ...zonePayload };
                ui.showToast(t('sa_settings_zone_saved'), 'success');
            } else {
                ui.showToast(res?.message || (isAr ? 'فشل حفظ منطقة الخدمة' : 'Failed to save zone settings'), 'error');
            }
        } catch (err) {
            ui.showToast(isAr ? 'حدث خطأ أثناء الحفظ' : 'Network error saving zone settings', 'error');
        } finally {
            zoneSaveBtn.disabled = false;
            zoneSaveBtn.textContent = t('sa_settings_zone_save_btn');
        }
    });
    mapPanel.appendChild(zoneSaveBtn);
    containerGrid.appendChild(mapPanel);

    // Initialize Leaflet map after DOM insertion
    requestAnimationFrame(() => {
        const initLat = parseFloat(inputZoneLat.value) || 30.0444;
        const initLng = parseFloat(inputZoneLng.value) || 31.2357;
        const initRadius = (parseFloat(inputZoneRadius.value) || 10.0) * 1000; // meters

        if (typeof L === 'undefined') return;

        const zoneMap = L.map(mapContainerId).setView([initLat, initLng], 11);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(zoneMap);

        // Zone circle
        let zoneCircle = L.circle([initLat, initLng], {
            color: '#00796B',
            fillColor: '#00796B',
            fillOpacity: 0.15,
            weight: 2.5,
            radius: initRadius
        }).addTo(zoneMap);

        // Draggable center marker
        const centerIcon = L.divIcon({
            className: '',
            html: '<div style="background:#00796B;width:20px;height:20px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        let centerMarker = L.marker([initLat, initLng], { draggable: true, icon: centerIcon }).addTo(zoneMap);

        function syncMapFromInputs() {
            const lat = parseFloat(inputZoneLat.value) || 30.0444;
            const lng = parseFloat(inputZoneLng.value) || 31.2357;
            const radKm = parseFloat(inputZoneRadius.value) || 10.0;
            centerMarker.setLatLng([lat, lng]);
            zoneCircle.setLatLng([lat, lng]);
            zoneCircle.setRadius(radKm * 1000);
        }

        function syncInputsFromLatLng(lat, lng) {
            inputZoneLat.value = lat.toFixed(6);
            inputZoneLng.value = lng.toFixed(6);
            centerMarker.setLatLng([lat, lng]);
            zoneCircle.setLatLng([lat, lng]);
        }

        async function performMapSearch() {
            const query = mapSearchInput.value.trim();
            if (!query) return;
            mapSearchBtn.disabled = true;
            mapSearchBtn.textContent = isAr ? 'جاري البحث...' : 'Searching...';
            try {
                const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
                const data = await res.json();
                if (data && data.length > 0) {
                    const lat = parseFloat(data[0].lat);
                    const lon = parseFloat(data[0].lon);
                    syncInputsFromLatLng(lat, lon);
                    zoneMap.setView([lat, lon], 13);
                    ui.showToast(isAr ? `تم تحديد الموقع` : `Location set`, 'success');
                } else {
                    ui.showToast(isAr ? 'لم يتم العثور على الموقع، جرب اسمًا آخر' : 'Location not found', 'warning');
                }
            } catch (err) {
                console.error('Search failed:', err);
                ui.showToast(isAr ? 'حدث خطأ أثناء البحث' : 'Search failed', 'error');
            } finally {
                mapSearchBtn.disabled = false;
                mapSearchBtn.textContent = isAr ? 'بحث' : 'Search';
            }
        }

        mapSearchBtn.addEventListener('click', performMapSearch);
        mapSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                performMapSearch();
            }
        });

        // Sync radius from number input
        inputZoneRadius.addEventListener('input', () => {
            const radKm = parseFloat(inputZoneRadius.value) || 10.0;
            radiusSlider.value = radKm;
            radiusLabel.textContent = `${radKm.toFixed(1)} km`;
            zoneCircle.setRadius(radKm * 1000);
        });

        // Sync radius from slider
        radiusSlider.addEventListener('input', () => {
            const radKm = parseFloat(radiusSlider.value) || 10.0;
            inputZoneRadius.value = radKm;
            radiusLabel.textContent = `${radKm.toFixed(1)} km`;
            zoneCircle.setRadius(radKm * 1000);
        });

        // Sync lat/lng from text inputs
        [inputZoneLat, inputZoneLng].forEach(inp => inp.addEventListener('input', syncMapFromInputs));

        // Drag marker updates inputs
        centerMarker.on('dragend', (e) => {
            const pos = e.target.getLatLng();
            syncInputsFromLatLng(pos.lat, pos.lng);
        });

        // Click on map to set new center
        zoneMap.on('click', (e) => {
            syncInputsFromLatLng(e.latlng.lat, e.latlng.lng);
        });

        // Fix map rendering after layout
        setTimeout(() => zoneMap.invalidateSize(), 300);
    });
}

// Autostart on standalone load
document.addEventListener('DOMContentLoaded', () => {
    initSuperAdmin();
});
