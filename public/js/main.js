(async function () {
    const container  = document.getElementById('date-groups-container');
    const loading    = document.getElementById('loading');
    const emptyState = document.getElementById('empty-state');
    const aggBar     = document.getElementById('agg-bar');
    const aggLabel   = document.getElementById('agg-label');
    const aggLink    = document.getElementById('agg-link');

    const selectedIds = new Set();

    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function formatEventDate(dateStr) {
        if (!dateStr) return 'Unknown Date';
        const [y, m, d] = dateStr.split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString(undefined, {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
    }

    function updateAggBar() {
        if (selectedIds.size >= 2) {
            const n = selectedIds.size;
            aggLabel.textContent = `${n} masterclass${n !== 1 ? 'es' : ''} selected`;
            aggLink.href = `summary.html?ids=${[...selectedIds].join(',')}`;
            aggBar.style.display = 'flex';
        } else {
            aggBar.style.display = 'none';
        }
    }

    try {
        const resp = await fetch('/api/masterclasses');
        if (!resp.ok) throw new Error('Failed to load');
        const list = await resp.json();

        loading.style.display = 'none';

        if (!list.length) {
            emptyState.style.display = 'block';
            return;
        }

        // Group by event_date (API returns them sorted DESC by date already)
        const groups = new Map();
        for (const mc of list) {
            const key = mc.event_date || 'unknown';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(mc);
        }

        for (const [dateKey, masterclasses] of groups) {
            const groupEl = document.createElement('div');
            groupEl.className = 'date-group';

            const count     = masterclasses.length;
            const dateLabel = escHtml(formatEventDate(dateKey));

            groupEl.innerHTML = `
                <div class="date-group-header">
                    <button class="date-group-toggle" aria-expanded="false">+</button>
                    <span class="date-group-label">${dateLabel}</span>
                    <span class="badge badge-blue date-group-count">${count} masterclass${count !== 1 ? 'es' : ''}</span>
                </div>
                <div class="date-group-body" hidden>
                    <div style="overflow-x:auto;">
                        <table class="admin-table">
                            <thead>
                                <tr>
                                    <th class="cb-col"><input type="checkbox" class="group-select-all mc-select-cb" title="Select all in this group"></th>
                                    <th>Masterclass Name</th>
                                    <th>Datasets</th>
                                    <th>Enter Data</th>
                                    <th>Summary</th>
                                </tr>
                            </thead>
                            <tbody></tbody>
                        </table>
                    </div>
                </div>`;

            container.appendChild(groupEl);

            const header      = groupEl.querySelector('.date-group-header');
            const toggleBtn   = groupEl.querySelector('.date-group-toggle');
            const body        = groupEl.querySelector('.date-group-body');
            const tbody       = groupEl.querySelector('tbody');
            const groupSelAll = groupEl.querySelector('.group-select-all');

            // Clicking anywhere on the header toggles the group
            header.addEventListener('click', () => {
                const isOpen = !body.hidden;
                body.hidden = isOpen;
                toggleBtn.textContent = isOpen ? '+' : '−';
                toggleBtn.setAttribute('aria-expanded', String(!isOpen));
            });

            // Build masterclass rows
            for (const mc of masterclasses) {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="cb-col">
                        <input type="checkbox" class="mc-select-cb row-cb" data-id="${mc.id}">
                    </td>
                    <td class="mc-name-cell">${escHtml(mc.name)}</td>
                    <td><span class="badge badge-blue">${mc.num_datasets} dataset${mc.num_datasets !== 1 ? 's' : ''}</span></td>
                    <td><a href="masterclass.html?id=${mc.id}" class="btn btn-primary btn-sm">Enter Data →</a></td>
                    <td><a href="summary.html?id=${mc.id}"    class="btn btn-outline btn-sm">Summary →</a></td>`;
                tbody.appendChild(tr);
            }

            // Per-row checkbox listeners
            tbody.querySelectorAll('.row-cb').forEach(cb => {
                cb.addEventListener('change', () => {
                    const id = parseInt(cb.dataset.id);
                    if (cb.checked) selectedIds.add(id);
                    else            selectedIds.delete(id);

                    const allRowCbs    = [...tbody.querySelectorAll('.row-cb')];
                    const checkedCount = allRowCbs.filter(c => c.checked).length;
                    groupSelAll.checked       = checkedCount > 0 && checkedCount === allRowCbs.length;
                    groupSelAll.indeterminate = checkedCount > 0 && checkedCount < allRowCbs.length;
                    updateAggBar();
                });
            });

            // Group-level select-all checkbox
            groupSelAll.addEventListener('change', e => {
                e.stopPropagation(); // don't fire the header toggle
                tbody.querySelectorAll('.row-cb').forEach(cb => {
                    const id = parseInt(cb.dataset.id);
                    cb.checked = groupSelAll.checked;
                    if (groupSelAll.checked) selectedIds.add(id);
                    else                     selectedIds.delete(id);
                });
                groupSelAll.indeterminate = false;
                updateAggBar();
            });
        }

        container.style.display = 'block';

    } catch (e) {
        loading.innerHTML = `<span style="color:#c0392b;">Could not load masterclasses. Is the server running?</span>`;
    }
})();
