// static/js/home.js
document.addEventListener('DOMContentLoaded', () => {
    const ownerList = document.getElementById('ownerList');
    const loadingMessage = document.getElementById('loadingMessage');
    const noOwnersMessage = document.getElementById('noOwnersMessage');
    const newOwnerInput = document.getElementById('newOwnerInput');
    const goToOwnerBtn = document.getElementById('goToOwnerBtn');

    async function loadOwners() {
        loadingMessage.style.display = 'block';
        noOwnersMessage.style.display = 'none';
        ownerList.innerHTML = '';

        try {
            const response = await fetch('/api/owners');
            if (!response.ok) throw new Error('网络响应错误');
            const owners = await response.json();

            if (!Array.isArray(owners) || owners.length === 0) {
                noOwnersMessage.style.display = 'block';
            } else {
                owners.forEach(owner => {
                    const li = document.createElement('li');
                    li.className = 'task-item';

                    const nameDiv = document.createElement('div');
                    nameDiv.className = 'task-name';
                    nameDiv.textContent = owner;
                    nameDiv.style.cursor = 'pointer';
                    nameDiv.addEventListener('click', () => {
                        window.location.href = `/tasks/${encodeURIComponent(owner)}`;
                    });

                    const actionsDiv = document.createElement('div');
                    actionsDiv.className = 'task-actions';

                    const enterBtn = document.createElement('a');
                    enterBtn.href = `/tasks/${encodeURIComponent(owner)}`;
                    enterBtn.className = 'btn btn-primary';
                    enterBtn.textContent = '进入';

                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'btn btn-danger';
                    deleteBtn.textContent = '删除所有者';
                    deleteBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        if (!confirm(`确认删除所有者 "${owner}" 及其所有任务？此操作不可恢复。`)) return;
                        try {
                            const res = await fetch('/api/owners/delete', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ owner })
                            });
                            const data = await res.json();
                            if (!res.ok) throw new Error(data.error || '删除失败');
                            await loadOwners();
                        } catch (err) {
                            alert(`删除失败: ${err.message}`);
                        }
                    });

                    actionsDiv.appendChild(enterBtn);
                    actionsDiv.appendChild(deleteBtn);

                    li.appendChild(nameDiv);
                    li.appendChild(actionsDiv);
                    ownerList.appendChild(li);
                });
            }
        } catch (error) {
            console.error('加载所有者失败:', error);
            ownerList.innerHTML = '<li>加载失败，请刷新页面。</li>';
        } finally {
            loadingMessage.style.display = 'none';
        }
    }

    function goToOwner() {
        const ownerName = newOwnerInput.value.trim();
        if (ownerName) {
            window.location.href = `/tasks/${encodeURIComponent(ownerName)}`;
        } else {
            alert('请输入一个所有者名称。');
        }
    }

    goToOwnerBtn.addEventListener('click', goToOwner);
    newOwnerInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            goToOwner();
        }
    });

    loadOwners();
});
