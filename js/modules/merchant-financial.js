/**
 * Merchant Financial & Wallet Module
 * Used by Restaurant, Supermarket, and Admin Dashboards
 * Strictly follows Quick-Service Frontend Guidelines:
 * - Zero innerHTML for dynamic data (XSS prevention)
 * - Full i18n support via t()
 * - Responsive tables & cards
 * - Modern Fintech UI with clean Cairo typography
 */

import * as ui from '../ui-utils.js?v=48.0';
import { t, getLanguage } from '../translations.js?v=46.0';

/**
 * Formats a number as currency (EGP / ج.م)
 */
function formatCurrency(val) {
    const num = Number(val) || 0;
    const isAr = getLanguage() === 'ar';
    const formatted = num.toLocaleString(isAr ? 'ar-EG' : 'en-US', {
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
// 1. MERCHANT FINANCIAL OVERVIEW TAB (📊 التقارير المالية والإحصائيات)
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
    filterLabel.innerHTML = `<span>📅</span> <span>${t('financial_filter_label')}</span>`;
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
    fromInput.className = 'date-input';

    const toInput = document.createElement('input');
    toInput.type = 'date';
    toInput.className = 'date-input';

    const applyCustomBtn = document.createElement('button');
    applyCustomBtn.className = 'btn btn-primary btn-sm';
    applyCustomBtn.textContent = t('btn_apply');
    applyCustomBtn.addEventListener('click', () => {
        if (!fromInput.value || !toInput.value) {
            ui.showToast(t('settlement_Toast_invalid_dates') || 'يرجى تحديد تاريخ البداية والنهاية', 'warning');
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
        btn.className = `btn-filter ${state.filterType === fb.type ? 'active' : ''}`;
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
    refreshBtn.className = 'btn btn-outline btn-sm refresh-btn';
    refreshBtn.innerHTML = `<span>🔄</span> <span>${t('btn_refresh')}</span>`;
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
    kpiGrid.className = 'financial-kpi-grid';
    wrapper.appendChild(kpiGrid);

    // --- Delivered Orders Section ---
    const ordersCard = document.createElement('div');
    ordersCard.className = 'card financial-table-card mt-4';

    const ordersHeader = document.createElement('div');
    ordersHeader.className = 'card-header d-flex justify-between align-center flex-wrap gap-2';

    const ordersTitle = document.createElement('h3');
    ordersTitle.className = 'card-title';
    ordersTitle.innerHTML = `<span>📦</span> <span>${t('recent_orders_title')} (${t('order_status_delivered')})</span>`;
    ordersHeader.appendChild(ordersTitle);

    const ordersCountBadge = document.createElement('span');
    ordersCountBadge.className = 'badge badge-info';
    ordersCountBadge.id = 'delivered-orders-count-badge';
    ordersCountBadge.textContent = '...';
    ordersHeader.appendChild(ordersCountBadge);

    ordersCard.appendChild(ordersHeader);

    const ordersBody = document.createElement('div');
    ordersBody.className = 'card-body p-0';
    ordersCard.appendChild(ordersBody);

    wrapper.appendChild(ordersCard);
    container.appendChild(wrapper);

    // --- Loaders ---
    async function loadDashboardSummary() {
        kpiGrid.replaceChildren();
        for (let i = 0; i < 6; i++) {
            const skel = document.createElement('div');
            skel.className = 'stat-card financial-kpi-card skeleton-box';
            skel.style.minHeight = '130px';
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

            // Net Merchant Earnings
            const grossSales = Number(d.totalRevenue ?? d.totalSalesAmount ?? 0);
            const appFee = Number(d.quickCommission ?? 0);
            const netEarnings = Math.max(0, grossSales - appFee);
            kpiGrid.appendChild(createKpiCard({
                icon: '💎',
                label: getLanguage() === 'ar' ? 'صافي أرباح المتجر' : 'Net Store Earnings',
                value: formatCurrency(netEarnings),
                subtext: getLanguage() === 'ar' ? 'الأرباح بعد خصم عمولة المنصة' : 'Earnings after platform fees',
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
                icon: '👛',
                label: t('merchant_kpi_wallet'),
                value: formatCurrency(d.currentWalletBalance ?? 0),
                subtext: t('stat_balance_desc'),
                accentClass: 'accent-primary'
            }));
        } catch (err) {
            console.error('Error loading merchant dashboard summary:', err);
            kpiGrid.replaceChildren();
            const errEl = document.createElement('div');
            errEl.className = 'error-state p-4 text-center';
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

            const badgeEl = document.getElementById('delivered-orders-count-badge');
            if (badgeEl) badgeEl.textContent = `${totalCount} ${getLanguage() === 'ar' ? 'طلب' : 'orders'}`;

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

                // Order ID with Chip
                const tdId = document.createElement('td');
                const chip = document.createElement('span');
                chip.className = 'order-chip';
                chip.textContent = `#${order.id}`;
                tdId.appendChild(chip);
                tr.appendChild(tdId);

                const totalPriceVal = Number(order.totalPrice || 0);
                const deliveryFeeVal = Number(order.deliveryFee || 0);
                const orderFeeVal = Number(order.orderFee || 0);
                const itemsSubtotal = Math.max(0, totalPriceVal - deliveryFeeVal - orderFeeVal);
                const commissionVal = Number(order.commission ?? order.quickCommission ?? 0);
                const netEarningsVal = Number(order.netEarnings ?? (itemsSubtotal - commissionVal));

                // Items Total
                const tdTotal = document.createElement('td');
                tdTotal.className = 'fw-bold';
                tdTotal.textContent = formatCurrency(itemsSubtotal || totalPriceVal);
                tr.appendChild(tdTotal);

                // Commission
                const tdComm = document.createElement('td');
                tdComm.className = 'text-danger fw-bold';
                tdComm.textContent = `- ${formatCurrency(commissionVal)}`;
                tr.appendChild(tdComm);

                // Net Earnings
                const tdNet = document.createElement('td');
                tdNet.className = 'text-success fw-bold';
                tdNet.textContent = `+ ${formatCurrency(netEarningsVal)}`;
                tr.appendChild(tdNet);

                // Status Badge
                const tdStatus = document.createElement('td');
                const badge = document.createElement('span');
                badge.className = 'status-badge status-completed';
                badge.innerHTML = `<span>✓</span> <span>${t('order_status_delivered')}</span>`;
                tdStatus.appendChild(badge);
                tr.appendChild(tdStatus);

                // Date
                const tdDate = document.createElement('td');
                tdDate.className = 'text-muted small';
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
// 2. MERCHANT SETTLEMENTS HISTORY TAB (💰 سجل التسويات والمستحقات)
// ============================================================================

export async function renderMerchantSettlements(container, apiClient) {
    if (!container) return;
    container.replaceChildren();

    const state = {
        pageNumber: 1,
        pageSize: 15,
        statusFilter: ''
    };

    const wrapper = document.createElement('div');
    wrapper.id = 'section-settlements';
    wrapper.className = 'settlements-section-wrapper';

    // --- Info Hint Banner ---
    const isAr = getLanguage() === 'ar';
    const hintBanner = document.createElement('div');
    hintBanner.className = 'settlement-info-banner';
    hintBanner.innerHTML = `
        <div class="banner-icon">ℹ️</div>
        <div class="banner-text">
            <strong>${isAr ? 'سياسة تسوية المستحقات المالية:' : 'Financial Settlement Policy:'}</strong>
            <span>${isAr ? 'يتم تحويل المستحقات المعتمدة دورياً لحسابك البنكي أو محفظتك الإلكترونية المسجلة، بعد تدقيق وتأكيد تسليم الطلبات.' : 'Approved payouts are transferred periodically to your registered bank account or e-wallet after orders are delivered and verified.'}</span>
        </div>
    `;
    wrapper.appendChild(hintBanner);

    // --- Settlements Summary KPI Cards ---
    const summaryGrid = document.createElement('div');
    summaryGrid.className = 'financial-kpi-grid mb-4';

    const cardSettled = createKpiCard({
        icon: '✅',
        label: isAr ? 'إجمالي المبالغ المصروفة' : 'Total Paid Out',
        value: '...',
        subtext: isAr ? 'تسويات مكتملة ومحولة بنجاح' : 'Completed and transferred settlements',
        accentClass: 'accent-green'
    });
    const cardPending = createKpiCard({
        icon: '⏳',
        label: isAr ? 'تسويات قيد المراجعة' : 'Pending Settlements',
        value: '...',
        subtext: isAr ? 'مستحقات قيد المعالجة الإدارية' : 'Under admin review and processing',
        accentClass: 'accent-orange'
    });
    const cardCycle = createKpiCard({
        icon: '🏦',
        label: isAr ? 'دورية الصرف والتسوية' : 'Payout Schedule',
        value: isAr ? 'أسبوعي / شهري' : 'Weekly / Monthly',
        subtext: isAr ? 'تلقائي وفقاً لاتفاقية المتجر' : 'Automatic via store agreement',
        accentClass: 'accent-teal'
    });

    summaryGrid.appendChild(cardSettled);
    summaryGrid.appendChild(cardPending);
    summaryGrid.appendChild(cardCycle);
    wrapper.appendChild(summaryGrid);

    // --- Settlements Card Table ---
    const card = document.createElement('div');
    card.className = 'card financial-table-card';

    const header = document.createElement('div');
    header.className = 'card-header d-flex justify-between align-center flex-wrap gap-2';

    const title = document.createElement('h3');
    title.className = 'card-title';
    title.innerHTML = `<span>📑</span> <span>${t('merchant_section_settlements_title')}</span>`;

    const controls = document.createElement('div');
    controls.className = 'd-flex align-center gap-2 flex-wrap';

    const statusSelect = document.createElement('select');
    statusSelect.className = 'form-control form-select-sm';

    const statusOptions = [
        { val: '', label: t('filter_all_status') || 'جميع الحالات' },
        { val: '0', label: `⏳ ${t('settlement_status_pending') || 'قيد الانتظار'}` },
        { val: '1', label: `✅ ${t('settlement_status_completed') || 'مكتملة ومحولة'}` },
        { val: '2', label: `❌ ${t('settlement_status_rejected') || 'مرفوضة'}` }
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
    refreshBtn.innerHTML = `<span>🔄</span> <span>${t('btn_refresh')}</span>`;
    refreshBtn.addEventListener('click', () => loadSettlements());

    controls.appendChild(statusSelect);
    controls.appendChild(refreshBtn);

    header.appendChild(title);
    header.appendChild(controls);
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'card-body p-0';
    card.appendChild(body);
    wrapper.appendChild(card);
    container.appendChild(wrapper);

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

            // Update KPI summary numbers
            let completedSum = 0;
            let pendingCount = 0;
            items.forEach(it => {
                const st = Number(it.status);
                const amt = Number(it.amount || 0);
                if (st === 1) completedSum += amt;
                if (st === 0) pendingCount++;
            });
            const settledValEl = cardSettled.querySelector('.stat-value');
            if (settledValEl) settledValEl.textContent = formatCurrency(completedSum);
            const pendingValEl = cardPending.querySelector('.stat-value');
            if (pendingValEl) pendingValEl.textContent = `${pendingCount} ${isAr ? 'حوالة' : 'payouts'}`;

            if (!items.length) {
                const empty = ui.createEmptyState(t('empty_state_settlements') || 'لا توجد سجلات تسويات حالياً', '💰');
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

                // Settlement ID
                const tdId = document.createElement('td');
                const chip = document.createElement('span');
                chip.className = 'order-chip';
                chip.textContent = `#${item.id}`;
                tdId.appendChild(chip);
                tr.appendChild(tdId);

                // Amount
                const tdAmount = document.createElement('td');
                tdAmount.className = 'fw-bold text-success';
                tdAmount.textContent = formatCurrency(item.amount);
                tr.appendChild(tdAmount);

                // Status Badge
                const tdStatus = document.createElement('td');
                const badge = document.createElement('span');
                const st = Number(item.status);
                if (st === 1) {
                    badge.className = 'status-badge status-completed';
                    badge.innerHTML = `<span>✓</span> <span>${t('settlement_status_completed')}</span>`;
                } else if (st === 2) {
                    badge.className = 'status-badge status-rejected';
                    badge.innerHTML = `<span>✕</span> <span>${t('settlement_status_rejected')}</span>`;
                } else {
                    badge.className = 'status-badge status-pending';
                    badge.innerHTML = `<span>⏳</span> <span>${t('settlement_status_pending')}</span>`;
                }
                tdStatus.appendChild(badge);
                tr.appendChild(tdStatus);

                // Notes
                const tdNotes = document.createElement('td');
                tdNotes.className = 'text-muted';
                tdNotes.textContent = item.notes || item.note || '-';
                tr.appendChild(tdNotes);

                // Dates
                const tdCreated = document.createElement('td');
                tdCreated.className = 'small text-muted';
                tdCreated.textContent = formatDate(item.createdOn || item.createdDate || item.createdAt);
                tr.appendChild(tdCreated);

                const tdProcessed = document.createElement('td');
                tdProcessed.className = 'small text-muted';
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
// 3. MERCHANT WALLET & TRANSACTIONS TAB (👛 المحفظة الرقمية)
// ============================================================================

export async function renderMerchantWallet(container, apiClient) {
    if (!container) return;
    container.replaceChildren();

    const state = {
        pageNumber: 1,
        pageSize: 15,
        txTypeFilter: ''
    };

    const isAr = getLanguage() === 'ar';
    const wrapper = document.createElement('div');
    wrapper.id = 'section-wallet';
    wrapper.className = 'wallet-section-wrapper';

    // --- Premium Fintech Hero Banner ---
    const banner = document.createElement('div');
    banner.className = 'card wallet-balance-banner';

    const bannerContent = document.createElement('div');
    bannerContent.className = 'wallet-hero-content';

    const leftCol = document.createElement('div');
    leftCol.className = 'wallet-hero-left';

    const titleRow = document.createElement('div');
    titleRow.className = 'wallet-hero-title-row';

    const chipIcon = document.createElement('span');
    chipIcon.className = 'wallet-chip-icon';
    chipIcon.textContent = '💳';

    const walletLabel = document.createElement('span');
    walletLabel.className = 'wallet-hero-label';
    walletLabel.textContent = isAr ? 'المحفظة الرقمية الذكية' : 'Digital Smart Wallet';

    const activeBadge = document.createElement('span');
    activeBadge.className = 'wallet-badge-active';
    activeBadge.textContent = isAr ? '🟢 المحفظة نشطة' : '🟢 Active';

    titleRow.appendChild(chipIcon);
    titleRow.appendChild(walletLabel);
    titleRow.appendChild(activeBadge);

    const subLabel = document.createElement('div');
    subLabel.className = 'wallet-sub-label';
    subLabel.textContent = isAr ? 'الرصيد المتاح للسحب حالياً:' : 'Current Available Balance:';

    const walletValue = document.createElement('div');
    walletValue.className = 'wallet-hero-amount';
    walletValue.textContent = '...';

    const walletUpdated = document.createElement('div');
    walletUpdated.className = 'wallet-hero-timestamp';

    leftCol.appendChild(titleRow);
    leftCol.appendChild(subLabel);
    leftCol.appendChild(walletValue);
    leftCol.appendChild(walletUpdated);

    const actionsCol = document.createElement('div');
    actionsCol.className = 'wallet-hero-actions';

    const refreshAllBtn = document.createElement('button');
    refreshAllBtn.className = 'btn btn-primary';
    refreshAllBtn.innerHTML = `<span>🔄</span> <span>${t('btn_refresh')}</span>`;
    refreshAllBtn.addEventListener('click', () => {
        loadWalletBalance();
        loadTransactions();
    });

    actionsCol.appendChild(refreshAllBtn);
    bannerContent.appendChild(leftCol);
    bannerContent.appendChild(actionsCol);
    banner.appendChild(bannerContent);
    wrapper.appendChild(banner);

    // --- Transactions Statement Card ---
    const txCard = document.createElement('div');
    txCard.className = 'card financial-table-card mt-4';

    const txHeader = document.createElement('div');
    txHeader.className = 'card-header d-flex justify-between align-center flex-wrap gap-2';

    const txTitle = document.createElement('h3');
    txTitle.className = 'card-title';
    txTitle.innerHTML = `<span>📑</span> <span>${t('wallet_tx_history_title')}</span>`;

    const typeSelect = document.createElement('select');
    typeSelect.className = 'form-control form-select-sm';
    [
        { val: '', label: t('filter_all_types') || 'جميع الحركات' },
        { val: '0', label: `🟢 ${t('wallet_tx_deposit') || 'إيداع'}` },
        { val: '1', label: `🔴 ${t('wallet_tx_withdrawal') || 'سحب'}` },
        { val: '2', label: `🔄 ${t('wallet_tx_transfer') || 'تحويل'}` },
        { val: '3', label: `💰 ${t('wallet_tx_settlement') || 'تسوية'}` }
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
    txBody.className = 'card-body p-0';
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
                walletUpdated.textContent = `${t('th_last_updated') || 'آخر تحديث'}: ${formatDate(upd)}`;
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
                const empty = ui.createEmptyState(t('empty_state_transactions') || 'لا توجد حركات مالية مسجلة في المحفظة', '💳');
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

                // Transaction ID
                const tdId = document.createElement('td');
                const chip = document.createElement('span');
                chip.className = 'order-chip';
                chip.textContent = `#${tx.id}`;
                tdId.appendChild(chip);
                tr.appendChild(tdId);

                const tInfo = typeMap[Number(tx.type)] || { key: 'wallet_tx_transfer', cls: 'status-pending', sign: '' };

                // Type Badge
                const tdType = document.createElement('td');
                const badge = document.createElement('span');
                badge.className = `status-badge ${tInfo.cls}`;
                badge.textContent = t(tInfo.key) || 'حركة مالية';
                tdType.appendChild(badge);
                tr.appendChild(tdType);

                // Amount
                const tdAmount = document.createElement('td');
                const isPositive = tInfo.sign === '+';
                tdAmount.className = `fw-bold ${isPositive ? 'text-success' : 'text-danger'}`;
                tdAmount.textContent = `${tInfo.sign} ${formatCurrency(Math.abs(Number(tx.amount) || 0))}`;
                tr.appendChild(tdAmount);

                // Balance after
                const tdBal = document.createElement('td');
                tdBal.className = 'fw-bold';
                tdBal.textContent = formatCurrency(tx.newBalance ?? tx.balanceAfter ?? 0);
                tr.appendChild(tdBal);

                // Description
                const tdDesc = document.createElement('td');
                tdDesc.className = 'text-muted';
                tdDesc.textContent = tx.reason || tx.description || tx.notes || tx.note || '-';
                tr.appendChild(tdDesc);

                // Date
                const tdDate = document.createElement('td');
                tdDate.className = 'small text-muted';
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
    nav.className = 'pagination-controls';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'btn btn-outline btn-sm';
    prevBtn.disabled = currentPage <= 1;
    prevBtn.innerHTML = `<span>◀</span> <span>${t('btn_prev')}</span>`;
    prevBtn.addEventListener('click', () => {
        if (currentPage > 1) onPageChange(currentPage - 1);
    });

    const pageInfo = document.createElement('span');
    pageInfo.className = 'pagination-info';
    pageInfo.textContent = `${t('page')} ${currentPage} / ${totalPages}`;

    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-outline btn-sm';
    nextBtn.disabled = currentPage >= totalPages;
    nextBtn.innerHTML = `<span>${t('btn_next')}</span> <span>▶</span>`;
    nextBtn.addEventListener('click', () => {
        if (currentPage < totalPages) onPageChange(currentPage + 1);
    });

    nav.appendChild(prevBtn);
    nav.appendChild(pageInfo);
    nav.appendChild(nextBtn);

    return nav;
}
