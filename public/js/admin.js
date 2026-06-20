(function () {
    // ── DOM refs ───────────────────────────────────────────────────────────────
    const loginOverlay    = document.getElementById('login-overlay');
    const adminContent    = document.getElementById('admin-content');
    const loginPasswordEl = document.getElementById('login-password');
    const loginBtn        = document.getElementById('login-btn');
    const loginError      = document.getElementById('login-error');
    const logoutLink      = document.getElementById('logout-link');

    const createBtn       = document.getElementById('create-btn');
    const createError     = document.getElementById('create-error');
    const createSuccess   = document.getElementById('create-success');
    const mcDate          = document.getElementById('mc-date');
    const mcName          = document.getElementById('mc-name');
    const mcDatasets      = document.getElementById('mc-datasets');

    const pwCurrent       = document.getElementById('pw-current');
    const pwNew           = document.getElementById('pw-new');
    const pwConfirm       = document.getElementById('pw-confirm');
    const pwBtn           = document.getElementById('pw-btn');
    const pwError         = document.getElementById('pw-error');
    const pwSuccess       = document.getElementById('pw-success');

    const mcTbody         = document.getElementById('mc-tbody');
    const mcTable         = document.getElementById('mc-table');
    const mcLoading       = document.getElementById('mc-loading');
    const mcEmpty         = document.getElementById('mc-empty');

    const confirmOverlay  = document.getElementById('confirm-overlay');
    const confirmTitle    = document.getElementById('confirm-title');
    const confirmMsg      = document.getElementById('confirm-msg');
    const confirmCancel   = document.getElementById('confirm-cancel');
    const confirmDelete   = document.getElementById('confirm-delete');

    const renameOverlay   = document.getElementById('rename-overlay');
    const renameDateInput = document.getElementById('rename-date-input');
    const renameInput     = document.getElementById('rename-input');
    const renameError     = document.getElementById('rename-error');
    const renameCancel    = document.getElementById('rename-cancel');
    const renameConfirm   = document.getElementById('rename-confirm');

    let pendingDeleteId = null;
    let pendingRenameId = null;

    // ── Helpers ────────────────────────────────────────────────────────────────
    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function showAlert(el, msg) {
        el.textContent = msg;
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 5000);
    }

    function formatDate(dateStr) {
        if (!dateStr) return '—';
        const [y, m, d] = dateStr.split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric'
        });
    }

    // ── Auth ───────────────────────────────────────────────────────────────────
    async function checkSession() {
        const resp = await fetch('/api/auth/status');
        const data = await resp.json();
        if (data.isAdmin) showAdminUI();
        else loginOverlay.style.display = 'flex';
    }

    function showAdminUI() {
        loginOverlay.style.display = 'none';
        adminContent.style.display = 'block';
        logoutLink.style.display   = 'inline';
        loadMasterclasses();
    }

    async function doLogin() {
        const password = loginPasswordEl.value.trim();
        if (!password) return;
        loginBtn.disabled    = true;
        loginBtn.textContent = 'Logging in…';
        try {
            const resp = await fetch('/api/auth/login', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ password })
            });
            const data = await resp.json();
            if (!resp.ok) showAlert(loginError, data.error || 'Login failed');
            else showAdminUI();
        } catch (e) {
            showAlert(loginError, 'Server error. Is the server running?');
        } finally {
            loginBtn.disabled    = false;
            loginBtn.textContent = 'Login';
        }
    }

    loginBtn.addEventListener('click', doLogin);
    loginPasswordEl.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

    logoutLink.addEventListener('click', async e => {
        e.preventDefault();
        await fetch('/api/auth/logout', { method: 'POST' });
        location.reload();
    });

    // ── Load Masterclasses ─────────────────────────────────────────────────────
    async function loadMasterclasses() {
        mcLoading.style.display = 'block';
        mcTable.style.display   = 'none';
        mcEmpty.style.display   = 'none';

        try {
            const resp = await fetch('/api/masterclasses?all=1');
            const list = await resp.json();
            mcLoading.style.display = 'none';

            if (!list.length) {
                mcEmpty.style.display = 'block';
                return;
            }

            mcTbody.innerHTML = '';
            for (const mc of list) {
                const createdAt  = new Date(mc.created_at).toLocaleString();
                const isArchived = !!mc.archived;
                const tr         = document.createElement('tr');
                if (isArchived) tr.classList.add('archived-row');
                tr.innerHTML = `
                    <td>${escHtml(mc.name)}${isArchived
                        ? ' <span class="badge badge-archived">Archived</span>'
                        : ''}</td>
                    <td style="white-space:nowrap;">${escHtml(formatDate(mc.event_date))}</td>
                    <td><span class="badge badge-blue">${mc.num_datasets}</span></td>
                    <td style="font-size:.8rem;color:#666;">${createdAt}</td>
                    <td><a href="summary.html?id=${mc.id}" class="btn btn-outline btn-sm"
                           target="_blank">Summary</a></td>
                    <td><button class="btn btn-secondary btn-sm row-rename-btn"
                                data-id="${mc.id}"
                                data-name="${escHtml(mc.name)}"
                                data-date="${mc.event_date || ''}">Edit</button></td>
                    <td>${isArchived
                        ? `<button class="btn btn-success btn-sm row-unarchive-btn"
                                   data-id="${mc.id}" data-name="${escHtml(mc.name)}">Unarchive</button>`
                        : `<button class="btn btn-warning btn-sm row-archive-btn"
                                   data-id="${mc.id}" data-name="${escHtml(mc.name)}">Archive</button>`
                    }</td>
                    <td><button class="btn btn-danger btn-sm row-delete-btn"
                                data-id="${mc.id}" data-name="${escHtml(mc.name)}">Delete</button></td>`;
                mcTbody.appendChild(tr);
            }

            mcTbody.querySelectorAll('.row-archive-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    btn.disabled = true;
                    try {
                        await fetch(`/api/masterclasses/${btn.dataset.id}/archive`, { method: 'POST' });
                    } catch (e) {
                        alert('Archive failed.');
                    } finally {
                        loadMasterclasses();
                    }
                });
            });

            mcTbody.querySelectorAll('.row-unarchive-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    btn.disabled = true;
                    try {
                        await fetch(`/api/masterclasses/${btn.dataset.id}/unarchive`, { method: 'POST' });
                    } catch (e) {
                        alert('Unarchive failed.');
                    } finally {
                        loadMasterclasses();
                    }
                });
            });

            mcTbody.querySelectorAll('.row-rename-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    pendingRenameId         = parseInt(btn.dataset.id);
                    renameDateInput.value   = btn.dataset.date || '';
                    renameInput.value       = btn.dataset.name;
                    renameError.classList.remove('show');
                    renameOverlay.style.display = 'flex';
                    renameInput.focus();
                    renameInput.select();
                });
            });

            mcTbody.querySelectorAll('.row-delete-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    pendingDeleteId = parseInt(btn.dataset.id);
                    confirmTitle.textContent = 'Delete Masterclass?';
                    confirmMsg.innerHTML     =
                        `<strong>${escHtml(btn.dataset.name)}</strong> and all its event data
                         will be permanently deleted.`;
                    confirmOverlay.style.display = 'flex';
                });
            });

            mcTable.style.display = 'table';

        } catch (e) {
            mcLoading.innerHTML = `<span style="color:#c0392b;">Failed to load masterclasses.</span>`;
        }
    }

    // ── Confirm Delete ─────────────────────────────────────────────────────────
    confirmCancel.addEventListener('click', () => {
        confirmOverlay.style.display = 'none';
        pendingDeleteId = null;
    });

    confirmDelete.addEventListener('click', async () => {
        if (!pendingDeleteId) return;
        confirmDelete.disabled = true;
        try {
            await fetch(`/api/masterclasses/${pendingDeleteId}`, { method: 'DELETE' });
        } catch (e) {
            alert('Delete failed.');
        } finally {
            confirmOverlay.style.display = 'none';
            pendingDeleteId              = null;
            confirmDelete.disabled       = false;
            loadMasterclasses();
        }
    });

    // ── Edit Masterclass ───────────────────────────────────────────────────────
    renameCancel.addEventListener('click', () => {
        renameOverlay.style.display = 'none';
        pendingRenameId = null;
    });

    async function doRename() {
        if (!pendingRenameId) return;
        const name       = renameInput.value.trim();
        const event_date = renameDateInput.value;
        if (!name)       { showAlert(renameError, 'Please enter a name.'); return; }
        if (!event_date) { showAlert(renameError, 'Please select a date.'); return; }

        renameConfirm.disabled = true;
        try {
            const resp = await fetch(`/api/masterclasses/${pendingRenameId}`, {
                method:  'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ name, event_date })
            });
            const data = await resp.json();
            if (!resp.ok) {
                showAlert(renameError, data.error || 'Update failed.');
            } else {
                renameOverlay.style.display = 'none';
                pendingRenameId = null;
                loadMasterclasses();
            }
        } catch (e) {
            showAlert(renameError, 'Server error.');
        } finally {
            renameConfirm.disabled = false;
        }
    }

    renameConfirm.addEventListener('click', doRename);
    renameInput.addEventListener('keydown', e => { if (e.key === 'Enter') doRename(); });

    // ── Create Masterclass ─────────────────────────────────────────────────────
    createBtn.addEventListener('click', async () => {
        const event_date = mcDate.value;
        const name       = mcName.value.trim();
        const num        = parseInt(mcDatasets.value);
        createError.classList.remove('show');
        createSuccess.classList.remove('show');

        if (!event_date)                        { showAlert(createError, 'Please select a date.'); return; }
        if (!name)                              { showAlert(createError, 'Please enter a masterclass name.'); return; }
        if (isNaN(num) || num < 1 || num > 100) { showAlert(createError, 'Dataset count must be between 1 and 100.'); return; }

        createBtn.disabled = true;
        try {
            const resp = await fetch('/api/masterclasses', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ name, event_date, num_datasets: num })
            });
            const data = await resp.json();
            if (!resp.ok) {
                showAlert(createError, data.error || 'Failed to create');
            } else {
                showAlert(createSuccess, `Masterclass "${data.name}" created successfully!`);
                mcDate.value     = '';
                mcName.value     = '';
                mcDatasets.value = '5';
                loadMasterclasses();
            }
        } catch (e) {
            showAlert(createError, 'Server error.');
        } finally {
            createBtn.disabled = false;
        }
    });

    mcName.addEventListener('keydown', e => { if (e.key === 'Enter') createBtn.click(); });

    // ── Change Password ────────────────────────────────────────────────────────
    pwBtn.addEventListener('click', async () => {
        pwError.classList.remove('show');
        pwSuccess.classList.remove('show');

        const current = pwCurrent.value;
        const next    = pwNew.value;
        const confirm = pwConfirm.value;

        if (!current || !next || !confirm) { showAlert(pwError, 'All three fields are required.'); return; }
        if (next.length < 10)              { showAlert(pwError, 'New password must be at least 10 characters.'); return; }
        if (next !== confirm)              { showAlert(pwError, 'New passwords do not match.'); return; }

        pwBtn.disabled = true;
        try {
            const resp = await fetch('/api/auth/change-password', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ currentPassword: current, newPassword: next })
            });
            const data = await resp.json();
            if (!resp.ok) showAlert(pwError, data.error || 'Password change failed.');
            else {
                showAlert(pwSuccess, 'Password updated successfully!');
                pwCurrent.value = '';
                pwNew.value     = '';
                pwConfirm.value = '';
            }
        } catch (e) {
            showAlert(pwError, 'Server error.');
        } finally {
            pwBtn.disabled = false;
        }
    });

    // ── Boot ───────────────────────────────────────────────────────────────────
    checkSession();
})();
