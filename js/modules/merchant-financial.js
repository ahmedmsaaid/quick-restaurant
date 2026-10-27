/**
 * Quick Service Merchant - Financial, Settlements, and Wallet Module
 * Strictly adheres to DASHBOARD_GUIDELINES.md:
 * - Uses apiClient.fetch()
 * - Safe DOM creation (no raw innerHTML for API values)
 * - Translations via t()
 * - CSS Variables only
 * - Proper error, loading, and empty states
 */

import * as ui from '../ui-utils.js?v=27';
import { t, getLanguage } from '../translations.js?v=27';

let currentFilterType = 2; // Default: ThisMonth (2)
let currentCustomFrom = '';
let currentCustomTo = '';
let currentSettlementStatus = '';
let currentWalletType = '';

function formatCurrency(val) {
    const num = Number(val) || 0;
    const curr = getLanguage() === 'ar' ? 'ج.م' : 'EGP';
    return `${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${curr}`;
}

function formatDate(isoStr) {
    if (!isoStr) return '-';
    try {
        const d = new Date(isoStr);
        return d.toLocaleDateString(getLanguage() === 'ar' ? 'ar-EG' : 'en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (_) {
        return isoStr;
    }
}

function getSettlementStatusBadge(status) {
    const badge = ui.createElement('span', ['badge']);
    switch (Number(status)) {
        case 0:
            badge.classList.add('badge-warning');
            badge.textContent = t('settlement_status_pending');
            break;
        case 1:
            badge.classList.add('badge-success');
            badge.textContent = t('settlement_status_completed');
            break;
        case 2:
            badge.classList.add('badge-danger');
            badge.textContent = t('settlement_status_rejected');
            break;
        case 3:
            badge.classList.add('badge-info');
            badge.textContent = t('settlement_status_completed');
            break;
        default:
            badge.classList.add('badge-secondary');
            badge.textContent = '-';
    }
    return badge;
}

function getTxTypeBadge(type) {
    const badge = ui.createElement('span', ['badge']);
    switch (Number(type)) {
        case 0:
            badge.classList.add('badge-info');
            badge.textContent = t('wallet_tx_deposit');
            break;
        case 1:
            badge.classList.add('badge-warning');
            badge.textContent = t('wallet_tx_withdrawal');
            break;
        case 2:
            badge.classList.add('badge-secondary');
            badge.textContent = t('wallet_tx_transfer');
            break;
        case 3:
            badge.classList.add('badge-danger');
            badge.textContent = t('wallet_tx_commission');
            break;
        case 4:
            badge.classList.add('badge-success');
            badge.textContent = t('wallet_tx_order_payment');
            break;
        case 5:
            badge.classList.add('badge-info');
            badge.textContent = t('wallet_tx_settlement');
            break;
        case 6:
            badge.classList.add('badge-warning');
            badge.textContent = t('wallet_tx_refund');
            break;
        default:
            badge.classList.add('badge-secondary');
            badge.textContent = '-';
    }
    return badge;
}

/* ==========================================================================
   Tab: Financial & Store Performance Overview (GET /api/v1/dashboard/merchant)
   ========================================================================== */
export async function renderMerchantOverview(container, apiClient) {
    container.replaceChildren();

    const rootWrapper = ui.createElement('div', ['merchant-financial-view']);

    // Filter Bar
    const filterCard = ui.createElement('div', ['card', 'mb-4']);
    filterCard.style.padding = '16px';
    filterCard.style.display = 'flex';
    filterCard.style.flexWrap = 'wrap';
    filterCard.style.gap = '12px';
    filterCard.style.alignItems = 'center';
    filterCard.style.justifyContent = 'space-between';

    const filterLeft = ui.createElement('div', ['filter-group']);
    filterLeft.style.display = 'flex';
    filterLeft.style.gap = '8px';
    filterLeft.style.alignItems = 'center';
    filterLeft.style.flexWrap = 'wrap';

    const filterLabel = ui.createElementWithText('span', t('financial_filter_label') + ':', ['fw-bold']);
    filterLeft.appendChild(filterLabel);

    const filterSelect = ui.createElement('select', ['form-control']);
    filterSelect.style.width = 'auto';

    const options = [
        { val: 0, text: t('filter_today') },
        { val: 1, text: t('filter_this_week') },
        { val: 2, text: t('filter_this_month') },
        { val: 3, text: t('filter_custom') }
    ];

    options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.val;
        o.textContent = opt.text;
        if (opt.val === currentFilterType) o.selected = true;
        filterSelect.appendChild(o);
    });

    filterLeft.appendChild(filterSelect);

    // Custom Date Range Container
    const customDateBox = ui.createElement('div', ['custom-date-box']);
    customDateBox.style.display = currentFilterType === 3 ? 'flex' : 'none';
    customDateBox.style.gap = '8px';
    customDateBox.style.alignItems = 'center';

    const fromInput = ui.createElement('input', ['form-control']);
    fromInput.type = 'date';
    fromInput.value = currentCustomFrom;

    const toInput = ui.createElement('input', ['form-control']);
    toInput.type = 'date';
    toInput.value = currentCustomTo;

    const btnApplyDates = ui.createElementWithText('button', t('btn_apply'), ['btn', 'btn-primary', 'btn-sm']);
    btnApplyDates.addEventListener('click', () => {
        currentCustomFrom = fromInput.value;
        currentCustomTo = toInput.value;
        renderMerchantOverview(container, apiClient);
    });

    customDateBox.appendChild(fromInput);
    customDateBox.appendChild(document.createTextNode(' - '));
    customDateBox.appendChild(toInput);
    customDateBox.appendChild(btnApplyDates);

    filterLeft.appendChild(customDateBox);
    filterCard.appendChild(filterLeft);

    filterSelect.addEventListener('change', (e) => {
        currentFilterType = Number(e.target.value);
        if (currentFilterType === 3) {
            customDateBox.style.display = 'flex';
        } else {
            customDateBox.style.display = 'none';
            renderMerchantOverview(container, apiClient);
        }
    });

    rootWrapper.appendChild(filterCard);

    // Content container for stats & orders
    const dataContainer = ui.createElement('div', ['data-container']);
    rootWrapper.appendChild(dataContainer);
    container.appendChild(rootWrapper);

    ui.renderShimmerGrid(dataContainer);

    try {
        let endpoint = `/api/v1/dashboard/merchant?filterType=${currentFilterType}`;
        if (currentFilterType === 3 && currentCustomFrom && currentCustomTo) {
            endpoint += `&fromDate=${encodeURIComponent(currentCustomFrom)}&toDate=${encodeURIComponent(currentCustomTo)}`;
        }

        const res = await apiClient.fetch(endpoint);
        dataContainer.replaceChildren();

        if (!res || !res.success || !res.result) {
            const emptyCard = ui.createEmptyState(t('empty_state_orders'));
            dataContainer.appendChild(emptyCard);
            return;
        }

        const data = res.result;

        // Metric Cards Grid
        const statsGrid = ui.createElement('div', ['analytics-grid', 'mb-4']);
        statsGrid.style.display = 'grid';
        statsGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(220px, 1fr))';
        statsGrid.style.gap = '16px';

        const createStatCard = (title, value, subtext, icon, highlightColor) => {
            const card = ui.createElement('div', ['summary-card']);
            card.style.background = 'var(--color-card-bg, #ffffff)';
            card.style.border = '1px solid var(--color-border, #e5e7eb)';
            card.style.borderRadius = '12px';
            card.style.padding = '20px';
            card.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)';
            card.style.position = 'relative';
            card.style.overflow = 'hidden';

            if (highlightColor) {
                const borderAccent = ui.createElement('div', ['card-accent']);
                borderAccent.style.position = 'absolute';
                borderAccent.style.top = '0';
                borderAccent.style.left = '0';
                borderAccent.style.right = '0';
                borderAccent.style.height = '4px';
                borderAccent.style.background = highlightColor;
                card.appendChild(borderAccent);
            }

            const headerRow = ui.createElement('div', ['card-header-row']);
            headerRow.style.display = 'flex';
            headerRow.style.justifyContent = 'space-between';
            headerRow.style.alignItems = 'center';
            headerRow.style.marginBottom = '12px';

            const titleEl = ui.createElementWithText('span', title, ['card-title']);
            titleEl.style.fontSize = '0.9rem';
            titleEl.style.color = 'var(--color-text-muted, #6b7280)';
            titleEl.style.fontWeight = '600';
            headerRow.appendChild(titleEl);

            if (icon) {
                const iconEl = ui.createElementWithText('span', icon, ['card-icon']);
                iconEl.style.fontSize = '1.3rem';
                headerRow.appendChild(iconEl);
            }
            card.appendChild(headerRow);

            const valEl = ui.createElementWithText('div', value, ['card-value']);
            valEl.style.fontSize = '1.6rem';
            valEl.style.fontWeight = '700';
            valEl.style.color = highlightColor || 'var(--color-text-main, #111827)';
            valEl.style.marginBottom = '6px';
            card.appendChild(valEl);

            if (subtext) {
                const subEl = ui.createElementWithText('div', subtext, ['card-subtext']);
                subEl.style.fontSize = '0.8rem';
                subEl.style.color = 'var(--color-text-muted, #9ca3af)';
                card.appendChild(subEl);
            }

            return card;
        };

        // 1. Delivered Orders
        statsGrid.appendChild(createStatCard(
            t('merchant_stat_orders'),
            String(data.deliveredOrdersCount ?? 0),
            t('stat_orders_desc'),
            '📦',
            'var(--color-primary, #00796B)'
        ));

        // 2. Total Sales
        statsGrid.appendChild(createStatCard(
            t('merchant_stat_earnings'),
            formatCurrency(data.totalEarnings ?? 0),
            t('stat_gmv_desc'),
            '💵',
            'var(--color-success, #10B981)'
        ));

        // 3. Platform Commission
        statsGrid.appendChild(createStatCard(
            t('merchant_stat_commission'),
            formatCurrency(data.quickCommission ?? 0),
            t('stat_commission_desc'),
            '📊',
            'var(--color-warning, #F59E0B)'
        ));

        // 4. Settled Amount
        statsGrid.appendChild(createStatCard(
            t('merchant_stat_settled'),
            formatCurrency(data.settledAmount ?? 0),
            t('stat_settled_desc'),
            '🏦',
            '#6366F1'
        ));

        // 5. Due Payout (Highlighted)
        statsGrid.appendChild(createStatCard(
            t('merchant_stat_due'),
            formatCurrency(data.duePayout ?? 0),
            t('stat_due_desc'),
            '⏳',
            'var(--color-danger, #EF4444)'
        ));

        // 6. Current Wallet Balance
        statsGrid.appendChild(createStatCard(
            t('merchant_stat_balance'),
            formatCurrency(data.currentWalletBalance ?? 0),
            t('stat_balance_desc'),
            '👛',
            '#06B6D4'
        ));

        dataContainer.appendChild(statsGrid);

        // Orders Breakdown Section
        const ordersCard = ui.createElement('div', ['card']);
        ordersCard.style.padding = '20px';
        ordersCard.style.borderRadius = '12px';
        ordersCard.style.background = 'var(--color-card-bg, #ffffff)';
        ordersCard.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)';

        const ordersHeader = ui.createElement('div', ['card-header', 'mb-3']);
        ordersHeader.style.display = 'flex';
        ordersHeader.style.justifyContent = 'space-between';
        ordersHeader.style.alignItems = 'center';

        const ordersTitle = ui.createElementWithText('h3', t('recent_orders_title'), ['h5', 'm-0']);
        ordersHeader.appendChild(ordersTitle);
        ordersCard.appendChild(ordersHeader);

        const ordersList = Array.isArray(data.orders) ? data.orders : [];

        if (ordersList.length === 0) {
            const emptyOrders = ui.createEmptyState(t('empty_state_orders'));
            ordersCard.appendChild(emptyOrders);
        } else {
            const tableWrap = ui.createElement('div', ['table-responsive']);
            const table = ui.createElement('table', ['table', 'table-hover', 'align-middle']);

            const thead = document.createElement('thead');
            const trHead = document.createElement('tr');
            [
                '#',
                t('th_order_id'),
                t('th_total_price'),
                t('th_commission'),
                t('th_net_earnings'),
                t('th_status'),
                t('th_date')
            ].forEach(hText => {
                const th = document.createElement('th');
                th.textContent = hText;
                trHead.appendChild(th);
            });
            thead.appendChild(trHead);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            ordersList.forEach((ord, idx) => {
                const tr = document.createElement('tr');

                const tdIndex = document.createElement('td');
                tdIndex.textContent = String(idx + 1);
                tr.appendChild(tdIndex);

                const tdId = document.createElement('td');
                tdId.appendChild(ui.createElementWithText('strong', `#${ord.orderId || ord.id || '-'}`));
                tr.appendChild(tdId);

                const tdTotal = document.createElement('td');
                tdTotal.textContent = formatCurrency(ord.totalPrice ?? 0);
                tr.appendChild(tdTotal);

                const tdComm = document.createElement('td');
                tdComm.style.color = 'var(--color-danger, #EF4444)';
                tdComm.textContent = `-${formatCurrency(ord.commission ?? 0)}`;
                tr.appendChild(tdComm);

                const tdNet = document.createElement('td');
                tdNet.style.color = 'var(--color-success, #10B981)';
                tdNet.style.fontWeight = 'bold';
                tdNet.textContent = formatCurrency(ord.netEarnings ?? (ord.totalPrice - ord.commission) ?? 0);
                tr.appendChild(tdNet);

                const tdStatus = document.createElement('td');
                const badge = ui.createElement('span', ['badge', 'badge-success']);
                badge.textContent = t('order_status_delivered');
                tdStatus.appendChild(badge);
                tr.appendChild(tdStatus);

                const tdDate = document.createElement('td');
                tdDate.textContent = formatDate(ord.createdAt || ord.createdDate);
                tr.appendChild(tdDate);

                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            tableWrap.appendChild(table);
            ordersCard.appendChild(tableWrap);
        }

        dataContainer.appendChild(ordersCard);

    } catch (err) {
        dataContainer.replaceChildren();
        const errCard = ui.createErrorState(err.message || t('network_error'), () => {
            renderMerchantOverview(container, apiClient);
        });
        dataContainer.appendChild(errCard);
    }
}

/* ==========================================================================
   Tab: Merchant Settlements & Payouts (GET /api/v1/settlements/my-settlements)
   ========================================================================== */
export async function renderMerchantSettlements(container, apiClient, pageNumber = 1) {
    container.replaceChildren();

    const rootWrapper = ui.createElement('div', ['merchant-settlements-view']);

    // Filter Bar
    const filterCard = ui.createElement('div', ['card', 'mb-4']);
    filterCard.style.padding = '16px';
    filterCard.style.display = 'flex';
    filterCard.style.flexWrap = 'wrap';
    filterCard.style.gap = '12px';
    filterCard.style.alignItems = 'center';
    filterCard.style.justifyContent = 'space-between';

    const filterLeft = ui.createElement('div', ['filter-group']);
    filterLeft.style.display = 'flex';
    filterLeft.style.gap = '8px';
    filterLeft.style.alignItems = 'center';
    filterLeft.style.flexWrap = 'wrap';

    const statusSelect = ui.createElement('select', ['form-control']);
    statusSelect.style.width = 'auto';

    const statusOpts = [
        { val: '', text: t('filter_all_status') },
        { val: '0', text: t('settlement_status_pending') },
        { val: '1', text: t('settlement_status_completed') },
        { val: '2', text: t('settlement_status_rejected') }
    ];

    statusOpts.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.val;
        o.textContent = opt.text;
        if (opt.val === currentSettlementStatus) o.selected = true;
        statusSelect.appendChild(o);
    });

    statusSelect.addEventListener('change', (e) => {
        currentSettlementStatus = e.target.value;
        renderMerchantSettlements(container, apiClient, 1);
    });

    filterLeft.appendChild(statusSelect);

    const btnRefresh = ui.createElementWithText('button', '🔄 ' + t('btn_refresh'), ['btn', 'btn-outline-secondary', 'btn-sm']);
    btnRefresh.addEventListener('click', () => {
        renderMerchantSettlements(container, apiClient, pageNumber);
    });
    filterLeft.appendChild(btnRefresh);

    filterCard.appendChild(filterLeft);
    rootWrapper.appendChild(filterCard);

    // Data Container
    const dataContainer = ui.createElement('div', ['data-container']);
    rootWrapper.appendChild(dataContainer);
    container.appendChild(rootWrapper);

    ui.renderShimmerList(dataContainer);

    try {
        let endpoint = `/api/v1/settlements/my-settlements?pageNumber=${pageNumber}&pageSize=15`;
        if (currentSettlementStatus !== '') {
            endpoint += `&status=${currentSettlementStatus}`;
        }

        const res = await apiClient.fetch(endpoint);
        dataContainer.replaceChildren();

        const items = res?.result?.items || [];
        const totalCount = res?.result?.totalCount || items.length;
        const totalPages = res?.result?.totalPages || 1;

        if (items.length === 0) {
            const empty = ui.createEmptyState(t('empty_state_settlements'));
            dataContainer.appendChild(empty);
            return;
        }

        const card = ui.createElement('div', ['card']);
        card.style.padding = '20px';
        card.style.borderRadius = '12px';
        card.style.background = 'var(--color-card-bg, #ffffff)';
        card.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)';

        const tableWrap = ui.createElement('div', ['table-responsive']);
        const table = ui.createElement('table', ['table', 'table-hover', 'align-middle']);

        const thead = document.createElement('thead');
        const trHead = document.createElement('tr');
        [
            '#',
            t('th_settlement_id'),
            t('th_amount'),
            t('th_status'),
            t('th_notes'),
            t('th_created_date'),
            t('th_processed_date')
        ].forEach(hText => {
            const th = document.createElement('th');
            th.textContent = hText;
            trHead.appendChild(th);
        });
        thead.appendChild(trHead);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        items.forEach((item, idx) => {
            const tr = document.createElement('tr');

            const tdIndex = document.createElement('td');
            tdIndex.textContent = String((pageNumber - 1) * 15 + idx + 1);
            tr.appendChild(tdIndex);

            const tdId = document.createElement('td');
            tdId.appendChild(ui.createElementWithText('strong', `#${item.id}`));
            tr.appendChild(tdId);

            const tdAmt = document.createElement('td');
            tdAmt.style.fontWeight = 'bold';
            tdAmt.style.color = 'var(--color-success, #10B981)';
            tdAmt.textContent = formatCurrency(item.amount);
            tr.appendChild(tdAmt);

            const tdStatus = document.createElement('td');
            tdStatus.appendChild(getSettlementStatusBadge(item.status));
            tr.appendChild(tdStatus);

            const tdNotes = document.createElement('td');
            tdNotes.textContent = item.notes || '-';
            tr.appendChild(tdNotes);

            const tdCreated = document.createElement('td');
            tdCreated.textContent = formatDate(item.createdDate);
            tr.appendChild(tdCreated);

            const tdProcessed = document.createElement('td');
            tdProcessed.textContent = formatDate(item.processedDate);
            tr.appendChild(tdProcessed);

            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        card.appendChild(tableWrap);

        // Pagination Bar
        if (totalPages > 1) {
            const paginationBar = ui.createElement('div', ['pagination-bar', 'mt-3']);
            paginationBar.style.display = 'flex';
            paginationBar.style.justifyContent = 'space-between';
            paginationBar.style.alignItems = 'center';

            const info = ui.createElementWithText('span', `${t('page')} ${pageNumber} / ${totalPages} (${totalCount} ${t('th_records')})`, ['text-muted', 'small']);
            paginationBar.appendChild(info);

            const btnGroup = ui.createElement('div', ['btn-group']);
            if (pageNumber > 1) {
                const btnPrev = ui.createElementWithText('button', t('btn_prev'), ['btn', 'btn-outline-primary', 'btn-sm']);
                btnPrev.addEventListener('click', () => renderMerchantSettlements(container, apiClient, pageNumber - 1));
                btnGroup.appendChild(btnPrev);
            }
            if (pageNumber < totalPages) {
                const btnNext = ui.createElementWithText('button', t('btn_next'), ['btn', 'btn-outline-primary', 'btn-sm']);
                btnNext.addEventListener('click', () => renderMerchantSettlements(container, apiClient, pageNumber + 1));
                btnGroup.appendChild(btnNext);
            }
            paginationBar.appendChild(btnGroup);
            card.appendChild(paginationBar);
        }

        dataContainer.appendChild(card);

    } catch (err) {
        dataContainer.replaceChildren();
        const errCard = ui.createErrorState(err.message || t('network_error'), () => {
            renderMerchantSettlements(container, apiClient, pageNumber);
        });
        dataContainer.appendChild(errCard);
    }
}

/* ==========================================================================
   Tab: Merchant Digital Wallet (GET /api/v1/wallets/user & transactions)
   ========================================================================== */
export async function renderMerchantWallet(container, apiClient, pageNumber = 1) {
    container.replaceChildren();

    const rootWrapper = ui.createElement('div', ['merchant-wallet-view']);

    // Wallet Balance Card
    const walletHeaderCard = ui.createElement('div', ['card', 'mb-4']);
    walletHeaderCard.style.padding = '24px';
    walletHeaderCard.style.borderRadius = '16px';
    walletHeaderCard.style.background = 'linear-gradient(135deg, var(--color-primary, #00796B) 0%, #004D40 100%)';
    walletHeaderCard.style.color = '#ffffff';
    walletHeaderCard.style.boxShadow = '0 4px 16px rgba(0, 77, 64, 0.2)';
    walletHeaderCard.style.display = 'flex';
    walletHeaderCard.style.justifyContent = 'space-between';
    walletHeaderCard.style.alignItems = 'center';
    walletHeaderCard.style.flexWrap = 'wrap';
    walletHeaderCard.style.gap = '16px';

    const balInfo = ui.createElement('div', ['bal-info']);
    const balTitle = ui.createElementWithText('div', t('merchant_menu_wallet'), ['text-uppercase']);
    balTitle.style.fontSize = '0.85rem';
    balTitle.style.opacity = '0.85';
    balTitle.style.letterSpacing = '1px';
    balTitle.style.marginBottom = '6px';
    balInfo.appendChild(balTitle);

    const balAmount = ui.createElementWithText('div', '...', ['balance-amount']);
    balAmount.style.fontSize = '2.2rem';
    balAmount.style.fontWeight = '800';
    balInfo.appendChild(balAmount);

    const balUpdated = ui.createElementWithText('div', '', ['balance-updated']);
    balUpdated.style.fontSize = '0.8rem';
    balUpdated.style.opacity = '0.7';
    balUpdated.style.marginTop = '4px';
    balInfo.appendChild(balUpdated);

    walletHeaderCard.appendChild(balInfo);

    const walletIcon = ui.createElementWithText('div', '👛', ['wallet-big-icon']);
    walletIcon.style.fontSize = '3.5rem';
    walletIcon.style.opacity = '0.4';
    walletHeaderCard.appendChild(walletIcon);

    rootWrapper.appendChild(walletHeaderCard);

    // Fetch user wallet balance
    apiClient.fetch('/api/v1/wallets/user').then(res => {
        if (res && res.success && res.result) {
            const w = res.result;
            balAmount.textContent = formatCurrency(w.balance);
            if (w.updatedAt) {
                balUpdated.textContent = `${t('th_last_updated')}: ${formatDate(w.updatedAt)}`;
            }
        } else {
            balAmount.textContent = formatCurrency(0);
        }
    }).catch(() => {
        balAmount.textContent = formatCurrency(0);
    });

    // Transactions Section
    const txCard = ui.createElement('div', ['card']);
    txCard.style.padding = '20px';
    txCard.style.borderRadius = '12px';
    txCard.style.background = 'var(--color-card-bg, #ffffff)';
    txCard.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)';

    const txHeader = ui.createElement('div', ['card-header', 'mb-3']);
    txHeader.style.display = 'flex';
    txHeader.style.justifyContent = 'space-between';
    txHeader.style.alignItems = 'center';
    txHeader.style.flexWrap = 'wrap';
    txHeader.style.gap = '10px';

    const txTitle = ui.createElementWithText('h3', t('wallet_tx_history_title'), ['h5', 'm-0']);
    txHeader.appendChild(txTitle);

    const txFilterGroup = ui.createElement('div', ['filter-group']);
    txFilterGroup.style.display = 'flex';
    txFilterGroup.style.gap = '8px';
    txFilterGroup.style.alignItems = 'center';

    const typeSelect = ui.createElement('select', ['form-control']);
    typeSelect.style.width = 'auto';

    const typeOpts = [
        { val: '', text: t('filter_all_types') },
        { val: '0', text: t('wallet_tx_deposit') },
        { val: '1', text: t('wallet_tx_withdrawal') },
        { val: '3', text: t('wallet_tx_commission') },
        { val: '4', text: t('wallet_tx_order_payment') },
        { val: '5', text: t('wallet_tx_settlement') },
        { val: '6', text: t('wallet_tx_refund') }
    ];

    typeOpts.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.val;
        o.textContent = opt.text;
        if (opt.val === currentWalletType) o.selected = true;
        typeSelect.appendChild(o);
    });

    typeSelect.addEventListener('change', (e) => {
        currentWalletType = e.target.value;
        renderMerchantWallet(container, apiClient, 1);
    });

    txFilterGroup.appendChild(typeSelect);
    txHeader.appendChild(txFilterGroup);
    txCard.appendChild(txHeader);

    const txDataContainer = ui.createElement('div', ['tx-data-container']);
    txCard.appendChild(txDataContainer);
    rootWrapper.appendChild(txCard);
    container.appendChild(rootWrapper);

    ui.renderShimmerList(txDataContainer);

    try {
        let endpoint = `/api/v1/wallets/user/transactions?pageNumber=${pageNumber}&pageSize=15`;
        if (currentWalletType !== '') {
            endpoint += `&type=${currentWalletType}`;
        }

        const res = await apiClient.fetch(endpoint);
        txDataContainer.replaceChildren();

        const items = res?.result?.items || [];
        const totalCount = res?.result?.totalCount || items.length;
        const totalPages = res?.result?.totalPages || 1;

        if (items.length === 0) {
            const empty = ui.createEmptyState(t('empty_state_transactions'));
            txDataContainer.appendChild(empty);
            return;
        }

        const tableWrap = ui.createElement('div', ['table-responsive']);
        const table = ui.createElement('table', ['table', 'table-hover', 'align-middle']);

        const thead = document.createElement('thead');
        const trHead = document.createElement('tr');
        [
            '#',
            t('th_transaction_id'),
            t('th_type'),
            t('th_amount'),
            t('th_balance_after'),
            t('th_description'),
            t('th_date')
        ].forEach(hText => {
            const th = document.createElement('th');
            th.textContent = hText;
            trHead.appendChild(th);
        });
        thead.appendChild(trHead);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        items.forEach((tx, idx) => {
            const tr = document.createElement('tr');

            const tdIndex = document.createElement('td');
            tdIndex.textContent = String((pageNumber - 1) * 15 + idx + 1);
            tr.appendChild(tdIndex);

            const tdId = document.createElement('td');
            tdId.appendChild(ui.createElementWithText('strong', `#${tx.id}`));
            tr.appendChild(tdId);

            const tdType = document.createElement('td');
            tdType.appendChild(getTxTypeBadge(tx.type));
            tr.appendChild(tdType);

            const tdAmt = document.createElement('td');
            tdAmt.style.fontWeight = 'bold';
            const isNegative = Number(tx.type) === 1 || Number(tx.type) === 3; // Withdrawal or Commission
            tdAmt.style.color = isNegative ? 'var(--color-danger, #EF4444)' : 'var(--color-success, #10B981)';
            tdAmt.textContent = (isNegative ? '-' : '+') + formatCurrency(tx.amount);
            tr.appendChild(tdAmt);

            const tdBal = document.createElement('td');
            tdBal.textContent = formatCurrency(tx.balanceAfter);
            tr.appendChild(tdBal);

            const tdDesc = document.createElement('td');
            tdDesc.textContent = tx.description || '-';
            tr.appendChild(tdDesc);

            const tdDate = document.createElement('td');
            tdDate.textContent = formatDate(tx.createdAt);
            tr.appendChild(tdDate);

            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        txDataContainer.appendChild(tableWrap);

        // Pagination
        if (totalPages > 1) {
            const paginationBar = ui.createElement('div', ['pagination-bar', 'mt-3']);
            paginationBar.style.display = 'flex';
            paginationBar.style.justifyContent = 'space-between';
            paginationBar.style.alignItems = 'center';

            const info = ui.createElementWithText('span', `${t('page')} ${pageNumber} / ${totalPages} (${totalCount} ${t('th_records')})`, ['text-muted', 'small']);
            paginationBar.appendChild(info);

            const btnGroup = ui.createElement('div', ['btn-group']);
            if (pageNumber > 1) {
                const btnPrev = ui.createElementWithText('button', t('btn_prev'), ['btn', 'btn-outline-primary', 'btn-sm']);
                btnPrev.addEventListener('click', () => renderMerchantWallet(container, apiClient, pageNumber - 1));
                btnGroup.appendChild(btnPrev);
            }
            if (pageNumber < totalPages) {
                const btnNext = ui.createElementWithText('button', t('btn_next'), ['btn', 'btn-outline-primary', 'btn-sm']);
                btnNext.addEventListener('click', () => renderMerchantWallet(container, apiClient, pageNumber + 1));
                btnGroup.appendChild(btnNext);
            }
            paginationBar.appendChild(btnGroup);
            txDataContainer.appendChild(paginationBar);
        }

    } catch (err) {
        txDataContainer.replaceChildren();
        const errCard = ui.createErrorState(err.message || t('network_error'), () => {
            renderMerchantWallet(container, apiClient, pageNumber);
        });
        txDataContainer.appendChild(errCard);
    }
}
