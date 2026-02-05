// static/js/tasks.js
document.addEventListener('DOMContentLoaded', () => {
    const ownerName = document.getElementById('ownerName').textContent;
    const taskList = document.getElementById('taskList');
    const loadingMessage = document.getElementById('loadingMessage');
    const noTasksMessage = document.getElementById('noTasksMessage');
    const newTaskInput = document.getElementById('newTaskInput');
    const createTaskBtn = document.getElementById('createTaskBtn');

    createTaskBtn.addEventListener('click', createTask);
    newTaskInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') createTask();
    });

    async function fetchTasks() {
        loadingMessage.style.display = 'block';
        noTasksMessage.style.display = 'none';
        taskList.innerHTML = '';

        try {
            const response = await fetch(`/api/tasks/${encodeURIComponent(ownerName)}`);
            if (!response.ok) throw new Error('网络响应错误');
            const tasks = await response.json();

            displayTasks(Array.isArray(tasks) ? tasks : []);
        } catch (error) {
            console.error('加载任务失败:', error);
            noTasksMessage.textContent = '加载任务失败，请稍后重试。';
            noTasksMessage.style.display = 'block';
        } finally {
            loadingMessage.style.display = 'none';
        }
    }

    function displayTasks(tasks) {
        taskList.innerHTML = '';

        if (!tasks || tasks.length === 0) {
            noTasksMessage.style.display = 'block';
            return;
        }
        noTasksMessage.style.display = 'none';

        tasks.forEach(task => {
            const li = document.createElement('li');
            li.className = 'task-item';

            // left: task name (click opens modal)
            const nameDiv = document.createElement('div');
            nameDiv.className = 'task-name';
            // Use an <a> inside for accessibility/style if you prefer
            const nameLink = document.createElement('a');
            nameLink.href = '#';
            nameLink.textContent = task;
            nameLink.addEventListener('click', (e) => {
                e.preventDefault();
                // showAnnotationTypeModal is defined in tasks.html; open modal
                if (typeof showAnnotationTypeModal === 'function') {
                    showAnnotationTypeModal(task);
                } else {
                    // fallback: direct to default annotate rect page
                    window.location.href = `/annotate/${encodeURIComponent(ownerName)}/${encodeURIComponent(task)}/rect`;
                }
            });
            nameDiv.appendChild(nameLink);

            // right: actions
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'task-actions';

            // Annotate button (same behavior as clicking name)
            const annotateBtn = document.createElement('button');
            annotateBtn.className = 'btn btn-primary';
            annotateBtn.textContent = '标注';
            annotateBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (typeof showAnnotationTypeModal === 'function') {
                    showAnnotationTypeModal(task);
                } else {
                    window.location.href = `/annotate/${encodeURIComponent(ownerName)}/${encodeURIComponent(task)}/rect`;
                }
            });

            // Train button (direct link)
            const trainLink = document.createElement('a');
            trainLink.className = 'btn btn-success';
            trainLink.textContent = '训练';
            trainLink.href = `/train/${encodeURIComponent(ownerName)}/${encodeURIComponent(task)}`;

            // Download button (direct link)
            const downloadLink = document.createElement('a');
            downloadLink.className = 'btn btn-info';
            downloadLink.textContent = '下载数据';
            downloadLink.href = `/api/download/${encodeURIComponent(ownerName)}/${encodeURIComponent(task)}`;

            // Delete button
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-danger';
            deleteBtn.textContent = '删除任务';
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!confirm(`确认删除任务 "${task}"？此操作不可恢复。`)) return;
                try {
                    const res = await fetch('/api/tasks/delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ owner: ownerName, taskName: task })
                    });
                    if (!res.ok) {
                        let data;
                        try { data = await res.json(); } catch (_) { /* ignore */ }
                        throw new Error(data && data.error ? data.error : '删除失败');
                    }
                    // 刷新列表
                    await fetchTasks();
                } catch (err) {
                    alert(`删除失败: ${err.message}`);
                }
            });

            // append actions (order can be changed)
            actionsDiv.appendChild(annotateBtn);
            actionsDiv.appendChild(trainLink);
            actionsDiv.appendChild(downloadLink);
            actionsDiv.appendChild(deleteBtn);

            li.appendChild(nameDiv);
            li.appendChild(actionsDiv);
            taskList.appendChild(li);
        });
    }

    async function createTask() {
        const taskName = newTaskInput.value.trim();
        if (!taskName) {
            alert('请输入任务名称');
            return;
        }

        if (/[\\/]/.test(taskName)) {
            alert('任务名不能包含 \\ 或 / 字符。');
            return;
        }

        try {
            const response = await fetch('/api/tasks/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ owner: ownerName, taskName: taskName })
            });

            if (response.ok) {
                // 默认跳转到矩形标注页面
                window.location.href = `/annotate/${encodeURIComponent(ownerName)}/${encodeURIComponent(taskName)}/rect`;
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || '创建失败');
            }
        } catch (err) {
            alert(`创建任务失败: ${err.message}`);
        }
    }

    // initial load
    fetchTasks();
});
