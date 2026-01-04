/**
 * Internationalization (i18n) Module for QSL Card Generator
 * Supports German (de) and English (en) with localStorage persistence
 */

const i18n = (function() {
  const SUPPORTED_LANGS = ['de', 'en'];
  const DEFAULT_LANG = 'en';
  const STORAGE_KEY = 'qsl_language';

  let currentLang = DEFAULT_LANG;
  let translations = {};
  let initialized = false;

  /**
   * Detect user's preferred language
   */
  function detectLanguage() {
    // 1. Check localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED_LANGS.includes(stored)) {
      return stored;
    }

    // 2. Check browser language
    const browserLang = navigator.language?.split('-')[0];
    if (browserLang && SUPPORTED_LANGS.includes(browserLang)) {
      return browserLang;
    }

    // 3. Fallback to default
    return DEFAULT_LANG;
  }

  /**
   * Load translation file for a language
   */
  async function loadLocale(lang) {
    try {
      const response = await fetch(`/locales/${lang}.json`);
      if (!response.ok) throw new Error(`Failed to load ${lang}.json`);
      return await response.json();
    } catch (error) {
      console.error(`i18n: Failed to load locale ${lang}:`, error);
      return null;
    }
  }

  /**
   * Get nested value from object using dot notation
   */
  function getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : null;
    }, obj);
  }

  /**
   * Translate a key with optional parameter substitution
   * @param {string} key - Dot notation key (e.g., 'auth.signIn')
   * @param {object} params - Optional parameters for substitution (e.g., {name: 'John'})
   * @returns {string} Translated text or key if not found
   */
  function t(key, params = {}) {
    let text = getNestedValue(translations, key);

    if (text === null) {
      console.warn(`i18n: Missing translation for key: ${key}`);
      return key;
    }

    // Parameter substitution: {{param}}
    if (params && typeof text === 'string') {
      Object.keys(params).forEach(param => {
        text = text.replace(new RegExp(`{{${param}}}`, 'g'), params[param]);
      });
    }

    return text;
  }

  /**
   * Apply translations to all elements with data-i18n attribute
   */
  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const translated = t(key);

      // Handle different element types
      if (el.tagName === 'INPUT' && el.type !== 'submit' && el.type !== 'button') {
        if (el.placeholder !== undefined && el.getAttribute('data-i18n-placeholder')) {
          el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
        }
      } else if (el.tagName === 'OPTION') {
        el.textContent = translated;
      } else {
        // Use innerHTML if translation contains HTML tags, otherwise use textContent
        if (translated.includes('<') && translated.includes('>')) {
          el.innerHTML = translated;
        } else {
          el.textContent = translated;
        }
      }
    });

    // Handle placeholder attributes separately
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      el.placeholder = t(key);
    });

    // Handle title attributes
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      el.title = t(key);
    });

    // Update HTML lang attribute
    document.documentElement.lang = currentLang;

    // Update language switcher if present
    const langSwitch = document.getElementById('langSwitch');
    if (langSwitch) {
      langSwitch.value = currentLang;
    }
  }

  /**
   * Set the current language
   * @param {string} lang - Language code ('de' or 'en')
   */
  async function setLanguage(lang) {
    if (!SUPPORTED_LANGS.includes(lang)) {
      console.warn(`i18n: Unsupported language: ${lang}`);
      return false;
    }

    const newTranslations = await loadLocale(lang);
    if (!newTranslations) {
      return false;
    }

    translations = newTranslations;
    currentLang = lang;
    localStorage.setItem(STORAGE_KEY, lang);

    applyTranslations();

    // Dispatch custom event for components that need to react
    window.dispatchEvent(new CustomEvent('languagechange', { detail: { lang } }));

    return true;
  }

  /**
   * Initialize the i18n module
   */
  async function init() {
    if (initialized) return currentLang;

    currentLang = detectLanguage();
    translations = await loadLocale(currentLang);

    if (!translations) {
      // Fallback to default if detected language fails
      if (currentLang !== DEFAULT_LANG) {
        currentLang = DEFAULT_LANG;
        translations = await loadLocale(DEFAULT_LANG);
      }
    }

    if (!translations) {
      console.error('i18n: Failed to load any translations');
      translations = {};
    }

    initialized = true;
    applyTranslations();

    return currentLang;
  }

  /**
   * Get current language
   */
  function getLanguage() {
    return currentLang;
  }

  /**
   * Get all supported languages
   */
  function getSupportedLanguages() {
    return [...SUPPORTED_LANGS];
  }

  /**
   * Check if initialized
   */
  function isInitialized() {
    return initialized;
  }

  // Public API
  return {
    init,
    t,
    setLanguage,
    getLanguage,
    getSupportedLanguages,
    applyTranslations,
    isInitialized
  };
})();

// Export for module environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = i18n;
}
