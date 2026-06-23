// Tiny admin SPA. No framework, hash-based routing.
const root = document.getElementById('root');
const tenantPill = document.getElementById('tenantPill');
const sidebar = document.getElementById('sidebar');
const menuToggle = document.getElementById('menuToggle');
const helpBtn = document.getElementById('helpBtn');
const helpOverlay = document.getElementById('helpOverlay');
const helpDrawer = document.getElementById('helpDrawer');
const helpClose = document.getElementById('helpClose');
const helpBody = document.getElementById('helpBody');

const POLL_MS = 2500;
const ACTIVE_STATUSES = new Set([
    'received',
    'extracting',
    'validating',
    'transforming',
    'uploading',
    'importing',
]);

async function fetchJson(path, init) {
    const res = await fetch(path, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
}

function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') node.className = v;
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v !== false && v !== null && v !== undefined) node.setAttribute(k, v);
    }
    for (const child of [].concat(children)) {
        if (child === null || child === undefined || child === false) continue;
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
}

function clear(parent) {
    while (parent.firstChild) parent.removeChild(parent.firstChild);
}

function fmtBytes(n) {
    if (!n && n !== 0) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
function fmtDate(s) {
    if (!s) return '—';
    return new Date(s).toLocaleString();
}
function fmtTime(s) {
    if (!s) return '';
    return new Date(s).toLocaleTimeString([], { hour12: false });
}
function relativeTime(s) {
    if (!s) return '';
    const diff = Date.now() - new Date(s).getTime();
    const sec = Math.round(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const h = Math.round(min / 60);
    if (h < 48) return `${h}h ago`;
    return new Date(s).toLocaleDateString();
}

function badge(status) {
    return el('span', { class: `badge ${status}` }, status);
}

// ──────────────────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────────────────

async function renderHome() {
    clear(root);
    root.append(el('h2', {}, 'Upload catalog'));
    root.append(buildUploader());
    root.append(el('h2', { style: 'margin-top:28px' }, 'Master catalogs'));

    const wrapper = el('div', { class: 'card', id: 'catalogsList' }, el('p', { class: 'empty' }, 'Loading catalogs…'));
    root.append(wrapper);

    try {
        const data = await fetchJson('/api/catalogs');
        clear(wrapper);
        if (data.count === 0) {
            wrapper.append(el('p', { class: 'empty' }, 'No catalogs yet. Upload products to get started.'));
            return;
        }
        for (const s of data.catalogs) {
            const row = el(
                'a',
                { class: 'catalog-row', href: `#/catalogs/${encodeURIComponent(s.masterCatalogId)}` },
                [
                    el('div', {}, [
                        el('div', { class: 'name' }, s.displayName ?? s.masterCatalogId),
                        el('div', { class: 'id' }, [
                            'catalog: ',
                            el('code', {}, s.masterCatalogId),
                            s.catalogExists ? '' : ' (will be created on next upload)',
                        ]),
                    ]),
                    el('div', { class: 'stat' }, [
                        `${s.knownProductIds.length} products`,
                        el('br'),
                        `${s.uploadCount} uploads`,
                    ]),
                    el('div', { class: 'stat' }, [
                        s.lastUploadStatus ? badge(s.lastUploadStatus) : '',
                        el('br'),
                        relativeTime(s.lastUploadAt),
                    ]),
                ]
            );
            wrapper.append(row);
        }
    } catch (err) {
        clear(wrapper);
        wrapper.append(el('p', { class: 'empty' }, `Failed to load catalogs: ${err.message}`));
    }
}

async function renderCatalogDetail(masterCatalogId) {
    clear(root);
    root.append(
        el('div', { class: 'row-actions' }, [
            el('a', { href: '#/' }, '← Back to all catalogs'),
        ])
    );
    root.append(el('h2', {}, `Master catalog: ${masterCatalogId}`));
    const summary = el('div', { class: 'card' }, el('p', { class: 'empty' }, 'Loading…'));
    root.append(summary);
    root.append(el('h2', {}, 'Products'));
    const productsCard = el('div', { class: 'card' }, '');
    root.append(productsCard);
    // Hidden by default — editor reveals after first save with the API trace.
    const apiCallsHeader = el('h2', { style: 'display:none' }, 'Last save · API calls');
    const apiCallsCard = el('div', { class: 'card', style: 'display:none' }, '');
    root.append(apiCallsHeader);
    root.append(apiCallsCard);
    root.append(el('h2', {}, 'Upload history'));
    const historyCard = el('div', { class: 'card' }, '');
    root.append(historyCard);

    try {
        const { catalog } = await fetchJson(`/api/catalogs/${encodeURIComponent(masterCatalogId)}`);
        clear(summary);
        summary.append(
            el('dl', { class: 'kv' }, [
                el('dt', {}, 'Display name'), el('dd', {}, catalog.displayName ?? '—'),
                el('dt', {}, 'Master catalog'), el('dd', {}, el('code', {}, catalog.masterCatalogId)),
                el('dt', {}, 'Catalog in B2C'), el('dd', {}, catalog.catalogExists ? 'yes' : 'no'),
                el('dt', {}, 'Products'), el('dd', {}, String(catalog.productCount)),
            ])
        );

        clear(productsCard);
        if (catalog.productIds.length === 0) {
            productsCard.append(el('p', { class: 'empty' }, 'No products yet.'));
        } else {
            productsCard.append(buildProductEditor({ masterCatalogId, apiCallsHeader, apiCallsCard }));
        }

        clear(historyCard);
        if (catalog.uploads.length === 0) {
            historyCard.append(el('p', { class: 'empty' }, 'No uploads.'));
        } else {
            for (const u of catalog.uploads) {
                historyCard.append(buildUploadRow(u));
            }
        }
    } catch (err) {
        clear(summary);
        summary.append(el('p', { class: 'empty' }, `Failed: ${err.message}`));
    }
}

function buildUploadRow(u) {
    return el(
        'a',
        { class: 'catalog-row', href: `#/uploads/${u.id}` },
        [
            el('div', {}, [
                el('div', { class: 'name' }, u.sourceFilename),
                el('div', { class: 'id' }, [
                    `${u.productCount ?? '?'} products · `,
                    `${(u.newCategoryIds ?? []).length} new cats · `,
                    `${(u.reusedCategoryIds ?? []).length} reused`,
                ]),
            ]),
            el('div', { class: 'stat' }, [fmtBytes(u.sourceBytes), el('br'), relativeTime(u.receivedAt)]),
            el('div', { class: 'stat' }, [
                badge(u.status),
                u.job ? el('div', {}, ['exec ', u.job.executionId]) : el('div', {}, '—'),
            ]),
        ]
    );
}

async function renderUploadDetail(uploadId) {
    clear(root);
    root.append(el('div', { class: 'row-actions' }, [el('a', { href: '#/' }, '← Back to home')]));
    root.append(el('h2', {}, `Upload ${uploadId.slice(0, 8)}…`));
    const summary = el('div', { class: 'card' }, el('p', { class: 'empty' }, 'Loading…'));
    root.append(summary);
    root.append(el('h2', {}, 'Timeline'));
    const timelineCard = el('div', { class: 'card' }, '');
    root.append(timelineCard);
    root.append(el('h2', {}, 'API calls'));
    const apiCard = el('div', { class: 'card' }, el('p', { class: 'empty' }, 'No API calls yet.'));
    root.append(apiCard);

    // Track which call rows are mounted and which are user-expanded so polls
    // don't blow the open <details> away.
    const renderedSeqs = new Set();
    const expandedSeqs = new Set();

    let active = true;
    async function tick() {
        if (!active) return;
        try {
            const { upload: u } = await fetchJson(`/api/uploads/${encodeURIComponent(uploadId)}`);
            clear(summary);
            summary.append(
                el('dl', { class: 'kv' }, [
                    el('dt', {}, 'Status'), el('dd', {}, badge(u.status)),
                    el('dt', {}, 'Master catalog'), el('dd', {}, [
                        el('a', { href: `#/catalogs/${encodeURIComponent(u.masterCatalogId)}` }, u.masterCatalogId),
                    ]),
                    el('dt', {}, 'File'), el('dd', {}, `${u.sourceFilename} (${fmtBytes(u.sourceBytes)})`),
                    el('dt', {}, 'Received'), el('dd', {}, fmtDate(u.receivedAt)),
                    u.job ? el('dt', {}, 'Job') : null,
                    u.job ? el('dd', {}, [
                        u.job.jobId, ' · execution ', el('code', {}, u.job.executionId),
                        ' · ', badge((u.job.status || '').toLowerCase()),
                    ]) : null,
                    u.validation ? el('dt', {}, 'Validation') : null,
                    u.validation ? el('dd', {}, u.validation.ok
                        ? `OK · ${u.validation.productCount} products · categories: ${(u.validation.categoryIds ?? []).join(', ') || '—'}`
                        : `Failed: ${u.validation.errors.join('; ')}`)
                        : null,
                    u.transform ? el('dt', {}, 'Transform') : null,
                    u.transform ? el('dd', {}, [
                        `new categories: ${(u.transform.newCategoryIds || []).join(', ') || '∅'}`,
                        el('br'),
                        `reused: ${(u.transform.reusedCategoryIds || []).join(', ') || '∅'}`,
                        el('br'),
                        `assignments published: ${u.transform.assignmentsPublished}`,
                    ]) : null,
                    u.webdav ? el('dt', {}, 'WebDAV') : null,
                    u.webdav ? el('dd', {}, [u.webdav.remoteName, ' (', fmtBytes(u.webdav.bytes), ')']) : null,
                    u.error ? el('dt', {}, 'Error') : null,
                    u.error ? el('dd', {}, u.error) : null,
                ])
            );

            clear(timelineCard);
            const ul = el('ul', { class: 'timeline' });
            for (const e of u.events.slice().reverse()) {
                ul.append(
                    el('li', {}, [
                        el('span', { class: 'time' }, fmtTime(e.at)),
                        badge(e.status),
                        el('span', {}, e.message ?? ''),
                    ])
                );
            }
            timelineCard.append(ul);

            renderApiCalls(apiCard, u.apiCalls ?? [], renderedSeqs, expandedSeqs);

            if (ACTIVE_STATUSES.has(u.status)) {
                setTimeout(tick, POLL_MS);
            }
        } catch (err) {
            clear(summary);
            summary.append(el('p', { class: 'empty' }, `Failed: ${err.message}`));
        }
    }

    tick();

    window.addEventListener('hashchange', () => { active = false; }, { once: true });
}

// ──────────────────────────────────────────────────────────────────────────
// API calls panel (demo of underlying SFCC requests)
// ──────────────────────────────────────────────────────────────────────────

/** One-shot rendering of an `apiCalls` array attached to a request response
 *  (used by the live-edit save flow). Replaces the card content each time and
 *  reveals the header. */
function renderLastSaveApiCalls(headerEl, container, calls) {
    if (headerEl) headerEl.style.display = '';
    container.style.display = '';
    clear(container);
    if (!calls.length) {
        container.append(el('p', { class: 'empty' }, 'No API calls captured.'));
        return;
    }
    container._expanded ??= new Set();
    for (const c of calls) {
        container.append(buildApiCallRow(c, container._expanded));
    }
}

function renderApiCalls(container, calls, renderedSeqs, expandedSeqs) {
    if (!calls.length) {
        if (renderedSeqs.size === 0) return;
        clear(container);
        container.append(el('p', { class: 'empty' }, 'No API calls yet.'));
        renderedSeqs.clear();
        return;
    }
    if (renderedSeqs.size === 0 && container.firstChild) {
        clear(container);
    }
    for (const c of calls) {
        if (renderedSeqs.has(c.seq)) continue;
        renderedSeqs.add(c.seq);
        container.append(buildApiCallRow(c, expandedSeqs));
    }
}

function buildApiCallRow(call, expandedSeqs) {
    const detail = el('details', { class: 'api-call' });
    if (expandedSeqs.has(call.seq)) detail.setAttribute('open', '');
    detail.addEventListener('toggle', () => {
        if (detail.open) expandedSeqs.add(call.seq);
        else expandedSeqs.delete(call.seq);
    });

    const statusPill = call.error
        ? el('span', { class: 'status-pill err' }, 'ERR')
        : el('span', { class: `status-pill ${statusBucket(call.status)}` }, String(call.status ?? '—'));

    const summaryRow = el('summary', {}, [
        el('span', { class: 'seq' }, `#${call.seq}`),
        el('span', { class: `method ${call.method}` }, call.method),
        el('span', { class: 'label' }, [
            el('span', { class: 'api-tag' }, `${call.api} · `),
            call.label,
        ]),
        statusPill,
        el('span', { class: 'duration' }, call.durationMs != null ? `${call.durationMs}ms` : ''),
    ]);
    detail.append(summaryRow);

    const body = el('div', { class: 'body' }, []);
    body.append(el('div', { class: 'url' }, `${call.method} ${call.url}`));

    if (call.requestHeaders && Object.keys(call.requestHeaders).length) {
        body.append(
            el('section', {}, [
                el('h4', {}, 'Request headers'),
                el('pre', {}, formatPretty(call.requestHeaders)),
            ])
        );
    }
    if (call.requestBody !== undefined && call.requestBody !== '') {
        body.append(
            el('section', {}, [
                el('h4', {}, 'Request payload'),
                el('pre', {}, formatPretty(call.requestBody)),
            ])
        );
    }
    if (call.error) {
        body.append(
            el('section', {}, [
                el('h4', {}, 'Error'),
                el('pre', {}, call.error),
            ])
        );
    }
    if (call.responseHeaders && Object.keys(call.responseHeaders).length) {
        body.append(
            el('section', {}, [
                el('h4', {}, `Response headers · HTTP ${call.status ?? '—'}`),
                el('pre', {}, formatPretty(call.responseHeaders)),
            ])
        );
    }
    if (call.responseBody !== undefined && call.responseBody !== '') {
        body.append(
            el('section', {}, [
                el('h4', {}, 'Response body'),
                el('pre', {}, formatPretty(call.responseBody)),
            ])
        );
    }
    detail.append(body);
    return detail;
}

function statusBucket(status) {
    if (!status) return 'err';
    if (status >= 200 && status < 300) return 's2xx';
    if (status >= 300 && status < 400) return 's3xx';
    if (status >= 400 && status < 500) return 's4xx';
    return 's5xx';
}

function formatPretty(v) {
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

// ──────────────────────────────────────────────────────────────────────────
// Uploader
// ──────────────────────────────────────────────────────────────────────────

function buildUploader() {
    const card = el('div', { class: 'card' });
    const dzName = el('div', { class: 'name' }, 'Drag a .zip or .csv here or click to browse');
    const dzHint = el('div', { class: 'hint' }, '.zip → site-archive (catalog.xml + pricebooks + inventory). .csv → flat product list (id, name, price, category required).');
    const dz = el('label', { class: 'uploader', for: 'fileInput' }, [dzName, dzHint]);
    const fileInput = el('input', { type: 'file', id: 'fileInput', accept: '.zip,.csv' });
    dz.append(fileInput);

    let chosen = null;
    function setChosen(f) {
        chosen = f;
        if (f) {
            dzName.textContent = `${f.name} (${fmtBytes(f.size)})`;
            dzHint.textContent = 'Click to choose another file or drop a new one.';
        }
    }

    fileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) setChosen(e.target.files[0]);
    });

    ['dragenter', 'dragover'].forEach((ev) =>
        dz.addEventListener(ev, (e) => {
            e.preventDefault();
            dz.classList.add('drag');
        })
    );
    ['dragleave', 'drop'].forEach((ev) =>
        dz.addEventListener(ev, (e) => {
            e.preventDefault();
            dz.classList.remove('drag');
        })
    );
    dz.addEventListener('drop', (e) => {
        const f = e.dataTransfer.files?.[0];
        if (f) setChosen(f);
    });

    card.append(dz);

    card.append(
        el('p', { class: 'hint', style: 'margin:6px 0 0;text-align:right' }, [
            el(
                'a',
                { href: '/api/csv-template', download: 'catalog-template.csv' },
                '📥 Download CSV template'
            ),
        ])
    );

    // ── Master catalog (existing or new) ──
    const masterSelect = el('select', { id: 'masterSelect' });
    const masterIdInput = el('input', { type: 'text', id: 'masterIdInput', placeholder: 'acme-products' });
    const masterNewWrap = el('div', { style: 'margin-top:8px' }, [
        el('label', { for: 'masterIdInput' }, 'New master catalog id'),
        masterIdInput,
        el('p', { class: 'hint', style: 'margin:4px 0 0' },
            'The catalog will be created automatically on the first import if it doesn\'t exist. Use letters, digits, hyphen or underscore (1–100 chars).'),
    ]);
    masterNewWrap.style.display = 'none';

    masterSelect.addEventListener('change', () => {
        masterNewWrap.style.display = masterSelect.value === '__new__' ? 'block' : 'none';
    });

    card.append(
        el('div', { style: 'margin-top:8px' }, [
            el('label', { for: 'masterSelect' }, 'Master catalog (target)'),
            masterSelect,
            masterNewWrap,
        ])
    );

    // ── Identifiers (storefront catalog / pricebook / inventory) ──
    const catalogSelect = el('select', { id: 'catalogSelect' });
    const catalogInput = el('input', { type: 'text', id: 'catalogInput', placeholder: 'your-storefront-catalog' });
    const pricebookSelect = el('select', { id: 'pricebookSelect' });
    const pricebookInput = el('input', { type: 'text', id: 'pricebookInput', placeholder: 'your-pricebook-id' });
    const inventorySelect = el('select', { id: 'inventorySelect' });
    const inventoryInput = el('input', { type: 'text', id: 'inventoryInput', placeholder: 'your-inventory-list' });

    function bindNewToggle(selectEl, inputEl) {
        inputEl.style.display = 'none';
        inputEl.style.marginTop = '4px';
        selectEl.addEventListener('change', () => {
            inputEl.style.display = selectEl.value === '__new__' ? 'block' : 'none';
        });
    }
    bindNewToggle(catalogSelect, catalogInput);
    bindNewToggle(pricebookSelect, pricebookInput);
    bindNewToggle(inventorySelect, inventoryInput);

    const idsRow = el('div', { class: 'form-row', style: 'margin-top:14px' }, [
        el('div', {}, [el('label', { for: 'catalogSelect' }, 'Storefront catalog (cross-publish)'), catalogSelect, catalogInput]),
        el('div', {}, [el('label', { for: 'pricebookSelect' }, 'Pricebook'), pricebookSelect, pricebookInput]),
    ]);
    const inventoryRow = el('div', { style: 'margin-top:8px' }, [
        el('label', { for: 'inventorySelect' }, 'Inventory list'),
        inventorySelect,
        inventoryInput,
    ]);
    card.append(idsRow);
    card.append(inventoryRow);

    // Populate selects from /api/discover. Falls back to text inputs only if it fails.
    void (async () => {
        try {
            const data = await fetchJson('/api/discover');
            const { defaults, options } = data;

            // Master catalog select
            masterSelect.append(el('option', { value: '__new__' }, '➕ New master catalog…'));
            for (const m of options.masterCatalogs ?? []) {
                masterSelect.append(
                    el(
                        'option',
                        { value: m.id },
                        m.displayName ? `${m.displayName} (${m.id})` : m.id
                    )
                );
            }
            if ((options.masterCatalogs ?? []).length === 0) {
                masterSelect.value = '__new__';
                masterNewWrap.style.display = 'block';
            } else {
                masterSelect.value = options.masterCatalogs[0].id;
            }

            // Storefront catalog select — every B2C catalog is a candidate; default highlighted.
            for (const c of options.catalogs ?? []) {
                appendOption(catalogSelect, c.id, c.id === defaults.storefrontCatalogId ? `${c.id} (default)` : c.id);
            }
            catalogSelect.append(el('option', { value: '__new__' }, '➕ New catalog id…'));
            catalogSelect.value = defaults.storefrontCatalogId;

            // Pricebook select
            for (const p of options.pricebooks ?? []) {
                appendOption(pricebookSelect, p.id, p.id === defaults.pricebookId ? `${p.id} (default)` : p.id);
            }
            pricebookSelect.append(el('option', { value: '__new__' }, '➕ New pricebook id…'));
            pricebookSelect.value = defaults.pricebookId;

            // Inventory select
            for (const i of options.inventoryLists ?? []) {
                const lbl = i.id === defaults.inventoryListId ? `${i.id} (default)` : i.description ? `${i.id} — ${i.description}` : i.id;
                appendOption(inventorySelect, i.id, lbl);
            }
            inventorySelect.append(el('option', { value: '__new__' }, '➕ New inventory list id…'));
            inventorySelect.value = defaults.inventoryListId;
        } catch (err) {
            console.warn('discover failed, falling back to manual inputs', err);
            for (const [sel, inp] of [
                [masterSelect, masterIdInput],
                [catalogSelect, catalogInput],
                [pricebookSelect, pricebookInput],
                [inventorySelect, inventoryInput],
            ]) {
                sel.style.display = 'none';
                inp.style.display = 'block';
            }
            masterNewWrap.style.display = 'block';
        }
    })();

    const status = el('p', { class: 'hint', id: 'uploadStatus' }, '');
    const submit = el('button', { class: 'primary' }, 'Upload');
    submit.addEventListener('click', async () => {
        const pickValue = (selectEl, inputEl) => {
            const sel = selectEl.value;
            return sel === '__new__' ? inputEl.value.trim() : sel;
        };

        const masterCatalogId = pickValue(masterSelect, masterIdInput);
        const storefrontCatalogId = pickValue(catalogSelect, catalogInput);
        const pricebookId = pickValue(pricebookSelect, pricebookInput);
        const inventoryListId = pickValue(inventorySelect, inventoryInput);

        if (!chosen) { status.textContent = 'Choose a .zip or .csv file first.'; return; }
        if (!masterCatalogId) { status.textContent = 'Master catalog id is required.'; return; }
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(masterCatalogId)) {
            status.textContent = 'Master catalog id must be 1–100 chars: letters, digits, hyphen or underscore.';
            return;
        }
        if (!storefrontCatalogId) { status.textContent = 'Storefront catalog id is required.'; return; }
        if (!pricebookId) { status.textContent = 'Pricebook id is required.'; return; }
        if (!inventoryListId) { status.textContent = 'Inventory list id is required.'; return; }

        const fd = new FormData();
        fd.append('file', chosen);
        fd.append('storefrontCatalogId', storefrontCatalogId);
        fd.append('pricebookId', pricebookId);
        fd.append('inventoryListId', inventoryListId);

        submit.disabled = true;
        submit.textContent = 'Uploading…';
        status.textContent = '';
        clear(status);
        const isCsv = /\.csv$/i.test(chosen.name);
        const endpoint = isCsv
            ? `/api/catalogs/${encodeURIComponent(masterCatalogId)}/uploads/csv`
            : `/api/catalogs/${encodeURIComponent(masterCatalogId)}/uploads`;
        try {
            const res = await fetch(endpoint, { method: 'POST', body: fd });
            const data = await res.json();
            if (!res.ok || !data.ok) {
                if (Array.isArray(data.csvErrors) && data.csvErrors.length > 0) {
                    status.append(
                        el('strong', {}, `${data.csvErrors.length} CSV error(s):`),
                        el('ul', { style: 'margin:6px 0 0;padding-left:20px' },
                            data.csvErrors.slice(0, 20).map((e) =>
                                el('li', {}, `Row ${e.row}${e.column ? ` · ${e.column}` : ''}: ${e.message}`)
                            )
                        )
                    );
                    if (data.csvErrors.length > 20) {
                        status.append(el('p', {}, `…and ${data.csvErrors.length - 20} more`));
                    }
                    return;
                }
                throw new Error(data.error || `HTTP ${res.status}`);
            }
            location.hash = `#/preview/${data.uploadId}`;
        } catch (err) {
            status.textContent = `Upload failed: ${err.message}`;
        } finally {
            submit.disabled = false;
            submit.textContent = 'Upload';
        }
    });

    card.append(el('div', { class: 'form-actions' }, [status, submit]));
    return card;
}

function appendOption(selectEl, value, label) {
    selectEl.append(el('option', { value }, label));
}

// ──────────────────────────────────────────────────────────────────────────
// Preview screen
// ──────────────────────────────────────────────────────────────────────────

const PREVIEW_POLL_MS = 1500;
const PREVIEW_PENDING = new Set([
    'received',
    'extracting',
    'validating',
]);

async function renderPreview(uploadId) {
    clear(root);
    root.append(
        el('div', { class: 'row-actions' }, [el('a', { href: '#/' }, '← Back to home')])
    );
    root.append(el('h2', {}, 'Review upload'));
    const headCard = el('div', { class: 'card' }, el('p', { class: 'empty' }, 'Loading preview…'));
    root.append(headCard);
    const productsHeader = el('h2', { style: 'display:none' }, 'Products');
    const productsCard = el('div', { class: 'card', style: 'display:none' });
    root.append(productsHeader);
    root.append(productsCard);

    let attempts = 0;
    async function load() {
        try {
            const status = await fetchJson(`/api/uploads/${encodeURIComponent(uploadId)}`);
            const u = status.upload;
            if (PREVIEW_PENDING.has(u.status)) {
                attempts += 1;
                if (attempts < 30) {
                    setTimeout(load, PREVIEW_POLL_MS);
                    return;
                }
                throw new Error('Preview is taking too long.');
            }
            if (u.status === 'invalid') {
                clear(headCard);
                headCard.append(
                    el('p', {}, [
                        'Upload is invalid: ',
                        el('strong', {}, (u.validation?.errors || []).join('; ')),
                    ])
                );
                headCard.append(buildPreviewActions(uploadId, { canCommit: false }));
                return;
            }
            if (u.status === 'failed') {
                clear(headCard);
                headCard.append(el('p', {}, [`Failed: `, el('strong', {}, u.error || 'unknown')]));
                headCard.append(buildPreviewActions(uploadId, { canCommit: false }));
                return;
            }
            if (u.status !== 'previewed') {
                location.hash = `#/uploads/${uploadId}`;
                return;
            }
            const data = await fetchJson(`/api/uploads/${encodeURIComponent(uploadId)}/preview`);
            renderPreviewBody(data, headCard, productsHeader, productsCard, uploadId);
        } catch (err) {
            clear(headCard);
            headCard.append(el('p', { class: 'empty' }, `Failed to load preview: ${err.message}`));
        }
    }
    load();
}

function renderPreviewBody(data, headCard, productsHeader, productsCard, uploadId) {
    const { catalog, targets, preview } = data;
    const s = preview.summary;

    clear(headCard);
    headCard.append(
        el('dl', { class: 'kv' }, [
            el('dt', {}, 'Master catalog'), el('dd', {}, [
                el('strong', {}, catalog.masterCatalogId),
            ]),
            el('dt', {}, 'Storefront'), el('dd', {}, el('code', {}, targets.storefrontCatalogId)),
            el('dt', {}, 'Pricebook'), el('dd', {}, [
                el('code', {}, targets.pricebookId),
                s.pricebookCurrency ? ` (${s.pricebookCurrency})` : '',
                ` · ${s.pricebookEntryCount} entries`,
            ]),
            el('dt', {}, 'Inventory'), el('dd', {}, [
                el('code', {}, targets.inventoryListId),
                ` · ${s.inventoryRecordCount} records`,
                s.productsWithoutStock > 0 ? ` · ${s.productsWithoutStock} without stock (default 10 will apply)` : '',
            ]),
            el('dt', {}, 'Products'), el('dd', {}, `${s.productCount} total`),
            el('dt', {}, 'Categories'), el('dd', {}, [
                s.categoryIds.length ? s.categoryIds.map((c) => el('span', { class: 'chip' }, c)) : '∅',
            ]),
        ])
    );

    const warnings = [];
    if (s.productsWithoutPrice > 0) warnings.push(`${s.productsWithoutPrice} products have no price`);
    if (s.productsWithoutImage > 0) warnings.push(`${s.productsWithoutImage} products have no image`);
    if (warnings.length) {
        headCard.append(
            el('p', { class: 'hint', style: 'color:#f8a4a4;margin-top:8px' }, '⚠ ' + warnings.join(' · '))
        );
    }
    headCard.append(buildPreviewActions(uploadId, { canCommit: true }));

    productsHeader.style.display = '';
    productsCard.style.display = '';
    clear(productsCard);

    const search = el('input', {
        type: 'text',
        placeholder: 'Search by name, SKU, brand or category…',
        style: 'margin-bottom:12px',
    });
    productsCard.append(search);
    const tableHost = el('div');
    productsCard.append(tableHost);

    function applyFilter() {
        const q = search.value.trim().toLowerCase();
        const filtered = q
            ? preview.products.filter((p) =>
                  [p.id, p.displayName, p.brand, p.manufacturerName, ...(p.categories ?? [])]
                      .filter(Boolean)
                      .some((v) => String(v).toLowerCase().includes(q))
              )
            : preview.products;
        clear(tableHost);
        tableHost.append(buildProductsTable(filtered, preview.products.length));
    }
    search.addEventListener('input', applyFilter);
    applyFilter();
}

function buildProductsTable(products, total) {
    if (products.length === 0) {
        return el('p', { class: 'empty' }, total === 0 ? 'No products in this upload.' : 'No products match your search.');
    }
    const wrap = el('div', { style: 'overflow-x:auto' });
    const table = el('table', {
        style:
            'width:100%;border-collapse:collapse;font-size:13px',
    });
    const thead = el('thead');
    thead.append(
        el('tr', {}, [
            th('SKU'),
            th('Name'),
            th('Brand'),
            th('Categories'),
            th('Price', 'right'),
            th('Stock', 'right'),
        ])
    );
    table.append(thead);
    const tbody = el('tbody');
    for (const p of products) {
        tbody.append(
            el('tr', { style: 'border-top:1px solid var(--border)' }, [
                td(el('code', { style: 'font-size:11px' }, p.id)),
                td([
                    el('div', { style: 'font-weight:600' }, p.displayName ?? '—'),
                    p.shortDescription
                        ? el(
                              'div',
                              { style: 'color:var(--muted);font-size:11px;margin-top:2px;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' },
                              p.shortDescription
                          )
                        : null,
                ]),
                td(p.brand ?? p.manufacturerName ?? '—'),
                td(
                    p.categories.length
                        ? p.categories.map((c) => el('span', { class: 'chip' }, c))
                        : '—'
                ),
                td(p.price !== null ? `${p.price.toFixed(2)} ${p.currency || ''}`.trim() : '—', 'right'),
                td(p.stock !== null ? String(p.stock) : el('span', { style: 'color:var(--muted)' }, 'default 10'), 'right'),
            ])
        );
    }
    table.append(tbody);
    wrap.append(table);
    if (products.length < total) {
        wrap.append(
            el(
                'p',
                { class: 'hint', style: 'margin-top:8px' },
                `Showing ${products.length} of ${total} products.`
            )
        );
    }
    return wrap;
}

function th(label, align) {
    return el(
        'th',
        {
            style: `text-align:${align ?? 'left'};color:var(--muted);font-weight:500;padding:8px;text-transform:uppercase;font-size:11px;letter-spacing:0.4px`,
        },
        label
    );
}
function td(content, align) {
    return el(
        'td',
        {
            style: `padding:8px;vertical-align:top;text-align:${align ?? 'left'}`,
        },
        Array.isArray(content) ? content : [content]
    );
}

function buildPreviewActions(uploadId, { canCommit }) {
    const wrap = el('div', { style: 'display:flex;gap:8px;justify-content:flex-end;margin-top:14px' });
    const cancelBtn = el('button', { class: 'ghost' }, 'Cancel upload');
    cancelBtn.addEventListener('click', async () => {
        if (!confirm('Discard this upload? Files will be deleted.')) return;
        cancelBtn.disabled = true;
        try {
            await fetchJson(`/api/uploads/${encodeURIComponent(uploadId)}`, { method: 'DELETE' });
            location.hash = '#/';
        } catch (err) {
            alert(`Cancel failed: ${err.message}`);
            cancelBtn.disabled = false;
        }
    });
    wrap.append(cancelBtn);

    if (canCommit) {
        const commitBtn = el('button', { class: 'primary' }, 'Confirm import →');
        commitBtn.addEventListener('click', async () => {
            commitBtn.disabled = true;
            commitBtn.textContent = 'Submitting…';
            try {
                const data = await fetchJson(`/api/uploads/${encodeURIComponent(uploadId)}/commit`, { method: 'POST' });
                invalidateSidebarCache();
                location.hash = `#/uploads/${data.uploadId}`;
            } catch (err) {
                alert(`Commit failed: ${err.message}`);
                commitBtn.disabled = false;
                commitBtn.textContent = 'Confirm import →';
            }
        });
        wrap.append(commitBtn);
    }
    return wrap;
}

// ──────────────────────────────────────────────────────────────────────────
// Bootstrap
// ──────────────────────────────────────────────────────────────────────────

async function fetchTenantPill() {
    try {
        const data = await fetchJson('/health');
        tenantPill.textContent = data.tenant;
    } catch {
        tenantPill.textContent = 'offline';
    }
}

function route() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const catalogMatch = hash.match(/^\/catalogs\/([^/]+)$/);
    const uploadMatch = hash.match(/^\/uploads\/([^/]+)$/);
    const previewMatch = hash.match(/^\/preview\/([^/]+)$/);
    if (catalogMatch) renderCatalogDetail(decodeURIComponent(catalogMatch[1]));
    else if (previewMatch) renderPreview(decodeURIComponent(previewMatch[1]));
    else if (uploadMatch) renderUploadDetail(decodeURIComponent(uploadMatch[1]));
    else renderHome();
    void renderSidebar();
    sidebar.classList.remove('open');
}

// ──────────────────────────────────────────────────────────────────────────
// Sidebar (persistent master catalogs nav)
// ──────────────────────────────────────────────────────────────────────────

let _sidebarCatalogsCache = null;
let _sidebarLastFetched = 0;
const SIDEBAR_CACHE_MS = 15_000;

async function renderSidebar() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const isHome = hash === '/' || hash === '';
    const catalogMatch = hash.match(/^\/catalogs\/([^/]+)$/);
    const activeCatalogId = catalogMatch ? decodeURIComponent(catalogMatch[1]) : null;

    const now = Date.now();
    if (!_sidebarCatalogsCache || now - _sidebarLastFetched > SIDEBAR_CACHE_MS) {
        try {
            const data = await fetchJson('/api/catalogs');
            _sidebarCatalogsCache = data.catalogs || [];
            _sidebarLastFetched = now;
        } catch {
            _sidebarCatalogsCache = _sidebarCatalogsCache ?? [];
        }
    }
    const catalogs = _sidebarCatalogsCache;

    clear(sidebar);
    sidebar.append(
        el('h3', {}, 'Workspace'),
        el(
            'a',
            { class: 'nav-item' + (isHome ? ' active' : ''), href: '#/' },
            ['🏠 Home']
        ),
        el(
            'a',
            { class: 'nav-item dim', href: '/api/csv-template', download: 'catalog-template.csv' },
            ['📥 CSV template']
        )
    );

    sidebar.append(
        el('h3', {}, ['Master catalogs ', el('span', { class: 'count' }, String(catalogs.length))])
    );
    if (catalogs.length === 0) {
        sidebar.append(el('p', { class: 'empty-mini' }, 'No catalogs yet.'));
    } else {
        for (const s of catalogs) {
            sidebar.append(
                el(
                    'a',
                    {
                        class:
                            'nav-item' + (activeCatalogId === s.masterCatalogId ? ' active' : ''),
                        href: `#/catalogs/${encodeURIComponent(s.masterCatalogId)}`,
                    },
                    [
                        s.displayName ?? s.masterCatalogId,
                        el('span', { class: 'meta' }, `${s.knownProductIds?.length ?? 0}`),
                    ]
                )
            );
        }
    }
}

function invalidateSidebarCache() {
    _sidebarCatalogsCache = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Product editor (live edit via /api/catalogs/:id/products PATCH)
// ─────────────────────────────────────────────────────────────────────────────

function buildProductEditor({ masterCatalogId, apiCallsHeader, apiCallsCard }) {
    const wrap = el('div', { class: 'product-editor' });
    const status = el('div', { class: 'pe-status' }, 'Loading products…');
    const tableHost = el('div', { class: 'pe-table-host' });
    const footer = el('div', { class: 'pe-footer' });
    wrap.append(status, tableHost, footer);

    const state = {
        rows: new Map(),
        start: 0,
        count: 25,
        total: 0,
        loading: false,
        submitting: false,
    };

    async function load(start = 0) {
        state.loading = true;
        state.start = start;
        renderStatus();
        try {
            const data = await fetchJson(
                `/api/catalogs/${encodeURIComponent(masterCatalogId)}/products?start=${start}&count=${state.count}`
            );
            state.total = data.total;
            state.rows.clear();
            for (const p of data.products) {
                state.rows.set(p.id, {
                    server: p,
                    draft: { ...p },
                    dirty: false,
                    lastError: null,
                });
            }
        } catch (err) {
            status.textContent = `Failed to load: ${err.message}`;
            return;
        } finally {
            state.loading = false;
        }
        renderTable();
        renderFooter();
        renderStatus();
    }

    function renderStatus() {
        if (state.loading) {
            status.textContent = 'Loading products…';
            return;
        }
        const dirtyCount = [...state.rows.values()].filter((r) => r.dirty).length;
        const showing = `${state.start + 1}–${Math.min(state.start + state.rows.size, state.total)}`;
        status.textContent =
            `Showing ${showing} of ${state.total}${dirtyCount > 0 ? ` · ${dirtyCount} unsaved` : ''}`;
    }

    function renderTable() {
        clear(tableHost);
        const table = el('table', { class: 'pe-table' });
        const thead = el('thead', {}, el('tr', {}, [
            el('th', {}, 'SKU'),
            el('th', {}, 'Name'),
            el('th', {}, 'Short description'),
            el('th', {}, 'Price'),
            el('th', {}, 'Stock'),
            el('th', {}, 'Online'),
            el('th', {}, ''),
        ]));
        table.append(thead);
        const tbody = el('tbody');
        for (const [sku, row] of state.rows) {
            tbody.append(buildRow(sku, row));
        }
        table.append(tbody);
        tableHost.append(table);
    }

    function buildRow(sku, row) {
        const tr = el('tr', {
            class: 'pe-row' + (row.dirty ? ' dirty' : ''),
            'data-sku': sku,
        });

        const editable = row._editing === true;

        const skuTd = el('td', {}, el('code', {}, sku));

        const nameTd = el('td', {});
        if (editable) {
            const input = el('input', { type: 'text', value: row.draft.name ?? '' });
            input.addEventListener('input', () => updateField(sku, 'name', input.value));
            nameTd.append(input);
        } else {
            nameTd.textContent = row.draft.name ?? '—';
        }

        const descTd = el('td', {});
        if (editable) {
            const ta = el('textarea', { rows: '2' });
            ta.value = row.draft.shortDescription ?? '';
            ta.addEventListener('input', () => updateField(sku, 'shortDescription', ta.value));
            descTd.append(ta);
        } else {
            descTd.textContent = row.draft.shortDescription ?? '—';
        }

        const priceTd = el('td', {});
        if (editable) {
            const input = el('input', {
                type: 'number',
                step: '0.01',
                min: '0',
                value: row.draft.price ?? '',
            });
            input.addEventListener('input', () => {
                const n = input.value === '' ? null : Number(input.value);
                updateField(sku, 'price', n);
            });
            priceTd.append(input);
            if (row.draft.currency) priceTd.append(el('span', { class: 'pe-suffix' }, row.draft.currency));
        } else {
            priceTd.textContent = row.draft.price != null
                ? `${row.draft.price} ${row.draft.currency ?? ''}`.trim()
                : '—';
        }

        const stockTd = el('td', {});
        if (editable) {
            const input = el('input', {
                type: 'number',
                step: '1',
                min: '0',
                value: row.draft.stock ?? '',
            });
            input.addEventListener('input', () => {
                const n = input.value === '' ? null : Number(input.value);
                updateField(sku, 'stock', n);
            });
            stockTd.append(input);
        } else {
            stockTd.textContent = row.draft.stock != null ? String(row.draft.stock) : '—';
        }

        const onlineTd = el('td', {});
        const cb = el('input', { type: 'checkbox' });
        cb.checked = row.draft.online === true;
        cb.disabled = !editable;
        cb.addEventListener('change', () => updateField(sku, 'online', cb.checked));
        onlineTd.append(cb);

        const actionsTd = el('td', { class: 'pe-actions' });
        if (editable) {
            const cancel = el('button', { class: 'ghost', type: 'button' }, 'Cancel');
            cancel.addEventListener('click', () => cancelEdit(sku));
            actionsTd.append(cancel);
        } else {
            const edit = el('button', { class: 'ghost', type: 'button' }, 'Edit');
            edit.addEventListener('click', () => startEdit(sku));
            actionsTd.append(edit);
        }

        if (row.lastError) {
            const errTd = el('td', { class: 'pe-error', colspan: '7' }, row.lastError);
            const errRow = el('tr', { class: 'pe-error-row' }, errTd);
            tr.append(skuTd, nameTd, descTd, priceTd, stockTd, onlineTd, actionsTd);
            const frag = document.createDocumentFragment();
            frag.append(tr, errRow);
            return frag;
        }
        tr.append(skuTd, nameTd, descTd, priceTd, stockTd, onlineTd, actionsTd);
        return tr;
    }

    function startEdit(sku) {
        const row = state.rows.get(sku);
        if (!row) return;
        row._editing = true;
        renderTable();
    }

    function cancelEdit(sku) {
        const row = state.rows.get(sku);
        if (!row) return;
        row._editing = false;
        row.draft = { ...row.server };
        row.dirty = false;
        row.lastError = null;
        renderTable();
        renderStatus();
        renderFooter();
    }

    function updateField(sku, field, value) {
        const row = state.rows.get(sku);
        if (!row) return;
        row.draft[field] = value;
        row.dirty = !shallowEqual(row.draft, row.server);
        const tr = tableHost.querySelector(`.pe-row[data-sku="${cssEscape(sku)}"]`);
        if (tr) tr.classList.toggle('dirty', row.dirty);
        renderStatus();
        renderFooter();
    }

    function renderFooter() {
        clear(footer);
        const dirty = [...state.rows.values()].filter((r) => r.dirty);
        const submit = el(
            'button',
            { class: 'primary', type: 'button', disabled: dirty.length === 0 || state.submitting },
            state.submitting ? 'Saving…' : `Save ${dirty.length} change${dirty.length === 1 ? '' : 's'}`
        );
        submit.addEventListener('click', submitBatch);
        footer.append(submit);

        if (state.total > state.count) {
            const prev = el(
                'button',
                { class: 'ghost', type: 'button', disabled: state.start === 0 || state.submitting },
                '← Prev'
            );
            prev.addEventListener('click', () => load(Math.max(0, state.start - state.count)));
            const next = el(
                'button',
                {
                    class: 'ghost',
                    type: 'button',
                    disabled: state.start + state.count >= state.total || state.submitting,
                },
                'Next →'
            );
            next.addEventListener('click', () => load(state.start + state.count));
            footer.append(el('div', { class: 'pe-pager' }, [prev, next]));
        }
    }

    async function submitBatch() {
        const dirty = [...state.rows.entries()].filter(([, r]) => r.dirty);
        if (dirty.length === 0) return;

        state.submitting = true;
        renderFooter();
        renderStatus();

        const patches = dirty.map(([sku, row]) => {
            const out = { id: sku };
            const s = row.server, d = row.draft;
            if (d.name !== s.name) out.name = d.name ?? '';
            if (d.shortDescription !== s.shortDescription) out.shortDescription = d.shortDescription ?? '';
            if (d.online !== s.online) out.online = !!d.online;
            if (d.price !== s.price && typeof d.price === 'number') {
                out.price = d.price;
                if (d.currency) out.currency = d.currency;
            }
            if (d.stock !== s.stock && typeof d.stock === 'number') out.stock = d.stock;
            return out;
        });

        let result;
        try {
            const res = await fetch(`/api/catalogs/${encodeURIComponent(masterCatalogId)}/products`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ patches }),
            });
            result = await res.json();
            if (!result.ok) throw new Error(result.error || `HTTP ${res.status}`);
        } catch (err) {
            state.submitting = false;
            showToast({ title: 'Save failed', body: err.message, kind: 'error' });
            renderFooter();
            renderStatus();
            return;
        }

        for (const out of result.results) {
            const row = state.rows.get(out.id);
            if (!row) continue;
            if (out.ok) {
                row.server = { ...row.draft };
                row.dirty = false;
                row._editing = false;
                row.lastError = null;
            } else {
                row.lastError = out.failedFields.map((f) => `${f.field}: ${f.error}`).join(' · ');
            }
        }

        state.submitting = false;
        renderTable();
        renderFooter();
        renderStatus();

        if (apiCallsCard && Array.isArray(result.apiCalls)) {
            renderLastSaveApiCalls(apiCallsHeader, apiCallsCard, result.apiCalls);
        }

        const summary =
            `${result.updated} updated${result.failed > 0 ? `, ${result.failed} failed` : ''}`;
        if (result.reindex.triggered) {
            showToast({
                title: summary,
                body: 'Reindexing storefront…',
                kind: result.failed > 0 ? 'warn' : 'success',
            });
            pollReindex(result.reindex.jobId, result.reindex.executionId);
        } else {
            showToast({
                title: summary,
                body: result.reindex.error
                    ? `Reindex skipped (${result.reindex.error})`
                    : 'Reindex skipped — relying on SFCC delta-index.',
                kind: result.failed > 0 ? 'warn' : 'success',
            });
        }
    }

    async function pollReindex(jobId, executionId) {
        const start = Date.now();
        for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 3000));
            try {
                const r = await fetchJson(
                    `/api/jobs/${encodeURIComponent(jobId)}/executions/${encodeURIComponent(executionId)}`
                );
                const s = String(r.status || '').toUpperCase();
                if (['OK', 'FINISHED'].includes(s)) {
                    showToast({
                        title: 'Reindex done',
                        body: `Took ${Math.round((Date.now() - start) / 1000)}s.`,
                        kind: 'success',
                    });
                    return;
                }
                if (['ERROR', 'CANCELLED', 'ABORTED'].includes(s)) {
                    showToast({
                        title: 'Reindex failed',
                        body: `Status: ${s}.`,
                        kind: 'error',
                    });
                    return;
                }
            } catch {
                // ignore transient errors during polling
            }
        }
        showToast({
            title: 'Reindex still running',
            body: 'Stopped polling after 60s. Check BM jobs for final status.',
            kind: 'warn',
        });
    }

    load(0);
    return wrap;
}

function shallowEqual(a, b) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
        if (k.startsWith('_')) continue;
        if (a[k] !== b[k]) return false;
    }
    return true;
}

function cssEscape(s) {
    return String(s).replace(/[^a-zA-Z0-9_-]/g, (m) => `\\${m}`);
}

function showToast({ title, body, kind = 'info' }) {
    let host = document.getElementById('toastHost');
    if (!host) {
        host = el('div', { id: 'toastHost', class: 'toast-host' });
        document.body.append(host);
    }
    const toast = el('div', { class: `toast toast-${kind}` }, [
        el('div', { class: 'toast-title' }, title),
        body ? el('div', { class: 'toast-body' }, body) : null,
    ].filter(Boolean));
    host.append(toast);
    setTimeout(() => toast.classList.add('toast-out'), 5000);
    setTimeout(() => toast.remove(), 5500);
}

// ─────────────────────────────────────────────────────────────────────────────
// Help drawer (setup guide + self-test)
// ─────────────────────────────────────────────────────────────────────────────

const ENV_VARS = [
    { key: 'B2C_INSTANCE_HOST', desc: '<sandbox>.dx.commercecloud.salesforce.com', source: 'BM URL' },
    { key: 'B2C_TENANT', desc: '<sandbox> with hyphens replaced by underscores', source: 'BM URL (e.g. zzse-258 → zzse_258)' },
    { key: 'B2C_ORG_ID', desc: 'f_ecom_<tenant>', source: 'derived' },
    { key: 'B2C_SHORT_CODE', desc: '8-char realm short code', source: 'BM → Administration → Site Development → Salesforce Commerce API Settings' },
    { key: 'STOREFRONT_CATALOG_ID', desc: 'Storefront master catalog id', source: 'Merchant Tools → Products and Catalogs' },
    { key: 'DEFAULT_PRICEBOOK_ID', desc: 'Pricebook the site uses', source: 'Site → Pricebooks' },
    { key: 'DEFAULT_INVENTORY_LIST_ID', desc: 'Inventory list the site uses', source: 'Site → Inventory' },
    { key: 'DEFAULT_INVENTORY_UNITS', desc: 'Units stocked when the source omits inventory (default 10)', source: 'preference' },
    { key: 'AM_CLIENT_ID', desc: 'Account Manager API client UUID', source: 'account.demandware.com' },
    { key: 'AM_CLIENT_SECRET', desc: 'Account Manager client secret', source: 'account.demandware.com' },
    { key: 'WEBDAV_USER', desc: 'Your BM username (typically your SF email)', source: 'BM' },
    { key: 'WEBDAV_PASSWORD', desc: 'BM WebDAV access password', source: 'BM → Administration → Organization → Users → WebDAV Access' },
    { key: 'REINDEX_JOB_ID', desc: 'Job id for SearchReindex; empty = skip reindex', source: 'BM → Administration → Operations → Jobs' },
    { key: 'PORT', desc: 'Default 3001', source: 'preference' },
];

function buildHelp() {
    clear(helpBody);

    helpBody.append(buildHelpSection('Prerequisites', true, [
        el('p', {}, 'Install these once on your machine:'),
        el('ul', {}, [
            el('li', {}, ['Node.js 18+ — ', el('a', { href: 'https://nodejs.org', target: '_blank', rel: 'noopener' }, 'nodejs.org')]),
            el('li', {}, ['pnpm — install with ', el('code', {}, 'npm i -g pnpm')]),
            el('li', {}, 'Access to a B2C Commerce sandbox (Business Manager + WebDAV password)'),
        ]),
    ]));

    helpBody.append(buildHelpSection('Connect a sandbox', false, [
        el('p', {}, [
            'In ', el('strong', {}, 'Account Manager'), ' (',
            el('a', { href: 'https://account.demandware.com', target: '_blank', rel: 'noopener' }, 'account.demandware.com'),
            '), create an API client with scope ',
            el('code', {}, 'SALESFORCE_COMMERCE_API:<tenant>'),
            '. The tenant is the value before ',
            el('code', {}, '.dx.commercecloud.salesforce.com'),
            ' written with underscores (e.g. ', el('code', {}, 'zzse-258'), ' → ', el('code', {}, 'zzse_258'), ').',
        ]),
        el('p', {}, [
            'In ', el('strong', {}, 'Business Manager'), ' → Administration → Operations → Jobs:',
        ]),
        el('ul', {}, [
            el('li', {}, ['Confirm the import job id is ', el('code', {}, 'sfcc-site-archive-import'), ' (default in most BMs).']),
            el('li', {}, ['Create a SearchReindex job for the storefront site (one step, ',
                el('code', {}, 'SearchReindex'),
                ' step type, "Product Search Index" + "Content Search Index" selected). Note the job id.']),
        ]),
        el('p', {}, [
            'In ', el('strong', {}, 'Merchant Tools'), ' → Products and Catalogs, note the storefront master catalog id, the default pricebook, and the default inventory list assigned to the site.',
        ]),
        el('p', {}, [
            'WebDAV credentials are your BM user + a per-user WebDAV password set in ',
            el('strong', {}, 'BM → Administration → Organization → Users → your user → WebDAV Access'), '.',
        ]),
    ]));

    const envTable = el('table', {}, [
        el('thead', {}, el('tr', {}, [
            el('th', {}, 'Variable'),
            el('th', {}, 'What it is'),
            el('th', {}, 'Where to find it'),
        ])),
        el('tbody', {},
            ENV_VARS.map((v) =>
                el('tr', {}, [
                    el('td', {}, el('code', {}, v.key)),
                    el('td', {}, v.desc),
                    el('td', {}, v.source),
                ])
            )
        ),
    ]);

    helpBody.append(buildHelpSection('Environment variables', false, [
        el('p', {}, [
            'Copy ', el('code', {}, '.env.example'), ' to ', el('code', {}, '.env'),
            ' and fill these in:',
        ]),
        codeBlock('cp .env.example .env'),
        envTable,
    ]));

    helpBody.append(buildHelpSection('Self-test', false, [
        el('p', {}, 'Hit the diagnostic endpoints to confirm the BFF is wired correctly.'),
        buildSelfTest(),
    ]));

    helpBody.append(buildHelpSection('Troubleshooting', false, [
        el('ul', {}, [
            el('li', {}, [
                el('strong', {}, '401 invalid_grant'), ' on ', el('code', {}, '/diag/auth'),
                ': check ', el('code', {}, 'AM_CLIENT_ID'), ' / ', el('code', {}, 'AM_CLIENT_SECRET'),
                '. The scope on the AM client must include ', el('code', {}, 'SALESFORCE_COMMERCE_API:<tenant>'), '.',
            ]),
            el('li', {}, [
                'WebDAV ', el('strong', {}, '401'),
                ' on upload: confirm a per-user WebDAV password is set in BM (Administration → Organization → Users → WebDAV Access).',
            ]),
            el('li', {}, [
                el('strong', {}, 'JobNotFound'), ' triggering import: the BM job id default is ',
                el('code', {}, 'sfcc-site-archive-import'),
                '. Open BM → Administration → Operations → Jobs and confirm the id.',
            ]),
            el('li', {}, [
                'Live ', el('strong', {}, 'price edits'), ' fail with 404: OCAPI Data does not expose price_book_entries on every sandbox. The XML import path always works; fall back to a fresh upload.',
            ]),
            el('li', {}, [
                'New catalog products do not appear on the storefront: check that ', el('code', {}, 'REINDEX_JOB_ID'),
                ' is set, or wait 5–15 min for the SFCC delta-index.',
            ]),
        ]),
    ]));
}

function buildHelpSection(title, openByDefault, contentNodes) {
    const detail = el('details', { class: 'help-section' });
    if (openByDefault) detail.setAttribute('open', '');
    detail.append(el('summary', { class: 'help-summary' }, title));
    detail.append(el('div', { class: 'help-content' }, contentNodes));
    return detail;
}

function codeBlock(text) {
    const block = el('div', { class: 'code-block' }, text);
    const btn = el('button', { class: 'copy-btn', type: 'button' }, 'Copy');
    btn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(text);
            const orig = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => (btn.textContent = orig), 1200);
        } catch {
            btn.textContent = 'Copy failed';
        }
    });
    block.append(btn);
    return block;
}

function buildSelfTest() {
    const wrap = el('div');
    const grid = el('div', { class: 'selftest-grid' });
    const runBtn = el('button', { class: 'ghost', type: 'button', style: 'margin-top:8px' }, 'Run self-test');
    wrap.append(runBtn, grid);

    const checks = [
        { label: '/health', url: '/health' },
        { label: '/diag/auth', url: '/diag/auth' },
        { label: '/diag/data-api', url: '/diag/data-api' },
        { label: '/diag/edit-targets', url: '/diag/edit-targets' },
    ];

    runBtn.addEventListener('click', async () => {
        clear(grid);
        const rowEls = checks.map((c) => {
            const lbl = el('div', {}, c.label);
            const stat = el('div', { class: 'pending' }, '⏳');
            const dur = el('div', { class: 'pending' }, '—');
            grid.append(lbl, stat, dur);
            return { stat, dur };
        });
        runBtn.disabled = true;
        const t0 = Date.now();
        await Promise.all(
            checks.map(async (c, i) => {
                const start = Date.now();
                try {
                    const res = await fetch(c.url);
                    const data = await res.json().catch(() => ({}));
                    const ok = res.ok && (data.ok !== false);
                    rowEls[i].stat.className = ok ? 'ok' : 'fail';
                    rowEls[i].stat.textContent = ok ? '🟢 OK' : `🔴 ${data.error ? 'fail' : `HTTP ${res.status}`}`;
                    rowEls[i].dur.textContent = `${Date.now() - start}ms`;
                    rowEls[i].dur.className = '';
                } catch (err) {
                    rowEls[i].stat.className = 'fail';
                    rowEls[i].stat.textContent = '🔴 ' + (err?.message ?? 'error');
                    rowEls[i].dur.textContent = `${Date.now() - start}ms`;
                    rowEls[i].dur.className = '';
                }
            })
        );
        runBtn.disabled = false;
        runBtn.textContent = `Run again (last: ${Date.now() - t0}ms)`;
    });

    return wrap;
}

function openHelpDrawer() {
    if (helpBody.childElementCount === 0) buildHelp();
    helpOverlay.classList.add('open');
    helpDrawer.classList.add('open');
    helpDrawer.setAttribute('aria-hidden', 'false');
}

function closeHelpDrawer() {
    helpOverlay.classList.remove('open');
    helpDrawer.classList.remove('open');
    helpDrawer.setAttribute('aria-hidden', 'true');
}

helpBtn.addEventListener('click', openHelpDrawer);
helpClose.addEventListener('click', closeHelpDrawer);
helpOverlay.addEventListener('click', closeHelpDrawer);
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && helpDrawer.classList.contains('open')) closeHelpDrawer();
});

menuToggle.addEventListener('click', () => sidebar.classList.toggle('open'));

window.addEventListener('hashchange', route);
fetchTenantPill();
route();
