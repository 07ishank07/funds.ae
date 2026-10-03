/**
 * Funds.ae language switch (English / Arabic), shared by every page.
 *
 * What it does
 *  - Adds an "العربية / English" toggle to the top-right of the masthead strip (and to the mobile header on the home page).
 *  - In Arabic mode: sets lang="ar" dir="rtl", loads an Arabic font, and translates the interface (navigation, section
 *    headings, buttons, form labels, footer). News headlines, listings and body copy stay in their original English.
 *  - Remembers the choice in localStorage. "?lang=ar" or "?lang=en" in the URL overrides it.
 *
 * To translate more text, add an exact English string (whitespace collapsed) to T below.
 * Text is matched one text node at a time, so keys must match the visible text exactly.
 */
(function () {
  'use strict';

  var T = {
    // Masthead and navigation
    'Connecting Talent, Opportunities and Intelligence': 'ربط المواهب والفرص والمعرفة',
    '← Back to Funds.ae home': 'العودة إلى الصفحة الرئيسية لـ Funds.ae →',
    'Discover. Connect. Grow.': 'اكتشف. تواصل. انمُ.',
    'Sunday 27 September 2026': 'الأحد 27 سبتمبر 2026',
    'Top news': 'أبرز الأخبار',
    'Events': 'الفعاليات',
    'Careers': 'الوظائف',
    'Advertise': 'الإعلان',
    'Sponsor': 'الرعاة',
    'About': 'عن الموقع',
    'Contact us': 'اتصل بنا',
    'Contact': 'اتصل بنا',
    // Footer
    'Headlines link to the original publishers.': 'تشير العناوين إلى الناشرين الأصليين.',
    '© 2026 Funds.ae. All rights reserved.': '© 2026 Funds.ae. جميع الحقوق محفوظة.',
    'Terms of Service': 'شروط الخدمة',
    'Privacy Policy': 'سياسة الخصوصية',
    // News column
    'UAE News': 'أخبار الإمارات',
    'Global News': 'أخبار عالمية',
    'Business Funding': 'تمويل الأعمال',
    'UAE News:': 'أخبار الإمارات:',
    'Global News:': 'أخبار عالمية:',
    'UAE Business Grants & Funding Resources': 'المنح ومصادر التمويل لأعمال الإمارات',
    'Other Funding Resources': 'مصادر تمويل أخرى',
    'Real Estate and Infrastructure News': 'أخبار العقارات والبنية التحتية',
    // Sidebar
    'Hiring in UAE finance?': 'توظّف في القطاع المالي بالإمارات؟',
    'Post a role (dummy)': 'انشر وظيفة (تجريبي)',
    'Post a role': 'انشر وظيفة',
    'UAE Careers': 'وظائف الإمارات',
    'Browse roles': 'تصفّح الوظائف',
    'Events and Expos': 'الفعاليات والمعارض',
    'Date': 'التاريخ',
    'Event Type': 'نوع الفعالية',
    'City': 'المدينة',
    'Submit your event': 'أضف فعاليتك',
    'Submit your event (dummy)': 'أضف فعاليتك (تجريبي)',
    'View All': 'عرض الكل',
    'Top Tweets': 'أبرز التغريدات',
    'UAE Thought Leaders and Influencers': 'قادة الفكر والمؤثرون في الإمارات',
    'Career Resources': 'مصادر مهنية',
    'Featured Companies': 'شركات مميزة',
    'Sponsored Posts': 'منشورات مموّلة',
    'Videos and Podcasts': 'فيديوهات وبودكاست',
    'Subscribe to stay ahead': 'اشترك لتبقى في المقدمة',
    'Subscribe': 'اشترك',
    'Email': 'البريد الإلكتروني',
    'Platinum Sponsors': 'الرعاة البلاتينيون',
    'Gold Sponsors': 'الرعاة الذهبيون',
    'Learn more': 'اعرف المزيد',
    'Fund research made clearer': 'أبحاث الصناديق أكثر وضوحًا',
    'Grow your UAE portfolio': 'نمِّ محفظتك في الإمارات',
    'Invest with local insight': 'استثمر برؤية محلية',
    'The future of private markets': 'مستقبل الأسواق الخاصة',
    'Connect with GCC capital': 'تواصل مع رأس المال الخليجي',
    // Events table
    'Nov': 'نوفمبر', 'Dec': 'ديسمبر', 'Jan': 'يناير',
    'Dubai': 'دبي', 'Abu Dhabi': 'أبوظبي',
    'Finance week': 'أسبوع التمويل', 'Fintech summit': 'قمة التقنية المالية', 'Technology expo': 'معرض التكنولوجيا',
    'Networking': 'لقاءات تواصل', 'Wealth summit': 'قمة الثروات', 'Sustainability expo': 'معرض الاستدامة',
    'Roundtable': 'طاولة مستديرة', 'Family office summit': 'قمة المكاتب العائلية', 'Digital assets expo': 'معرض الأصول الرقمية',
    // Sub-pages
    'About Funds.ae': 'عن Funds.ae',
    'Our mission': 'مهمتنا',
    'What we cover': 'ما نغطيه',
    'Our team': 'فريقنا',
    'Get in touch': 'تواصل معنا',
    'Contact us (dummy)': 'اتصل بنا (تجريبي)',
    'Send us a message': 'أرسل لنا رسالة',
    'Contact details': 'بيانات الاتصال',
    'Name': 'الاسم',
    'Subject': 'الموضوع',
    'Message': 'الرسالة',
    'Send message (dummy)': 'إرسال الرسالة (تجريبي)',
    'General enquiries': 'الاستفسارات العامة',
    'Press & media': 'الصحافة والإعلام',
    'Advertising & sponsorship': 'الإعلان والرعاية',
    'Phone': 'الهاتف',
    'Office': 'المكتب',
    'Advertise & Sponsor': 'الإعلان والرعاية',
    'Most popular': 'الأكثر شعبية',
    'Silver Sponsor': 'راعٍ فضي',
    'Gold Sponsor': 'راعٍ ذهبي',
    'Platinum Partner': 'شريك بلاتيني',
    'Get started (dummy)': 'ابدأ الآن (تجريبي)',
    'Events and Career Opportunities': 'الفعاليات والفرص الوظيفية',
    'Sponsored events': 'فعاليات مموّلة',
    'Current Opportunities': 'الفرص الحالية',
    'Previous': 'السابق',
    'Next': 'التالي',
    'Featured Employers': 'أبرز أصحاب العمل',
    'Apply (dummy)': 'قدّم الآن (تجريبي)',
    'Last updated 27 September 2026 (dummy)': 'آخر تحديث 27 سبتمبر 2026 (تجريبي)',
    'See also our': 'راجع أيضًا',
    // Live data (js/fundsae-connector.js)
    'Demo data': 'بيانات تجريبية',
    'Apply': 'قدّم الآن',
    '1 job': 'وظيفة واحدة',
    '{n} jobs': '{n} وظائف',
    'Show all roles': 'عرض كل الوظائف',
    'Nothing to show yet. Check back soon.': 'لا يوجد ما يُعرض بعد. تحقق لاحقًا.',
    'Feb': 'فبراير', 'Mar': 'مارس', 'Apr': 'أبريل', 'May': 'مايو', 'Jun': 'يونيو',
    'Jul': 'يوليو', 'Aug': 'أغسطس', 'Sep': 'سبتمبر', 'Oct': 'أكتوبر',
    'Sharjah': 'الشارقة',
    // Forms (js/fundsae-forms.js and the form pages)
    'Send message': 'إرسال الرسالة',
    'Get started': 'ابدأ الآن',
    'Sponsorship enquiry': 'طلب رعاية',
    'Company': 'الشركة',
    'Package': 'الباقة',
    'Message (optional)': 'الرسالة (اختياري)',
    'Send enquiry': 'إرسال الطلب',
    'Job title': 'المسمى الوظيفي',
    'Location': 'الموقع',
    'Link to apply': 'رابط التقديم',
    'Employment type (optional)': 'نوع التوظيف (اختياري)',
    'Not specified': 'غير محدد',
    'Your email': 'بريدك الإلكتروني',
    'Send role for review': 'إرسال الوظيفة للمراجعة',
    'Event name': 'اسم الفعالية',
    'Start date': 'تاريخ البدء',
    'End date (optional)': 'تاريخ الانتهاء (اختياري)',
    'Event website (optional)': 'موقع الفعالية (اختياري)',
    'Organiser': 'الجهة المنظمة',
    'Send event for review': 'إرسال الفعالية للمراجعة',
    'Sending…': 'جارٍ الإرسال…',
    'Thank you. Your message has been sent.': 'شكرًا لك. تم إرسال رسالتك.',
    'Thank you for subscribing.': 'شكرًا لاشتراكك.',
    'Thank you. Our partnerships team will be in touch.': 'شكرًا لك. سيتواصل معك فريق الشراكات.',
    'Thank you. We will review your event before it is listed.': 'شكرًا لك. سنراجع فعاليتك قبل نشرها.',
    'Thank you. We will review the role before it is listed.': 'شكرًا لك. سنراجع الوظيفة قبل نشرها.',
    'This demo site does not send forms yet. Nothing was sent.': 'هذا موقع تجريبي لا يرسل النماذج بعد. لم يُرسل أي شيء.',
    'Please check the highlighted fields.': 'يرجى مراجعة الحقول المحددة.',
    'Too many attempts. Please wait a few minutes and try again.': 'محاولات كثيرة. يرجى الانتظار بضع دقائق ثم المحاولة مجددًا.',
    'Your message is too long. Please shorten it.': 'رسالتك طويلة جدًا. يرجى اختصارها.',
    'Something went wrong. Please try again later.': 'حدث خطأ ما. يرجى المحاولة لاحقًا.',
    'The end date must be on or after the start date.': 'يجب أن يكون تاريخ الانتهاء في يوم البدء أو بعده.',
    // Field messages from the API (backend/src/validation/validate.js)
    'This field is required.': 'هذا الحقل مطلوب.',
    'Enter a valid email address.': 'أدخل بريدًا إلكترونيًا صحيحًا.',
    'Enter a link that starts with https://': 'أدخل رابطًا يبدأ بـ https://',
    'Enter a public website address.': 'أدخل عنوان موقع عام.',
    'Choose one of the listed options.': 'اختر أحد الخيارات المتاحة.',
  };

  // aria-label values such as "Sections", "Footer" and "Funds.ae home" are used as CSS/JS selectors, so they are never translated.
  var ATTRS = ['placeholder', 'aria-label', 'title'];
  var ATTR_T = {
    'Search news, funds and firms': 'ابحث في الأخبار والصناديق والشركات',
    'Search Funds.ae': 'ابحث في Funds.ae',
    'Search': 'بحث',
    'Open menu': 'فتح القائمة',
    'Your name (dummy)': 'اسمك (تجريبي)',
    'Write your message here (dummy)': 'اكتب رسالتك هنا (تجريبي)',
    "What's this about? (dummy)": 'ما موضوع رسالتك؟ (تجريبي)',
    'Your name': 'اسمك',
    "What's this about?": 'ما موضوع رسالتك؟',
    'Write your message here': 'اكتب رسالتك هنا',
    'e.g. DIFC, Dubai': 'مثال: مركز دبي المالي العالمي، دبي',
    'e.g. Roundtable': 'مثال: طاولة مستديرة',
  };

  var FONT_URL = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap';
  var lang = 'en';
  var applying = false;

  function readPref() {
    var q = /[?&]lang=(ar|en)\b/.exec(location.search);
    try {
      if (q) { localStorage.setItem('funds-lang', q[1]); return q[1]; }
      return localStorage.getItem('funds-lang') === 'ar' ? 'ar' : 'en';
    } catch (e) { return q ? q[1] : 'en'; }
  }
  function savePref(v) { try { localStorage.setItem('funds-lang', v); } catch (e) { /* private mode: choice lasts for this page only */ } }

  /** Translate an English UI string for the current language (used by page scripts that write their own text). */
  window.__fundsTr = function (s) { return lang === 'ar' && T[s] ? T[s] : s; };
  window.__fundsLang = function () { return lang; };

  function key(s) { return s.replace(/\s+/g, ' ').trim(); }

  function translateNode(n) {
    if (n.__fx_orig !== undefined) {
      // Already translated. Re-translate only if the page wrote new English text over it.
      if (T[key(n.nodeValue)] === undefined) return;
    }
    var k = key(n.nodeValue);
    if (!k || T[k] === undefined) return;
    n.__fx_orig = n.__fx_orig !== undefined ? n.__fx_orig : n.nodeValue;
    n.nodeValue = n.nodeValue.replace(k, T[k]);
  }
  function translateAttrs(el) {
    ATTRS.forEach(function (a) {
      var v = el.getAttribute(a);
      if (v == null) return;
      var orig = el.getAttribute('data-fx-orig-' + a);
      var src = orig != null ? orig : v;
      if (ATTR_T[src] === undefined) return;
      if (orig == null) el.setAttribute('data-fx-orig-' + a, v);
      el.setAttribute(a, ATTR_T[src]);
    });
  }
  function walk(root, fn, attrFn) {
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (n) {
        if (n.nodeType === 1 && /^(SCRIPT|STYLE|NOSCRIPT)$/.test(n.nodeName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 3) fn(n); else attrFn(n);
    }
  }
  function revert(root) {
    walk(root, function (n) {
      if (n.__fx_orig !== undefined) { n.nodeValue = n.__fx_orig; delete n.__fx_orig; }
    }, function (el) {
      ATTRS.forEach(function (a) {
        var orig = el.getAttribute('data-fx-orig-' + a);
        if (orig != null) { el.setAttribute(a, orig); el.removeAttribute('data-fx-orig-' + a); }
      });
    });
  }

  var CSS =
    /* Toggle button: quiet mono text, like the rest of the masthead strip */
    '.fx-lang{font:500 14px/1 "IBM Plex Sans Arabic","Segoe UI",Tahoma,"Jost",sans-serif;letter-spacing:0;text-transform:none;background:none;border:0;padding:2px 0;margin:0;color:#0E3A43;cursor:pointer;justify-self:end;white-space:nowrap}' +
    '.fx-lang:hover{color:#1F6A6E;text-decoration:underline;text-underline-offset:3px}' +
    '.fx-lang:focus-visible{outline:2px solid #1F6A6E;outline-offset:2px}' +
    '.fx-lang-m{font:600 14px/1 "Jost",sans-serif;background:none;border:0;color:#F1F5F4;height:44px;padding:0 10px;cursor:pointer}' +
    /* Arabic mode: font, no forced caps or letter-spacing (both break Arabic letter joining) */
    'html[lang="ar"] body,html[lang="ar"] body *:not(svg):not(svg *):not(a[aria-label="Funds.ae home"] *):not(.foot-brand *){font-family:"IBM Plex Sans Arabic","Segoe UI",Tahoma,sans-serif!important;letter-spacing:0!important;text-transform:none!important}' +
    'html[lang="ar"] body{line-height:1.7}' +
    /* Arabic needs a larger size than the 11px mono labels it replaces */
    'html[lang="ar"] :is(.topline,.fx-topline,label,.label-row,.events-headings,[data-city-heading],.updated){font-size:13px!important}' +
    /* Emails and phone numbers keep left-to-right order but sit on the right edge */
    'html[dir="rtl"] .contact-item .value{direction:ltr;text-align:right}' +
    /* English text inside the Arabic layout keeps its own word order (punctuation stays put) but aligns to the right edge */
    'html[dir="rtl"] :is(p,h2,h3){unicode-bidi:plaintext;text-align:right}' +
    'html[dir="rtl"] li a,html[dir="rtl"] .news article a{unicode-bidi:plaintext}' +
    /* Mirror the few places that use physical left/right */
    'html[dir="rtl"] .foot-nav{margin-left:0;margin-right:auto}' +
    'html[dir="rtl"] .topline>:last-child,html[dir="rtl"] .fx-topline>:last-child{text-align:left}' +
    'html[dir="rtl"] .fx-lang{justify-self:start}' +
    'html[dir="rtl"] section ul{margin:10px 20px 0 0}' +
    'html[dir="rtl"] [data-city-heading] span:last-child,html[dir="rtl"] section[aria-labelledby="events-title"] ul>li>span:last-child{text-align:left!important}' +
    'html[dir="rtl"] .events-headings span:last-child,html[dir="rtl"] .events-list .city{text-align:left}' +
    'html[dir="rtl"] .hdr-search svg{left:auto!important;right:14px}' +
    'html[dir="rtl"] #home-search{padding:0 42px 0 14px!important}' +
    '@media (min-width:981px){html[dir="rtl"] main.wrap>aside{border-left:0!important;border-right:1px solid var(--fx-line);padding-left:0!important;padding-right:var(--fx-col-gap)}}' +
    '@media (min-width:861px){html[dir="rtl"] .page>aside{border-left:0;border-right:1px solid var(--line);padding-left:0;padding-right:28px}}';

  function ensureStyle() {
    if (document.getElementById('fx-i18n-style')) return;
    var st = document.createElement('style');
    st.id = 'fx-i18n-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  function ensureFont() {
    if (document.getElementById('fx-i18n-font')) return;
    var l = document.createElement('link');
    l.id = 'fx-i18n-font';
    l.rel = 'stylesheet';
    l.href = FONT_URL;
    document.head.appendChild(l);
  }

  function updateButtons() {
    var toArabic = lang !== 'ar';
    document.querySelectorAll('.fx-lang, .fx-lang-m').forEach(function (b) {
      b.textContent = toArabic ? 'العربية' : 'English';
      b.setAttribute('lang', toArabic ? 'ar' : 'en');
      b.setAttribute('aria-label', toArabic ? 'Switch language to Arabic' : 'التبديل إلى الإنجليزية');
      b.setAttribute('data-fx-orig-aria-label', b.getAttribute('aria-label'));
    });
  }

  function apply(next) {
    applying = true;
    lang = next;
    var de = document.documentElement;
    de.setAttribute('lang', lang);
    de.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    if (lang === 'ar') {
      ensureFont();
      walk(document.body, translateNode, translateAttrs);
    } else {
      revert(document.body);
    }
    updateButtons();
    if (typeof window.__fundsRelang === 'function') window.__fundsRelang();
    applying = false;
  }

  /** Put the toggle where the masthead strip's right-hand slot is, plus a compact copy in the mobile header. */
  function mountButtons() {
    var slot = document.querySelector('.fx-topline > span:last-child, .topline > span:last-child');
    if (slot && !slot.querySelector('.fx-lang')) {
      slot.removeAttribute('aria-hidden');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'fx-lang';
      b.addEventListener('click', function () { var n = lang === 'ar' ? 'en' : 'ar'; savePref(n); apply(n); });
      slot.appendChild(b);
    }
    var mobile = document.querySelector('header.m-only > div:last-child');
    if (mobile && !mobile.querySelector('.fx-lang-m')) {
      var m = document.createElement('button');
      m.type = 'button';
      m.className = 'fx-lang-m';
      m.addEventListener('click', function () { var n = lang === 'ar' ? 'en' : 'ar'; savePref(n); apply(n); });
      mobile.insertBefore(m, mobile.firstChild);
    }
  }

  function start() {
    ensureStyle();
    mountButtons();
    apply(readPref());
    // Keep translating text the page adds later (news tabs, re-rendered lists).
    new MutationObserver(function (muts) {
      if (applying || lang !== 'ar') return;
      applying = true;
      muts.forEach(function (m) {
        if (m.type === 'characterData') translateNode(m.target);
        m.addedNodes.forEach(function (n) {
          if (n.nodeType === 3) translateNode(n);
          else if (n.nodeType === 1) { translateAttrs(n); walk(n, translateNode, translateAttrs); }
        });
      });
      applying = false;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
