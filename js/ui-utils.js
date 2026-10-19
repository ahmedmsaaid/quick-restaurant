/**
 * Quick Service Portal - UI Utility & DOM Creation Helpers
 * Follows strict secure coding rules to avoid innerHTML assignments and PII exposure.
 */

import { t, getLanguage } from './translations.js';

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
 * POS Thermal Receipt Printer for Handheld POS (Sunmi V2 Pro), Bluetooth Printers & Web Browsers
 * Modeled directly after Haat Store's thermal printing architecture
 * @param {Object} order - The order DTO or raw order
 * @param {Object} options - { paperSize: '80mm'|'58mm'|'a4', copies: 1 }
 */
export function printOrderReceipt(order = {}, options = {}) {
    if (!order) return;

    const paperSize = options.paperSize || '80mm';
    const copies = Math.max(1, parseInt(options.copies || 1));
    const isAr = (typeof getLanguage === 'function' ? getLanguage() : (localStorage.getItem('portal_lang') || 'ar')) === 'ar';

    const orderId = order.id || order.orderId || order.code || '1001';
    let dateStr = '';
    try {
        dateStr = order.createdAt ? new Date(order.createdAt).toLocaleString(isAr ? 'ar-EG' : 'en-US') : new Date().toLocaleString(isAr ? 'ar-EG' : 'en-US');
    } catch (_) {
        dateStr = new Date().toLocaleString();
    }

    // Determine store name from order, DOM header, or cached vendor profile
    let storeName = order.storeName || order.vendorName || '';
    if (!storeName) {
        const headerNameEl = document.getElementById('header-vendor-name');
        if (headerNameEl && headerNameEl.textContent && headerNameEl.textContent.trim()) {
            storeName = headerNameEl.textContent.trim();
        }
    }
    if (!storeName) {
        try {
            const userJson = localStorage.getItem('qs_vendor_user') || localStorage.getItem('qs_user');
            if (userJson) {
                const parsed = JSON.parse(userJson);
                storeName = parsed.name || parsed.storeName || '';
            }
        } catch (_) {}
    }
    if (!storeName) {
        storeName = isAr ? 'خدمة كويك السريعة' : 'Quick Delivery';
    }

    const customerName = order.customerName || (order.user ? order.user.name : '') || (order.creator ? order.creator.name : '') || (isAr ? 'عميل كويك' : 'Customer');
    const customerPhone = order.customerPhone || (order.user ? order.user.phone : '') || (order.creator ? order.creator.phone : '') || '';
    const address = order.address || order.deliveryAddress || (order.formattedDeliveryAddress) || '';
    const items = Array.isArray(order.items) ? order.items : (order.products || order.orderProducts || []);

    let subtotal = 0;
    let itemsHtml = '';
    if (items.length > 0) {
        items.forEach((item, idx) => {
            const name = item.name || item.productName || item.title || `${isAr ? 'صنف' : 'Item'} #${idx + 1}`;
            const qty = parseInt(item.qty || item.quantity || 1);
            const price = parseFloat(item.price || item.unitPrice || 0);
            const itemTotal = (price * qty).toFixed(2);
            subtotal += price * qty;
            itemsHtml += `
                <tr style="border-bottom: 1px dashed #cbd5e1;">
                    <td style="padding: 4px 2px; text-align: right; font-weight: 700;">${name}</td>
                    <td style="padding: 4px 2px; text-align: center;">${qty}</td>
                    <td style="padding: 4px 2px; text-align: center;">${price.toFixed(2)}</td>
                    <td style="padding: 4px 2px; text-align: left; font-weight: 700;">${itemTotal} ج.م</td>
                </tr>
            `;
        });
    } else {
        subtotal = parseFloat(order.totalPrice || 0);
        itemsHtml = `
            <tr style="border-bottom: 1px dashed #cbd5e1;">
                <td colspan="4" style="padding: 6px 0; text-align: center;">${isAr ? `طلب #${orderId}` : `Order #${orderId}`}</td>
            </tr>
        `;
    }

    const deliveryFee = parseFloat(order.deliveryFee || (order.rawOrder && order.rawOrder.deliveryFee) || 0);
    const finalTotal = parseFloat(order.finalTotal || order.totalPrice || (subtotal + deliveryFee) || 0);
    const isOnline = (order.rawOrder && order.rawOrder.paymentMethod === 1) || order.paymentMethod === 1;
    const paymentMethodText = isOnline ? (isAr ? 'دفع إلكتروني' : 'Online Payment') : (isAr ? 'كاش عند الاستلام' : 'Cash on Delivery');
    const paymentStatusBadge = isOnline ? (isAr ? '[مدفوع]' : '[PAID]') : (isAr ? '[غير مدفوع]' : '[UNPAID]');
    const notes = (order.notes || order.note || '').trim();

    let printArea = document.getElementById('thermal-receipt-print-area');
    if (!printArea) {
        printArea = document.createElement('div');
        printArea.id = 'thermal-receipt-print-area';
        document.body.appendChild(printArea);
    }
    printArea.style.display = 'none';

    // Build Single Receipt HTML Block
    const singleReceiptHtml = `
        <div class="receipt-print-ticket" style="font-family: 'Cairo', monospace, sans-serif; font-size: ${paperSize === '58mm' ? '10px' : '11px'}; color: #000000; direction: rtl; text-align: right; width: 100%; box-sizing: border-box; padding: 4px; page-break-inside: avoid;">
            <div style="text-align: center; margin-bottom: 6px;">
                <div style="font-weight: 900; font-size: 14px; letter-spacing: 0.5px;">⚡ Quick Delivery ⚡</div>
                <div style="font-size: 10px; font-weight: 700; color: #444;">كويك لخدمات التوصيل السريع</div>
                <div style="font-size: 13px; font-weight: 800; margin-top: 4px; border: 1px solid #000; padding: 2px 6px; display: inline-block; border-radius: 4px;">${storeName}</div>
            </div>
            
            <div style="border-top: 1px dashed #000; margin: 6px 0;"></div>
            
            <div style="display: flex; justify-content: space-between; font-weight: 800; font-size: 12px;">
                <span>رقم الطلب: #${orderId}</span>
                <span>توصيل</span>
            </div>
            <div style="font-size: 10px; color: #333; margin-top: 2px;">التاريخ: ${dateStr}</div>
            
            <div style="border-top: 1px dashed #000; margin: 6px 0;"></div>
            
            <div><strong>العميل:</strong> ${customerName}</div>
            ${customerPhone ? `<div><strong>الهاتف:</strong> ${customerPhone}</div>` : ''}
            ${address ? `<div><strong>العنوان:</strong> ${address}</div>` : ''}
            
            <div style="border-top: 1px dashed #000; margin: 6px 0;"></div>
            
            <table style="width: 100%; border-collapse: collapse; font-size: ${paperSize === '58mm' ? '9.5px' : '10.5px'};">
                <thead>
                    <tr style="border-bottom: 1px solid #000;">
                        <th style="text-align: right; padding-bottom: 4px;">الصنف</th>
                        <th style="text-align: center; padding-bottom: 4px;">العدد</th>
                        <th style="text-align: center; padding-bottom: 4px;">السعر</th>
                        <th style="text-align: left; padding-bottom: 4px;">المجموع</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml}
                </tbody>
            </table>
            
            <div style="border-top: 1px dashed #000; margin: 6px 0;"></div>
            
            <div style="display: flex; justify-content: space-between;">
                <span>المجموع الفرعي:</span>
                <span style="font-weight: 700;">${subtotal.toFixed(2)} ج.م</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
                <span>رسوم التوصيل:</span>
                <span style="font-weight: 700;">${deliveryFee.toFixed(2)} ج.م</span>
            </div>
            
            <div style="border-top: 1px solid #000; margin: 4px 0;"></div>
            
            <div style="display: flex; justify-content: space-between; font-weight: 900; font-size: 13px; background: #eee; padding: 4px;">
                <span>الإجمالي الكلي:</span>
                <span>${finalTotal.toFixed(2)} ج.م</span>
            </div>
            
            <div style="margin-top: 6px; display: flex; justify-content: space-between;">
                <span><strong>وسيلة الدفع:</strong> ${paymentMethodText}</span>
                <span style="font-weight: 800;">${paymentStatusBadge}</span>
            </div>
            
            ${notes ? `
                <div style="margin-top: 6px; border: 1px dashed #000; padding: 4px; border-radius: 4px; font-size: 10px;">
                    <strong>ملاحظات العميل:</strong> ${notes}
                </div>
            ` : ''}
            
            <div style="border-top: 1px dashed #000; margin: 8px 0 4px 0;"></div>
            <div style="text-align: center; font-size: 10px; font-weight: 800;">شكراً لتعاملكم معنا! نتمنى لكم يوماً سعيداً</div>
            <div style="text-align: center; font-size: 9px; color: #555;">www.quick-service.com</div>
        </div>
    `;

    // Repeat for number of copies
    let fullPrintHtml = '';
    for (let c = 0; c < copies; c++) {
        fullPrintHtml += singleReceiptHtml;
        if (c < copies - 1) {
            fullPrintHtml += `
                <div style="page-break-after: always; height: 16px; border-bottom: 2px dashed #666; margin: 16px 0; text-align: center; font-size: 9px; color: #666;">
                    --- نسخة ${c + 2} من ${copies} ---
                </div>
            `;
        }
    }

    printArea.innerHTML = fullPrintHtml;

    // Inject temporary paper size override style
    const styleId = 'receipt-dynamic-print-style';
    let styleEl = document.getElementById(styleId);
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = styleId;
        document.head.appendChild(styleEl);
    }
    const maxWidth = paperSize === '58mm' ? '58mm' : (paperSize === 'a4' ? '180mm' : '80mm');
    styleEl.textContent = `
        @media print {
            #thermal-receipt-print-area {
                display: block !important;
                max-width: ${maxWidth} !important;
                margin: 0 auto !important;
                padding: ${paperSize === '58mm' ? '3mm' : '5mm'} !important;
            }
        }
    `;

    // Trigger Print
    window.print();

    // Show success feedback
    showToast(isAr ? 'تم إرسال الفاتورة للطباعة بنجاح!' : 'Invoice sent to printer successfully!', 'success');
}

/**
 * Interactive Receipt Preview & Print Modal matching Haat Store OrderReceiptDialog
 * @param {Object} order - Order DTO object
 */
export function showOrderReceiptModal(order) {
    if (!order) return;

    let overlay = document.getElementById('receipt-preview-overlay');
    if (!overlay) {
        overlay = createElement('div', ['modal-overlay', 'hidden'], { id: 'receipt-preview-overlay' });
        document.body.appendChild(overlay);
    }

    overlay.replaceChildren();
    overlay.style.display = 'flex';
    overlay.style.zIndex = '9999999';
    overlay.classList.remove('hidden');

    const isAr = (typeof getLanguage === 'function' ? getLanguage() : (localStorage.getItem('portal_lang') || 'ar')) === 'ar';
    let selectedPaperSize = '80mm';
    let selectedCopies = 1;

    // Card Container
    const card = createElement('div', ['receipt-modal-card']);

    // 1. Header
    const header = createElement('div', ['receipt-modal-header']);
    const titleGroup = createElement('div', ['receipt-modal-title']);
    titleGroup.appendChild(createElementWithText('span', '🧾', []));
    titleGroup.appendChild(createElementWithText('span', isAr ? 'معاينة الفاتورة' : 'Receipt Preview', []));
    header.appendChild(titleGroup);

    const closeBtn = createElementWithText('button', '✕', ['receipt-modal-close-btn'], {
        type: 'button',
        title: isAr ? 'إغلاق' : 'Close'
    });
    const closeModal = () => {
        overlay.classList.add('hidden');
        overlay.style.display = 'none';
    };
    closeBtn.addEventListener('click', closeModal);
    overlay.onclick = (e) => {
        if (e.target === overlay) closeModal();
    };
    header.appendChild(closeBtn);
    card.appendChild(header);

    // 2. Scrollable Body containing simulated thermal paper
    const body = createElement('div', ['receipt-modal-body']);
    const paper = createElement('div', ['receipt-paper', 'paper-80mm']);

    const orderId = order.id || order.orderId || order.code || '1001';
    let dateStr = '';
    try {
        dateStr = order.createdAt ? new Date(order.createdAt).toLocaleString(isAr ? 'ar-EG' : 'en-US') : new Date().toLocaleString(isAr ? 'ar-EG' : 'en-US');
    } catch (_) {
        dateStr = new Date().toLocaleString();
    }

    let storeName = order.storeName || order.vendorName || '';
    if (!storeName) {
        const headerNameEl = document.getElementById('header-vendor-name');
        if (headerNameEl && headerNameEl.textContent && headerNameEl.textContent.trim()) {
            storeName = headerNameEl.textContent.trim();
        }
    }
    if (!storeName) {
        try {
            const userJson = localStorage.getItem('qs_vendor_user') || localStorage.getItem('qs_user');
            if (userJson) {
                const parsed = JSON.parse(userJson);
                storeName = parsed.name || parsed.storeName || '';
            }
        } catch (_) {}
    }
    if (!storeName) storeName = isAr ? 'خدمة كويك السريعة' : 'Quick Delivery';

    const customerName = order.customerName || (order.user ? order.user.name : '') || (order.creator ? order.creator.name : '') || (isAr ? 'عميل كويك' : 'Customer');
    const customerPhone = order.customerPhone || (order.user ? order.user.phone : '') || (order.creator ? order.creator.phone : '') || '';
    const address = order.address || order.deliveryAddress || (order.formattedDeliveryAddress) || '';
    const items = Array.isArray(order.items) ? order.items : (order.products || order.orderProducts || []);

    let subtotal = 0;
    const deliveryFee = parseFloat(order.deliveryFee || (order.rawOrder && order.rawOrder.deliveryFee) || 0);

    // Paper Branding Header
    const branding = createElement('div', ['receipt-branding']);
    branding.appendChild(createElementWithText('div', '⚡ Quick Delivery - خدمة كويك ⚡', ['receipt-brand-badge']));
    branding.appendChild(createElementWithText('div', storeName, ['receipt-store-name']));
    branding.appendChild(createElementWithText('div', isAr ? 'فاتورة ضريبية مبسطة' : 'Simplified Tax Invoice', ['receipt-store-sub']));
    paper.appendChild(branding);

    paper.appendChild(createElement('div', ['receipt-dashed-line']));

    // Meta Row: Order # + Badge
    const metaRow1 = createElement('div', ['receipt-meta-row']);
    metaRow1.appendChild(createElementWithText('span', `${isAr ? 'رقم الطلب:' : 'Order ID:'} #${orderId}`, ['receipt-meta-id']));
    metaRow1.appendChild(createElementWithText('span', isAr ? 'توصيل سريع' : 'Express Delivery', ['receipt-badge-pill']));
    paper.appendChild(metaRow1);

    const metaRow2 = createElement('div', ['receipt-meta-row']);
    metaRow2.appendChild(createElementWithText('span', `${isAr ? 'التاريخ:' : 'Date:'} ${dateStr}`, ['text-secondary'], { style: 'font-size: 11px;' }));
    paper.appendChild(metaRow2);

    // Customer Info
    paper.appendChild(createElement('div', ['receipt-dotted-line']));
    const custRow1 = createElement('div', ['receipt-meta-row']);
    custRow1.appendChild(createElementWithText('span', `👤 ${customerName}`, ['font-bold']));
    if (customerPhone) {
        custRow1.appendChild(createElementWithText('span', `📞 ${customerPhone}`, []));
    }
    paper.appendChild(custRow1);
    if (address) {
        const addrRow = createElement('div', ['receipt-meta-row'], { style: 'font-size: 11px; color: #475569;' });
        addrRow.appendChild(createElementWithText('span', `📍 ${address}`));
        paper.appendChild(addrRow);
    }

    paper.appendChild(createElement('div', ['receipt-dashed-line']));

    // Items Table
    const table = createElement('table', ['receipt-table']);
    const thead = createElement('thead');
    thead.innerHTML = `
        <tr style="border-bottom: 1px solid #cbd5e1;">
            <th style="text-align: right; width: 45%;">${isAr ? 'الصنف' : 'Item'}</th>
            <th style="text-align: center; width: 15%;">${isAr ? 'الكمية' : 'Qty'}</th>
            <th style="text-align: center; width: 20%;">${isAr ? 'السعر' : 'Price'}</th>
            <th style="text-align: left; width: 20%;">${isAr ? 'الإجمالي' : 'Total'}</th>
        </tr>
    `;
    table.appendChild(thead);

    const tbody = createElement('tbody');
    if (items.length > 0) {
        items.forEach((item, idx) => {
            const name = item.name || item.productName || item.title || `${isAr ? 'صنف' : 'Item'} #${idx + 1}`;
            const qty = parseInt(item.qty || item.quantity || 1);
            const price = parseFloat(item.price || item.unitPrice || 0);
            const total = qty * price;
            subtotal += total;

            const tr = createElement('tr', [], { style: 'border-bottom: 1px dotted #e2e8f0;' });
            tr.innerHTML = `
                <td style="text-align: right; font-weight: 700;">${name}</td>
                <td style="text-align: center;">${qty}</td>
                <td style="text-align: center;">${price.toFixed(2)}</td>
                <td style="text-align: left; font-weight: 700;">${total.toFixed(2)} ج.م</td>
            `;
            tbody.appendChild(tr);
        });
    } else {
        subtotal = parseFloat(order.totalPrice || 0);
        const tr = createElement('tr');
        tr.innerHTML = `<td colspan="4" style="text-align: center; padding: 6px;">${isAr ? 'تفاصيل الطلب' : 'Order details'}</td>`;
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    paper.appendChild(table);

    paper.appendChild(createElement('div', ['receipt-dashed-line']));

    // Financial Breakdown
    const subtotalRow = createElement('div', ['receipt-meta-row']);
    subtotalRow.appendChild(createElementWithText('span', isAr ? 'المجموع الفرعي:' : 'Subtotal:'));
    subtotalRow.appendChild(createElementWithText('span', `${subtotal.toFixed(2)} ج.م`, ['font-bold']));
    paper.appendChild(subtotalRow);

    const deliveryRow = createElement('div', ['receipt-meta-row']);
    deliveryRow.appendChild(createElementWithText('span', isAr ? 'رسوم التوصيل:' : 'Delivery Fee:'));
    deliveryRow.appendChild(createElementWithText('span', `${deliveryFee.toFixed(2)} ج.م`, ['font-bold']));
    paper.appendChild(deliveryRow);

    const finalTotal = parseFloat(order.finalTotal || order.totalPrice || (subtotal + deliveryFee) || 0);
    const totalBox = createElement('div', ['receipt-total-box']);
    totalBox.appendChild(createElementWithText('span', isAr ? 'الإجمالي الكلي:' : 'Grand Total:'));
    totalBox.appendChild(createElementWithText('span', `${finalTotal.toFixed(2)} ج.م`));
    paper.appendChild(totalBox);

    // Payment Info
    const isOnline = (order.rawOrder && order.rawOrder.paymentMethod === 1) || order.paymentMethod === 1;
    const payRow = createElement('div', ['receipt-meta-row']);
    payRow.appendChild(createElementWithText('span', `${isAr ? 'وسيلة الدفع:' : 'Payment:'} ${isOnline ? (isAr ? 'دفع إلكتروني' : 'Online') : (isAr ? 'كاش عند الاستلام' : 'Cash')}`));
    payRow.appendChild(createElementWithText('span', isOnline ? (isAr ? 'مدفوع ✔' : 'PAID ✔') : (isAr ? 'تحصيل كاش' : 'Cash on Delivery'), ['receipt-badge-pill'], {
        style: isOnline ? 'background: #dcfce7; color: #15803d;' : 'background: #fef3c7; color: #b45309;'
    }));
    paper.appendChild(payRow);

    // Notes if present
    const notes = (order.notes || order.note || '').trim();
    if (notes) {
        const notesBox = createElement('div', ['receipt-notes-box']);
        notesBox.appendChild(createElementWithText('div', isAr ? '📝 ملاحظات العميل:' : '📝 Customer Notes:', ['font-bold']));
        notesBox.appendChild(createElementWithText('div', notes));
        paper.appendChild(notesBox);
    }

    paper.appendChild(createElement('div', ['receipt-dashed-line']));
    paper.appendChild(createElementWithText('div', isAr ? 'شكراً لتسوقكم معنا!' : 'Thank you for your order!', [], {
        style: 'text-align: center; font-weight: 800; font-size: 11px; margin-top: 4px;'
    }));
    paper.appendChild(createElementWithText('div', 'Quick Delivery - www.quick-service.com', [], {
        style: 'text-align: center; font-size: 10px; color: #64748b; margin-top: 2px;'
    }));

    body.appendChild(paper);
    card.appendChild(body);

    // 3. Footer Controls (Paper Size + Copies + Print/Cancel Buttons)
    const footer = createElement('div', ['receipt-modal-footer']);

    // Paper Size & Copies Toolbar
    const controlsRow = createElement('div', ['receipt-controls-row']);

    // Paper Size Selector
    const sizeGroup = createElement('div', [], { style: 'display: flex; align-items: center; gap: 6px;' });
    sizeGroup.appendChild(createElementWithText('span', isAr ? 'المقاس:' : 'Size:', [], { style: 'font-size: 11px; font-weight: 700;' }));
    const pillsWrap = createElement('div', ['receipt-paper-pills']);

    const sizes = [
        { id: '80mm', label: isAr ? '80 مم' : '80mm' },
        { id: '58mm', label: isAr ? '58 مم' : '58mm' },
        { id: 'a4', label: isAr ? 'A4' : 'A4' }
    ];

    const updatePaperSize = (sizeId) => {
        selectedPaperSize = sizeId;
        pillsWrap.querySelectorAll('.receipt-paper-pill').forEach(p => {
            p.classList.toggle('active', p.dataset.size === sizeId);
        });
        paper.className = `receipt-paper paper-${sizeId}`;
    };

    sizes.forEach(s => {
        const pill = createElementWithText('button', s.label, ['receipt-paper-pill', s.id === '80mm' ? 'active' : ''], {
            type: 'button',
            dataset: { size: s.id }
        });
        pill.addEventListener('click', () => updatePaperSize(s.id));
        pillsWrap.appendChild(pill);
    });
    sizeGroup.appendChild(pillsWrap);
    controlsRow.appendChild(sizeGroup);

    // Copies Selector
    const copiesGroup = createElement('div', ['receipt-copies-ctrl']);
    copiesGroup.appendChild(createElementWithText('span', isAr ? 'النسخ:' : 'Copies:', [], { style: 'font-size: 11px; font-weight: 700;' }));
    
    const countDisplay = createElementWithText('span', '1', ['receipt-copies-count']);
    const minusBtn = createElementWithText('button', '-', ['receipt-copy-btn'], { type: 'button' });
    const plusBtn = createElementWithText('button', '+', ['receipt-copy-btn'], { type: 'button' });

    minusBtn.addEventListener('click', () => {
        if (selectedCopies > 1) {
            selectedCopies--;
            countDisplay.textContent = selectedCopies.toString();
        }
    });
    plusBtn.addEventListener('click', () => {
        if (selectedCopies < 5) {
            selectedCopies++;
            countDisplay.textContent = selectedCopies.toString();
        }
    });

    copiesGroup.appendChild(minusBtn);
    copiesGroup.appendChild(countDisplay);
    copiesGroup.appendChild(plusBtn);
    controlsRow.appendChild(copiesGroup);

    footer.appendChild(controlsRow);

    // Buttons
    const buttonsRow = createElement('div', ['receipt-footer-buttons']);
    const printBtn = createElementWithText('button', isAr ? '🖨️ طباعة الفاتورة' : '🖨️ Print Invoice', ['receipt-btn-print'], {
        type: 'button'
    });
    printBtn.addEventListener('click', () => {
        printOrderReceipt(order, {
            paperSize: selectedPaperSize,
            copies: selectedCopies
        });
    });
    buttonsRow.appendChild(printBtn);

    const cancelBtn = createElementWithText('button', isAr ? 'إغلاق' : 'Close', ['receipt-btn-close'], {
        type: 'button'
    });
    cancelBtn.addEventListener('click', closeModal);
    buttonsRow.appendChild(cancelBtn);

    footer.appendChild(buttonsRow);
    card.appendChild(footer);

    overlay.appendChild(card);
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
            <button type="button" class="full-order-close-btn" id="btn-close-full-order" aria-label="Close">&times;</button>
            <div class="full-order-icon-wrap">
                <span class="full-order-bell">🔔</span>
            </div>
            <h2 class="full-order-title">${titleText}</h2>
            <p class="full-order-subtitle">${subTitleText}</p>
            <div class="full-order-badge" id="full-order-code">${badgeText}</div>
            <button type="button" id="btn-ack-full-order" class="full-order-btn">${btnText}</button>
        </div>
    `;

    const closeAlert = () => {
        stopAlarmSound();
        overlay.classList.add('hidden');
    };

    const ackBtn = overlay.querySelector('#btn-ack-full-order');
    if (ackBtn) {
        ackBtn.onclick = (e) => {
            e.stopPropagation();
            closeAlert();
            if (typeof onAcknowledgeCallback === 'function') {
                onAcknowledgeCallback();
            }
        };
    }

    const closeBtn = overlay.querySelector('#btn-close-full-order');
    if (closeBtn) {
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            closeAlert();
        };
    }

    // Dismiss when clicking outside the card on the backdrop
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            closeAlert();
        }
    };

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
    let overlay = document.getElementById('modal-overlay');
    let container = document.getElementById('modal-container');
    
    if (!overlay) {
        overlay = createElement('div', ['modal-overlay', 'hidden'], { id: 'modal-overlay' });
        document.body.appendChild(overlay);
    }
    if (!container) {
        container = createElement('div', ['modal-card'], { id: 'modal-container' });
        overlay.appendChild(container);
    }

    // Reset container styles in case they were modified by other custom modals
    container.style.background = '';
    container.style.border = '';
    container.style.borderTop = '';
    container.style.boxShadow = '';
    container.style.padding = '';
    container.style.maxWidth = '';
    container.style.width = '';
    container.style.maxHeight = '';
    container.style.overflowY = '';
    
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

    // Backdrop click to close
    overlay.onclick = (e) => {
        if (e.target === overlay) closeModal();
    };
    
    container.appendChild(header);
    container.appendChild(body);
    container.appendChild(footer);
    
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
    overlay.style.zIndex = '999999';
}

/**
 * Close the custom modal
 */
export function closeModal() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.style.display = 'none';
    }
}
export const hideModal = closeModal;

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

/**
 * Unified Mobile-Style Order Details Layout (Matching user reference)
 * @param {Object} order - Order DTO object
 * @param {Object} options - { showHeader, onBack, onAccept, acceptText, readonly }
 * @returns {HTMLElement} - Container DOM node
 */
export function renderOrderView(order, options = {}) {
    const container = createElement('div', ['qs-order-view']);

    // 1. Optional Top Header (e.g. inside modal or full page view)
    if (options.showHeader) {
        const header = createElement('div', ['qs-order-view-header']);
        if (options.onBack) {
            const backBtn = createElementWithText('button', '❮', ['qs-order-view-header-back']);
            backBtn.type = 'button';
            backBtn.addEventListener('click', options.onBack);
            header.appendChild(backBtn);
        } else {
            header.appendChild(createElement('div', [], { style: 'width: 24px;' }));
        }
        header.appendChild(createElementWithText('div', 'تفاصيل الطلب', ['qs-order-view-header-title']));
        header.appendChild(createElement('div', [], { style: 'width: 24px;' }));
        container.appendChild(header);
    }

    // 2. Card 1: Order ID, Badge, Time, Customer & Phone (NO ADDRESS per user request)
    const card1 = createElement('div', ['qs-order-card']);
    
    // Top Row
    const topRow = createElement('div', ['qs-order-top-row']);
    
    // Title & Time Group
    const titleGroup = createElement('div', ['qs-order-title-group']);
    titleGroup.appendChild(createElementWithText('h3', `طلب #${order.id}`, ['qs-order-number']));
    
    let timeText = 'وصل منذ لحظات 🕒';
    if (order.createdAt) {
        try {
            const diffMs = Date.now() - new Date(order.createdAt).getTime();
            const mins = Math.floor(diffMs / 60000);
            if (mins > 1 && mins < 60) {
                timeText = `منذ ${mins} دقيقة 🕒`;
            } else if (mins >= 60 && mins < 1440) {
                timeText = `منذ ${Math.floor(mins / 60)} ساعة 🕒`;
            }
        } catch (_) {}
    }
    titleGroup.appendChild(createElementWithText('div', timeText, ['qs-order-time']));
    topRow.appendChild(titleGroup);

    // Status Badge
    let badgeLabel = 'جديد';
    if (order.status === 'confirmed') badgeLabel = 'مؤكد';
    else if (order.status === 'preparing') badgeLabel = 'قيد التجهيز';
    else if (order.status === 'ready_for_pickup') badgeLabel = 'جاهز';
    else if (order.status === 'waiting_for_driver') badgeLabel = 'بانتظار سائق';
    else if (order.status === 'completed') badgeLabel = 'مكتمل';
    else if (order.status === 'on_the_way') badgeLabel = 'في الطريق';

    topRow.appendChild(createElementWithText('span', badgeLabel, ['qs-order-badge']));
    card1.appendChild(topRow);

    // Divider
    card1.appendChild(createElement('div', [], { style: 'height: 1px; background: rgba(0,0,0,0.06); margin: 6px 0 10px 0;' }));

    // Customer Name Row
    const custName = order.customerName || (order.user ? order.user.name : '') || 'Quick Market';
    const nameRow = createElement('div', ['qs-order-contact-row']);
    nameRow.appendChild(createElementWithText('span', `${custName} 👤`, []));
    card1.appendChild(nameRow);

    // Customer Phone Row
    const phoneVal = order.customerPhone || (order.user ? order.user.phone : '') || '0100 123 4567';
    const phoneRow = createElement('div', ['qs-order-contact-row', 'qs-order-contact-phone']);
    phoneRow.appendChild(createElementWithText('span', `${phoneVal} 📞`, []));
    card1.appendChild(phoneRow);

    // NOTE: Address is completely omitted per user instructions ("بس من غير العنوان")
    container.appendChild(card1);

    // 3. Card 2: Items List & Financial Summary
    const card2 = createElement('div', ['qs-order-card']);
    const items = Array.isArray(order.items) ? order.items : [];
    card2.appendChild(createElementWithText('div', `الأصناف (${items.length})`, ['qs-order-section-title']));

    let subtotal = 0;
    items.forEach(it => {
        const qty = parseInt(it.qty || it.quantity || 1);
        const price = parseFloat(it.price || 0);
        subtotal += qty * price;

        const itemBox = createElement('div', ['qs-order-item-box']);
        
        // Item Details (Name + Qty + Price)
        const info = createElement('div', ['qs-order-item-info']);
        info.appendChild(createElementWithText('div', it.name || 'صنف', ['qs-order-item-name']));
        info.appendChild(createElementWithText('div', `${qty}x`, ['qs-order-item-qty']));
        info.appendChild(createElementWithText('div', `${(qty * price).toFixed(2)} ج.م`, ['qs-order-item-price']));
        itemBox.appendChild(info);

        // Item Image Wrap
        const imgWrap = createElement('div', ['qs-order-item-img-wrap']);
        if (it.image || it.photo) {
            const img = createElement('img', ['qs-order-item-img'], {
                src: getImageUrl(it.image || it.photo),
                alt: it.name || 'Item'
            });
            img.onerror = () => { imgWrap.textContent = '📦'; };
            imgWrap.appendChild(img);
        } else {
            imgWrap.textContent = '📦';
        }
        itemBox.appendChild(imgWrap);

        card2.appendChild(itemBox);
    });

    if (items.length === 0) {
        subtotal = parseFloat(order.totalPrice || 0);
    }

    const deliveryFee = parseFloat(order.deliveryFee || (order.rawOrder && order.rawOrder.deliveryFee) || 0);
    const grandTotal = subtotal + deliveryFee;

    const subtotalRow = createElement('div', ['qs-order-summary-row']);
    subtotalRow.appendChild(createElementWithText('span', 'الإجمالي الفرعي'));
    subtotalRow.appendChild(createElementWithText('span', `${subtotal.toFixed(2)} ج.م`));
    card2.appendChild(subtotalRow);

    const deliveryRow = createElement('div', ['qs-order-summary-row']);
    deliveryRow.appendChild(createElementWithText('span', 'رسوم التوصيل'));
    deliveryRow.appendChild(createElementWithText('span', `${deliveryFee.toFixed(2)} ج.م`));
    card2.appendChild(deliveryRow);

    const totalRow = createElement('div', ['qs-order-summary-total']);
    totalRow.appendChild(createElementWithText('span', 'الإجمالي الكلي'));
    totalRow.appendChild(createElementWithText('span', `${grandTotal.toFixed(2)} ج.م`));
    card2.appendChild(totalRow);

    container.appendChild(card2);

    // 4. Card 3: Payment Method
    const card3 = createElement('div', ['qs-order-card']);
    const isOnline = (order.rawOrder && order.rawOrder.paymentMethod === 1) || order.paymentMethod === 1;
    const payText = isOnline ? 'دفع إلكتروني' : 'كاش عند الاستلام';
    
    const payRow = createElement('div', ['qs-order-card-row']);
    payRow.appendChild(createElementWithText('span', payText, ['qs-order-card-value']));
    payRow.appendChild(createElementWithText('span', '💳 وسيلة الدفع', ['qs-order-card-label']));
    card3.appendChild(payRow);
    container.appendChild(card3);

    // 5. Card 4: Customer Notes
    const card4 = createElement('div', ['qs-order-card']);
    card4.appendChild(createElementWithText('div', 'ملاحظات العميل', ['qs-order-section-title', 'qs-order-card-label']));
    const notesText = order.notes && order.notes.trim() ? order.notes.trim() : 'لا توجد ملاحظات';
    card4.appendChild(createElementWithText('div', notesText, ['qs-order-notes-content']));
    container.appendChild(card4);

    // 6. Action Button: ONLY Accept button (NO reject button per "ومن غير رفض الطلب")
    if (!options.readonly && options.onAccept) {
        const acceptBtn = createElementWithText('button', options.acceptText || '✔ تأكيد القبول', ['qs-order-accept-btn']);
        acceptBtn.type = 'button';
        acceptBtn.addEventListener('click', options.onAccept);
        container.appendChild(acceptBtn);
    }

    // Print Invoice Button (Modeled after Haat Store OrderDetailsActionButtons)
    const printInvoiceBtn = createElementWithText('button', isAr ? '🖨️ طباعة الفاتورة' : '🖨️ Print Invoice', ['qs-order-print-btn']);
    printInvoiceBtn.type = 'button';
    printInvoiceBtn.title = isAr ? 'طباعة الفاتورة' : 'Print Invoice';
    printInvoiceBtn.addEventListener('click', () => {
        showOrderReceiptModal(order);
    });
    container.appendChild(printInvoiceBtn);

    return container;
}

/**
 * Modern Compact Dashboard Order Card for Queue Grid (4 per row desktop, 2 per row mobile)
 * @param {Object} order - Order DTO object
 * @param {Object} options - { onAccept, acceptText, readonly }
 * @returns {HTMLElement} - Card DOM element
 */
export function renderDashboardOrderCard(order, options = {}) {
    const isAr = (typeof getLanguage === 'function' ? getLanguage() : (localStorage.getItem('portal_lang') || 'ar')) === 'ar';
    const card = createElement('div', ['qs-dash-order-card']);

    // 1. Header
    const header = createElement('div', ['qs-dash-order-header']);
    
    // Top Row: Order # + Status Badge
    const headerTop = createElement('div', ['qs-dash-order-header-top']);
    headerTop.appendChild(createElementWithText('span', `${isAr ? 'طلب #' : 'Order #'}${order.id}`, ['qs-dash-order-number']));
    
    let badgeLabel = isAr ? 'جديد' : 'New';
    if (order.status === 'confirmed') badgeLabel = isAr ? 'مؤكد' : 'Confirmed';
    else if (order.status === 'preparing') badgeLabel = isAr ? 'قيد التجهيز' : 'Preparing';
    else if (order.status === 'ready_for_pickup') badgeLabel = isAr ? 'جاهز' : 'Ready';
    else if (order.status === 'waiting_for_driver') badgeLabel = isAr ? 'بانتظار سائق' : 'Awaiting Driver';
    else if (order.status === 'completed') badgeLabel = isAr ? 'مكتمل' : 'Completed';
    else if (order.status === 'on_the_way') badgeLabel = isAr ? 'في الطريق' : 'On the way';
    headerTop.appendChild(createElementWithText('span', badgeLabel, ['qs-dash-order-badge-compact', 'qs-dash-order-badge-new']));
    
    // Quick Print Button (Modeled after Haat Store OrderCard header print icon)
    const quickPrintBtn = createElementWithText('button', '🖨️', ['qs-dash-quick-print-btn'], {
        type: 'button',
        title: isAr ? 'طباعة الفاتورة' : 'Print Invoice'
    });
    quickPrintBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showOrderReceiptModal(order);
    });
    headerTop.appendChild(quickPrintBtn);

    header.appendChild(headerTop);

    // Sub Row: Time + Payment Badge
    const headerSub = createElement('div', ['qs-dash-order-header-sub']);
    let timeText = isAr ? 'منذ قليل 🕒' : 'Just now 🕒';
    if (order.createdAt) {
        try {
            const diffMs = Date.now() - new Date(order.createdAt).getTime();
            const mins = Math.floor(diffMs / 60000);
            if (mins >= 1 && mins < 60) {
                timeText = isAr ? `منذ ${mins} د 🕒` : `${mins}m ago 🕒`;
            } else if (mins >= 60 && mins < 1440) {
                timeText = isAr ? `منذ ${Math.floor(mins / 60)} س 🕒` : `${Math.floor(mins / 60)}h ago 🕒`;
            }
        } catch (_) {}
    }
    headerSub.appendChild(createElementWithText('span', timeText, ['qs-dash-order-time-compact']));

    const isOnline = (order.rawOrder && order.rawOrder.paymentMethod === 1) || order.paymentMethod === 1;
    const payText = isOnline ? (isAr ? '💳 أونلاين' : '💳 Online') : (isAr ? '💵 كاش' : '💵 Cash');
    headerSub.appendChild(createElementWithText('span', payText, ['qs-dash-order-badge-pay', isOnline ? 'badge-info' : 'badge-warning']));
    header.appendChild(headerSub);
    card.appendChild(header);

    // 2. Body
    const body = createElement('div', ['qs-dash-order-body']);
    
    // Customer Name (NO ADDRESS per instructions)
    const custName = order.customerName || (order.user ? order.user.name : '') || (isAr ? 'عميل' : 'Customer');
    const custRow = createElement('div', ['qs-dash-order-customer-compact']);
    custRow.appendChild(createElementWithText('span', `👤 ${custName}`));
    body.appendChild(custRow);

    // Items preview
    const items = Array.isArray(order.items) ? order.items : [];
    const itemsSummary = items.map(it => `${it.qty || 1}x ${it.name}`).join('، ') || (isAr ? 'لا توجد أصناف' : 'No items');
    const itemsRow = createElement('div', ['qs-dash-order-items-compact']);
    itemsRow.appendChild(createElementWithText('span', `📦 ${items.length} ${isAr ? 'أصناف' : 'items'}: ${itemsSummary}`));
    body.appendChild(itemsRow);

    // Price row
    const deliveryFee = parseFloat(order.deliveryFee || (order.rawOrder && order.rawOrder.deliveryFee) || 0);
    const subtotal = items.reduce((acc, it) => acc + (parseFloat(it.price || 0) * parseInt(it.qty || 1)), 0);
    const finalTotal = parseFloat(order.finalTotal || order.totalPrice || (subtotal + deliveryFee) || 0);
    
    const priceRow = createElement('div', ['qs-dash-order-price-compact']);
    priceRow.appendChild(createElementWithText('span', isAr ? 'الإجمالي:' : 'Total:', ['text-secondary'], { style: 'font-size: 0.78rem;' }));
    priceRow.appendChild(createElementWithText('strong', `${finalTotal.toFixed(2)} ج.م`));
    body.appendChild(priceRow);
    card.appendChild(body);

    // 3. Actions row: compact buttons
    const actionsRow = createElement('div', ['qs-dash-order-actions-compact']);
    
    const detailsBtn = createElementWithText('button', isAr ? '👁️ التفاصيل' : '👁️ Details', ['qs-dash-btn-details-compact']);
    detailsBtn.type = 'button';
    detailsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showOrderDetailsModal(order, options.onAccept);
    });
    actionsRow.appendChild(detailsBtn);

    // Compact Print Button
    const printCompactBtn = createElementWithText('button', isAr ? '🖨️ طباعة' : '🖨️ Print', ['qs-dash-btn-print-compact']);
    printCompactBtn.type = 'button';
    printCompactBtn.title = isAr ? 'طباعة الفاتورة' : 'Print Invoice';
    printCompactBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showOrderReceiptModal(order);
    });
    actionsRow.appendChild(printCompactBtn);

    if (!options.readonly && options.onAccept) {
        const acceptBtn = createElementWithText('button', options.acceptText || (isAr ? '✔ قبول' : '✔ Accept'), ['qs-dash-btn-accept-compact']);
        acceptBtn.type = 'button';
        acceptBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            options.onAccept();
        });
        actionsRow.appendChild(acceptBtn);
    }
    card.appendChild(actionsRow);

    // Clicking anywhere on card opens details modal
    card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        showOrderDetailsModal(order, options.onAccept);
    });

    return card;
}

/**
 * Shows the order details in an overlay modal matching the mobile reference
 */
export function showOrderDetailsModal(order, onAcceptCallback = null) {
    let overlay = document.getElementById('modal-overlay');
    let modalContainer = document.getElementById('modal-container');
    
    if (!overlay) {
        overlay = createElement('div', ['modal-overlay', 'hidden'], { id: 'modal-overlay' });
        document.body.appendChild(overlay);
    }
    if (!modalContainer) {
        modalContainer = createElement('div', ['modal-card'], { id: 'modal-container' });
        overlay.appendChild(modalContainer);
    }

    modalContainer.replaceChildren();
    modalContainer.style.background = 'transparent';
    modalContainer.style.border = 'none';
    modalContainer.style.borderTop = 'none';
    modalContainer.style.boxShadow = 'none';
    modalContainer.style.padding = '0';
    modalContainer.style.maxWidth = '480px';
    modalContainer.style.width = '100%';
    modalContainer.style.maxHeight = '92vh';
    modalContainer.style.overflowY = 'auto';

    // Click outside backdrop to close
    overlay.onclick = (e) => {
        if (e.target === overlay) closeModal();
    };

    const orderView = renderOrderView(order, {
        showHeader: true,
        onBack: () => closeModal(),
        acceptText: '✔ تأكيد القبول',
        onAccept: onAcceptCallback ? () => {
            onAcceptCallback(order);
            closeModal();
        } : null
    });

    modalContainer.appendChild(orderView);
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
    overlay.style.zIndex = '999999';
}




