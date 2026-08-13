(function() {
    let token = localStorage.getItem('qs_vendor_token');
    let userJson = localStorage.getItem('qs_vendor_user');
    let isValid = false;

    if (token && userJson) {
        try {
            const u = JSON.parse(userJson);
            const r = u.type !== undefined ? u.type : (u.role !== undefined ? u.role : u.userType);
            // Market role must be 1 or Admin 4
            if (r === 1 || r === 4 || (typeof r === 'string' && (r.toLowerCase().includes('market') || r.toLowerCase().includes('admin')))) {
                isValid = true;
            }
        } catch (_) {}
    }

    if (!isValid) {
        const renderAuthDialog = () => {
            const overlay = document.createElement('div');
            overlay.id = 'auth-check-dialog-overlay';
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(10, 25, 27, 0.94);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                z-index: 999999;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 1.5rem;
                box-sizing: border-box;
                font-family: 'Cairo', sans-serif;
            `;

            overlay.innerHTML = `
                <div style="
                    background: #ffffff;
                    border-radius: 16px;
                    max-width: 460px;
                    width: 100%;
                    padding: 2.25rem 1.75rem;
                    text-align: center;
                    box-shadow: 0 20px 50px rgba(0,0,0,0.4);
                    border: 2px solid #FF9800;
                    direction: rtl;
                ">
                    <div style="font-size: 3.2rem; margin-bottom: 0.5rem;">🔒</div>
                    <h2 style="font-size: 1.35rem; font-weight: 800; color: #004D40; margin: 0 0 0.75rem 0;">تسجيل الدخول مطلوب!</h2>
                    <p style="font-size: 0.95rem; color: #5f6f72; line-height: 1.6; margin: 0 0 1.75rem 0;">
                        عفواً، لا توجد جلسة دخول صالحة للسوبر ماركت، أو انتهت صلاحية الجلسة الحالية. يرجى مسح البيانات المؤقتة وتسجيل الدخول بحساب الماركت.
                    </p>
                    <button id="btn-clear-cache-redirect" style="
                        width: 100%;
                        padding: 1rem 1.25rem;
                        background: linear-gradient(135deg, #004D40 0%, #00796B 100%);
                        color: #ffffff;
                        border: none;
                        border-radius: 10px;
                        font-size: 0.98rem;
                        font-weight: 800;
                        font-family: 'Cairo', sans-serif;
                        cursor: pointer;
                        box-shadow: 0 4px 14px rgba(0,77,64,0.35);
                    ">🔑 مسح الكاش والتوجيه لصفحة الدخول</button>
                </div>
            `;

            document.body.appendChild(overlay);

            const btn = overlay.querySelector('#btn-clear-cache-redirect');
            if (btn) {
                btn.onclick = () => {
                    localStorage.clear();
                    sessionStorage.clear();
                    window.location.replace('login.html?role=market');
                };
            }
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', renderAuthDialog);
        } else {
            renderAuthDialog();
        }
    }
})();
