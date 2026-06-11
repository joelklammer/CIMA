(async function () {
    const wrap       = document.getElementById('masterclass-table-wrap');
    const tbody      = document.getElementById('masterclass-tbody');
    const loading    = document.getElementById('loading');
    const emptyState = document.getElementById('empty-state');
    const selectAllCb = document.getElementById('select-all-cb');
    const aggBar     = document.getElementById('agg-bar');
    const aggLabel   = document.getElementById('agg-label');
    const aggLink    = document.getElementById('agg-link');

    const selectedIds = new Set();

    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
        // Keep "select all" checkbox in sync
        const allCbs = tbody.querySelectorAll('.mc-select-cb');
        selectAllCb.checked       = allCbs.length > 0 && selectedIds.size === allCbs.length;
        selectAllCb.indeterminate = selectedIds.size > 0 && selectedIds.size < allCbs.length;
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

        for (const mc of list) {
            const date = new Date(mc.created_at).toLocaleDateString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric'
            });

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="cb-col">
                    <input type="checkbox" class="mc-select-cb" data-id="${mc.id}">
                </td>
                <td class="mc-name-cell">${escHtml(mc.name)}</td>
                <td><span class="badge badge-blue">${mc.num_datasets} dataset${mc.num_datasets !== 1 ? 's' : ''}</span></td>
                <td style="font-size:.82rem;color:#666;white-space:nowrap;">${date}</td>
                <td><a href="masterclass.html?id=${mc.id}" class="btn btn-primary btn-sm">Enter Data →</a></td>
                <td><a href="summary.html?id=${mc.id}"    class="btn btn-outline btn-sm">Summary →</a></td>`;
            tbody.appendChild(tr);
        }

        // Per-row checkbox listeners
        tbody.querySelectorAll('.mc-select-cb').forEach(cb => {
            cb.addEventListener('change', () => {
                const id = parseInt(cb.dataset.id);
                if (cb.checked) selectedIds.add(id);
                else            selectedIds.delete(id);
                updateAggBar();
            });
        });

        // "Select all" header checkbox
        selectAllCb.addEventListener('change', () => {
            tbody.querySelectorAll('.mc-select-cb').forEach(cb => {
                const id = parseInt(cb.dataset.id);
                cb.checked = selectAllCb.checked;
                if (selectAllCb.checked) selectedIds.add(id);
                else                     selectedIds.delete(id);
            });
            updateAggBar();
        });

        wrap.style.display = 'block';
    } catch (e) {
        loading.innerHTML = `<span style="color:#c0392b;">Could not load masterclasses. Is the server running?</span>`;
    }
})();
