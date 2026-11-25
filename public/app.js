/* Biography RAG frontend. Vanilla JS, no build step. API shapes: docs/CONTRACT.md */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const app = $('#app');
  const DEMO = new URLSearchParams(location.search).get('demo') === '1';

  // ---------------------------------------------------------------- helpers
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  const nf = new Intl.NumberFormat('en-US');
  const fmtN = (n) => nf.format(Number(n) || 0);
  const plural = (n, one, many = one + 's') => `${fmtN(n)} ${Number(n) === 1 ? one : many}`;
  const fmtBytes = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1).replace(/\.0$/, '')} MB` : `${Math.max(1, Math.round((b || 0) / 1e3))} KB`);
  const fmtDate = (iso) => {
    if (!iso) return '';
    try { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)); } catch { return ''; }
  };
  const fmtDay = (iso) => {
    try { return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(iso)); } catch { return ''; }
  };
  const fmtCost = (c) => (c == null || Number.isNaN(Number(c)) ? '' : `$${Number(c) < 0.01 ? Number(c).toFixed(3) : Number(c).toFixed(2)}`);
  const aliasText = (a) => (Array.isArray(a) ? a.filter(Boolean).join(', ') : String(a || '').trim());
  const ID_RUN_RE = /((?:\s*\[?\bD\d{2}-C\d{4}\b\]?)+)([.,;:!?]?)/g;
  const ID_ONE_RE = /D\d{2}-C\d{4}/g;
  const PROCESSING = new Set(['queued', 'extracting', 'embedding']);

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
  };
  const ownerKey = (id) => `brag.owner.${id}`;

  const icon = {
    chevR: '<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevL: '<svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevD: '<svg class="chev" width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 7.5 10 12.5l5-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5l9 9m0-9-9 9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    alert: '<svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 6v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="10" cy="14" r="1.1" fill="currentColor"/></svg>',
    lock: '<svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="9" width="12" height="8.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    upload: '<svg class="drop-icon" width="34" height="34" viewBox="0 0 32 32" aria-hidden="true"><path d="M9 4h10l6 6v16a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" fill="#FAFBF8" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M19 4v6h6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M16 23v-8m-3.5 3.5L16 15l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    download: '<svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5v9m-3.5-3.5L10 12.5 13.5 9M4.5 16h11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    flag: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.6" fill="#F2D649" stroke="#1D2330" stroke-width="1.3"/><path d="M10 5.6v5.2" stroke="#1D2330" stroke-width="2" stroke-linecap="round"/><path d="M10 14.2v.1" stroke="#1D2330" stroke-width="2.3" stroke-linecap="round"/></svg>',
  };

  const errBox = (msg) => `<span>${icon.alert}</span><span>${esc(msg)}</span>`;
  function showErr(el, msg) {
    if (!el) return;
    if (!msg) { el.hidden = true; el.innerHTML = ''; return; }
    el.innerHTML = errBox(msg);
    el.hidden = false;
  }

  // ---------------------------------------------------------------- timers per view
  const timers = new Set();
  function later(fn, ms) {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
    return t;
  }
  function clearTimers() { timers.forEach(clearTimeout); timers.clear(); }
  let routeSeq = 0;

  // ---------------------------------------------------------------- API
  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }
  function friendlyStatus(s) {
    if (s === 400) return 'The request was not valid. Check the fields and try again.';
    if (s === 403) return 'Only the person who created this collection can do that.';
    if (s === 404) return 'That could not be found. It may have been deleted.';
    if (s === 413) return 'That is too large to upload. Each file can be up to 60 MB, and one upload up to 80 MB.';
    if (s === 415) return 'That file type is not supported. Use .txt, .md, .html, .pdf or .docx.';
    if (s === 429) return 'Too many requests, or today\'s budget is used up. Wait a while and try again.';
    if (s >= 500) return 'The server ran into a problem. Try again in a moment.';
    return `The request failed (status ${s}).`;
  }
  async function api(method, path, body, headers = {}) {
    if (DEMO) return Demo.handle(method, path, body, headers);
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) throw new ApiError((data && data.error) || friendlyStatus(res.status), res.status);
    return data;
  }
  function uploadFiles(cid, files, token, onProgress) {
    if (DEMO) return Demo.upload(cid, files, onProgress);
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f, f.name));
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/collections/${encodeURIComponent(cid)}/files`);
      xhr.setRequestHeader('X-Owner-Token', token);
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data || { documents: [] });
        else reject(new ApiError((data && data.error) || friendlyStatus(xhr.status), xhr.status));
      };
      xhr.onerror = () => reject(new ApiError('The upload did not reach the server. Check your connection and try again.', 0));
      xhr.send(fd);
    });
  }
  const runUrl = (id, file) => `/api/runs/${encodeURIComponent(id)}/${file}`;

  // ---------------------------------------------------------------- router
  function parseHash() {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    return { c: p.get('c'), r: p.get('r') };
  }
  async function route() {
    clearTimers();
    closeNote(true);
    ctxs.clear();
    const seq = ++routeSeq;
    const { c, r } = parseHash();
    window.scrollTo(0, 0);
    try {
      if (r) await viewRun(r, seq);
      else if (c) await viewCollection(c, seq);
      else await viewStart(seq);
    } catch (e) {
      if (seq !== routeSeq) return;
      app.innerHTML = `<div class="panel" style="margin-top:24px"><h1 class="h2" tabindex="-1">This page could not load</h1><p class="muted" style="margin-top:8px">${esc(e.message)}</p><p style="margin-top:16px"><a class="link" href="#">Go to all collections</a></p></div>`;
    }
    if (seq === routeSeq) {
      const h = $('h1', app);
      if (h && document.activeElement !== h && route.count++ > 0) h.focus({ preventScroll: true });
    }
  }
  route.count = 0;
  const stale = (seq) => seq !== routeSeq;

  // ---------------------------------------------------------------- start view
  async function viewStart(seq) {
    app.innerHTML = `
      <div class="start">
        <section>
          <h1 class="display" tabindex="-1">Write a life story from the pages you upload</h1>
          <p class="lede" style="margin-top:20px">Add books, articles and letters about one person. The app asks those pages 20 questions about the life and writes a story only from what it finds. Every sentence names its source, and sentences it could not check are highlighted.</p>
          <form id="create" class="panel" style="margin-top:40px" novalidate>
            <h2 class="h2">New collection</h2>
            <div class="field" style="margin-top:20px">
              <label for="person">Person's name</label>
              <input class="input" id="person" name="person" autocomplete="off" placeholder="Benjamin Franklin" maxlength="120" required>
            </div>
            <div class="field" style="margin-top:16px">
              <label for="aliases">Also called <span class="muted" style="font-weight:400">(optional)</span></label>
              <input class="input" id="aliases" name="aliases" autocomplete="off" placeholder="Ben Franklin, Poor Richard" maxlength="300" aria-describedby="aliases-hint">
              <p class="hint" id="aliases-hint">Separate names with commas. They help find passages that don't use the full name.</p>
            </div>
            <p class="err" id="create-err" role="alert" hidden style="margin-top:16px"></p>
            <div style="margin-top:24px"><button class="btn btn-primary btn-lg" type="submit" id="create-btn">Create collection</button></div>
          </form>
        </section>
        <section aria-labelledby="coll-h">
          <h2 class="h2" id="coll-h">Collections</h2>
          <p class="small muted" style="margin-top:4px">Open one to read its story, write a new one, or ask a question.</p>
          <div id="coll-list" style="margin-top:20px" aria-busy="true">
            <div class="coll-list">${[0, 1, 2].map(() => '<div style="padding:18px 0;border-bottom:1px solid var(--rule)"><div class="skeleton" style="width:45%;height:1.2rem"></div><div class="skeleton" style="width:70%;margin-top:10px;height:.8rem"></div></div>').join('')}</div>
          </div>
        </section>
      </div>`;

    const form = $('#create');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const person = form.person.value.trim();
      const aliases = form.aliases.value.split(',').map((s) => s.trim()).filter(Boolean);
      const errEl = $('#create-err');
      if (!person) {
        form.person.setAttribute('aria-invalid', 'true');
        showErr(errEl, "Type the person's name first.");
        form.person.focus();
        return;
      }
      form.person.removeAttribute('aria-invalid');
      showErr(errEl, '');
      const btn = $('#create-btn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Creating collection';
      try {
        const res = await api('POST', '/api/collections', { person, aliases });
        if (res.ownerToken) store.set(ownerKey(res.id), res.ownerToken);
        location.hash = `#c=${encodeURIComponent(res.id)}`;
      } catch (err) {
        showErr(errEl, err.message);
        btn.disabled = false;
        btn.textContent = 'Create collection';
      }
    });

    const listEl = $('#coll-list');
    try {
      const { collections = [] } = await api('GET', '/api/collections');
      if (stale(seq)) return;
      listEl.removeAttribute('aria-busy');
      if (!collections.length) {
        listEl.innerHTML = '<p class="muted" style="padding:16px 0;border-top:1px solid var(--rule)">No collections yet. Create one to start adding pages.</p>';
        return;
      }
      listEl.innerHTML = `<div class="coll-list">${collections.map((c) => {
        const mine = !!store.get(ownerKey(c.id));
        const alias = aliasText(c.aliases);
        const meta = [plural(c.documents, 'document'), `about ${plural(c.estPages, 'page')}`].join(', ');
        return `<a class="coll-row" href="#c=${encodeURIComponent(c.id)}">
          <span class="coll-name">${esc(c.person)}${mine ? '<span class="tag">Yours</span>' : ''}</span>
          <span class="coll-sub">${alias ? `Also called ${esc(alias)}. ` : ''}${esc(meta)}</span>
          <span class="coll-chev">${icon.chevR}</span>
        </a>`;
      }).join('')}</div>`;
    } catch (err) {
      if (stale(seq)) return;
      listEl.removeAttribute('aria-busy');
      listEl.innerHTML = `<p class="err">${errBox(`Could not load collections. ${err.message}`)}</p>`;
    }
  }

  // ---------------------------------------------------------------- collection view
  const ACCEPT = ['.txt', '.md', '.html', '.htm', '.pdf', '.docx'];
  const MAX_FILE = 60 * 1024 * 1024;
  const MAX_REQ = 80 * 1024 * 1024;
  const MAX_FILES = 40;
  const STATE_TEXT = { queued: 'Waiting', extracting: 'Reading text', embedding: 'Embedding', ready: 'Ready', error: 'Failed' };
  const STAGES = [
    ['retrieving', 'Searching the pages'],
    ['weaving', 'Writing the story'],
    ['verifying', 'Checking sentences'],
  ];

  async function viewCollection(cid, seq) {
    app.innerHTML = `<div style="padding-top:8px"><a class="crumb" href="#">${icon.chevL} All collections</a></div>
      <div class="coll-head"><div class="skeleton" style="width:min(32rem,80%);height:3.4rem"></div><div class="skeleton" style="width:14rem;margin-top:18px"></div></div>`;
    let detail;
    try {
      detail = await api('GET', `/api/collections/${encodeURIComponent(cid)}`);
    } catch (err) {
      if (stale(seq)) return;
      const msg = err.status === 404 ? 'This collection does not exist. It may have been deleted.' : err.message;
      app.innerHTML = `<div style="padding-top:8px"><a class="crumb" href="#">${icon.chevL} All collections</a></div><div class="panel" style="margin-top:24px"><h1 class="h2" tabindex="-1">Collection not found</h1><p class="muted" style="margin-top:8px">${esc(msg)}</p></div>`;
      return;
    }
    if (stale(seq)) return;

    const col = detail.collection;
    const token = store.get(ownerKey(cid));
    const alias = aliasText(col.aliases);
    const state = { detail, polling: false, runPolling: null };

    app.innerHTML = `
      <div style="padding-top:8px"><a class="crumb" href="#">${icon.chevL} All collections</a></div>
      <header class="coll-head">
        <h1 class="person" tabindex="-1">${esc(col.person)}</h1>
        ${alias ? `<p class="muted" style="margin-top:14px;font-size:17px">Also called ${esc(alias)}</p>` : ''}
        <p class="totals" id="totals"></p>
      </header>
      <div class="coll-grid">
        <section class="panel area-story" aria-labelledby="story-h">
          <h2 class="h2" id="story-h">Story</h2>
          <p class="small muted" style="margin-top:6px">The app asks these pages 20 questions about ${esc(col.person)}'s life, then writes a story using only the passages it found. It takes a few minutes.</p>
          <div style="margin-top:20px"><button class="btn btn-primary btn-lg" id="write-btn" type="button">Write the story</button></div>
          <p class="small muted" id="write-hint" style="margin-top:10px" hidden></p>
          <p class="err" id="write-err" role="alert" hidden style="margin-top:14px"></p>
          <div id="run-status" aria-live="polite"></div>
          <h3 class="h3" style="margin-top:28px">Past runs</h3>
          <ul class="runs" id="runs" style="margin-top:6px"></ul>
        </section>

        <section class="panel area-sources" aria-labelledby="src-h">
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <h2 class="h2" id="src-h">Sources</h2>
            <p class="small muted num" id="src-count"></p>
          </div>
          <div style="margin-top:18px">${token ? `
            <div class="drop" id="drop">
              ${icon.upload}
              <p class="drop-title">Add pages</p>
              <p class="small muted">Drop files here, or <button type="button" class="linkbtn" id="choose">choose files</button></p>
              <p class="small muted" style="font-size:13px">.txt, .md, .html, .pdf or .docx. Up to 40 files at a time, 60 MB each.</p>
              <input type="file" id="file-input" multiple accept="${ACCEPT.join(',')}" class="sr-only" tabindex="-1" aria-hidden="true">
            </div>
            <p class="err" id="upload-err" role="alert" hidden style="margin-top:12px"></p>
            <div id="upload-status" aria-live="polite"></div>` : `
            <p class="owner-note">${icon.lock}<span>Only the person who created this collection can add pages. Anyone can write a story or ask a question.</span></p>`}
          </div>
          <ul class="docs" id="docs" aria-live="polite" aria-relevant="additions text"></ul>
        </section>

        <section class="panel area-ask" aria-labelledby="ask-h">${askFormHTML('ask', col.person)}</section>
      </div>`;

    const renderAll = () => {
      renderTotals(state.detail);
      renderDocs(state.detail.documents);
      renderRuns(state.detail.runs);
      updateWriteButton();
    };

    function updateWriteButton() {
      const docs = state.detail.documents || [];
      const ready = docs.filter((d) => d.status === 'ready').length;
      const busy = docs.some((d) => PROCESSING.has(d.status));
      const btn = $('#write-btn');
      const hint = $('#write-hint');
      const running = !!state.runPolling;
      btn.disabled = !ready || running;
      if (!ready) {
        hint.textContent = busy ? 'The pages are still being processed. You can write the story once a document is ready.' : 'Add pages first. The story needs at least one ready document.';
        hint.hidden = false;
      } else if (busy) {
        hint.textContent = 'Documents still being processed will not be included.';
        hint.hidden = false;
      } else hint.hidden = true;
    }

    async function refresh() {
      try {
        const d = await api('GET', `/api/collections/${encodeURIComponent(cid)}`);
        if (stale(seq)) return;
        state.detail = d;
        renderAll();
      } catch { /* keep the last good state and try again */ }
      schedulePoll();
    }
    function schedulePoll() {
      state.polling = false;
      if (stale(seq)) return;
      if ((state.detail.documents || []).some((d) => PROCESSING.has(d.status))) {
        state.polling = true;
        later(refresh, 1500);
      }
    }

    renderAll();
    schedulePoll();
    bindAsk($('#ask'), cid, col.person);

    // story run
    $('#write-btn').addEventListener('click', async () => {
      const errEl = $('#write-err');
      showErr(errEl, '');
      const btn = $('#write-btn');
      btn.disabled = true;
      try {
        const { runId } = await api('POST', `/api/collections/${encodeURIComponent(cid)}/runs`, {});
        if (stale(seq)) return;
        trackRun(runId);
      } catch (err) {
        showErr(errEl, err.message);
        updateWriteButton();
      }
    });

    function trackRun(runId) {
      state.runPolling = runId;
      updateWriteButton();
      renderRunStatus({ status: 'running', progress: { stage: 'retrieving', questionsDone: 0, questionsTotal: 20 } });
      if (!state.polling) refresh();
      const tick = async () => {
        if (stale(seq)) return;
        let run;
        try {
          ({ run } = await api('GET', `/api/runs/${encodeURIComponent(runId)}`));
        } catch (err) {
          renderRunStatus({ status: 'running', progress: null }, `Lost touch with the run: ${err.message} Trying again.`);
          later(tick, 4000);
          return;
        }
        if (stale(seq)) return;
        renderRunStatus(run);
        if (run.status === 'running') { later(tick, 2000); return; }
        state.runPolling = null;
        refresh();
        if (run.status === 'done') {
          const a = document.activeElement;
          const typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && a.value;
          if (!typing) later(() => { location.hash = `#r=${encodeURIComponent(runId)}`; }, 900);
        }
      };
      later(tick, 1200);
    }

    function renderRunStatus(run, warn) {
      const el = $('#run-status');
      if (!el) return;
      if (run.status === 'error') {
        el.innerHTML = `<p class="err" style="margin-top:16px">${errBox(`The story run failed. ${run.error || ''}`.trim())}</p>`;
        return;
      }
      if (run.status === 'done') {
        el.innerHTML = `<p style="margin-top:16px;font-weight:600">The story is ready. <a class="link" href="#r=${encodeURIComponent(run.id)}">Read the story</a></p>`;
        return;
      }
      const p = run.progress || {};
      const total = p.questionsTotal || 20;
      const done = Math.min(p.questionsDone || 0, total);
      const idx = Math.max(0, STAGES.findIndex(([k]) => k === p.stage));
      el.innerHTML = `
        <div style="margin-top:18px">
          <ol class="stages" aria-label="Steps">${STAGES.map(([k, label], i) => `<li class="${i < idx ? 'done' : i === idx ? 'current' : ''}"${i === idx ? ' aria-current="step"' : ''}>${label}</li>`).join('')}</ol>
          <div class="bar" role="progressbar" aria-label="Questions answered" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><span style="--p:${done / total}"></span></div>
          <p class="small" style="margin-top:8px;display:flex;align-items:center;gap:8px"><span class="spinner" aria-hidden="true" style="color:var(--patina)"></span><span class="num">Questions answered ${done}/${total}</span></p>
          ${warn ? `<p class="small muted" style="margin-top:4px">${esc(warn)}</p>` : ''}
        </div>`;
    }

    const runningStory = (detail.runs || []).find((r) => r.kind === 'story' && r.status === 'running');
    if (runningStory) trackRun(runningStory.id);

    // uploads
    if (token) {
      const drop = $('#drop');
      const input = $('#file-input');
      $('#choose').addEventListener('click', () => input.click());
      input.addEventListener('change', () => { handleFiles(Array.from(input.files || [])); input.value = ''; });
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
      ['dragleave', 'dragend'].forEach((ev) => drop.addEventListener(ev, (e) => { if (!drop.contains(e.relatedTarget)) drop.classList.remove('is-over'); }));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('is-over');
        handleFiles(Array.from((e.dataTransfer && e.dataTransfer.files) || []));
      });
    }

    let uploading = false;
    async function handleFiles(files) {
      const errEl = $('#upload-err');
      showErr(errEl, '');
      if (!files.length || uploading) return;
      const problems = [];
      const ok = [];
      for (const f of files) {
        const ext = (f.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
        if (!ACCEPT.includes(ext)) problems.push(`"${f.name}" is not a supported file type.`);
        else if (f.size > MAX_FILE) problems.push(`"${f.name}" is ${fmtBytes(f.size)}. Each file can be at most 60 MB.`);
        else if (f.size === 0) problems.push(`"${f.name}" is empty.`);
        else ok.push(f);
      }
      if (ok.length > MAX_FILES) {
        problems.push(`You chose ${ok.length} files. Add up to 40 at a time.`);
        ok.length = MAX_FILES;
      }
      if (problems.length) showErr(errEl, `${problems.slice(0, 3).join(' ')}${problems.length > 3 ? ` And ${problems.length - 3} more.` : ''} Use .txt, .md, .html, .pdf or .docx files.`);
      if (!ok.length) return;

      // group into requests of at most 80 MB
      const batches = [];
      let cur = []; let size = 0;
      for (const f of ok) {
        if (cur.length && size + f.size > MAX_REQ) { batches.push(cur); cur = []; size = 0; }
        cur.push(f); size += f.size;
      }
      if (cur.length) batches.push(cur);

      uploading = true;
      const statusEl = $('#upload-status');
      const totalBytes = ok.reduce((s, f) => s + f.size, 0);
      let sent = 0;
      try {
        for (const batch of batches) {
          const bBytes = batch.reduce((s, f) => s + f.size, 0);
          const res = await uploadFiles(cid, batch, token, (frac) => {
            const p = (sent + frac * bBytes) / totalBytes;
            statusEl.innerHTML = `<div style="margin-top:14px"><p class="small num" style="margin-bottom:6px">Uploading ${plural(ok.length, 'file')}, ${Math.round(p * 100)}%</p><div class="bar"><span style="--p:${p}"></span></div></div>`;
          });
          sent += bBytes;
          if (stale(seq)) return;
          const incoming = (res && res.documents) || [];
          const byId = new Map((state.detail.documents || []).map((d) => [d.id, d]));
          incoming.forEach((d) => byId.set(d.id, d));
          state.detail.documents = Array.from(byId.values()).sort((a, b) => a.seq - b.seq);
          renderDocs(state.detail.documents);
          updateWriteButton();
        }
        statusEl.innerHTML = '';
      } catch (err) {
        statusEl.innerHTML = '';
        showErr(errEl, `The upload failed. ${err.message}`);
      } finally {
        uploading = false;
      }
      if (!state.polling) refresh();
    }
  }

  function renderTotals(detail) {
    const t = detail.totals || {};
    const el = $('#totals');
    if (el) el.textContent = `${plural(t.documents, 'document')}, ${plural(t.chunks, 'chunk')}, about ${plural(t.estPages, 'page')}`;
    const c = $('#src-count');
    if (c) c.textContent = t.documents ? `${fmtN(t.words)} words` : '';
  }

  function renderDocs(docs = []) {
    const el = $('#docs');
    if (!el) return;
    if (!docs.length) {
      el.innerHTML = '<li class="doc"><p class="small muted">No documents yet.</p></li>';
      return;
    }
    el.innerHTML = docs.map((d) => {
      const st = d.status;
      const busy = PROCESSING.has(st);
      const meta = [fmtBytes(d.bytes)];
      if (d.words) meta.push(`${fmtN(d.words)} words`);
      if (d.estPages) meta.push(`about ${plural(d.estPages, 'page')}`);
      if (d.chunks) meta.push(plural(d.chunks, 'chunk'));
      let label = STATE_TEXT[st] || st;
      if (busy && d.progress && d.progress.total) {
        label = st === 'embedding'
          ? `Embedding ${fmtN(d.progress.done)} of ${fmtN(d.progress.total)}`
          : `${label} ${Math.round((d.progress.done / d.progress.total) * 100)}%`;
      }
      const frac = d.progress && d.progress.total ? d.progress.done / d.progress.total : null;
      const bar = busy
        ? `<div class="bar${frac == null ? ' indeterminate' : ''}" role="progressbar" aria-label="${esc(d.filename)} progress"${frac == null ? '' : ` aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(frac * 100)}"`}><span style="--p:${frac || 0}"></span></div>`
        : '';
      return `<li class="doc">
        <div class="doc-top"><span class="doc-id">${esc(d.id)}</span><span class="doc-name" title="${esc(d.filename)}">${esc(d.filename)}</span>
          <span class="doc-state ${esc(st)}">${busy ? '<span class="spinner" aria-hidden="true" style="width:11px;height:11px"></span>' : st === 'ready' ? '<span class="dot" aria-hidden="true"></span>' : ''}<span class="num">${esc(label)}</span></span></div>
        <p class="doc-meta">${esc(meta.join(', '))}</p>
        ${bar}
        ${st === 'error' ? `<p class="err">${errBox(d.error || 'This file could not be read.')}</p>` : ''}
      </li>`;
    }).join('');
  }

  function renderRuns(runs = []) {
    const el = $('#runs');
    if (!el) return;
    if (!runs.length) {
      el.innerHTML = '<li><p class="small muted" style="padding:8px 0">No runs yet.</p></li>';
      return;
    }
    const statusWord = { running: 'Running', done: 'Done', error: 'Failed' };
    el.innerHTML = runs.map((r) => {
      const title = r.kind === 'story' ? 'Story' : `Question: ${r.question || ''}`;
      const meta = [fmtDate(r.createdAt), fmtCost(r.costUsd)].filter(Boolean).join(', ');
      return `<li><a class="run-row" href="#r=${encodeURIComponent(r.id)}">
        <span class="run-title" title="${esc(title)}">${esc(title)}</span>
        <span class="run-meta">${esc(meta)}</span>
        <span class="run-status ${esc(r.status)}">${esc(statusWord[r.status] || r.status)}</span>
      </a></li>`;
    }).join('');
  }

  // ---------------------------------------------------------------- ask
  function askFormHTML(id, person) {
    return `<form id="${id}" novalidate>
      <h2 class="h2" id="${id}-h">Ask your own question</h2>
      <p class="small muted" style="margin-top:6px">The answer comes only from this collection's pages. If they don't cover it, you'll see "Not in the sources."</p>
      <label class="sr-only" for="${id}-q">Your question</label>
      <div class="ask-row" style="margin-top:16px">
        <input class="input" id="${id}-q" name="q" autocomplete="off" maxlength="500" placeholder="Did they ever visit Japan?">
        <button class="btn btn-primary" type="submit">Ask</button>
      </div>
      <p class="err" role="alert" hidden style="margin-top:12px"></p>
      <div class="ask-out" aria-live="polite"></div>
    </form>`;
  }

  function bindAsk(form, cid, person) {
    if (!form) return;
    let n = 0;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.q;
      const q = input.value.trim();
      const errEl = $('.err', form);
      const out = $('.ask-out', form);
      showErr(errEl, '');
      if (!q) { showErr(errEl, 'Type a question first.'); input.focus(); return; }
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      out.innerHTML = '<p class="pending"><span class="spinner" aria-hidden="true" style="color:var(--patina)"></span>Searching the pages. This can take up to 15 seconds.</p>';
      const seq = routeSeq;
      try {
        const res = await api('POST', `/api/collections/${encodeURIComponent(cid)}/ask`, { question: q });
        if (stale(seq)) return;
        const key = `ask-${form.id}-${++n}`;
        out.innerHTML = askResultHTML(res.result, key, cid, res.runId);
        out.firstElementChild && out.firstElementChild.classList.add('reveal');
      } catch (err) {
        if (stale(seq)) return;
        out.innerHTML = '';
        showErr(errEl, err.message);
      } finally {
        btn.disabled = false;
      }
    });
  }

  function askResultHTML(result, key, cid, runId) {
    registerCtx(key, { chunks: result.chunks || {}, collectionId: cid, facts: result.facts || [] });
    const retrieved = (result.retrieved || []).map((r) => r.id);
    const retrievedHTML = retrieved.length ? `<p class="answer-meta">Retrieved passages: ${retrieved.map((id) => citeHTML(id, key)).join('')}</p>` : '';
    const rejected = (result.rejected || []).length;
    const rejNote = rejected ? `<p class="answer-meta" style="line-height:1.5">${plural(rejected, 'candidate fact')} ${rejected === 1 ? 'was' : 'were'} dropped because the quoted words weren't in the passage.</p>` : '';
    const link = runId ? `<p class="answer-meta" style="line-height:1.5"><a class="link" href="#r=${encodeURIComponent(runId)}">Open this answer and its log</a></p>` : '';
    if (!result.found) {
      return `<div class="answer none">
        <p class="answer-text">Not in the sources.</p>
        <p class="small muted" style="margin-top:4px">None of the passages retrieved for "${esc(result.question)}" answer it, so no answer was written.</p>
        ${retrievedHTML}${rejNote}${link}
      </div>`;
    }
    return `<div class="answer">
      <p class="answer-text">${textWithCites(result.answer, key, result.facts)}</p>
      ${retrievedHTML}${rejNote}${link}
    </div>`;
  }

  // Turns "[D02-C0147]" inside text into citation markers. Falls back to the facts' IDs.
  function textWithCites(text, key, facts = []) {
    let found = false;
    const html = esc(text).replace(ID_RUN_RE, (_, ids, punct) => {
      found = true;
      return `${punct}<span class="cites">${ids.match(ID_ONE_RE).map((id) => citeHTML(id, key)).join('')}</span>`;
    });
    if (found) return html;
    const ids = [...new Set((facts || []).flatMap((f) => f.chunkIds || []))];
    return html + (ids.length ? `<span class="cites">${ids.map((id) => citeHTML(id, key)).join('')}</span>` : '');
  }

  // ---------------------------------------------------------------- run / story view
  async function viewRun(runId, seq) {
    app.innerHTML = `<div class="story-grid"><div class="story-main"><div class="leaf"><div class="skeleton" style="width:70%;height:2.6rem"></div><div class="skeleton" style="width:40%;margin-top:18px"></div>${[90, 96, 84, 92, 60].map((w) => `<div class="skeleton" style="width:${w}%;margin-top:14px"></div>`).join('')}</div></div></div>`;
    let run;
    try {
      ({ run } = await api('GET', `/api/runs/${encodeURIComponent(runId)}`));
    } catch (err) {
      if (stale(seq)) return;
      const msg = err.status === 404 ? 'This run does not exist.' : err.message;
      app.innerHTML = `<div class="panel" style="margin-top:24px"><h1 class="h2" tabindex="-1">Run not found</h1><p class="muted" style="margin-top:8px">${esc(msg)}</p><p style="margin-top:16px"><a class="link" href="#">Go to all collections</a></p></div>`;
      return;
    }
    if (stale(seq)) return;
    let person = run.result && run.result.person;
    if (!person && run.collectionId) {
      try { person = (await api('GET', `/api/collections/${encodeURIComponent(run.collectionId)}`)).collection.person; } catch { /* name is optional */ }
      if (stale(seq)) return;
    }
    const crumb = `<div class="story-crumb" style="padding-top:8px"><a class="crumb" href="#c=${encodeURIComponent(run.collectionId)}">${icon.chevL} ${esc(person || 'Back to collection')}</a></div>`;

    if (run.status === 'running') {
      const p = run.progress || {};
      const total = p.questionsTotal || 20;
      const done = Math.min(p.questionsDone || 0, total);
      const idx = Math.max(0, STAGES.findIndex(([k]) => k === p.stage));
      app.innerHTML = `${crumb}<div class="story-grid"><div class="story-main"><div class="leaf">
        <h1 class="story-title" tabindex="-1">${run.kind === 'ask' ? 'Answering your question' : 'Writing the story'}</h1>
        <div aria-live="polite" style="max-width:34rem;margin-top:24px">
          <ol class="stages">${STAGES.map(([k, label], i) => `<li class="${i < idx ? 'done' : i === idx ? 'current' : ''}">${label}</li>`).join('')}</ol>
          <div class="bar" role="progressbar" aria-label="Questions answered" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><span style="--p:${done / total}"></span></div>
          <p class="small num" style="margin-top:8px">Questions answered ${done}/${total}</p>
        </div></div></div></div>`;
      later(() => { if (!stale(seq)) viewRun(runId, seq); }, 2000);
      return;
    }
    if (run.status === 'error') {
      app.innerHTML = `${crumb}<div class="story-grid"><div class="story-main"><div class="leaf"><h1 class="story-title" tabindex="-1">This run failed</h1><p class="err" style="margin-top:20px">${errBox(run.error || 'The run stopped before it finished.')}</p>${downloadsHTML(run, false)}</div></div></div>`;
      bindDownloads(run);
      return;
    }
    if (run.kind === 'ask') renderAskRun(run, crumb, person);
    else renderStory(run, crumb, person);
  }

  function downloadsHTML(run, withStory = true) {
    const files = [withStory && run.kind === 'story' ? ['story.md', 'The story with its citations'] : null, ['log.md', 'Every step, readable'], ['log.json', 'Every step, as data']].filter(Boolean);
    return `<section class="after" aria-labelledby="dl-h">
      <h2 class="h3" id="dl-h">Download the record</h2>
      <p class="small muted" style="margin-top:2px">The log lists every query, the passages it retrieved, and each prompt and response.</p>
      <div class="downloads">${files.map(([f, t]) => `<a class="btn btn-quiet" href="${runUrl(run.id, f)}" download="${esc(`${run.id}-${f}`)}" data-file="${f}" title="${esc(t)}">${icon.download}${f}</a>`).join('')}</div>
    </section>`;
  }
  function bindDownloads(run) {
    if (!DEMO) return;
    $$('[data-file]', app).forEach((a) => {
      a.href = Demo.fileUrl(run, a.dataset.file);
    });
  }

  function renderStory(run, crumb, person) {
    const R = run.result || {};
    const story = R.story || { title: '', sections: [] };
    const review = R.review || {};
    const questions = R.questions || [];
    const sentences = [];
    story.sections.forEach((s) => s.sentences.forEach((x) => sentences.push(x)));
    registerCtx('story', { chunks: R.chunks || {}, collectionId: run.collectionId, facts: questions.flatMap((q) => q.facts || []), sentences });

    const docNames = new Set(Object.values(R.chunks || {}).map((c) => c.filename));
    const cov = review.coverage || { found: questions.filter((q) => q.found).length, total: 20 };
    const flagged = review.flagged ?? sentences.filter((s) => (s.flags || []).length).length;

    let si = 0;
    const sectionsHTML = story.sections.map((sec) => {
      const body = sec.sentences.map((s) => {
        const i = si++;
        const isFlag = (s.flags || []).length > 0;
        const ids = s.chunkIds || [];
        const cites = ids.map((id) => citeHTML(id, 'story', i, R.chunks && !R.chunks[id])).join('');
        const flagBtn = isFlag ? `<button type="button" class="flagbtn" data-flag="${i}" data-ctx="story" aria-expanded="false" aria-controls="note" aria-label="Flagged: ${esc(s.flags.map(flagWord).join('. '))}. Show details">${icon.flag}</button>` : '';
        return `<span class="sent${isFlag ? ' flagged' : ''}" data-si="${i}">${esc(s.text)}</span><span class="cites">${cites}${flagBtn}</span>`;
      }).join(' ');
      return `<h2>${esc(sec.heading)}</h2><p>${body}</p>`;
    }).join('');

    const notIn = (R.notInSources || []).map((n) => questions.find((q) => q.n === n) || { n, question: `Question ${n}` });

    const qRows = questions.map((q) => `<tr>
      <td class="qn">${esc(q.n)}</td>
      <td class="qq">${esc(q.question)}</td>
      <td class="qa${q.found ? '' : ' none'}">${q.found ? textWithCites(q.answer, 'story', q.facts) : 'Not in the sources.'}</td>
      <td class="qr">${(q.retrieved || []).map((r) => citeHTML(r.id, 'story')).join('')}</td>
    </tr>`).join('');

    app.innerHTML = `${crumb}
      <div class="story-grid has-margin">
        <div class="story-main">
          <article class="leaf" aria-labelledby="story-title">
            <h1 class="story-title" id="story-title" tabindex="-1">${esc(story.title || `${person || R.person}`)}</h1>
            <p class="byline">Written from ${plural(docNames.size, 'source document')} on ${esc(fmtDay(run.finishedAt || run.createdAt))}</p>
            <dl class="summary">
              <div><dt>sentences</dt><dd class="num">${fmtN(review.sentences ?? sentences.length)}</dd></div>
              <div><dt>cite a source</dt><dd class="num">${fmtN(review.cited ?? sentences.filter((s) => (s.chunkIds || []).length).length)}</dd></div>
              <div class="is-flag"><dt>flagged</dt><dd class="num">${fmtN(flagged)}</dd></div>
              <div><dt>questions answered</dt><dd class="num">${fmtN(cov.found)}<small>/${fmtN(cov.total || 20)}</small></dd></div>
            </dl>
            <p class="legend">Each sentence ends with the IDs of the passages it came from. Select one to read the passage. <span class="flagged" style="color:var(--ink)">Highlighted</span> sentences could not be fully checked against those passages, so they may come from the model's training data instead.</p>
            <div class="prose">${sectionsHTML || '<p class="muted">The story has no sentences.</p>'}</div>

            <section class="after" aria-labelledby="nis-h">
              <h2 class="h2" id="nis-h">Not in the sources</h2>
              ${notIn.length ? `<p class="small muted" style="margin-top:4px">The pages had nothing on these questions, so the story leaves them out.</p>
              <ol class="skipped">${notIn.map((q) => `<li><span class="n">${esc(q.n)}.</span><span>${esc(q.question)}</span></li>`).join('')}</ol>` : '<p class="small muted" style="margin-top:4px">The pages answered all 20 questions.</p>'}
            </section>

            <details class="qs">
              <summary><span>The 20 questions</span>${icon.chevD}</summary>
              <table class="qtable">
                <thead><tr><th scope="col">#</th><th scope="col">Question</th><th scope="col">Answer</th><th scope="col">Retrieved</th></tr></thead>
                <tbody>${qRows}</tbody>
              </table>
            </details>

            ${downloadsHTML(run)}
          </article>
          <section class="panel" aria-labelledby="ask-story-h">${askFormHTML('ask-story', person || R.person)}</section>
        </div>
        <div class="margin-col" aria-hidden="true"></div>
      </div>`;
    bindDownloads(run);
    bindAsk($('#ask-story'), run.collectionId, person || R.person);
    app.firstElementChild && app.querySelector('.leaf').classList.add('reveal');
  }

  function renderAskRun(run, crumb, person) {
    const R = run.result || {};
    app.innerHTML = `${crumb}
      <div class="story-grid has-margin">
        <div class="story-main">
          <article class="leaf">
            <p class="byline" style="margin-top:0">Question asked on ${esc(fmtDay(run.createdAt))}</p>
            <h1 class="story-title" tabindex="-1" style="margin-top:8px">${esc(R.question || run.question)}</h1>
            ${askResultHTML(R, 'askrun', run.collectionId, null)}
            ${downloadsHTML(run, false)}
          </article>
          <section class="panel">${askFormHTML('ask-run', person)}</section>
        </div>
        <div class="margin-col" aria-hidden="true"></div>
      </div>`;
    bindDownloads(run);
    bindAsk($('#ask-run'), run.collectionId, person);
  }

  // ---------------------------------------------------------------- citations + notes
  const ctxs = new Map();
  const chunkCache = new Map();
  function registerCtx(key, ctx) { ctxs.set(key, ctx); }

  function citeHTML(id, ctxKey, si, unknown) {
    return `<button type="button" class="cite${unknown ? ' unknown' : ''}" data-cite="${esc(id)}" data-ctx="${esc(ctxKey)}"${si != null ? ` data-si="${si}"` : ''} aria-expanded="false" aria-controls="note" aria-label="Source ${esc(id)}">${esc(id)}</button>`;
  }

  const FLAG_WORDS = {
    'no-citation': 'No source cited',
    'unknown-citation': 'Cites a passage that was not retrieved',
    'judge-partly': 'Source only partly supports this',
    'judge-no': 'Source does not support this',
    'new-terms': 'Has names or numbers the cited passages do not contain',
  };
  const flagWord = (f) => FLAG_WORDS[f] || String(f).replace(/-/g, ' ');

  function markQuotes(text, quotes) {
    const lower = text.toLowerCase();
    const ranges = [];
    for (const q of quotes) {
      const ql = String(q || '').trim().toLowerCase();
      if (ql.length < 6) continue;
      const i = lower.indexOf(ql);
      if (i >= 0) ranges.push([i, i + ql.length]);
    }
    if (!ranges.length) return { html: esc(text), marked: false };
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [ranges[0].slice()];
    for (const r of ranges.slice(1)) {
      const last = merged[merged.length - 1];
      if (r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push(r.slice());
    }
    let html = ''; let pos = 0;
    for (const [s, e] of merged) {
      html += esc(text.slice(pos, s)) + `<mark class="q">${esc(text.slice(s, e))}</mark>`;
      pos = e;
    }
    return { html: html + esc(text.slice(pos)), marked: true };
  }

  async function getChunk(ctx, id) {
    if (ctx && ctx.chunks && ctx.chunks[id]) return ctx.chunks[id];
    const key = `${ctx && ctx.collectionId}/${id}`;
    if (chunkCache.has(key)) return chunkCache.get(key);
    try {
      const { chunk } = await api('GET', `/api/collections/${encodeURIComponent(ctx.collectionId)}/chunks/${encodeURIComponent(id)}`);
      chunkCache.set(key, chunk);
      return chunk;
    } catch (err) {
      if (err.status === 404) { chunkCache.set(key, null); return null; }
      throw err;
    }
  }

  const note = $('#note');
  const scrim = $('#scrim');
  const mqSheet = window.matchMedia('(max-width: 767px)');
  const mqWide = window.matchMedia('(min-width: 1180px)');
  let noteAnchor = null;
  let noteKey = null;
  let noteOpenedBy = null;
  let quietFocus = false;
  function refocus(el) { quietFocus = true; el.focus({ preventScroll: true }); quietFocus = false; }

  function setExpanded(el, on) { if (el) el.setAttribute('aria-expanded', on ? 'true' : 'false'); }
  function setActiveSentence(si) {
    $$('.sent.is-active', app).forEach((s) => s.classList.remove('is-active'));
    if (si != null && si !== '') { const s = $(`.sent[data-si="${si}"]`, app); if (s) s.classList.add('is-active'); }
  }

  function placeNote(anchor, fresh) {
    const sheet = mqSheet.matches;
    note.classList.toggle('sheet', sheet);
    scrim.classList.toggle('is-open', sheet && note.classList.contains('is-open'));
    if (sheet) { note.style.transform = ''; note.style.width = ''; note.removeAttribute('data-mode'); return; }
    if (fresh) note.classList.add('no-move');
    const ar = anchor.getBoundingClientRect();
    const sx = window.scrollX; const sy = window.scrollY;
    const marginCol = anchor.closest('.has-margin') && mqWide.matches ? $('.margin-col', anchor.closest('.has-margin')) : null;
    let x; let y; let w;
    if (marginCol) {
      const mr = marginCol.getBoundingClientRect();
      w = mr.width - 16; x = mr.left + sx + 16; y = ar.top + sy - 16;
      note.dataset.mode = 'margin';
    } else {
      w = Math.min(380, window.innerWidth - 32);
      x = Math.min(Math.max(ar.left + sx - 24, sx + 16), sx + window.innerWidth - w - 16);
      y = ar.bottom + sy + 10;
      note.dataset.mode = 'popover';
    }
    note.style.width = `${w}px`;
    note.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    if (fresh) requestAnimationFrame(() => requestAnimationFrame(() => note.classList.remove('no-move')));
  }

  function noteShell(headHTML, bodyHTML, footHTML) {
    return `<div class="note-card">
      <div class="note-head"><div style="min-width:0">${headHTML}</div><button type="button" class="note-close" aria-label="Close note">${icon.close}</button></div>
      <div class="note-body">${bodyHTML}</div>
      ${footHTML ? `<p class="note-foot">${footHTML}</p>` : ''}
    </div>`;
  }

  async function openNote(anchor, how) {
    const ctx = ctxs.get(anchor.dataset.ctx);
    const isFlag = anchor.hasAttribute('data-flag');
    const key = `${anchor.dataset.ctx}|${isFlag ? `f${anchor.dataset.flag}` : anchor.dataset.cite}|${anchor.dataset.si || ''}`;
    if (noteKey === key && note.classList.contains('is-open')) { if (how === 'click' && mqSheet.matches) return; return; }
    const fresh = !note.classList.contains('is-open') || mqSheet.matches;
    setExpanded(noteAnchor, false);
    noteAnchor = anchor; noteKey = key; noteOpenedBy = how;
    setExpanded(anchor, true);

    if (isFlag) {
      const s = ctx && ctx.sentences ? ctx.sentences[Number(anchor.dataset.flag)] : null;
      setActiveSentence(anchor.dataset.flag);
      const flags = (s && s.flags) || [];
      const ids = (s && s.chunkIds) || [];
      note.innerHTML = noteShell(
        '<p class="note-title">May come from the model\'s training data</p><p class="note-src">The checker could not confirm this sentence from the passages.</p>',
        `<ul class="note-flags">${flags.map((f) => `<li>${esc(flagWord(f))}</li>`).join('')}</ul>
         ${s && s.note ? `<div class="note-verdict"><span class="note-label">Checker's note</span>${esc(s.note)}</div>` : ''}`,
        ids.length ? `Cited: ${ids.map((id) => esc(id)).join(', ')}` : 'This sentence cites no passage.',
      );
    } else {
      const id = anchor.dataset.cite;
      setActiveSentence(anchor.dataset.si);
      note.innerHTML = noteShell(`<p class="note-id">${esc(id)}</p><p class="note-src">Loading passage</p>`, '<div class="skeleton"></div><div class="skeleton" style="margin-top:10px;width:85%"></div>', '');
      fillChunk(ctx, id, key);
    }
    note.classList.add('is-open');
    placeNote(anchor, fresh);
  }

  async function fillChunk(ctx, id, key) {
    let chunk;
    try { chunk = await getChunk(ctx, id); } catch (err) {
      if (noteKey !== key) return;
      $('.note-src', note).textContent = '';
      $('.note-body', note).innerHTML = `<p class="err">${errBox(`Could not load this passage. ${err.message}`)}</p>`;
      return;
    }
    if (noteKey !== key) return;
    if (!chunk) {
      $('.note-src', note).textContent = 'Not among the retrieved passages';
      $('.note-body', note).innerHTML = '<p>This ID was not one of the passages retrieved for this run, so there is no text to show. A sentence citing it is flagged.</p>';
      return;
    }
    const quotes = ((ctx && ctx.facts) || []).filter((f) => (f.chunkIds || []).includes(id)).map((f) => f.quote);
    const { html, marked } = markQuotes(String(chunk.text || ''), quotes);
    const src = [chunk.filename, chunk.page != null ? `page ${chunk.page}` : null].filter(Boolean).join(', ');
    const card = $('.note-card', note);
    card.outerHTML = noteShell(
      `<p class="note-id">${esc(chunk.id || id)}</p><p class="note-src">${esc(src)}</p>`,
      `<p>${html}</p>`,
      marked ? 'Marked words were quoted as evidence for an answer.' : '',
    );
    if (noteAnchor && !mqSheet.matches) placeNote(noteAnchor, false);
  }

  function closeNote(silent) {
    if (!note.classList.contains('is-open')) return;
    note.classList.remove('is-open');
    scrim.classList.remove('is-open');
    setExpanded(noteAnchor, false);
    setActiveSentence(null);
    const back = noteAnchor;
    noteAnchor = null; noteKey = null;
    if (!silent && back && noteOpenedBy !== 'focus' && document.contains(back)) refocus(back);
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('.cite, .flagbtn');
    if (t) { e.preventDefault(); openNote(t, 'click'); return; }
    if (e.target.closest('.note-close')) { closeNote(false); return; }
    if (note.classList.contains('is-open') && !e.target.closest('#note')) closeNote(true);
  });
  document.addEventListener('focusin', (e) => {
    const t = e.target.closest && e.target.closest('.cite, .flagbtn');
    if (t && !quietFocus && e.target.matches(':focus-visible')) openNote(t, 'focus');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && note.classList.contains('is-open')) {
      const back = noteAnchor;
      closeNote(true);
      if (back && document.contains(back)) refocus(back);
    }
  });
  scrim.addEventListener('click', () => closeNote(false));
  let rz = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(() => { if (noteAnchor && note.classList.contains('is-open')) placeNote(noteAnchor, true); });
  });

  // ---------------------------------------------------------------- demo mode (?demo=1)
  const Demo = (() => {
    let S = null;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const clone = (o) => JSON.parse(JSON.stringify(o));
    const now = () => Date.now();
    const fail = (status, msg) => { throw new ApiError(msg, status); };
    const hex = () => Math.random().toString(16).slice(2, 10);

    async function init() {
      if (S) return S;
      const get = (n) => fetch(`demo/${n}.json`).then((r) => { if (!r.ok) throw new Error(`demo/${n}.json missing`); return r.json(); });
      const [list, coll, story, askNo, askYes] = await Promise.all(['collections', 'collection', 'story-run', 'ask-not-found', 'ask-found'].map(get));
      S = { list: list.collections, details: {}, runs: {}, story: story.run, askNo, askYes };
      S.details[coll.collection.id] = coll;
      S.runs[story.run.id] = story.run;
      const askSummary = coll.runs.find((r) => r.id === askNo.runId);
      S.runs[askNo.runId] = { id: askNo.runId, collectionId: coll.collection.id, kind: 'ask', question: askNo.result.question, status: 'done', progress: null, result: askNo.result, costUsd: askSummary ? askSummary.costUsd : 0.003, error: null, createdAt: askSummary && askSummary.createdAt, finishedAt: askSummary && askSummary.createdAt };
      for (const c of S.list) if (!S.details[c.id]) S.details[c.id] = synth(c);
      if (!store.get(ownerKey(coll.collection.id))) store.set(ownerKey(coll.collection.id), 'demo-owner-token');
      return S;
    }

    function synth(c) {
      const n = c.documents || 0;
      const docs = Array.from({ length: n }, (_, i) => {
        const words = Math.round((c.words || 0) / Math.max(1, n));
        return { id: `D${String(i + 1).padStart(2, '0')}`, seq: i + 1, filename: `${c.person.toLowerCase().replace(/[^a-z]+/g, '-')}-source-${i + 1}.txt`, bytes: words * 6, words, estPages: Math.round(words / 275), chunks: Math.round((c.chunks || 0) / Math.max(1, n)), status: 'ready', error: null, progress: null };
      });
      return { collection: { id: c.id, person: c.person, aliases: c.aliases || [], createdAt: c.createdAt }, documents: docs, totals: { documents: n, chunks: c.chunks || 0, words: c.words || 0, estPages: c.estPages || 0 }, runs: [] };
    }

    function tickDocs(d) {
      for (const doc of d.documents) {
        if (!doc._t) continue;
        const el = (now() - doc._t) / 1000;
        if (doc._bad && el > 2.5) { doc.status = 'error'; doc.error = 'No text could be read from this file. If it is a scanned PDF, run OCR on it first.'; doc.progress = null; delete doc._t; continue; }
        if (el < 1.2) { doc.status = 'queued'; doc.progress = null; }
        else if (el < 3.6) { doc.status = 'extracting'; doc.progress = { done: Math.ceil(doc._pages * (el - 1.2) / 2.4), total: doc._pages }; }
        else if (el < 8.5) { doc.status = 'embedding'; doc.words = doc._words; doc.estPages = doc._pages; doc.progress = { done: Math.round(doc._chunks * (el - 3.6) / 4.9), total: doc._chunks }; }
        else { doc.status = 'ready'; doc.chunks = doc._chunks; doc.words = doc._words; doc.estPages = doc._pages; doc.progress = null; delete doc._t; }
      }
      const ready = d.documents;
      d.totals = {
        documents: ready.length,
        chunks: ready.reduce((s, x) => s + (x.chunks || 0), 0),
        words: ready.reduce((s, x) => s + (x.words || 0), 0),
        estPages: ready.reduce((s, x) => s + (x.estPages || 0), 0),
      };
      d.runs.forEach((r) => { const full = S.runs[r.id]; if (full) { tickRun(full); r.status = full.status; r.costUsd = full.costUsd; } });
    }

    function tickRun(run) {
      if (!run._t || run.status !== 'running') return run;
      const el = (now() - run._t) / 1000;
      if (el < 10) run.progress = { stage: 'retrieving', questionsDone: Math.min(20, Math.floor(el / 0.5)), questionsTotal: 20 };
      else if (el < 13) run.progress = { stage: 'weaving', questionsDone: 20, questionsTotal: 20 };
      else if (el < 16) run.progress = { stage: 'verifying', questionsDone: 20, questionsTotal: 20 };
      else {
        run.status = 'done';
        run.progress = { stage: 'done', questionsDone: 20, questionsTotal: 20 };
        run.result = clone(S.story.result);
        run.costUsd = S.story.costUsd;
        run.finishedAt = new Date().toISOString();
      }
      return run;
    }

    const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k.startsWith('_') ? undefined : v)));

    async function handle(method, path, body, headers) {
      await init();
      await wait(160);
      let m;
      if (method === 'GET' && path === '/api/collections') {
        return { collections: S.list.map((c) => { const d = S.details[c.id]; tickDocs(d); return { ...c, ...d.totals }; }) };
      }
      if (method === 'POST' && path === '/api/collections') {
        const person = String((body && body.person) || '').trim();
        if (!person) fail(400, "Type the person's name first.");
        const id = `c${hex()}`;
        const aliases = (body && body.aliases) || [];
        const createdAt = new Date().toISOString();
        S.list.unshift({ id, person, aliases, documents: 0, chunks: 0, words: 0, estPages: 0, createdAt });
        S.details[id] = { collection: { id, person, aliases, createdAt }, documents: [], totals: { documents: 0, chunks: 0, words: 0, estPages: 0 }, runs: [] };
        return { id, person, aliases, ownerToken: `demo-${hex()}${hex()}` };
      }
      if ((m = path.match(/^\/api\/collections\/([^/]+)$/)) && method === 'GET') {
        const d = S.details[decodeURIComponent(m[1])];
        if (!d) fail(404, 'Collection not found.');
        tickDocs(d);
        return strip(d);
      }
      if ((m = path.match(/^\/api\/collections\/([^/]+)\/runs$/)) && method === 'POST') {
        const cid = decodeURIComponent(m[1]);
        const d = S.details[cid];
        if (!d) fail(404, 'Collection not found.');
        if (!d.documents.some((x) => x.status === 'ready')) fail(400, 'This collection has no ready documents yet.');
        const id = `r${hex()}`;
        const createdAt = new Date().toISOString();
        S.runs[id] = { id, collectionId: cid, kind: 'story', question: null, status: 'running', progress: { stage: 'retrieving', questionsDone: 0, questionsTotal: 20 }, result: null, costUsd: null, error: null, createdAt, finishedAt: null, _t: now() };
        d.runs.unshift({ id, kind: 'story', question: null, status: 'running', createdAt, costUsd: null });
        return { runId: id };
      }
      if ((m = path.match(/^\/api\/collections\/([^/]+)\/ask$/)) && method === 'POST') {
        const cid = decodeURIComponent(m[1]);
        const d = S.details[cid];
        if (!d) fail(404, 'Collection not found.');
        const q = String((body && body.question) || '').trim();
        if (!q) fail(400, 'Type a question first.');
        await wait(1400);
        const base = /kite|lightning|electric/i.test(q) ? S.askYes : S.askNo;
        const result = { ...clone(base.result), question: q };
        const id = `r${hex()}`;
        const createdAt = new Date().toISOString();
        S.runs[id] = { id, collectionId: cid, kind: 'ask', question: q, status: 'done', progress: null, result, costUsd: 0.0029, error: null, createdAt, finishedAt: createdAt };
        d.runs.unshift({ id, kind: 'ask', question: q, status: 'done', createdAt, costUsd: 0.0029 });
        return { runId: id, result };
      }
      if ((m = path.match(/^\/api\/runs\/([^/]+)$/)) && method === 'GET') {
        const run = S.runs[decodeURIComponent(m[1])];
        if (!run) fail(404, 'Run not found.');
        return { run: strip(tickRun(run)) };
      }
      if ((m = path.match(/^\/api\/collections\/([^/]+)\/chunks\/([^/]+)$/)) && method === 'GET') {
        const c = S.story.result.chunks[decodeURIComponent(m[2])];
        if (!c) fail(404, 'Chunk not found.');
        return { chunk: c };
      }
      return fail(404, `Demo has no handler for ${method} ${path}`);
    }

    async function upload(cid, files, onProgress) {
      await init();
      const d = S.details[cid];
      if (!d) fail(404, 'Collection not found.');
      for (let i = 1; i <= 8; i++) { await wait(140); onProgress(i / 8); }
      const start = d.documents.reduce((s, x) => Math.max(s, x.seq), 0);
      const created = files.map((f, i) => {
        const seq = start + i + 1;
        const isPdf = /\.pdf$/i.test(f.name);
        const words = Math.max(200, Math.round(f.size / (isPdf ? 40 : 6.2)));
        const doc = { id: `D${String(seq).padStart(2, '0')}`, seq, filename: f.name, bytes: f.size, words: 0, estPages: 0, chunks: 0, status: 'queued', error: null, progress: null,
          _t: now() + i * 700, _words: words, _pages: Math.max(1, Math.round(words / 275)), _chunks: Math.max(1, Math.ceil(words / 215)), _bad: /scan/i.test(f.name) };
        d.documents.push(doc);
        return doc;
      });
      return { documents: strip(created) };
    }

    function fileUrl(run, file) {
      let text; let type = 'text/markdown';
      const R = run.result || {};
      if (file === 'story.md') {
        const st = R.story || { title: '', sections: [] };
        text = `# ${st.title}\n\n${st.sections.map((s) => `## ${s.heading}\n\n${s.sentences.map((x) => `${x.text}${x.chunkIds.length ? ` [${x.chunkIds.join(', ')}]` : ''}${x.flags.length ? ` (flagged: ${x.flags.join(', ')})` : ''}`).join(' ')}`).join('\n\n')}\n`;
      } else if (file === 'log.json') {
        type = 'application/json';
        text = JSON.stringify({ run: strip(run), entries: [] }, null, 2);
      } else {
        text = `# Run ${run.id}\n\nDemo data: the real log lists every query, retrieval, prompt and response.\n`;
      }
      return URL.createObjectURL(new Blob([text], { type }));
    }

    return { handle, upload, fileUrl };
  })();

  // ---------------------------------------------------------------- boot
  if (DEMO) { const pill = $('#demo-pill'); if (pill) pill.hidden = false; }
  window.addEventListener('hashchange', route);
  route();
})();
