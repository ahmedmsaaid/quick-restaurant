/**
 * Merchant Financial & Wallet Module
 * Used by Restaurant and Supermarket Dashboards
 * Strictly follows Quick-Service Frontend Guidelines:
 * - Zero innerHTML for dynamic data (XSS prevention)
 * - Full i18n support via t()
 * - Responsive tables & cards
 */

import * as ui from '../ui-utils.js?v=46.0';
import { t, getLanguage } from '../translations.js?v=46.0';

/**
 * Formats a number as currency (EGP / ج.م)
 */
function formatCurrency(val) {
    const num = Number(val) || 0;
    const formatted = num.toLocaleString(getLanguage() === 'ar' ? 'ar-EG' : 'en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    return `${formatted} ${t('currency_egp')}`;
}

/**
 * Formats an ISO date string to localized readable date/time
 */
function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString(getLanguage() === 'ar' ? 'ar-EG' : 'en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return dateStr;
    }
}

/**
 * Normalizes paginated API responses where `res.result` may be either
 * a direct Array or an object containing `items` / `data`.
 */
function extractPaginatedItems(res) {
    if (!res) return { items: [], totalCount: 0, totalPages: 1 };
    const items = Array.isArray(res.result)
        ? res.result
        : (Array.isArray(res.result?.items)
            ? res.result.items
            : (Array.isArray(res.result?.data) ? res.result.data : []));
    const totalCount = res.totalCount ?? res.result?.totalCount ?? items.length;
    const totalPages = res.totalPages ?? res.result?.totalPages ?? 1;
    return { items, totalCount, totalPages: Math.max(1, totalPages) };
}

/**
 * Helper to create a KPI Stat Card using safe DOM manipulation
 */
function createKpiCard({ icon, label, value, subtext, accentClass = 'accent-primary' }) {
    const card = document.createElement('div');
    card.className = `stat-card financial-kpi-card ${accentClass}`;

    const header = document.createElement('div');
    header.className = 'stat-card-header';

    const iconEl = document.createElement('span');
    iconEl.className = 'stat-icon';
    iconEl.textContent = icon;

    const labelEl = document.createElement('span');
    labelEl.className = 'stat-label';
    labelEl.textContent = label;

    header.appendChild(iconEl);
    header.appendChild(labelEl);

    const valueEl = document.createElement('div');
    valueEl.className = 'stat-value';
    valueEl.textContent = value;

    card.appendChild(header);
    card.appendChild(valueEl);

    if (subtext) {
        const subEl = document.createElement('div');
        subEl.className = 'stat-subtext';
        subEl.textContent = subtext;
        card.appendChild(subEl);
    }

    return card;
}

// ============================================================================
// 1. MERCHANT FINANCIAL OVERVIEW TAB
// ============================================================================

export async function renderMerchantOverview(container, apiClient, merchantId) {
    if (!container) return;
    container.replaceChildren();

    const state = {
        filterType: 2, // Default: ThisMonth (0=Today, 1=ThisWeek, 2=ThisMonth, 3=Custom)
        fromDate: '',
        toDate: '',
        ordersPage: 1,
        ordersPageSize: 10
    };

    const wrapper = document.createElement('div');
    wrapper.className = 'financial-overview-wrapper';

    // --- Filter Bar ---
    const filterBar = document.createElement('div');
    filterBar.className = 'card financial-filter-bar';

    const filterGroup = document.createElement('div');
    filterGroup.className = 'filter-group-row';

    const filterLabel = document.createElement('span');
    filterLabel.className = 'filter-label';
    filterLabel.textContent = t('financial_filter_label');
    filterGroup.appendChild(filterLabel);

    const filterButtons = [
        { type: 0, key: 'filter_today' },
        { type: 1, key: 'filter_this_week' },
        { type: 2, key: 'filter_this_month' },
        { type: 3, key: 'filter_custom' }
    ];

    const btnContainer = document.createElement('div');
    btnContainer.className = 'filter-pills';

    const customDateContainer = document.createElement('div');
    customDateContainer.className = 'custom-date-inputs hidden';

    const fromInput = document.createElement('input');
    fromInput.type = 'date';
    fromInput.className = 'form-control date-input';

    const toInput = document.createElement('input');
    toInput.type = 'date';
    toInput.className = 'form-control date-input';

    const applyCustomBtn = document.createElement('button');
    applyCustomBtn.className = 'btn btn-primary btn-sm';
    applyCustomBtn.textContent = t('btn_apply');
    applyCustomBtn.addEventListener('click', () => {
        if (!fromInput.value || !toInput.value) {
            ui.showToast(t('settlement_Toast_invalid_dates'), 'warning');
            return;
        }
        state.fromDate = new Date(fromInput.value).toISOString();
        state.toDate = new Date(toInput.value + 'T23:59:59').toISOString();
        loadDashboardSummary();
    });

    customDateContainer.appendChild(fromInput);
    customDateContainer.appendChild(toInput);
    customDateContainer.appendChild(applyCustomBtn);

    filterButtons.forEach(fb => {
        const btn = document.createElement('button');
        btn.className = `btn btn-filter ${state.filterType === fb.type ? 'active' : ''}`;
        btn.textContent = t(fb.key);
        btn.addEventListener('click', () => {
            state.filterType = fb.type;
            Array.from(btnContainer.children).forEach(c => c.classList.remove('active'));
            btn.classList.add('active');

            if (fb.type === 3) {
                customDateContainer.classList.remove('hidden');
            } else {
                customDateContainer.classList.add('hidden');
                state.fromDate = '';
                state.toDate = '';
                loadDashboardSummary();
            }
        });
        btnContainer.appendChild(btn);
    });

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'btn btn-outline btn-sm ms-auto';
    refreshBtn.textContent = `🔄 ${t('btn_refresh')}`;
    refreshBtn.addEventListener('click', () => {
        loadDashboardSummary();
        loadDeliveredOrders();
    });

    filterGroup.appendChild(btnContainer);
    filterGroup.appendChild(customDateContainer);
    filterGroup.appendChild(refreshBtn);
    filterBar.appendChild(filterGroup);
    wrapper.appendChild(filterBar);

    // --- KPI Cards Grid ---
    const kpiGrid = document.createElement('div');
    kpiGrid.className = 'stats-grid financial-kpi-grid';
    wrapper.appendChild(kpiGrid);

    // --- Financial Breakdown & Recent Delivered Orders Section ---
    const ordersCard = document.createElement('div');
    ordersCard.className = 'card mt-4';

    const ordersHeader = document.createElement('div');
    ordersHeader.className = 'card-header d-flex justify-between align-center';

    const ordersTitle = document.createElement('h3');
    ordersTitle.className = 'card-title';
    ordersTitle.textContent = `📦 ${t('recent_orders_title')} (${t('order_status_delivered')})`;
    ordersHeader.appendChild(ordersTitle);
    ordersCard.appendChild(ordersHeader);

    const ordersBody = document.createElement('div');
    ordersBody.className = 'card-body';
    ordersCard.appendChild(ordersBody);

    wrapper.appendChild(ordersCard);
    container.appendChild(wrapper);

    // --- Loaders ---
    async function loadDashboardSummary() {
        kpiGrid.replaceChildren();
        for (let i = 0; i < 6; i++) {
            const skel = document.createElement('div');
            skel.className = 'stat-card skeleton-box';
            skel.style.height = '120px';
            kpiGrid.appendChild(skel);
        }

        try {
            const params = new URLSearchParams();
            params.append('FilterType', state.filterType);
            if (state.filterType === 3 && state.fromDate && state.toDate) {
                params.append('FromDate', state.fromDate);
                params.append('ToDate', state.toDate);
            }

            const res = await apiClient.fetch(`/api/v1/dashboard/merchant?${params.toString()}`, {
                method: 'GET'
            });

            kpiGrid.replaceChildren();
            const d = res?.result || {};

            kpiGrid.appendChild(createKpiCard({
                icon: '🧾',
                label: t('merchant_kpi_orders'),
                value: String(d.ordersCount ?? 0),
                subtext: t('stat_orders_desc'),
                accentClass: 'accent-blue'
            }));

            kpiGrid.appendChild(createKpiCard({
                icon: '💰',
                label: t('merchant_kpi_revenue'),
                value: formatCurrency(d.totalRevenue ?? d.totalSalesAmount ?? 0),
                subtext: t('stat_gmv_desc'),
                accentClass: 'accent-green'
            }));

            kpiGrid.appendChild(createKpiCard({
                icon: '📊',
                label: t('merchant_kpi_commission'),
                value: formatCurrency(d.quickCommission ?? 0),
                subtext: t('stat_commission_desc'),
                accentClass: 'accent-orange'
            }));

            kpiGrid.appendChild(createKpiCard({
                icon: '✅',
                label: t('merchant_kpi_settled'),
                value: formatCurrency(d.settledAmount ?? 0),
                subtext: t('stat_settled_desc'),
                accentClass: 'accent-teal'
            }));

            kpiGrid.appendChild(createKpiCard({
                icon: '⏳',
                label: t('merchant_kpi_due'),
                value: formatCurrency(d.duePayout ?? 0),
                subtext: t('stat_due_desc'),
                accentClass: 'accent-purple'
            }));

            kpiGrid.appendChild(createKpiCard({
                icon: '🏦',
                label: t('merchant_kpi_wallet'),
                value: formatCurrency(d.currentWalletBalance ?? 0),
                subtext: t('stat_balance_desc'),
                accentClass: 'accent-primary'
            }));
        } catch (err) {
            console.error('Error loading merchant dashboard summary:', err);
            kpiGrid.replaceChildren();
            const errEl = document.createElement('div');
            errEl.className = 'error-state p-3';
            errEl.textContent = t('network_error');
            kpiGrid.appendChild(errEl);
        }
    }

    async function loadDeliveredOrders() {
        ordersBody.replaceChildren();
        const loadingEl = document.createElement('div');
        loadingEl.className = 'loading-spinner p-4 text-center';
        loadingEl.textContent = t('loading');
        ordersBody.appendChild(loadingEl);

        try {
            const ordersReqBody = {
                pageNumber: state.ordersPage,
                pageSize: state.ordersPageSize,
                enablePagination: true,
                filters: {
                    status: 7 // Delivered = 7
                }
            };
            if (merchantId) {
                ordersReqBody.filters.userId = Number(merchantId);
            }

            const ordersRes = await apiClient.fetch('/api/v1/orders', {
                method: 'PATCH',
                body: JSON.stringify(ordersReqBody)
            });

            ordersBody.replaceChildren();
            const { items: orders, totalCount, totalPages } = extractPaginatedItems(ordersRes);

            if (!orders.length) {
                const emptyOrders = ui.createEmptyState(t('empty_state_orders'));
                ordersBody.appendChild(emptyOrders);
                return;
            }

            const tableResponsive = document.createElement('div');
            tableResponsive.className = 'table-responsive';

            const table = document.createElement('table');
            table.className = 'data-table financial-table';

            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            const headers = [
                t('th_order_id'),
                t('th_total_price'),
                t('th_commission'),
                t('th_net_earnings'),
                t('th_status'),
                t('th_date')
            ];
            headers.forEach(hText => {
                const th = document.createElement('th');
                th.textContent = hText;
                headerRow.appendChild(th);
            });
            thead.appendChild(headerRow);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            orders.forEach(order => {
                const tr = document.createElement('tr');

                const tdId = document.createElement('td');
                tdId.className = 'fw-bold';
                tdId.textContent = `#${order.id}`;
                tr.appendChild(tdId);

                const totalPriceVal = Number(order.totalPrice || 0);
                const deliveryFeeVal = Number(order.deliveryFee || 0);
                const orderFeeVal = Number(order.orderFee || 0);
                const itemsSubtotal = Math.max(0, totalPriceVal - deliveryFeeVal - orderFeeVal);
                const commissionVal = Number(order.commission ?? order.quickCommission ?? 0);
                const netEarningsVal = Number(order.netEarnings ?? (itemsSubtotal - commissionVal));

                const tdTotal = document.createElement('td');
                tdTotal.textContent = formatCurrency(itemsSubtotal || totalPriceVal);
                tr.appendChild(tdTotal);

                const tdComm = document.createElement('td');
                tdComm.className = 'text-danger';
                tdComm.textContent = `- ${formatCurrency(commissionVal)}`;
                tr.appendChild(tdComm);

                const tdNet = document.createElement('td');
                tdNet.className = 'text-success fw-bold';
                tdNet.textContent = formatCurrency(netEarningsVal);
                tr.appendChild(tdNet);

                const tdStatus = document.createElement('td');
                const badge = document.createElement('span');
                badge.className = 'status-badge status-completed';
                badge.textContent = t('order_status_delivered');
                tdStatus.appendChild(badge);
                tr.appendChild(tdStatus);

                const tdDate = document.createElement('td');
                tdDate.textContent = formatDate(order.createdOn || order.createdDate || order.createdAt);
                tr.appendChild(tdDate);

                tbody.appendChild(tr);
            });

            table.appendChild(tbody);
            tableResponsive.appendChild(table);
            ordersBody.appendChild(tableResponsive);

            // Pagination Controls
            const calcPages = Math.ceil(totalCount / state.ordersPageSize) || totalPages || 1;
            if (calcPages > 1) {
                const pagEl = createPaginationControls(state.ordersPage, calcPages, (newPage) => {
                    state.ordersPage = newPage;
                    loadDeliveredOrders();
                });
                ordersBody.appendChild(pagEl);
            }
        } catch (err) {
            console.error('Error loading delivered orders:', err);
            ordersBody.replaceChildren();
            const emptyOrders = ui.createEmptyState(t('empty_state_orders'));
            ordersBody.appendChild(emptyOrders);
        }
    }

    await Promise.all([loadDashboardSummary(), loadDeliveredOrders()]);
}

// ============================================================================
// 2. MERCHANT SETTLEMENTS HISTORY TAB
// ============================================================================

export async function renderMerchantSettlements(container, apiClient) {
    if (!container) return;
    container.replaceChildren();

    const state = {
        pageNumber: 1,
        pageSize: 15,
        statusFilter: ''
    };

    const card = document.createElement('div');
    card.id = 'section-settlements';
    card.className = 'card';

    const header = document.createElement('div');
    header.className = 'card-header d-flex justify-between align-center flex-wrap gap-2';

    const title = document.createElement('h3');
    title.className = 'card-title';
    title.textContent = `📑 ${t('merchant_section_settlements_title')}`;

    const controls = document.createElement('div');
    controls.className = 'd-flex align-center gap-2';

    const statusSelect = document.createElement('select');
    statusSelect.className = 'form-control form-select-sm';

    const statusOptions = [
        { val: '', label: t('filter_all_status') },
        { val: '0', label: t('settlement_status_pending') },
        { val: '1', label: t('settlement_status_completed') },
        { val: '2', label: t('settlement_status_rejected') }
    ];
    statusOptions.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.val;
        option.textContent = opt.label;
        statusSelect.appendChild(option);
    });

    statusSelect.addEventListener('change', () => {
        state.statusFilter = statusSelect.value;
        state.pageNumber = 1;
        loadSettlements();
    });

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'btn btn-outline btn-sm';
    refreshBtn.textContent = `🔄 ${t('btn_refresh')}`;
    refreshBtn.addEventListener('click', () => loadSettlements());

    controls.appendChild(statusSelect);
    controls.appendChild(refreshBtn);

    header.appendChild(title);
    header.appendChild(controls);
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'card-body';
    card.appendChild(body);
    container.appendChild(card);

    async function loadSettlements() {
        body.replaceChildren();
        const loader = document.createElement('div');
        loader.className = 'loading-spinner p-4 text-center';
        loader.textContent = t('loading');
        body.appendChild(loader);

        try {
            const params = new URLSearchParams({
                PageNumber: state.pageNumber,
                PageSize: state.pageSize
            });
            if (state.statusFilter !== '') {
                params.append('Status', state.statusFilter);
            }

            const res = await apiClient.fetch(`/api/v1/settlements/my-settlements?${params.toString()}`, {
                method: 'GET'
            });

            body.replaceChildren();
            const { items, totalCount, totalPages } = extractPaginatedItems(res);

            if (!items.length) {
                const empty = ui.createEmptyState(t('empty_state_settlements'));
                body.appendChild(empty);
                return;
            }

            const tableWrap = document.createElement('div');
            tableWrap.className = 'table-responsive';

            const table = document.createElement('table');
            table.className = 'data-table financial-table';

            const thead = document.createElement('thead');
            const trHead = document.createElement('tr');
            [
                t('th_settlement_id'),
                t('th_amount'),
                t('th_status'),
                t('th_notes'),
                t('th_created_date'),
                t('th_processed_date')
            ].forEach(h => {
                const th = document.createElement('th');
                th.textContent = h;
                trHead.appendChild(th);
            });
            thead.appendChild(trHead);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            items.forEach(item => {
                const tr = document.createElement('tr');

                const tdId = document.createElement('td');
                tdId.className = 'fw-bold';
                tdId.textContent = `#${item.id}`;
                tr.appendChild(tdId);

                const tdAmount = document.createElement('td');
                tdAmount.className = 'fw-bold text-primary';
                tdAmount.textContent = formatCurrency(item.amount);
                tr.appendChild(tdAmount);

                const tdStatus = document.createElement('td');
                const badge = document.createElement('span');
                const st = Number(item.status);
                if (st === 1) {
                    badge.className = 'status-badge status-completed';
                    badge.textContent = t('settlement_status_completed');
                } else if (st === 2) {
                    badge.className = 'status-badge status-rejected';
                    badge.textContent = t('settlement_status_rejected');
                } else {
                    badge.className = 'status-badge status-pending';
                    badge.textContent = t('settlement_status_pending');
                }
                tdStatus.appendChild(badge);
                tr.appendChild(tdStatus);

                const tdNotes = document.createElement('td');
                tdNotes.textContent = item.notes || item.note || '-';
                tr.appendChild(tdNotes);

                const tdCreated = document.createElement('td');
                tdCreated.textContent = formatDate(item.createdOn || item.createdDate || item.createdAt);
                tr.appendChild(tdCreated);

                const tdProcessed = document.createElement('td');
                tdProcessed.textContent = formatDate(item.settledOn || item.processedDate || item.updatedOn);
                tr.appendChild(tdProcessed);

                tbody.appendChild(tr);
            });

            table.appendChild(tbody);
            tableWrap.appendChild(table);
            body.appendChild(tableWrap);

            const calcPages = Math.ceil(totalCount / state.pageSize) || totalPages || 1;
            if (calcPages > 1) {
                const pag = createPaginationControls(state.pageNumber, calcPages, (p) => {
                    state.pageNumber = p;
                    loadSettlements();
                });
                body.appendChild(pag);
            }
        } catch (err) {
            console.error('Error loading merchant settlements:', err);
            body.replaceChildren();
            const errEl = document.createElement('div');
            errEl.className = 'error-state p-4 text-center';
            errEl.textContent = t('network_error');
            body.appendChild(errEl);
        }
    }

    await loadSettlements();
}

// ============================================================================
// 3. MERCHANT WALLET & TRANSACTIONS TAB
// ============================================================================

export async function renderMerchantWallet(container, apiClient) {
    if (!container) return;
    container.replaceChildren();

    const state = {
        pageNumber: 1,
        pageSize: 15,
        txTypeFilter: ''
    };

    const wrapper = document.createElement('div');
    wrapper.id = 'section-wallet';
    wrapper.className = 'wallet-section-wrapper';

    // --- Wallet Balance Banner ---
    const banner = document.createElement('div');
    banner.className = 'card wallet-balance-banner mb-4';

    const bannerContent = document.createElement('div');
    bannerContent.className = 'd-flex justify-between align-center flex-wrap gap-3 p-4';

    const leftCol = document.createElement('div');
    const walletLabel = document.createElement('div');
    walletLabel.className = 'text-muted mb-1';
    walletLabel.textContent = t('merchant_kpi_wallet');

    const walletValue = document.createElement('div');
    walletValue.className = 'wallet-hero-amount';
    walletValue.textContent = '...';

    const walletUpdated = document.createElement('div');
    walletUpdated.className = 'text-muted small mt-1';

    leftCol.appendChild(walletLabel);
    leftCol.appendChild(walletValue);
    leftCol.appendChild(walletUpdated);

    const refreshAllBtn = document.createElement('button');
    refreshAllBtn.className = 'btn btn-primary';
    refreshAllBtn.textContent = `🔄 ${t('btn_refresh')}`;
    refreshAllBtn.addEventListener('click', () => {
        loadWalletBalance();
        loadTransactions();
    });

    bannerContent.appendChild(leftCol);
    bannerContent.appendChild(refreshAllBtn);
    banner.appendChild(bannerContent);
    wrapper.appendChild(banner);

    // --- Transactions Table Card ---
    const txCard = document.createElement('div');
    txCard.className = 'card';

    const txHeader = document.createElement('div');
    txHeader.className = 'card-header d-flex justify-between align-center flex-wrap gap-2';

    const txTitle = document.createElement('h3');
    txTitle.className = 'card-title';
    txTitle.textContent = `💳 ${t('wallet_tx_history_title')}`;

    const typeSelect = document.createElement('select');
    typeSelect.className = 'form-control form-select-sm';
    [
        { val: '', label: t('filter_all_types') },
        { val: '0', label: t('wallet_tx_deposit') },
        { val: '1', label: t('wallet_tx_withdrawal') },
        { val: '2', label: t('wallet_tx_transfer') },
        { val: '3', label: t('wallet_tx_settlement') }
    ].forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.val;
        o.textContent = opt.label;
        typeSelect.appendChild(o);
    });

    typeSelect.addEventListener('change', () => {
        state.txTypeFilter = typeSelect.value;
        state.pageNumber = 1;
        loadTransactions();
    });

    txHeader.appendChild(txTitle);
    txHeader.appendChild(typeSelect);
    txCard.appendChild(txHeader);

    const txBody = document.createElement('div');
    txBody.className = 'card-body';
    txCard.appendChild(txBody);

    wrapper.appendChild(txCard);
    container.appendChild(wrapper);

    async function loadWalletBalance() {
        try {
            const walletRes = await apiClient.fetch('/api/v1/wallets/user', { method: 'GET' });
            const w = walletRes?.result || {};
            const bal = w.availableBalance ?? w.balance ?? w.currentWalletBalance ?? 0;
            walletValue.textContent = formatCurrency(bal);
            const upd = w.updatedOn || w.updatedAt || w.createdOn;
            if (upd) {
                walletUpdated.textContent = `${t('th_last_updated')}: ${formatDate(upd)}`;
            }
        } catch (err) {
            console.error('Error loading wallet balance:', err);
            walletValue.textContent = formatCurrency(0);
        }
    }

    async function loadTransactions() {
        txBody.replaceChildren();
        const loader = document.createElement('div');
        loader.className = 'loading-spinner p-4 text-center';
        loader.textContent = t('loading');
        txBody.appendChild(loader);

        try {
            const params = new URLSearchParams({
                PageNumber: state.pageNumber,
                PageSize: state.pageSize
            });
            if (state.txTypeFilter !== '') {
                params.append('Type', state.txTypeFilter);
            }

            const res = await apiClient.fetch(`/api/v1/wallets/user/transactions?${params.toString()}`, {
                method: 'GET'
            });

            txBody.replaceChildren();
            const { items, totalCount, totalPages } = extractPaginatedItems(res);

            if (!items.length) {
                const empty = ui.createEmptyState(t('empty_state_transactions'));
                txBody.appendChild(empty);
                return;
            }

            const tableWrap = document.createElement('div');
            tableWrap.className = 'table-responsive';

            const table = document.createElement('table');
            table.className = 'data-table financial-table';

            const thead = document.createElement('thead');
            const trHead = document.createElement('tr');
            [
                t('th_transaction_id'),
                t('th_type'),
                t('th_amount'),
                t('th_balance_after'),
                t('th_description'),
                t('th_date')
            ].forEach(h => {
                const th = document.createElement('th');
                th.textContent = h;
                trHead.appendChild(th);
            });
            thead.appendChild(trHead);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            const typeMap = {
                0: { key: 'wallet_tx_deposit', cls: 'status-completed', sign: '+' },
                1: { key: 'wallet_tx_withdrawal', cls: 'status-rejected', sign: '-' },
                2: { key: 'wallet_tx_transfer', cls: 'status-completed', sign: '+' },
                3: { key: 'wallet_tx_settlement', cls: 'status-pending', sign: '-' },
                4: { key: 'wallet_tx_order_payment', cls: 'status-completed', sign: '+' },
                5: { key: 'wallet_tx_settlement', cls: 'status-pending', sign: '-' },
                6: { key: 'wallet_tx_refund', cls: 'status-rejected', sign: '-' }
            };

            items.forEach(tx => {
                const tr = document.createElement('tr');

                const tdId = document.createElement('td');
                tdId.className = 'fw-bold';
                tdId.textContent = `#${tx.id}`;
                tr.appendChild(tdId);

                const tInfo = typeMap[Number(tx.type)] || { key: 'wallet_tx_transfer', cls: 'status-pending', sign: '' };

                const tdType = document.createElement('td');
                const badge = document.createElement('span');
                badge.className = `status-badge ${tInfo.cls}`;
                badge.textContent = t(tInfo.key);
                tdType.appendChild(badge);
                tr.appendChild(tdType);

                const tdAmount = document.createElement('td');
                const isPositive = tInfo.sign === '+';
                tdAmount.className = `fw-bold ${isPositive ? 'text-success' : 'text-danger'}`;
                tdAmount.textContent = `${tInfo.sign} ${formatCurrency(Math.abs(Number(tx.amount) || 0))}`;
                tr.appendChild(tdAmount);

                const tdBal = document.createElement('td');
                tdBal.textContent = formatCurrency(tx.newBalance ?? tx.balanceAfter ?? 0);
                tr.appendChild(tdBal);

                const tdDesc = document.createElement('td');
                tdDesc.textContent = tx.reason || tx.description || tx.notes || tx.note || '-';
                tr.appendChild(tdDesc);

                const tdDate = document.createElement('td');
                tdDate.textContent = formatDate(tx.createdOn || tx.createdDate || tx.createdAt);
                tr.appendChild(tdDate);

                tbody.appendChild(tr);
            });

            table.appendChild(tbody);
            tableWrap.appendChild(table);
            txBody.appendChild(tableWrap);

            const calcPages = Math.ceil(totalCount / state.pageSize) || totalPages || 1;
            if (calcPages > 1) {
                const pag = createPaginationControls(state.pageNumber, calcPages, (p) => {
                    state.pageNumber = p;
                    loadTransactions();
                });
                txBody.appendChild(pag);
            }
        } catch (err) {
            console.error('Error loading wallet transactions:', err);
            txBody.replaceChildren();
            const errEl = document.createElement('div');
            errEl.className = 'error-state p-4 text-center';
            errEl.textContent = t('network_error');
            txBody.appendChild(errEl);
        }
    }

    await Promise.all([loadWalletBalance(), loadTransactions()]);
}

/**
 * Reusable Pagination Controls
 */
function createPaginationControls(currentPage, totalPages, onPageChange) {
    const nav = document.createElement('div');
    nav.className = 'pagination-controls d-flex justify-center align-center gap-2 mt-3';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'btn btn-outline btn-sm';
    prevBtn.disabled = currentPage <= 1;
    prevBtn.textContent = t('btn_prev');
    prevBtn.addEventListener('click', () => {
        if (currentPage > 1) onPageChange(currentPage - 1);
    });

    const pageInfo = document.createElement('span');
    pageInfo.className = 'pagination-info mx-2';
    pageInfo.textContent = `${t('page')} ${currentPage} / ${totalPages}`;

    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-outline btn-sm';
    nextBtn.disabled = currentPage >= totalPages;
    nextBtn.textContent = t('btn_next');
    nextBtn.addEventListener('click', () => {
        if (currentPage < totalPages) onPageChange(currentPage + 1);
    });

    nav.appendChild(prevBtn);
    nav.appendChild(pageInfo);
    nav.appendChild(nextBtn);

    return nav;
}
