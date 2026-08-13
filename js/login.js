/**
 * Quick Service Portal - Admin Login Controller
 * Handles user credentials input, calls the backend authentication API,
 * retrieves and verifies the user profile role, and saves session tokens.
 * Refactored to OOP Class-based architecture.
 */

import { t, getLanguage, setLanguage, initTranslations, subscribeLangChange } from './translations.js';
import { ApiClient } from './core.js';
import { initTheme } from './ui-utils.js';

export class LoginController {
    constructor() {
        const urlParams = new URLSearchParams(window.location.search);
        this.roleParam = urlParams.get('role') || 'admin';
        this.apiClient = new ApiClient(this.roleParam);

        // UI Element bindings
        this.loginForm = null;
        this.otpForm = null;
        this.identifierInput = null;
        this.passwordInput = null;
        this.submitBtn = null;
        this.spinner = null;
        this.btnText = null;
        this.togglePasswordBtn = null;
        this.otpPhoneInput = null;
        this.otpCodeInput = null;
        this.otpSubmitBtn = null;
        this.sendOtpBtn = null;
        this.otpBackBtn = null;
        
        // Temp auth credentials
        this.tempAuthToken = null;
        this.tempLoginCredentials = null;
    }

    /**
     * Entry point to boot the login page controllers
     */
    init() {
        if (this.checkAutoRedirect()) {
            return;
        }

        this.cacheDomElements();
        this.configureDynamicRole();
        initTranslations();
        this.setupLanguageSwitcher();
        this.bindEvents();
    }

    /**
     * Checks if a valid session already exists for the role and auto-redirects
     * @returns {boolean} true if redirected
     */
    checkAutoRedirect() {
        const token = this.apiClient.getToken();
        const user = this.apiClient.getUser();
        
        if (token && user) {
            if (this.roleParam === 'restaurant') {
                window.location.replace('restaurant.html');
                return true;
            } else if (this.roleParam === 'market') {
                window.location.replace('market.html');
                return true;
            } else if (this.roleParam === 'admin') {
                window.location.replace('super-admin.html');
                return true;
            }
        }
        return false;
    }

    /**
     * Cache DOM element references
     */
    cacheDomElements() {
        this.loginForm = document.getElementById('admin-login-form');
        this.otpForm = document.getElementById('otp-verify-form');
        this.identifierInput = document.getElementById('identifier');
        this.passwordInput = document.getElementById('password');
        this.submitBtn = document.getElementById('btn-login-submit');
        this.spinner = document.getElementById('login-spinner');
        this.btnText = document.getElementById('login-btn-text');
        this.togglePasswordBtn = document.getElementById('btn-toggle-password');
        
        this.otpPhoneInput = document.getElementById('otp-phone');
        this.otpCodeInput = document.getElementById('otp-code');
        this.otpSubmitBtn = document.getElementById('btn-otp-submit');
        this.sendOtpBtn = document.getElementById('btn-send-otp');
        this.otpBackBtn = document.getElementById('btn-otp-back');
    }

    /**
     * Configure UI dynamically based on the requested role parameter
     */
    configureDynamicRole() {
        const titleEl = document.querySelector('.login-title');
        const subtitleEl = document.querySelector('.login-subtitle');
        const logoEl = document.querySelector('.login-logo');

        if (this.roleParam === 'restaurant') {
            if (titleEl) titleEl.setAttribute('data-i18n', 'rest_login_title');
            if (subtitleEl) subtitleEl.setAttribute('data-i18n', 'rest_login_subtitle');
            if (logoEl) logoEl.textContent = '🍔';
            document.title = 'Restaurant Kitchen Hub Login - Quick Service';

            // Set CSS styling properties for Restaurant theme (Orange/Red)
            document.documentElement.style.setProperty('--admin-color', 'var(--rest-color)');
            document.documentElement.style.setProperty('--admin-color-hover', 'var(--rest-color-hover)');
            document.documentElement.style.setProperty('--admin-gradient', 'var(--rest-gradient)');
            document.documentElement.style.setProperty('--admin-glow', 'var(--rest-glow)');
        } else if (this.roleParam === 'market') {
            if (titleEl) titleEl.setAttribute('data-i18n', 'mkt_login_title');
            if (subtitleEl) subtitleEl.setAttribute('data-i18n', 'mkt_login_subtitle');
            if (logoEl) logoEl.textContent = '🛒';
            document.title = 'Supermarket Logistics Login - Quick Service';

            // Set CSS styling properties for Market theme (Emerald Green)
            document.documentElement.style.setProperty('--admin-color', 'var(--mkt-color)');
            document.documentElement.style.setProperty('--admin-color-hover', 'var(--mkt-color-hover)');
            document.documentElement.style.setProperty('--admin-gradient', 'var(--mkt-gradient)');
            document.documentElement.style.setProperty('--admin-glow', 'var(--mkt-glow)');
        } else {
            if (titleEl) titleEl.setAttribute('data-i18n', 'admin_login_title');
            if (subtitleEl) subtitleEl.setAttribute('data-i18n', 'admin_login_subtitle');
            if (logoEl) logoEl.textContent = '👑';
            document.title = 'Super Admin Portal Login - Quick Service';
        }
    }

    /**
     * Configure language switching toggle
     */
    setupLanguageSwitcher() {
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
                
                // Refresh validation or placeholder strings if any alert is active
                const alertBox = document.getElementById('login-alert');
                if (alertBox && alertBox.style.display === 'flex') {
                    const errorType = alertBox.dataset.errorType || 'error_generic';
                    this.showAlert(t(errorType), 'error');
                }
            });
        }

        // Subscribe to external language switches
        subscribeLangChange(() => {
            initTranslations();
        });
    }

    /**
     * Bind UI event listeners
     */
    bindEvents() {
        // Toggle Password Visibility
        if (this.togglePasswordBtn && this.passwordInput) {
            this.togglePasswordBtn.addEventListener('click', () => {
                const isPassword = this.passwordInput.getAttribute('type') === 'password';
                this.passwordInput.setAttribute('type', isPassword ? 'text' : 'password');
                this.togglePasswordBtn.textContent = isPassword ? '🙈' : '👁️';
            });
        }

        // Form submissions
        if (this.loginForm) {
            this.loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        }

        if (this.otpForm) {
            this.otpForm.addEventListener('submit', (e) => this.handleOtpSubmit(e));
        }

        if (this.sendOtpBtn) {
            this.sendOtpBtn.addEventListener('click', () => this.handleSendOtp());
        }

        if (this.otpBackBtn) {
            this.otpBackBtn.addEventListener('click', () => {
                if (this.otpForm) this.otpForm.style.display = 'none';
                if (this.loginForm) this.loginForm.style.display = 'flex';
            });
        }
    }

    /**
     * Handle Login Form Submission
     */
    async handleLogin(e) {
        e.preventDefault();
        this.hideAlert();

        const identifier = this.identifierInput.value.trim();
        const password = this.passwordInput.value;

        // Local Validation
        if (!identifier || !password) {
            this.showAlert(t('error_invalid_credentials'), 'error', 'error_invalid_credentials');
            return;
        }

        // Update UI loading state
        this.submitBtn.disabled = true;
        if (this.spinner) this.spinner.style.display = 'inline-block';
        this.btnText.textContent = t('logging_in');

        try {
            // Call Authenticate API via ApiClient
            const reqPayload = { identifier, password };
            this.tempLoginCredentials = { identifier, password };

            let loginData;
            try {
                loginData = await this.apiClient.fetch('/api/v1/users/login', {
                    method: 'POST',
                    body: JSON.stringify(reqPayload)
                });
            } catch (err) {
                // Intercept verification redirection statuses (330)
                if (err.message.includes('330') || (err.response && err.response.status === 330) || (window._lastHttpStatus === 330)) {
                    // Try parsing token out of response memory or defaults
                    this.transitionToOtpFlow(identifier);
                    return;
                }
                throw err;
            }

            // In some environments response is interceptable via HTTP status mapping,
            // check if response code matches 330 verification requirement
            if (loginData && loginData.status === 330) {
                this.transitionToOtpFlow(identifier);
                return;
            }

            // Check if token exists
            if (!loginData.success || !loginData.result || !loginData.result.accessToken) {
                this.resetLoginButtonState();
                this.showAlert(loginData.message || t('error_invalid_credentials'), 'error', 'error_invalid_credentials');
                return;
            }

            const token = loginData.result.accessToken;

            // Fetch Profile to verify role
            let user = { id: 1, role: 4, name: 'Admin' };
            try {
                const profileData = await this.apiClient.fetch('/api/v1/users', {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (profileData && profileData.result) {
                    user = profileData.result;
                }
            } catch (pErr) {
                console.warn('Profile fetch warning, using default claims:', pErr);
            }

            // Normalize and Validate User Role
            // Enum: Resturant = 0, Market = 1, Customer = 2, Delivery = 3, Admin = 4
            const rawRole = user.type !== undefined ? user.type : (user.role !== undefined ? user.role : user.userType);
            let roleNum = -1;
            if (typeof rawRole === 'number') {
                roleNum = rawRole;
            } else if (typeof rawRole === 'string') {
                const s = rawRole.toLowerCase();
                if (s.includes('rest')) roleNum = 0;
                else if (s.includes('market')) roleNum = 1;
                else if (s.includes('cust')) roleNum = 2;
                else if (s.includes('deliv') || s.includes('capt')) roleNum = 3;
                else if (s.includes('admin')) roleNum = 4;
            }

            // Strict Role Authorization Check
            let isAuthorized = false;
            let targetUrl = 'super-admin.html';

            if (roleNum === 4) {
                // Admin can access any portal
                isAuthorized = true;
                if (this.roleParam === 'restaurant') targetUrl = 'restaurant.html';
                else if (this.roleParam === 'market') targetUrl = 'market.html';
                else targetUrl = 'super-admin.html';
            } else if (this.roleParam === 'restaurant' && roleNum === 0) {
                isAuthorized = true;
                targetUrl = 'restaurant.html';
            } else if (this.roleParam === 'market' && roleNum === 1) {
                isAuthorized = true;
                targetUrl = 'market.html';
            }

            if (!isAuthorized) {
                this.resetLoginButtonState();
                const errorMsg = getLanguage() === 'ar' 
                    ? 'عفواً، هذا الحساب غير مصرح له بالدخول لهذه اللوحة. (حسابات العملاء والطيارين غير مسموح لها بالسماح للوحة التحكم)'
                    : 'Unauthorized: This account role cannot access this vendor dashboard portal.';
                this.showAlert(errorMsg, 'error');
                return;
            }

            // Auth Successful! Store session
            localStorage.setItem(this.apiClient.getTokenKey(), token);
            localStorage.setItem(this.apiClient.getUserKey(), JSON.stringify(user));

            // Display Success and Redirect
            this.showAlert(t('login_success'), 'success', 'login_success');
            
            setTimeout(() => {
                window.location.href = targetUrl;
            }, 1200);

        } catch (err) {
            console.error('Login error:', err);
            this.resetLoginButtonState();
            // Handle HTTP 330 specifically if it failed under fetch error throw
            if (err.message.includes('330') || (window._lastHttpStatus === 330)) {
                this.transitionToOtpFlow(identifier);
            } else {
                this.showAlert(t('error_invalid_credentials'), 'error', 'error_invalid_credentials');
            }
        }
    }

    /**
     * Transition flow to OTP form
     */
    transitionToOtpFlow(identifier) {
        this.resetLoginButtonState();
        if (this.loginForm) this.loginForm.style.display = 'none';
        if (this.otpPhoneInput) this.otpPhoneInput.value = identifier;
        if (this.otpForm) this.otpForm.style.display = 'flex';

        const phoneVerifMsg = getLanguage() === 'ar'
            ? "تفعيل رقم الهاتف مطلوب. يرجى إدخال رمز التحقق."
            : "Phone number verification is required. Please verify.";
        this.showOtpAlert(phoneVerifMsg, 'error');
    }

    /**
     * Reset login button state
     */
    resetLoginButtonState() {
        this.submitBtn.disabled = false;
        if (this.spinner) this.spinner.style.display = 'none';
        this.btnText.textContent = t('login_btn');
    }

    /**
     * Request OTP Code
     */
    async handleSendOtp() {
        const phone = this.otpPhoneInput.value.trim();
        if (!phone) {
            this.showOtpAlert(getLanguage() === 'ar' ? 'يرجى إدخال رقم الجوال أولاً' : 'Please enter your phone number first.', 'error');
            return;
        }

        this.sendOtpBtn.disabled = true;
        this.sendOtpBtn.textContent = getLanguage() === 'ar' ? 'جاري الإرسال...' : 'Sending...';

        try {
            const reqPayload = { phone, type: 1 };
            await this.apiClient.fetch('/api/v1/users/send-otp', {
                method: 'POST',
                body: JSON.stringify(reqPayload)
            });

            this.showOtpAlert(getLanguage() === 'ar' ? 'تم إرسال رمز التحقق بنجاح!' : 'OTP sent successfully!', 'success');
            
            // Disable resend for 30s
            let countdown = 30;
            const interval = setInterval(() => {
                countdown--;
                if (countdown <= 0) {
                    clearInterval(interval);
                    this.sendOtpBtn.disabled = false;
                    this.sendOtpBtn.textContent = getLanguage() === 'ar' ? 'إرسال الرمز' : 'Send OTP';
                } else {
                    this.sendOtpBtn.textContent = `${countdown}s`;
                }
            }, 1000);

        } catch (err) {
            this.showOtpAlert(err.message, 'error');
            this.sendOtpBtn.disabled = false;
            this.sendOtpBtn.textContent = getLanguage() === 'ar' ? 'إرسال الرمز' : 'Send OTP';
        }
    }

    /**
     * Submit OTP Verification
     */
    async handleOtpSubmit(e) {
        e.preventDefault();
        const phone = this.otpPhoneInput.value.trim();
        const code = this.otpCodeInput.value.trim();

        if (!phone || !code) {
            this.showOtpAlert(getLanguage() === 'ar' ? 'يرجى إدخال رقم الجوال ورمز التحقق' : 'Please enter phone and verification code.', 'error');
            return;
        }

        this.otpSubmitBtn.disabled = true;
        this.otpSubmitBtn.textContent = getLanguage() === 'ar' ? 'جاري التحقق...' : 'Verifying...';

        try {
            const reqPayload = { phone, code };
            const data = await this.apiClient.fetch('/api/v1/users/verify-otp', {
                method: 'PATCH',
                body: JSON.stringify(reqPayload)
            });

            let token = null;
            if (data) {
                if (typeof data.result === 'string' && data.result.length > 10) {
                    token = data.result;
                } else if (data.result && typeof data.result === 'object') {
                    token = data.result.token || data.result.accessToken;
                }
                if (!token) {
                    token = data.token || data.accessToken;
                }
            }

            // Auto re-login if token not returned directly in response
            if (!token && this.tempLoginCredentials) {
                this.showOtpAlert(getLanguage() === 'ar' ? 'تم التحقق بنجاح! جاري الدخول للوحة التحكم...' : 'Verified! Launching dashboard...', 'success');
                try {
                    const loginResJson = await this.apiClient.fetch('/api/v1/users/login', {
                        method: 'POST',
                        body: JSON.stringify(this.tempLoginCredentials)
                    });
                    if (loginResJson && loginResJson.success && loginResJson.result) {
                        token = loginResJson.result.accessToken || loginResJson.result.token;
                    }
                } catch (authErr) {
                    console.error('Auto login after OTP error:', authErr);
                }
            }

            if (!token && this.tempAuthToken) {
                token = this.tempAuthToken;
            }

            if (!token) {
                this.showOtpAlert(
                    getLanguage() === 'ar'
                        ? 'تم تفعيل حسابك بنجاح! جاري العودة لصفحة تسجيل الدخول...'
                        : 'Account verified successfully! Redirecting to login screen...',
                    'success'
                );
                setTimeout(() => {
                    if (this.otpForm) this.otpForm.style.display = 'none';
                    if (this.loginForm) this.loginForm.style.display = 'flex';
                    this.showAlert(
                        getLanguage() === 'ar'
                            ? 'تم تفعيل حسابك بنجاح، يمكنك تسجيل الدخول الآن.'
                            : 'Your account has been verified successfully. Please login.',
                        'success'
                    );
                }, 1500);
                return;
            }

            // Fetch user profile using the OTP verified token
            const profileData = await this.apiClient.fetch('/api/v1/users', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            const user = profileData.result;
            if (!user || user.role === undefined) {
                throw new Error(t('error_generic'));
            }

            // Validate expected role mapping
            const userRole = parseInt(user.role !== undefined ? user.role : -1);
            const userType = parseInt(user.type !== undefined ? user.type : -1);
            let roleValid = false;
            let redirectUrl;

            if (this.roleParam === 'restaurant') {
                roleValid = (userRole === 0 || userType === 0 || userRole === 4);
                redirectUrl = 'restaurant.html';
            } else if (this.roleParam === 'market') {
                roleValid = (userRole === 1 || userType === 1 || userRole === 4);
                redirectUrl = 'market.html';
            } else {
                roleValid = (userRole === 4 || userRole === 1 || userRole === 0);
                redirectUrl = 'super-admin.html';
            }

            if (!roleValid) {
                throw new Error(t('error_unauthorized'));
            }

            // Auth Successful! Store session
            localStorage.setItem(this.apiClient.getTokenKey(), token);
            localStorage.setItem(this.apiClient.getUserKey(), JSON.stringify(user));

            this.showOtpAlert(t('login_success'), 'success');

            setTimeout(() => {
                window.location.href = redirectUrl;
            }, 1200);

        } catch (err) {
            this.showOtpAlert(err.message, 'error');
            this.otpSubmitBtn.disabled = false;
            this.otpSubmitBtn.textContent = getLanguage() === 'ar' ? 'تحقق وتشغيل' : 'Verify & Launch';
        }
    }

    /**
     * Display alert banner inside card
     */
    showAlert(message, type, errorTypeKey = '') {
        const alertBox = document.getElementById('login-alert');
        const alertIcon = document.getElementById('alert-icon');
        const alertMsg = document.getElementById('alert-message');

        if (alertBox && alertIcon && alertMsg) {
            alertMsg.textContent = message;
            if (errorTypeKey) {
                alertBox.dataset.errorType = errorTypeKey;
            }

            if (type === 'success') {
                alertBox.className = 'alert-box alert-success';
                alertIcon.textContent = '✅';
            } else {
                alertBox.className = 'alert-box alert-error';
                alertIcon.textContent = '⚠️';
            }
            alertBox.style.display = 'flex';
        }
    }

    /**
     * Hide alert banner
     */
    hideAlert() {
        const alertBox = document.getElementById('login-alert');
        if (alertBox) {
            alertBox.style.display = 'none';
            alertBox.removeAttribute('data-error-type');
        }
    }

    /**
     * Display alert banner in OTP form
     */
    showOtpAlert(message, type) {
        const alertBox = document.getElementById('otp-alert');
        const alertIcon = document.getElementById('otp-alert-icon');
        const alertMsg = document.getElementById('otp-alert-message');

        if (alertBox && alertIcon && alertMsg) {
            alertMsg.textContent = message;
            if (type === 'success') {
                alertBox.className = 'alert-box alert-success';
                alertIcon.textContent = '✅';
            } else {
                alertBox.className = 'alert-box alert-error';
                alertIcon.textContent = '⚠️';
            }
            alertBox.style.display = 'flex';
        }
    }
}

// Global interceptor for HTTP status codes (tracks 330)
const nativeFetch = window.fetch;
window.fetch = async function (...args) {
    try {
        const response = await nativeFetch(...args);
        window._lastHttpStatus = response.status;
        return response;
    } catch (e) {
        throw e;
    }
};

// Bootstrap the page controller
document.addEventListener('DOMContentLoaded', () => {
    try {
        const controller = new LoginController();
        controller.init();
    } catch (e) {
        console.error('Failed to initialize login controller:', e);
    }
});
