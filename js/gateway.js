import { initTranslations, getLanguage, setLanguage } from './translations.js';
import { initTheme } from './ui-utils.js';

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initTranslations();
    
    const btn = document.getElementById('btn-lang-toggle');
    if (btn) {
        const updateButtonText = () => {
            const current = getLanguage();
            btn.textContent = current === 'en' ? 'العربية' : 'English';
        };
        
        updateButtonText();
        
        btn.addEventListener('click', () => {
            const nextLang = getLanguage() === 'en' ? 'ar' : 'en';
            setLanguage(nextLang);
            initTranslations();
            updateButtonText();
        });
    }
});
