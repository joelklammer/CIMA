(async function () {
    const FINAL_STATES   = ['e-ν', 'μ-ν', 'e-e', 'μ-μ', '4e', '4μ', '2e-2μ'];
    const FS_KEYS        = ['e-v', 'μ-ν', 'e-e', 'μ-μ', '4e', '4μ', '2e-2μ'];
    const PRIMARY_STATES = ['W+', 'W-', 'NP(Z,H)', 'Zoo'];

    // ── DOM refs ───────────────────────────────────────────────────────────────
    const pageLoading    = document.getElementById('page-loading');
    const pageContent    = document.getElementById('page-content');
    const pageError      = document.getElementById('page-error');
    const errorMsg       = document.getElementById('error-msg');
    const mcTitle        = document.getElementById('mc-title');
    const backLink       = document.getElementById('back-link');
    const fsTbody        = document.getElementById('fs-tbody');
    const psTbody        = document.getElementById('ps-tbody');
    const fsGrandTotal   = document.getElementById('fs-grand-total');
    const psGrandTotal   = document.getElementById('ps-grand-total');
    const datasetCard    = document.getElementById('dataset-card');
    const datasetThead   = document.getElementById('dataset-thead');
    const datasetTbody   = document.getElementById('dataset-tbody');
    const datasetEmpty   = document.getElementById('dataset-empty');
    const datasetTable   = document.getElementById('dataset-table');

    // Two-lepton histogram controls
    const hist2MinEl      = document.getElementById('hist2-min');
    const hist2MaxEl      = document.getElementById('hist2-max');
    const hist2BinEl      = document.getElementById('hist2-bin');
    const updateHist2Btn  = document.getElementById('update-hist2-btn');
    const noMass2Msg      = document.getElementById('no-mass2-msg');
    const chart2Container = document.getElementById('chart2-container');
    const hist2Controls   = document.getElementById('hist2-controls');

    // Four-lepton histogram controls
    const hist4MinEl      = document.getElementById('hist4-min');
    const hist4MaxEl      = document.getElementById('hist4-max');
    const hist4BinEl      = document.getElementById('hist4-bin');
    const updateHist4Btn  = document.getElementById('update-hist4-btn');
    const noMass4Msg      = document.getElementById('no-mass4-msg');
    const chart4Container = document.getElementById('chart4-container');
    const hist4Controls   = document.getElementById('hist4-controls');

    // Export buttons
    const exportCsv2Btn   = document.getElementById('export-csv2-btn');
    const exportCsv4Btn   = document.getElementById('export-csv4-btn');

    let hist2Chart = null;
    let hist4Chart = null;
    let twoLeptonMasses  = [];
    let fourLeptonMasses = [];

    // ── Helpers ────────────────────────────────────────────────────────────────
    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function showError(msg) {
        pageLoading.style.display = 'none';
        errorMsg.textContent      = msg;
        pageError.style.display   = 'block';
    }

    function downloadCsv(allMasses, fsSet, filename) {
        const rows = ['Final State,Mass (GeV)'];
        for (const entry of (allMasses || [])) {
            if (entry && entry.mass !== undefined && fsSet.has(entry.finalState)) {
                rows.push(`${entry.finalState},${entry.mass}`);
            }
        }
        const blob = new Blob([rows.join('\r\n')], { type: 'text/csv' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ── Mode detection ─────────────────────────────────────────────────────────
    const params      = new URLSearchParams(window.location.search);
    const singleId    = params.get('id');
    const multiIdsRaw = params.get('ids');

    if (!singleId && !multiIdsRaw) { showError('No masterclass specified.'); return; }

    // Normalised data that all rendering code will use
    let fsTotals, psTotals, masses, breakdown, breakdownHeading, breakdownFirstCol;
    let isAggregate = !!multiIdsRaw;

    try {
        if (isAggregate) {
            // ── Aggregate mode ─────────────────────────────────────────────────
            const resp = await fetch(`/api/summary/aggregate?ids=${encodeURIComponent(multiIdsRaw)}`);
            if (!resp.ok) throw new Error('not found');
            const data = await resp.json();

            fsTotals = data.fsTotals;
            psTotals = data.psTotals;
            masses   = data.masses;

            breakdownHeading  = 'Per-Masterclass Breakdown';
            breakdownFirstCol = 'Masterclass';
            breakdown = data.masterclasses.map(mc => ({
                label: mc.name,
                fs:    data.mcTotals[mc.id].fs,
                ps:    data.mcTotals[mc.id].ps
            }));

            pageLoading.style.display = 'none';
            pageContent.style.display = 'block';

            document.title = 'CIMA – Combined Summary';
            // Show "Combined Summary" as the main title with masterclass names as subtitle
            const names = data.masterclasses.map(m => m.name).join(' + ');
            mcTitle.innerHTML =
                `Combined Summary<span style="display:block;font-size:.82rem;font-weight:400;color:#555;margin-top:4px;">${escHtml(names)}</span>`;
            backLink.textContent = '← All Masterclasses';
            backLink.href        = 'index.html';

        } else {
            // ── Single mode ────────────────────────────────────────────────────
            const resp = await fetch(`/api/summary/${singleId}`);
            if (!resp.ok) throw new Error('not found');
            const data = await resp.json();

            fsTotals = data.fsTotals;
            psTotals = data.psTotals;
            masses   = data.masses;

            breakdownHeading  = 'Per-Dataset Breakdown';
            breakdownFirstCol = 'Dataset';
            const dsTotals    = data.dsTotals || {};
            breakdown = Object.keys(dsTotals)
                .map(Number).sort((a, b) => a - b)
                .map(ds => ({
                    label: `Dataset ${ds}`,
                    fs:    dsTotals[ds].fs,
                    ps:    dsTotals[ds].ps
                }));

            pageLoading.style.display = 'none';
            pageContent.style.display = 'block';

            document.title       = `CIMA – Summary: ${data.masterclass.name}`;
            mcTitle.textContent  = `Summary: ${data.masterclass.name}`;
            backLink.textContent = '← Back to Masterclass';
            backLink.href        = `masterclass.html?id=${singleId}`;
        }
    } catch (e) {
        showError(isAggregate ? 'Could not load combined summary.' : 'Masterclass not found.');
        return;
    }

    // ── Final State Totals ─────────────────────────────────────────────────────
    let fsTotal = 0;
    for (let i = 0; i < FS_KEYS.length; i++) {
        const key   = FS_KEYS[i];
        const label = FINAL_STATES[i];
        const count = fsTotals[key] || 0;
        fsTotal += count;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${label}</td><td>${count}</td>`;
        fsTbody.appendChild(tr);
    }
    fsGrandTotal.textContent = fsTotal;

    // ── Primary State Totals ───────────────────────────────────────────────────
    let psTotal = 0;
    for (const ps of PRIMARY_STATES) {
        const count = psTotals[ps] || 0;
        psTotal += count;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escHtml(ps)}</td><td>${count}</td>`;
        psTbody.appendChild(tr);
    }
    psGrandTotal.textContent = psTotal;

    // ── Particle Statistics ────────────────────────────────────────────────────
    const fs = fsTotals;
    const ps = psTotals;

    // W⁺ / W⁻ ratio
    const wPlus  = ps['W+']  || 0;
    const wMinus = ps['W-']  || 0;
    const wRatio = wMinus > 0
        ? (wPlus / wMinus).toFixed(3)
        : (wPlus > 0 ? '∞' : 'N/A');

    // Total electrons:  e-ν×1  +  e-e×2  +  2e-2μ×2  +  4e×4
    const totalElectrons = (fs['e-v']   || 0) * 1
                         + (fs['e-e']   || 0) * 2
                         + (fs['2e-2μ'] || 0) * 2
                         + (fs['4e']    || 0) * 4;

    // Total muons:      μ-ν×1  +  μ-μ×2  +  2e-2μ×2  +  4μ×4
    const totalMuons     = (fs['μ-ν']   || 0) * 1
                         + (fs['μ-μ']   || 0) * 2
                         + (fs['2e-2μ'] || 0) * 2
                         + (fs['4μ']    || 0) * 4;

    const leptonRatio = totalMuons > 0
        ? (totalElectrons / totalMuons).toFixed(3)
        : (totalElectrons > 0 ? '∞' : 'N/A');

    // Populate W-boson table
    const wTbody = document.getElementById('w-stats-tbody');
    [
        ['W⁺ count',      wPlus,  false],
        ['W⁻ count',      wMinus, false],
        ['W⁺ / W⁻ ratio', wRatio, true ]
    ].forEach(([label, value, isRatio]) => {
        const tr = document.createElement('tr');
        if (isRatio) tr.className = 'stat-ratio-row';
        tr.innerHTML = `<td>${label}</td><td>${value}</td>`;
        wTbody.appendChild(tr);
    });

    // Populate lepton-universality table
    const leptonTbody = document.getElementById('lepton-stats-tbody');
    [
        ['Total electrons', totalElectrons, false,
            'e-ν ×1 &nbsp;+&nbsp; e-e ×2 &nbsp;+&nbsp; 2e-2μ ×2 &nbsp;+&nbsp; 4e ×4'],
        ['Total muons',     totalMuons,     false,
            'μ-ν ×1 &nbsp;+&nbsp; μ-μ ×2 &nbsp;+&nbsp; 2e-2μ ×2 &nbsp;+&nbsp; 4μ ×4'],
        ['e / μ ratio',     leptonRatio,    true,  '']
    ].forEach(([label, value, isRatio, formula]) => {
        const tr = document.createElement('tr');
        if (isRatio) tr.className = 'stat-ratio-row';
        tr.innerHTML = `
            <td>
                ${label}
                ${formula
                    ? `<span style="font-size:.72rem;color:#888;display:block;margin-top:2px;">${formula}</span>`
                    : ''}
            </td>
            <td>${value}</td>`;
        leptonTbody.appendChild(tr);
    });

    // ── Breakdown (per-dataset or per-masterclass) ─────────────────────────────
    datasetCard.querySelector('h2').textContent = breakdownHeading;

    if (breakdown.length === 0) {
        datasetTable.style.display = 'none';
        datasetEmpty.style.display = 'block';
    } else {
        const allCols = [
            ...FINAL_STATES.map((l, i) => ({ label: l, group: 'fs', key: FS_KEYS[i] })),
            ...PRIMARY_STATES.map(p  => ({ label: p, group: 'ps', key: p }))
        ];

        const hRow = document.createElement('tr');
        hRow.innerHTML = `<th>${escHtml(breakdownFirstCol)}</th>` +
            allCols.map(c => `<th>${escHtml(c.label)}</th>`).join('') + `<th>Total</th>`;
        datasetThead.appendChild(hRow);

        for (const item of breakdown) {
            let rowTotal = 0;
            const cells = allCols.map(c => {
                const v = c.group === 'fs' ? (item.fs[c.key] || 0) : (item.ps[c.key] || 0);
                rowTotal += v;
                return `<td>${v}</td>`;
            });
            const tr = document.createElement('tr');
            tr.innerHTML = `<td style="font-weight:600;">${escHtml(item.label)}</td>${cells.join('')}` +
                           `<td style="font-weight:700;color:#003087;">${rowTotal}</td>`;
            datasetTbody.appendChild(tr);
        }

        // Grand-total row
        const totRow = document.createElement('tr');
        totRow.style.background = '#e8edf8';
        const totCells = allCols.map(c => {
            const v = c.group === 'fs' ? (fsTotals[c.key] || 0) : (psTotals[c.key] || 0);
            return `<td style="font-weight:700;color:#003087;">${v}</td>`;
        });
        const allLabel = isAggregate ? 'All Masterclasses' : 'All Datasets';
        totRow.innerHTML = `<td style="font-weight:700;">${allLabel}</td>${totCells.join('')}` +
                           `<td style="font-weight:700;color:#003087;">${fsTotal}</td>`;
        datasetTbody.appendChild(totRow);
    }

    // ── Split masses by final state ────────────────────────────────────────────
    const TWO_LEPTON_FS  = new Set(['e-e', 'μ-μ']);
    const FOUR_LEPTON_FS = new Set(['4e', '4μ', '2e-2μ']);

    for (const entry of (masses || [])) {
        if (entry && entry.mass !== undefined) {
            if (TWO_LEPTON_FS.has(entry.finalState))  twoLeptonMasses.push(entry.mass);
            if (FOUR_LEPTON_FS.has(entry.finalState)) fourLeptonMasses.push(entry.mass);
        }
    }

    // ── Two-Lepton Histogram ───────────────────────────────────────────────────
    if (twoLeptonMasses.length === 0) {
        hist2Controls.style.display   = 'none';
        noMass2Msg.style.display      = 'block';
        chart2Container.style.display = 'none';
        exportCsv2Btn.style.display   = 'none';
    } else {
        setAutoRange(hist2MinEl, hist2MaxEl, hist2BinEl, twoLeptonMasses);
        drawHistogram2();
        updateHist2Btn.addEventListener('click', drawHistogram2);
        exportCsv2Btn.addEventListener('click', () =>
            downloadCsv(masses, TWO_LEPTON_FS, 'Two Lepton Mass.cvs'));
    }

    // ── Four-Lepton Histogram ──────────────────────────────────────────────────
    if (fourLeptonMasses.length === 0) {
        hist4Controls.style.display   = 'none';
        noMass4Msg.style.display      = 'block';
        chart4Container.style.display = 'none';
        exportCsv4Btn.style.display   = 'none';
    } else {
        setAutoRange(hist4MinEl, hist4MaxEl, hist4BinEl, fourLeptonMasses);
        drawHistogram4();
        updateHist4Btn.addEventListener('click', drawHistogram4);
        exportCsv4Btn.addEventListener('click', () =>
            downloadCsv(masses, FOUR_LEPTON_FS, 'Four Lepton Mass.cvs'));
    }

    // ── Histogram helpers ──────────────────────────────────────────────────────
    function setAutoRange(minEl, maxEl, binEl, masses) {
        const minMass = Math.min(...masses);
        const maxMass = Math.max(...masses);
        const range   = maxMass - minMass;
        let autoMin   = Math.max(0, Math.floor(minMass - range * 0.1));
        let autoMax   = Math.ceil(maxMass + range * 0.1);
        if (autoMax <= autoMin) {
            autoMin = Math.max(0, autoMin - 10);
            autoMax += 10;
        }
        const autoBin = Math.max(1, Math.round((autoMax - autoMin) / 20));
        minEl.value = autoMin;
        maxEl.value = autoMax;
        binEl.value = autoBin;
    }

    function buildHistogram(masses, minEl, maxEl, binEl) {
        const binMin   = parseFloat(minEl.value);
        const binMax   = parseFloat(maxEl.value);
        const binWidth = parseFloat(binEl.value);

        if (isNaN(binMin) || isNaN(binMax) || isNaN(binWidth) || binWidth <= 0 || binMin >= binMax) {
            alert('Invalid histogram parameters. Min must be less than Max, Bin Width must be positive.');
            return null;
        }

        const numBins = Math.ceil((binMax - binMin) / binWidth);
        if (numBins > 500) {
            alert('Too many bins (max 500). Increase bin width or reduce the range.');
            return null;
        }

        const counts = new Array(numBins).fill(0);
        const labels = [];
        for (let i = 0; i < numBins; i++) {
            labels.push((binMin + (i + 0.5) * binWidth).toFixed(1));
        }
        for (const m of masses) {
            if (m >= binMin && m < binMax) {
                const idx = Math.floor((m - binMin) / binWidth);
                if (idx >= 0 && idx < numBins) counts[idx]++;
            }
        }
        return { labels, counts, binMin, binMax, binWidth };
    }

    function makeChartConfig(labels, counts, title, binWidth) {
        return {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Events',
                    data: counts,
                    backgroundColor: 'rgba(0, 80, 160, 0.72)',
                    borderColor:     'rgba(0, 48, 135, 0.9)',
                    borderWidth: 1,
                    barPercentage:      1.0,
                    categoryPercentage: 1.0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: {
                        display: true,
                        text: title,
                        color: '#003087',
                        font: { size: 13, weight: '600' }
                    },
                    tooltip: {
                        callbacks: {
                            title: items => {
                                const center = parseFloat(items[0].label);
                                const lo = (center - binWidth / 2).toFixed(1);
                                const hi = (center + binWidth / 2).toFixed(1);
                                return `${lo} – ${hi} GeV`;
                            },
                            label: item => ` ${item.raw} event${item.raw !== 1 ? 's' : ''}`
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true, text: 'Mass [GeV]',
                            color: '#003087', font: { weight: '600' }
                        },
                        ticks: { maxRotation: 45, maxTicksLimit: 20, color: '#334' },
                        grid:  { color: 'rgba(0,0,0,.06)' }
                    },
                    y: {
                        title: {
                            display: true, text: 'Number of Events',
                            color: '#003087', font: { weight: '600' }
                        },
                        beginAtZero: true,
                        ticks: { precision: 0, color: '#334' },
                        grid:  { color: 'rgba(0,0,0,.06)' }
                    }
                }
            }
        };
    }

    function drawHistogram2() {
        if (twoLeptonMasses.length === 0) return;
        const result = buildHistogram(twoLeptonMasses, hist2MinEl, hist2MaxEl, hist2BinEl);
        if (!result) return;
        const { labels, counts, binWidth } = result;
        const title = `Mass Distribution – Two Leptons  (${twoLeptonMasses.length} events, bin width = ${binWidth} GeV)`;
        if (hist2Chart) hist2Chart.destroy();
        hist2Chart = new Chart(document.getElementById('mass-histogram-2'),
            makeChartConfig(labels, counts, title, binWidth));
    }

    function drawHistogram4() {
        if (fourLeptonMasses.length === 0) return;
        const result = buildHistogram(fourLeptonMasses, hist4MinEl, hist4MaxEl, hist4BinEl);
        if (!result) return;
        const { labels, counts, binWidth } = result;
        const title = `Mass Distribution – Four Leptons  (${fourLeptonMasses.length} events, bin width = ${binWidth} GeV)`;
        if (hist4Chart) hist4Chart.destroy();
        hist4Chart = new Chart(document.getElementById('mass-histogram-4'),
            makeChartConfig(labels, counts, title, binWidth));
    }

    // ── Print support ──────────────────────────────────────────────────────────
    // Lock chart canvas dimensions before the browser reflows for print,
    // then restore responsive sizing afterwards.
    window.addEventListener('beforeprint', () => {
        if (hist2Chart) hist2Chart.resize(520, 200);
        if (hist4Chart) hist4Chart.resize(520, 200);
    });
    window.addEventListener('afterprint', () => {
        if (hist2Chart) hist2Chart.resize();
        if (hist4Chart) hist4Chart.resize();
    });
})();
