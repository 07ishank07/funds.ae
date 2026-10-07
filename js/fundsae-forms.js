/*!
 * Funds.ae forms: sends every <form data-fundsae-form="<kind>"> to
 * POST /api/v1/submissions/<kind> (contact, newsletter, advertise, event, job).
 * Needs js/fundsae-api.js loaded first.
 *
 * - The browser checks the fields first (required, lengths, email/URL types).
 *   Those attributes mirror the server's rules in backend/src/validation/submissions.js.
 * - When the site is hosted without the API server (e.g. GitHub Pages), meta.json
 *   says forms are off: the form says so and nothing is sent or stored.
 * - Server field errors appear next to the field (aria-invalid + aria-describedby);
 *   the status line is an aria-live region.
 * - The hidden "website" field is a bot trap. People never see or fill it.
 */
(function () {
  'use strict';

  var api = window.FundsAeApi;
  var KINDS = ['contact', 'newsletter', 'advertise', 'event', 'job'];
  // Plain English; i18n.js translates these exact strings in Arabic mode.
  var SUCCESS = {
    contact: 'Thank you. Your message has been sent.',
    newsletter: 'Thank you for subscribing.',
    advertise: 'Thank you. Our partnerships team will be in touch.',
    event: 'Thank you. We will review your event before it is listed.',
    job: 'Thank you. We will review the role before it is listed.'
  };
  var MESSAGES = {
    sending: 'Sending…',
    offline: 'This demo site does not send forms yet. Nothing was sent.',
    invalid: 'Please check the highlighted fields.',
    tooMany: 'Too many attempts. Please wait a few minutes and try again.',
    tooLarge: 'Your message is too long. Please shorten it.',
    failed: 'Something went wrong. Please try again later.',
    endBeforeStart: 'The end date must be on or after the start date.'
  };

  var CSS =
    '.fx-hp{position:absolute!important;left:-10000px!important;top:auto!important;width:1px!important;height:1px!important;overflow:hidden!important}' +
    '.fx-form-status{margin:2px 0 0;min-height:1.4em;font-size:14px;line-height:1.5;color:#1F6A6E}' +
    '.fx-form-status:empty{display:none}' +
    '.fx-form-status[data-state="error"]{color:#9E4A2F}' +
    '.fx-field-error{margin:4px 0 0;font-size:13px;line-height:1.4;color:#9E4A2F}' +
    'form [aria-invalid="true"]{border-color:#9E4A2F!important}' +
    'form[aria-busy="true"] [type="submit"]{opacity:0.6;cursor:progress}';

  function ensureStyle() {
    if (document.getElementById('fx-forms-style')) return;
    var style = document.createElement('style');
    style.id = 'fx-forms-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  var capabilityPromise = null;
  /** True only when this site's API server accepts forms (meta.capabilities.submissions). */
  function submissionsEnabled() {
    if (!api) return Promise.resolve(false);
    if (!capabilityPromise) {
      capabilityPromise = api.meta().then(function (meta) {
        return !!(meta.capabilities && meta.capabilities.submissions === true);
      }, function () {
        capabilityPromise = null;
        return false;
      });
    }
    return capabilityPromise;
  }

  /** Named fields as trimmed strings; empty optional fields are left out. */
  function collect(form) {
    var data = {};
    Array.prototype.forEach.call(form.elements, function (field) {
      if (!field.name || field.disabled || /^(submit|button|reset|file)$/.test(field.type)) return;
      if ((field.type === 'checkbox' || field.type === 'radio') && !field.checked) return;
      var value = String(field.value || '').trim();
      if (value !== '') data[field.name] = value;
    });
    return data;
  }

  function setStatus(form, text, state) {
    var status = form.querySelector('[data-fundsae-form-status]');
    if (!status) return;
    status.textContent = text;
    if (state) status.setAttribute('data-state', state); else status.removeAttribute('data-state');
  }

  function clearErrors(form) {
    form.querySelectorAll('.fx-field-error').forEach(function (node) { node.remove(); });
    form.querySelectorAll('[aria-invalid]').forEach(function (field) {
      field.removeAttribute('aria-invalid');
      var original = field.getAttribute('data-fx-describedby');
      if (original) field.setAttribute('aria-describedby', original); else field.removeAttribute('aria-describedby');
      field.removeAttribute('data-fx-describedby');
    });
  }

  function showFieldErrors(form, fields) {
    var first = null;
    Object.keys(fields).forEach(function (name) {
      var field = form.elements.namedItem(name);
      if (!field || typeof field.setAttribute !== 'function' || field.type === 'hidden' || field.closest('.fx-hp')) return;
      var id = (form.getAttribute('data-fundsae-form') || 'form') + '-' + name + '-error';
      var message = document.createElement('p');
      message.className = 'fx-field-error';
      message.id = id;
      message.textContent = String(fields[name]);
      field.insertAdjacentElement('afterend', message);
      if (field.hasAttribute('aria-describedby')) field.setAttribute('data-fx-describedby', field.getAttribute('aria-describedby'));
      field.setAttribute('aria-describedby', ((field.getAttribute('data-fx-describedby') || '') + ' ' + id).trim());
      field.setAttribute('aria-invalid', 'true');
      first = first || field;
    });
    if (first) first.focus();
  }

  /** Checks the browser cannot express as attributes. */
  function extraChecks(form, kind) {
    if (kind !== 'event') return null;
    var start = form.elements.namedItem('startDate');
    var end = form.elements.namedItem('endDate');
    if (start && end && end.value && start.value && end.value < start.value) return { endDate: MESSAGES.endBeforeStart };
    return null;
  }

  function bind(form) {
    var kind = form.getAttribute('data-fundsae-form');
    if (KINDS.indexOf(kind) === -1 || form.hasAttribute('data-fundsae-bound')) return;
    form.setAttribute('data-fundsae-bound', '');
    form.noValidate = false;

    if (kind === 'event') {
      // Dates in the past make no sense for a new event.
      var today = api ? api.dubaiToday() : '';
      ['startDate', 'endDate'].forEach(function (name) {
        var field = form.elements.namedItem(name);
        if (field && today) field.min = today;
      });
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (form.getAttribute('aria-busy') === 'true') return;
      clearErrors(form);
      setStatus(form, '');
      if (typeof form.reportValidity === 'function' && !form.reportValidity()) return;
      var extra = extraChecks(form, kind);
      if (extra) {
        setStatus(form, MESSAGES.invalid, 'error');
        showFieldErrors(form, extra);
        return;
      }

      var button = form.querySelector('[type="submit"]');
      form.setAttribute('aria-busy', 'true');
      if (button) button.disabled = true;
      setStatus(form, MESSAGES.sending);

      submissionsEnabled().then(function (enabled) {
        if (!enabled) {
          setStatus(form, MESSAGES.offline, 'info');
          return null;
        }
        return api.submit(kind, collect(form)).then(function (res) {
          if (res.status === 202) {
            form.reset();
            setStatus(form, SUCCESS[kind], 'success');
            return;
          }
          var error = res.body && res.body.error;
          if (res.status === 400 && error && error.fields) {
            setStatus(form, MESSAGES.invalid, 'error');
            showFieldErrors(form, error.fields);
            return;
          }
          if (res.status === 429) return setStatus(form, MESSAGES.tooMany, 'error');
          if (res.status === 413) return setStatus(form, MESSAGES.tooLarge, 'error');
          setStatus(form, MESSAGES.failed, 'error');
        });
      }).catch(function () {
        setStatus(form, MESSAGES.failed, 'error');
      }).then(function () {
        form.removeAttribute('aria-busy');
        if (button) button.disabled = false;
      });
    });
  }

  /** Advertise page: "Get started" on a tier preselects it in the enquiry form. */
  function bindTierButtons() {
    document.querySelectorAll('[data-fundsae-tier]').forEach(function (button) {
      button.addEventListener('click', function () {
        var form = document.querySelector('[data-fundsae-form="advertise"]');
        if (!form) return;
        var select = form.elements.namedItem('tier');
        var tier = button.getAttribute('data-fundsae-tier');
        if (select && /^(silver|gold|platinum|exclusive)$/.test(tier)) select.value = tier;
        setTimeout(function () {
          var first = form.elements.namedItem('name');
          if (first) first.focus({ preventScroll: true });
        }, 0);
      });
    });
  }

  /** Careers page: #post-a-role and #submit-event open the matching <details> form. */
  function openFromHash() {
    var id = location.hash.slice(1);
    if (!/^[a-z0-9-]{1,40}$/.test(id)) return;
    var target = document.getElementById(id);
    if (target && target.tagName === 'DETAILS') {
      target.open = true;
      target.scrollIntoView({ block: 'start' });
      var summary = target.querySelector('summary');
      if (summary) summary.focus({ preventScroll: true });
    }
  }

  function start() {
    ensureStyle();
    document.querySelectorAll('form[data-fundsae-form]').forEach(bind);
    bindTierButtons();
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
