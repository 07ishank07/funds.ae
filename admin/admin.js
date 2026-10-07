/*
 * Funds.ae sponsor manager.
 * Reads and writes backend/config/sponsors.json and uploads images to
 * assets/sponsors/ through the GitHub REST API, using a fine-grained access
 * token that only the person using this page holds. After a save, the
 * "Publish sponsors" GitHub Action validates the file and updates the site.
 */
(function () {
  'use strict';

  var CONFIG_PATH = 'backend/config/sponsors.json';
  var ASSET_DIR = 'assets/sponsors';
  var MAX_IMAGE_BYTES = 500 * 1024;
  var IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  var HEX = /^#[0-9a-f]{6}$/i;
  var STORE_KEY = 'fundsae-sponsor-admin';

  // One group per sponsor area on the website. Field names and limits match
  // backend/src/pipeline/sponsors.js (SLOT_RULES), which validates the file again before publishing.
  var LOGO_HINT = 'Square PNG, JPG or WebP up to 500 KB.';
  var GROUPS = [
    {
      key: 'founding', label: 'Elite founding sponsor', noun: 'sponsor', prefix: 'founding', max: 1,
      where: 'The banner directly under the masthead on every page except Careers. Leave this empty to show the “Your firm here” advert for the slot.',
      fields: [
        { name: 'title', label: 'Sponsor name', type: 'text', max: 60, required: true },
        { name: 'blurb', label: 'One-line message', type: 'textarea', max: 140, hint: 'Hidden on phones.' },
        { name: 'url', label: 'Link', type: 'url' },
        { name: 'image', label: 'Logo (optional)', type: 'image', hint: LOGO_HINT + ' Shown 28 pixels high, next to the name.' }
      ],
      defaults: { title: '', blurb: '', url: '#', image: null }
    },
    {
      key: 'platinum', label: 'Elite partners', noun: 'partner', prefix: 'platinum', max: 5,
      where: 'Home page, top of the middle column, under “Elite Partners” (5 tiles).',
      fields: [
        { name: 'title', label: 'Sponsor name', type: 'text', max: 60, required: true },
        { name: 'url', label: 'Link', type: 'url' },
        { name: 'image', label: 'Background image (optional)', type: 'image', hint: 'Wide image up to 500 KB.' },
        { row: [
          { name: 'colorFrom', label: 'Tile colour (optional)', type: 'color' },
          { name: 'colorTo', label: 'Fades into', type: 'color' }
        ] }
      ],
      defaults: { title: '', url: '#', image: null, colorFrom: null, colorTo: null }
    },
    {
      key: 'gold', label: 'Gold sponsors', noun: 'sponsor', prefix: 'gold', max: 10,
      where: 'Home page right-hand column, under “Gold Sponsors” (10 tiles).',
      fields: [
        { name: 'title', label: 'Tagline', type: 'text', max: 70, required: true },
        { name: 'url', label: 'Link', type: 'url' },
        { name: 'image', label: 'Background image (optional)', type: 'image', hint: 'Wide image up to 500 KB.' },
        { row: [
          { name: 'colorFrom', label: 'Tile colour (optional)', type: 'color' },
          { name: 'colorTo', label: 'Fades into', type: 'color' }
        ] },
        { name: 'label', label: 'Small label', type: 'text', max: 20 }
      ],
      defaults: { title: '', url: '#', image: null, colorFrom: null, colorTo: null, label: 'Sponsored' }
    },
    {
      key: 'sponsoredPosts', label: 'Sponsored posts', noun: 'post', prefix: 'post', max: 15,
      where: 'Home page, right-hand column, under “Sponsored Posts”.',
      fields: [
        { name: 'title', label: 'Headline', type: 'text', max: 90, required: true },
        { name: 'blurb', label: 'Short description', type: 'textarea', max: 160 },
        { name: 'url', label: 'Link', type: 'url' },
        { name: 'image', label: 'Logo', type: 'image', hint: LOGO_HINT + ' Shown at 28 × 28 pixels.' },
        { row: [
          { name: 'logoText', label: 'Initials when there is no logo', type: 'text', max: 4 },
          { name: 'colorFrom', label: 'Initials background', type: 'color' }
        ] }
      ],
      defaults: { title: '', blurb: '', url: '#', image: null, logoText: '', colorFrom: '#1F6A6E' }
    },
    {
      key: 'sponsoredMedia', label: 'Videos and podcasts', noun: 'video', prefix: 'media', max: 15,
      where: 'Home page, right-hand column, under “Videos and Podcasts”.',
      fields: [
        { name: 'title', label: 'Title', type: 'text', max: 90, required: true },
        { name: 'blurb', label: 'Short description', type: 'textarea', max: 160 },
        { name: 'url', label: 'Link to the video or episode', type: 'url' },
        { row: [
          { name: 'label', label: 'Small label', type: 'text', max: 20, hint: 'For example VIDEO or PODCAST' },
          { name: 'image', label: 'Thumbnail', type: 'image', hint: '16:9 image up to 500 KB.' }
        ] }
      ],
      defaults: { title: '', blurb: '', url: '#', label: 'VIDEO', image: null }
    },
    {
      key: 'professionalServices', label: 'Featured companies', noun: 'company', prefix: 'service', max: 15,
      where: 'Home page, right-hand column, under “Featured Companies”, and the scrolling strip at the bottom of the Careers page.',
      fields: [
        { name: 'title', label: 'Company name', type: 'text', max: 70, required: true },
        { name: 'website', label: 'Website shown under the name (text only)', type: 'text', max: 80, hint: 'For example www.example.ae' },
        { name: 'url', label: 'Link', type: 'url' },
        { name: 'image', label: 'Logo', type: 'image', hint: LOGO_HINT + ' Shown at 34 × 34 pixels, and 44 × 44 on the Careers page.' },
        { row: [
          { name: 'logoText', label: 'Initials when there is no logo', type: 'text', max: 4 },
          { name: 'colorFrom', label: 'Initials background', type: 'color' },
          { name: 'colorTo', label: 'Fades into', type: 'color' }
        ] }
      ],
      defaults: { title: '', website: '', url: '#', image: null, logoText: '', colorFrom: '#0E3A43', colorTo: '#4FB3B8' }
    },
    {
      key: 'careerResources', label: 'Career resources', noun: 'resource', prefix: 'resource', max: 12,
      where: 'Home page middle column and the Careers page, under “Career Resources”. Editorial links, not marked as sponsored.',
      fields: [
        { name: 'title', label: 'Resource name', type: 'text', max: 70, required: true },
        { name: 'url', label: 'Link', type: 'url' },
        { row: [
          { name: 'logoText', label: 'Short label on the tile', type: 'text', max: 5 },
          { name: 'colorFrom', label: 'Tile colour', type: 'color' },
          { name: 'colorTo', label: 'Fades into', type: 'color' }
        ] }
      ],
      defaults: { title: '', url: '#', logoText: '', colorFrom: '#0E3A43', colorTo: '#4FB3B8' }
    }
  ];

  // Files saved by an older version of this page used other names. Convert them
  // on load so the next save passes the backend's checks.
  var LEGACY_FIELDS = { headline: 'title', name: 'title', tag: 'label', logo: 'image', thumbnail: 'image', logoBackground: 'colorFrom' };
  function migrateLegacy(data) {
    if (Array.isArray(data.banners)) {
      data.gold = (data.gold || []).concat(data.banners);
      delete data.banners;
    }
    GROUPS.forEach(function (g) {
      (data[g.key] || []).forEach(function (item) {
        Object.keys(LEGACY_FIELDS).forEach(function (old) {
          if (!(old in item)) return;
          if (item[LEGACY_FIELDS[old]] === undefined || item[LEGACY_FIELDS[old]] === null || item[LEGACY_FIELDS[old]] === '') item[LEGACY_FIELDS[old]] = item[old];
          delete item[old];
        });
      });
    });
    return data;
  }

  var state = {
    owner: '', repo: '', branch: 'main', token: '',
    sha: null, data: null, pending: {}, previews: {},
    dirty: false, active: GROUPS[0].key, errors: {}
  };

  /* -------------------------------- helpers -------------------------------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function groupDef(key) { return GROUPS.filter(function (g) { return g.key === key; })[0]; }
  function flatFields(g) {
    var out = [];
    g.fields.forEach(function (f) { if (f.row) out.push.apply(out, f.row); else out.push(f); });
    return out;
  }
  function itemName(g, item) { return item[g.fields[0].name] || 'Untitled ' + g.noun; }

  function b64encodeText(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decodeText(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function showStatus(message, kind, list) {
    var s = $('status');
    s.textContent = '';
    s.className = 'status' + (kind === 'error' ? ' error' : '');
    s.appendChild(el('span', null, message));
    if (list && list.length) {
      var ul = el('ul');
      list.slice(0, 12).forEach(function (m) { ul.appendChild(el('li', null, m)); });
      s.appendChild(ul);
    }
    s.hidden = false;
    s.scrollIntoView({ block: 'nearest' });
  }
  function statusLink(message, href, linkText) {
    var s = $('status');
    s.textContent = '';
    s.className = 'status';
    s.appendChild(el('span', null, message + ' '));
    var a = el('a', null, linkText);
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    s.appendChild(a);
    s.hidden = false;
  }

  function setDirty(v) {
    state.dirty = v;
    $('dirty').hidden = !v;
    $('save').disabled = !v;
  }

  function imageSrc(value) {
    if (!value) return null;
    if (state.previews[value]) return state.previews[value];
    if (/^assets\/sponsors\/[A-Za-z0-9._-]+$/.test(value)) return '../' + value;
    if (/^https:\/\/[^\s"'()<>]+$/.test(value)) return value;
    return null;
  }

  /* ------------------------------ GitHub API ------------------------------ */
  function explain(status, msg) {
    if (status === 401) return 'GitHub did not accept the token. Check it was copied in full and has not expired.';
    if (status === 403) return 'The token is not allowed to do this. It needs Contents set to Read and write for this repository.';
    if (status === 404) return 'Could not find the repository, branch or sponsors file. Check the names, and that the token was given access to this repository.';
    if (status === 409 || status === 412) return 'The sponsors file changed on GitHub after you opened it. Reload this page to get the latest version, then make your edits again.';
    if (status === 422) return 'GitHub refused the change' + (msg ? ': ' + msg : '.');
    return 'GitHub returned error ' + status + (msg ? ': ' + msg : '.');
  }

  function gh(method, path, body) {
    return fetch('https://api.github.com' + path, {
      method: method,
      cache: 'no-store',
      headers: Object.assign({
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: 'Bearer ' + state.token
      }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      if (res.ok) return res.json();
      return res.json().catch(function () { return {}; }).then(function (j) {
        var err = new Error(explain(res.status, j && j.message));
        err.status = res.status;
        throw err;
      });
    }, function () {
      throw new Error('Could not reach GitHub. Check your internet connection, or whether your network blocks api.github.com.');
    });
  }

  function repoPath(p) {
    return '/repos/' + encodeURIComponent(state.owner) + '/' + encodeURIComponent(state.repo) + '/contents/' +
      p.split('/').map(encodeURIComponent).join('/');
  }

  /* -------------------------------- connect -------------------------------- */
  function guessRepo() {
    var host = location.hostname;
    if (/\.github\.io$/i.test(host)) {
      var owner = host.split('.')[0];
      var first = location.pathname.split('/').filter(Boolean)[0];
      return { owner: owner, repo: first && first !== 'admin' ? first : host };
    }
    return { owner: '', repo: '' };
  }

  function loadRemembered() {
    try {
      var saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
      if (saved) return saved;
    } catch (e) { /* ignore */ }
    return null;
  }

  function connect() {
    state.owner = $('owner').value.trim();
    state.repo = $('repo').value.trim();
    state.branch = $('branch').value.trim() || 'main';
    state.token = $('token').value.trim();
    if (!state.owner || !state.repo || !state.token) {
      return showStatus('Fill in the username, repository name and access token.', 'error');
    }
    $('connect-btn').disabled = true;
    showStatus('Connecting to GitHub…');
    gh('GET', repoPath(CONFIG_PATH) + '?ref=' + encodeURIComponent(state.branch)).then(function (file) {
      var data;
      try { data = JSON.parse(b64decodeText(file.content)); }
      catch (e) { throw new Error('The sponsors file on GitHub is not valid JSON. Fix it in the editor first.'); }
      migrateLegacy(data);
      GROUPS.forEach(function (g) { if (!Array.isArray(data[g.key])) data[g.key] = []; });
      state.data = data;
      state.sha = file.sha;
      if ($('remember').checked) {
        sessionStorage.setItem(STORE_KEY, JSON.stringify({ owner: state.owner, repo: state.repo, branch: state.branch, token: state.token }));
      } else {
        sessionStorage.setItem(STORE_KEY, JSON.stringify({ owner: state.owner, repo: state.repo, branch: state.branch }));
      }
      $('token').value = '';
      $('connect').hidden = true;
      $('editor').hidden = false;
      $('save').hidden = false;
      $('sign-out').hidden = false;
      $('repo-label').hidden = false;
      $('repo-label').textContent = state.owner + '/' + state.repo + ' · ' + state.branch;
      $('status').hidden = true;
      setDirty(false);
      render();
    }).catch(function (err) {
      showStatus(err.message, 'error');
    }).then(function () { $('connect-btn').disabled = false; });
  }

  function disconnect() {
    if (state.dirty && !confirm('You have unsaved changes. Disconnect anyway?')) return;
    sessionStorage.removeItem(STORE_KEY);
    location.reload();
  }

  /* ------------------------------- validation ------------------------------- */
  function validateItem(g, item) {
    var errs = {};
    flatFields(g).forEach(function (f) {
      var v = item[f.name];
      var s = v === null || v === undefined ? '' : String(v).trim();
      if (f.required && !s) errs[f.name] = 'Required.';
      if (f.max && s.length > f.max) errs[f.name] = s.length + ' characters; the limit is ' + f.max + '.';
      if (f.type === 'url' && s && s !== '#') {
        var ok = false;
        try { ok = new URL(s).protocol === 'https:'; } catch (e) { ok = false; }
        if (!ok) errs[f.name] = 'Must start with https:// (or use # for no link yet).';
      }
      if (f.type === 'color' && s && !HEX.test(s)) errs[f.name] = 'Pick a colour.';
    });
    return errs;
  }

  function validateAll() {
    var problems = [];
    state.errors = {};
    GROUPS.forEach(function (g) {
      state.data[g.key].forEach(function (item, i) {
        var errs = validateItem(g, item);
        Object.keys(errs).forEach(function (field) {
          state.errors[g.key + ':' + i + ':' + field] = errs[field];
          problems.push({ group: g.key, text: g.label + ', ' + itemName(g, item) + ': ' + field + ' – ' + errs[field] });
        });
      });
    });
    return problems;
  }

  /* -------------------------------- previews -------------------------------- */
  function logoPreview(item, background) {
    var src = imageSrc(item.image);
    if (src) {
      var img = el('img', 'pv-logo');
      img.src = src; img.alt = '';
      img.style.border = '1px solid #DCE5E3';
      return img;
    }
    var box = el('span', 'pv-logo', item.logoText || '');
    box.style.background = background;
    return box;
  }

  function gradient(item, from, to) {
    return 'linear-gradient(145deg, ' + (HEX.test(item.colorFrom || '') ? item.colorFrom : from) + ', ' + (HEX.test(item.colorTo || '') ? item.colorTo : to) + ')';
  }
  function tilePreview(item, from, to, cls) {
    var tile = el('div', 'pv-banner ' + (cls || ''));
    var src = imageSrc(item.image);
    tile.style.background = src
      ? 'linear-gradient(145deg, rgba(14, 58, 67, 0.55), rgba(14, 58, 67, 0.2)), url("' + src + '") center / cover no-repeat'
      : gradient(item, from, to);
    tile.appendChild(el('strong', null, item.title || 'Title'));
    return tile;
  }

  var PREVIEWS = {
    founding: function (item) {
      var frame = el('div', 'pv-founding');
      var id = el('div', 'pv-founding-id');
      id.appendChild(el('span', 'pv-founding-label', 'Elite Founding Sponsor'));
      var brand = el('div', 'pv-founding-brand');
      var src = imageSrc(item.image);
      if (src) { var img = el('img', 'pv-founding-logo'); img.src = src; img.alt = ''; brand.appendChild(img); }
      brand.appendChild(el('span', 'pv-founding-name', item.title || 'Sponsor name'));
      id.appendChild(brand);
      frame.appendChild(id);
      if (item.blurb) frame.appendChild(el('p', 'pv-founding-pitch', item.blurb));
      frame.appendChild(el('span', 'pv-founding-cta', 'Learn more →'));
      return frame;
    },
    platinum: function (item) { return tilePreview(item, '#F1F3F4', '#B9C0C6', 'light'); },
    gold: function (item) { return tilePreview(item, '#DDB86F', '#B88B3E', 'light'); },
    sponsoredPosts: function (item) {
      var panel = el('div', 'pv-panel');
      var row = el('div', 'pv-post');
      row.appendChild(logoPreview(item, HEX.test(item.colorFrom || '') ? item.colorFrom : '#1F6A6E'));
      var body = el('div');
      body.appendChild(el('span', 'pv-title', item.title || 'Headline'));
      if (item.blurb) body.appendChild(el('p', 'pv-blurb', item.blurb));
      row.appendChild(body);
      panel.appendChild(row);
      return panel;
    },
    sponsoredMedia: function (item) {
      var panel = el('div', 'pv-panel plain');
      var head = el('div', 'pv-media-head');
      var src = imageSrc(item.image);
      if (src) { var img = el('img', 'pv-thumb'); img.src = src; img.alt = ''; head.appendChild(img); }
      else head.appendChild(el('span', 'pv-icon', '\u25BA'));
      if (item.label) head.appendChild(el('span', 'pv-label', item.label));
      panel.appendChild(head);
      panel.appendChild(el('span', 'pv-title', item.title || 'Title'));
      if (item.blurb) panel.appendChild(el('p', 'pv-blurb', item.blurb));
      return panel;
    },
    professionalServices: function (item) {
      var panel = el('div', 'pv-panel plain');
      var row = el('div', 'pv-service');
      row.appendChild(logoPreview(item, gradient(item, '#0E3A43', '#4FB3B8')));
      var text = el('span');
      text.appendChild(el('b', null, item.title || 'Company name'));
      if (item.website) text.appendChild(el('small', null, item.website));
      row.appendChild(text);
      panel.appendChild(row);
      return panel;
    },
    careerResources: function (item) {
      var panel = el('div', 'pv-panel plain');
      var row = el('div', 'pv-service');
      var box = el('span', 'pv-logo', item.logoText || '');
      box.style.background = gradient(item, '#0E3A43', '#4FB3B8');
      row.appendChild(box);
      var text = el('span');
      text.appendChild(el('b', null, item.title || 'Resource name'));
      row.appendChild(text);
      panel.appendChild(row);
      return panel;
    }
  };

  /* --------------------------------- fields --------------------------------- */
  function fieldId(g, i, name) { return 'f-' + g.key + '-' + i + '-' + name; }

  function buildField(g, item, i, f, refresh) {
    var wrap = el('div', 'field');
    var id = fieldId(g, i, f.name);
    var label = el('label', null, f.label);
    label.htmlFor = id;
    wrap.appendChild(label);
    var errKey = g.key + ':' + i + ':' + f.name;
    var errEl = el('span', 'error');
    errEl.id = id + '-err';

    function setError(msg) {
      errEl.textContent = msg || '';
      errEl.hidden = !msg;
      var input = wrap.querySelector('input:not([type="file"]):not([type="color"]), textarea');
      if (input) {
        if (msg) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', errEl.id); }
        else { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); }
      }
    }
    function onChange(value) {
      item[f.name] = value;
      setDirty(true);
      var errs = validateItem(g, item);
      setError(errs[f.name]);
      refresh();
    }

    if (f.type === 'text' || f.type === 'url' || f.type === 'textarea') {
      var input = f.type === 'textarea' ? el('textarea') : el('input');
      if (f.type !== 'textarea') input.type = f.type === 'url' ? 'url' : 'text';
      input.id = id;
      input.value = item[f.name] || '';
      if (f.max) input.maxLength = f.max + 40; // allow typing past the limit so the message can explain it
      if (f.type === 'url') input.placeholder = 'https://';
      input.addEventListener('input', function () { onChange(input.value); });
      wrap.appendChild(input);
    } else if (f.type === 'color') {
      var c = el('div', 'color-input');
      var picker = el('input');
      picker.type = 'color';
      picker.id = id;
      picker.value = HEX.test(item[f.name] || '') ? item[f.name] : '#137A72';
      var code = el('span', null, picker.value.toUpperCase());
      picker.addEventListener('input', function () { code.textContent = picker.value.toUpperCase(); onChange(picker.value.toUpperCase()); });
      c.appendChild(picker);
      c.appendChild(code);
      wrap.appendChild(c);
    } else if (f.type === 'image') {
      var box = el('div', 'image-field');
      var thumb = el('div', 'thumb');
      function paintThumb() {
        var src = imageSrc(item[f.name]);
        thumb.className = 'thumb' + (src ? '' : ' empty');
        thumb.style.backgroundImage = src ? 'url("' + src + '")' : '';
      }
      paintThumb();
      var controls = el('div');
      var file = el('input');
      file.type = 'file';
      file.id = id;
      file.accept = 'image/png,image/jpeg,image/webp';
      var remove = el('button', 'link-btn danger', 'Remove image');
      remove.type = 'button';
      remove.hidden = !item[f.name];
      file.addEventListener('change', function () {
        var chosen = file.files && file.files[0];
        if (!chosen) return;
        var ext = IMAGE_TYPES[chosen.type];
        if (!ext) { setError('Use a PNG, JPG or WebP image. SVG is not allowed for security reasons.'); file.value = ''; return; }
        if (chosen.size > MAX_IMAGE_BYTES) { setError('This image is ' + Math.round(chosen.size / 1024) + ' KB; the limit is 500 KB. Resize or compress it first.'); file.value = ''; return; }
        var reader = new FileReader();
        reader.onload = function () {
          var dataUrl = String(reader.result);
          var path = ASSET_DIR + '/' + item.id + '-' + Date.now().toString(36) + '.' + ext;
          state.pending[path] = dataUrl.slice(dataUrl.indexOf(',') + 1);
          state.previews[path] = dataUrl;
          setError('');
          remove.hidden = false;
          onChange(path);
          paintThumb();
        };
        reader.onerror = function () { setError('Could not read that file.'); };
        reader.readAsDataURL(chosen);
      });
      remove.addEventListener('click', function () {
        file.value = '';
        remove.hidden = true;
        onChange(null);
        paintThumb();
      });
      controls.appendChild(file);
      controls.appendChild(el('br'));
      controls.appendChild(remove);
      box.appendChild(thumb);
      box.appendChild(controls);
      wrap.appendChild(box);
    }
    if (f.hint) wrap.appendChild(el('span', 'hint', f.hint));
    wrap.appendChild(errEl);
    setError(state.errors[errKey]);
    return wrap;
  }

  /* --------------------------------- render --------------------------------- */
  function renderGroups() {
    var list = $('group-list');
    list.textContent = '';
    GROUPS.forEach(function (g) {
      var li = el('li');
      var b = el('button');
      b.type = 'button';
      b.appendChild(el('span', null, g.label));
      b.appendChild(el('span', 'count', String(state.data[g.key].filter(function (x) { return x.enabled !== false; }).length)));
      if (g.key === state.active) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', function () { state.active = g.key; render(); $('group-title').focus(); });
      li.appendChild(b);
      list.appendChild(li);
    });
  }

  function renderItems() {
    var g = groupDef(state.active);
    var items = state.data[g.key];
    $('group-title').textContent = g.label;
    $('group-title').tabIndex = -1;
    $('group-where').textContent = g.where;
    $('add-item').textContent = 'Add ' + g.noun;
    var host = $('items');
    host.textContent = '';
    if (!items.length) {
      host.appendChild(el('p', 'empty-state', 'Nothing here yet. Use “Add ' + g.noun + '” to create the first one.'));
      return;
    }
    items.forEach(function (item, i) {
      var row = el('article', 'item' + (item.enabled === false ? ' off' : ''));
      var head = el('div', 'item-head');
      var h2 = el('h2', null, itemName(g, item));
      head.appendChild(h2);

      var showWrap = el('label', 'check');
      var show = el('input');
      show.type = 'checkbox';
      show.checked = item.enabled !== false;
      show.addEventListener('change', function () {
        item.enabled = show.checked;
        row.className = 'item' + (show.checked ? '' : ' off');
        setDirty(true);
        renderGroups();
      });
      showWrap.appendChild(show);
      showWrap.appendChild(document.createTextNode('Show on site'));
      head.appendChild(showWrap);

      [['Move up', -1], ['Move down', 1]].forEach(function (m) {
        var b = el('button', 'link-btn', m[0]);
        b.type = 'button';
        b.disabled = (m[1] < 0 && i === 0) || (m[1] > 0 && i === items.length - 1);
        b.addEventListener('click', function () {
          var j = i + m[1];
          var tmp = items[i]; items[i] = items[j]; items[j] = tmp;
          state.errors = {};
          setDirty(true);
          renderItems();
        });
        head.appendChild(b);
      });
      var del = el('button', 'link-btn danger', 'Remove');
      del.type = 'button';
      del.addEventListener('click', function () {
        if (!confirm('Remove “' + itemName(g, item) + '”? It disappears from the site after you save.')) return;
        items.splice(i, 1);
        state.errors = {};
        setDirty(true);
        render();
      });
      head.appendChild(del);
      row.appendChild(head);

      var form = el('div', 'form');
      var preview = el('div', 'preview');
      preview.appendChild(el('p', 'preview-label', 'How it looks on the site'));
      var slot = el('div');
      preview.appendChild(slot);
      function refresh() {
        slot.textContent = '';
        slot.appendChild(PREVIEWS[g.key](item));
        h2.textContent = itemName(g, item);
      }
      g.fields.forEach(function (f) {
        if (f.row) {
          var r = el('div', 'field-row');
          f.row.forEach(function (sub) { r.appendChild(buildField(g, item, i, sub, refresh)); });
          form.appendChild(r);
        } else {
          form.appendChild(buildField(g, item, i, f, refresh));
        }
      });
      refresh();
      row.appendChild(form);
      row.appendChild(preview);
      host.appendChild(row);
    });
  }

  function render() {
    renderGroups();
    renderItems();
  }

  function addItem() {
    var g = groupDef(state.active);
    var shown = state.data[g.key].filter(function (i) { return i.enabled !== false; }).length;
    if (g.max && shown >= g.max) {
      return showStatus('The page has room for ' + g.max + ' ' + g.label.toLowerCase() + '. Hide or remove one before adding another.', 'error');
    }
    var item = Object.assign({ id: g.prefix + '-' + Date.now().toString(36), enabled: true }, JSON.parse(JSON.stringify(g.defaults)));
    state.data[g.key].push(item);
    setDirty(true);
    render();
    var first = document.getElementById(fieldId(g, state.data[g.key].length - 1, flatFields(g)[0].name));
    if (first) { first.focus(); first.scrollIntoView({ block: 'center' }); }
  }

  /* ---------------------------------- save ---------------------------------- */
  function save() {
    var problems = validateAll();
    if (problems.length) {
      var firstGroup = problems[0].group;
      if (firstGroup !== state.active) state.active = firstGroup;
      render();
      showStatus('Some fields need attention before saving:', 'error', problems.map(function (p) { return p.text; }));
      return;
    }

    // Only upload images that are still in use.
    var inUse = {};
    GROUPS.forEach(function (g) {
      state.data[g.key].forEach(function (item) {
        flatFields(g).forEach(function (f) { if (f.type === 'image' && item[f.name]) inUse[item[f.name]] = true; });
      });
    });
    var uploads = Object.keys(state.pending).filter(function (p) { return inUse[p]; });

    $('save').disabled = true;
    var chain = Promise.resolve();
    uploads.forEach(function (path, n) {
      chain = chain.then(function () {
        showStatus('Uploading image ' + (n + 1) + ' of ' + uploads.length + '…');
        return gh('PUT', repoPath(path), {
          message: 'Add sponsor image ' + path.split('/').pop(),
          content: state.pending[path],
          branch: state.branch
        }).then(function () { delete state.pending[path]; });
      });
    });
    chain.then(function () {
      showStatus('Saving sponsors…');
      var json = JSON.stringify(state.data, null, 2) + '\n';
      return gh('PUT', repoPath(CONFIG_PATH), {
        message: 'Update sponsors via sponsor manager',
        content: b64encodeText(json),
        sha: state.sha,
        branch: state.branch
      });
    }).then(function (result) {
      state.sha = result.content.sha;
      state.pending = {};
      setDirty(false);
      statusLink('Saved. The site updates in about two minutes, once the “Publish sponsors” job finishes.',
        'https://github.com/' + encodeURIComponent(state.owner) + '/' + encodeURIComponent(state.repo) + '/actions', 'Watch the job on GitHub');
    }).catch(function (err) {
      showStatus(err.message, 'error');
      $('save').disabled = false;
    });
  }

  /* ---------------------------------- boot ---------------------------------- */
  function boot() {
    var guess = guessRepo();
    var saved = loadRemembered();
    $('owner').value = (saved && saved.owner) || guess.owner;
    $('repo').value = (saved && saved.repo) || guess.repo;
    $('branch').value = (saved && saved.branch) || 'main';
    $('connect-btn').addEventListener('click', connect);
    $('token').addEventListener('keydown', function (e) { if (e.key === 'Enter') connect(); });
    $('save').addEventListener('click', save);
    $('sign-out').addEventListener('click', disconnect);
    $('add-item').addEventListener('click', addItem);
    window.addEventListener('beforeunload', function (e) {
      if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
    if (saved && saved.token) {
      $('token').value = saved.token;
      $('remember').checked = true;
      connect();
    }
  }

  boot();
})();
