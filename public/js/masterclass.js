(async function () {
    // ── Constants ──────────────────────────────────────────────────────────────
    const FINAL_STATES   = ['e-ν', 'μ-ν', 'e-e', 'μ-μ', '4e', '4μ', '2e-2μ'];
    // Values stored in DB use the same strings as displayed
    const FS_VALUES      = ['e-v', 'μ-ν', 'e-e', 'μ-μ', '4e', '4μ', '2e-2μ'];
    const PRIMARY_STATES = ['W+', 'W-', 'NP(Z,H)', 'Zoo'];
    const NUM_EVENTS     = 100;

    // ── State ──────────────────────────────────────────────────────────────────
    let masterclassId  = null;
    let masterclass    = null;
    let currentDataset = 1;
    // eventData[eventNum] = { fs: 'e-v'|null, ps: 'W+'|null, mass: number|null }
    let eventData      = {};
    let massTimers     = {};   // debounce timers for mass inputs

    // ── DOM refs ───────────────────────────────────────────────────────────────
    const pageLoading   = document.getElementById('page-loading');
    const pageContent   = document.getElementById('page-content');
    const pageError     = document.getElementById('page-error');
    const errorMsg      = document.getElementById('error-msg');
    const mcTitle       = document.getElementById('mc-title');
    const headerSub     = document.getElementById('header-sub');
    const summaryLink   = document.getElementById('summary-link');
    const datasetSelect = document.getElementById('dataset-select');
    const saveStatus    = document.getElementById('save-status');
    const tbody         = document.getElementById('event-tbody');
    const tfoot         = document.getElementById('event-tfoot');

    // ── Init ───────────────────────────────────────────────────────────────────
    const params = new URLSearchParams(window.location.search);
    masterclassId = params.get('id');

    if (!masterclassId) {
        showError('No masterclass specified.');
        return;
    }

    try {
        const resp = await fetch(`/api/masterclasses/${masterclassId}`);
        if (!resp.ok) throw new Error('not found');
        masterclass = await resp.json();
    } catch (e) {
        showError('Masterclass not found.');
        return;
    }

    document.title = `CIMA – ${masterclass.name}`;
    mcTitle.textContent  = masterclass.name;
    headerSub.textContent = masterclass.name;
    summaryLink.href      = `summary.html?id=${masterclassId}`;

    // Build dataset selector
    for (let i = 1; i <= masterclass.num_datasets; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `Dataset ${i}`;
        datasetSelect.appendChild(opt);
    }
    datasetSelect.addEventListener('change', () => {
        flushPendingMassSaves();
        currentDataset = parseInt(datasetSelect.value);
        loadDataset(currentDataset);
    });

    buildTable();
    buildTotalsRow();

    pageLoading.style.display = 'none';
    pageContent.style.display = 'block';

    await loadDataset(1);

    // ── Build Table Structure ──────────────────────────────────────────────────
    function buildTable() {
        const frag = document.createDocumentFragment();

        for (let i = 1; i <= NUM_EVENTS; i++) {
            const tr = document.createElement('tr');
            tr.id = `row-${i}`;

            // Event number
            const numTd = document.createElement('td');
            numTd.className = 'event-num';
            numTd.textContent = i;
            tr.appendChild(numTd);

            // Final State radio buttons
            for (let fi = 0; fi < FS_VALUES.length; fi++) {
                const td = document.createElement('td');
                td.className = 'radio-cell';
                const radio = document.createElement('input');
                radio.type  = 'radio';
                radio.name  = `fs_${i}`;
                radio.value = FS_VALUES[fi];
                radio.id    = `fs_${i}_${fi}`;
                radio.title = FINAL_STATES[fi];
                radio.addEventListener('change', () => onFsChange(i, FS_VALUES[fi]));
                td.appendChild(radio);
                tr.appendChild(td);
            }

            // Primary State radio buttons
            for (let pi = 0; pi < PRIMARY_STATES.length; pi++) {
                const td = document.createElement('td');
                td.className = 'radio-cell';
                const radio = document.createElement('input');
                radio.type  = 'radio';
                radio.name  = `ps_${i}`;
                radio.value = PRIMARY_STATES[pi];
                radio.id    = `ps_${i}_${pi}`;
                radio.title = PRIMARY_STATES[pi];
                radio.addEventListener('change', () => onPsChange(i, PRIMARY_STATES[pi]));
                td.appendChild(radio);
                tr.appendChild(td);
            }

            // Mass [GeV] input
            const massTd = document.createElement('td');
            massTd.className = 'mass-cell';
            const massInput = document.createElement('input');
            massInput.type        = 'number';
            massInput.step        = 'any';
            massInput.min         = '0';
            massInput.id          = `mass_${i}`;
            massInput.className   = 'mass-input';
            massInput.disabled    = true;
            massInput.placeholder = '—';
            massInput.addEventListener('input', () => onMassInput(i));
            massInput.addEventListener('change', () => onMassCommit(i));
            massTd.appendChild(massInput);
            tr.appendChild(massTd);

            // Clear button
            const clearTd = document.createElement('td');
            clearTd.className = 'clear-cell';
            const clearBtn = document.createElement('button');
            clearBtn.className = 'btn-clear-row';
            clearBtn.title     = 'Clear this row';
            clearBtn.textContent = '✕';
            clearBtn.addEventListener('click', () => clearRow(i));
            clearTd.appendChild(clearBtn);
            tr.appendChild(clearTd);

            frag.appendChild(tr);
        }
        tbody.appendChild(frag);
    }

    function buildTotalsRow() {
        const tr = document.createElement('tr');
        tr.className = 'totals-row';

        const labelTd = document.createElement('td');
        labelTd.className = 'totals-label';
        labelTd.textContent = 'Totals';
        tr.appendChild(labelTd);

        for (let fi = 0; fi < FS_VALUES.length; fi++) {
            const td = document.createElement('td');
            td.id = `tot-fs-${fi}`;
            td.textContent = '0';
            tr.appendChild(td);
        }
        for (let pi = 0; pi < PRIMARY_STATES.length; pi++) {
            const td = document.createElement('td');
            td.id = `tot-ps-${pi}`;
            td.textContent = '0';
            tr.appendChild(td);
        }
        // Empty cells for mass and clear columns
        tr.appendChild(document.createElement('td'));
        tr.appendChild(document.createElement('td'));

        tfoot.appendChild(tr);
    }

    // ── Load Dataset ───────────────────────────────────────────────────────────
    async function loadDataset(dsNum) {
        // Reset in-memory state
        eventData = {};

        // Clear all radio buttons and mass inputs
        for (let i = 1; i <= NUM_EVENTS; i++) {
            clearRowUI(i);
        }
        updateAllTotals();

        try {
            const resp = await fetch(`/api/events/${masterclassId}/${dsNum}`);
            if (!resp.ok) return;
            const rows = await resp.json();

            for (const row of rows) {
                const n = row.event_num;
                eventData[n] = {
                    fs:   row.final_state   || null,
                    ps:   row.primary_state || null,
                    mass: row.mass_gev != null ? parseFloat(row.mass_gev) : null
                };
                restoreRowUI(n);
            }
            updateAllTotals();
        } catch (e) {
            // Non-fatal: dataset just has no saved data yet
        }
    }

    function clearRowUI(n) {
        // Uncheck all radios
        document.querySelectorAll(`input[name="fs_${n}"]`).forEach(r => r.checked = false);
        document.querySelectorAll(`input[name="ps_${n}"]`).forEach(r => r.checked = false);
        const massEl = document.getElementById(`mass_${n}`);
        massEl.value    = '';
        massEl.disabled = true;
        massEl.classList.remove('mass-invalid');
        massEl.title = '';
    }

    function restoreRowUI(n) {
        const d = eventData[n];
        if (!d) return;

        if (d.fs) {
            const idx = FS_VALUES.indexOf(d.fs);
            if (idx >= 0) {
                const radio = document.getElementById(`fs_${n}_${idx}`);
                if (radio) radio.checked = true;
            }
        }
        if (d.ps) {
            const idx = PRIMARY_STATES.indexOf(d.ps);
            if (idx >= 0) {
                const radio = document.getElementById(`ps_${n}_${idx}`);
                if (radio) radio.checked = true;
            }
        }
        const massEl = document.getElementById(`mass_${n}`);
        if (d.ps === 'NP(Z,H)') {
            massEl.disabled = false;
            if (d.mass != null) massEl.value = d.mass;
        } else {
            massEl.disabled = true;
            massEl.value = '';
        }
    }

    // ── Event Handlers ─────────────────────────────────────────────────────────
    function onFsChange(n, value) {
        if (!eventData[n]) eventData[n] = { fs: null, ps: null, mass: null };
        eventData[n].fs = value;
        updateAllTotals();
        saveEvent(n);
    }

    function onPsChange(n, value) {
        if (!eventData[n]) eventData[n] = { fs: null, ps: null, mass: null };
        eventData[n].ps = value;

        const massEl = document.getElementById(`mass_${n}`);
        if (value === 'NP(Z,H)') {
            massEl.disabled = false;
            massEl.focus();
        } else {
            massEl.disabled = true;
            massEl.value    = '';
            eventData[n].mass = null;
        }

        updateAllTotals();
        saveEvent(n);
    }

    function onMassInput(n) {
        if (!eventData[n]) eventData[n] = { fs: null, ps: null, mass: null };
        const massEl = document.getElementById(`mass_${n}`);
        const parsed = massEl.value !== '' ? parseFloat(massEl.value) : null;

        if (parsed !== null && parsed <= 0) {
            massEl.classList.add('mass-invalid');
            massEl.title = 'Mass must be greater than zero';
            eventData[n].mass = null;
            clearTimeout(massTimers[n]);
            return;
        }

        massEl.classList.remove('mass-invalid');
        massEl.title = '';
        eventData[n].mass = parsed;

        // Debounce: save 800ms after user stops typing
        clearTimeout(massTimers[n]);
        massTimers[n] = setTimeout(() => saveEvent(n), 800);
    }

    function onMassCommit(n) {
        clearTimeout(massTimers[n]);
        const massEl = document.getElementById(`mass_${n}`);
        const parsed = massEl.value !== '' ? parseFloat(massEl.value) : null;

        if (parsed !== null && parsed <= 0) {
            // Clear the invalid value so the field is clean when the user returns
            massEl.value = '';
            massEl.classList.remove('mass-invalid');
            massEl.title = '';
            if (!eventData[n]) eventData[n] = { fs: null, ps: null, mass: null };
            eventData[n].mass = null;
            saveEvent(n);
            return;
        }

        massEl.classList.remove('mass-invalid');
        massEl.title = '';
        if (eventData[n] && eventData[n].ps === 'NP(Z,H)') saveEvent(n);
    }

    function clearRow(n) {
        clearRowUI(n);
        delete eventData[n];
        updateAllTotals();
        saveEvent(n);  // saves nulls to DB
    }

    function flushPendingMassSaves() {
        for (const n of Object.keys(massTimers)) {
            clearTimeout(massTimers[n]);
            if (eventData[n] && eventData[n].ps === 'NP(Z,H)') saveEvent(parseInt(n));
        }
        massTimers = {};
    }

    // ── Save to Server ─────────────────────────────────────────────────────────
    let saveQueue  = Promise.resolve();
    let saveErrors = 0;

    function saveEvent(n) {
        const d = eventData[n] || { fs: null, ps: null, mass: null };
        const body = {
            masterclass_id: parseInt(masterclassId),
            dataset_num:    currentDataset,
            event_num:      n,
            final_state:    d.fs   || null,
            primary_state:  d.ps   || null,
            mass_gev:       (d.ps === 'NP(Z,H)' && d.mass != null) ? d.mass : null
        };

        setSaveStatus('saving');
        saveQueue = saveQueue.then(async () => {
            try {
                const resp = await fetch('/api/events', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                if (!resp.ok) throw new Error('save failed');
                saveErrors = 0;
                setSaveStatus('saved');
            } catch (e) {
                saveErrors++;
                setSaveStatus('error');
            }
        });
    }

    let saveStatusTimer = null;
    function setSaveStatus(state) {
        saveStatus.className = `save-status ${state}`;
        const labels = { saving: 'Saving…', saved: 'Saved ✓', error: 'Save error ✗' };
        saveStatus.textContent = labels[state];
        clearTimeout(saveStatusTimer);
        if (state === 'saved') {
            saveStatusTimer = setTimeout(() => {
                saveStatus.className = 'save-status hidden';
            }, 2000);
        }
    }

    // ── Totals ─────────────────────────────────────────────────────────────────
    function updateAllTotals() {
        const fsCounts = new Array(FS_VALUES.length).fill(0);
        const psCounts = new Array(PRIMARY_STATES.length).fill(0);

        for (const d of Object.values(eventData)) {
            if (d.fs) {
                const i = FS_VALUES.indexOf(d.fs);
                if (i >= 0) fsCounts[i]++;
            }
            if (d.ps) {
                const i = PRIMARY_STATES.indexOf(d.ps);
                if (i >= 0) psCounts[i]++;
            }
        }

        for (let i = 0; i < FS_VALUES.length; i++) {
            document.getElementById(`tot-fs-${i}`).textContent = fsCounts[i];
        }
        for (let i = 0; i < PRIMARY_STATES.length; i++) {
            document.getElementById(`tot-ps-${i}`).textContent = psCounts[i];
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────────
    function showError(msg) {
        pageLoading.style.display = 'none';
        pageContent.style.display = 'none';
        errorMsg.textContent      = msg;
        pageError.style.display   = 'block';
    }
})();
