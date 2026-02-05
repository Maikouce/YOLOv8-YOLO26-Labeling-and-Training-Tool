// train.js - YOLO Web UI (方案一：解耦模式 - 完整版)

// ============ 1. 工具函数:动态加载 Chart.js ============
async function loadChartJs() {
    if (typeof Chart !== 'undefined') return;
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

// ============ 2. 图表管理器类 (5参数全监控) ============
class TrainingChart {
    constructor(containerId) {
        this.chart = null;
        this.containerId = containerId;
        this.ctx = null;
        this.data = {
            labels: [], // Epochs
            datasets: [
                {
                    label: 'mAP50',
                    borderColor: '#ec4899',
                    backgroundColor: 'rgba(236, 72, 153, 0.1)',
                    data: [],
                    yAxisID: 'y',
                    tension: 0.3,
                    order: 1
                },
                {
                    label: 'mAP50-95',
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    data: [],
                    yAxisID: 'y',
                    tension: 0.3,
                    order: 2
                },
                {
                    label: 'Precision',
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6, 182, 212, 0.1)',
                    data: [],
                    yAxisID: 'y',
                    tension: 0.3,
                    hidden: true,
                    borderDash: [2, 2],
                    order: 3
                },
                {
                    label: 'Recall',
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    data: [],
                    yAxisID: 'y',
                    tension: 0.3,
                    hidden: true,
                    borderDash: [2, 2],
                    order: 4
                },
                {
                    label: 'Box Loss',
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    data: [],
                    yAxisID: 'y1',
                    borderDash: [5, 5],
                    tension: 0.3,
                    order: 5
                }
            ]
        };
    }

    async init() {
        await loadChartJs();
        const logContainer = document.getElementById(this.containerId);
        let chartWrapper = document.getElementById('chart-wrapper');

        if (!chartWrapper) {
            chartWrapper = document.createElement('div');
            chartWrapper.id = 'chart-wrapper';
            Object.assign(chartWrapper.style, {
                height: '320px',
                width: '100%',
                marginBottom: '15px',
                background: 'rgba(255, 255, 255, 0.95)',
                borderRadius: '12px',
                padding: '10px',
                border: '1px solid rgba(203, 213, 225, 0.8)',
                display: 'none'
            });
            logContainer.parentNode.insertBefore(chartWrapper, logContainer);
        } else {
            chartWrapper.innerHTML = '';
        }

        const canvas = document.createElement('canvas');
        chartWrapper.appendChild(canvas);
        this.ctx = canvas.getContext('2d');
        this.chartWrapper = chartWrapper;

        this.chart = new Chart(this.ctx, {
            type: 'line',
            data: this.data,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        labels: { color: '#334155', padding: 15, usePointStyle: true },
                        onHover: (e) => e.native.target.style.cursor = 'pointer'
                    },
                    title: { display: true, text: '点击图例可 隐藏/显示 线条', color: '#64748b', font: {size: 11} },
                    tooltip: {
                        mode: 'index', intersect: false,
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        titleColor: '#1e293b', bodyColor: '#475569',
                        borderColor: 'rgba(99,102,241,0.3)', borderWidth: 1
                    }
                },
                scales: {
                    x: { ticks: { color: '#475569' }, grid: { color: 'rgba(148, 163, 184, 0.2)' } },
                    y: {
                        type: 'linear', display: true, position: 'left',
                        title: { display: true, text: 'Metrics (0-1)', color: '#ec4899' },
                        ticks: { color: '#334155' }, min: 0, max: 1,
                        grid: { color: 'rgba(148, 163, 184, 0.2)' }
                    },
                    y1: {
                        type: 'linear', display: true, position: 'right',
                        title: { display: true, text: 'Loss', color: '#f59e0b' },
                        ticks: { color: '#f59e0b' }, grid: { drawOnChartArea: false }
                    }
                }
            }
        });
    }

    update(epoch, precision, recall, map50, map95, boxLoss) {
        if (!this.chart) return;
        if (this.chartWrapper.style.display === 'none') {
            this.chartWrapper.style.display = 'block';
        }
        if (!this.data.labels.includes(epoch)) {
            this.data.labels.push(epoch);
            this.data.datasets[0].data.push(map50);
            this.data.datasets[1].data.push(map95);
            this.data.datasets[2].data.push(precision);
            this.data.datasets[3].data.push(recall);
            this.data.datasets[4].data.push(boxLoss);
            this.chart.update();
        }
    }

    reset() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
        if (this.chartWrapper) {
            this.chartWrapper.style.display = 'none';
        }
        this.data.labels = [];
        this.data.datasets.forEach(ds => ds.data = []);
    }
}

// ============ 3. YOLO 日志渲染器 ============
class YOLOLogRenderer {
    constructor(containerEl) {
        this.container = containerEl;
        this.lines = [];
        this.progressLineIndex = -1;
    }

    append(rawText) {
        const chunks = rawText.split(/\r?\n/);
        chunks.forEach(chunk => {
            const trimmed = chunk.trim();
            if (!trimmed) return;
            if (this.isProgressLine(trimmed)) {
                this.updateProgressLine(chunk);
            } else {
                this.finalizeProgressLine();
                this.addLine(chunk);
            }
        });
        this.render();
    }

    isProgressLine(line) {
        return /\d+%\s*[━─█]/.test(line) || /^\s*\d+\/\d+.*:\s*\d+%/.test(line) || /Scanning.*:\s*\d+%/.test(line);
    }

    updateProgressLine(line) {
        if (this.progressLineIndex !== -1) {
            this.lines[this.progressLineIndex] = { type: 'progress', content: line };
        } else {
            this.progressLineIndex = this.lines.length;
            this.lines.push({ type: 'progress', content: line });
        }
    }

    finalizeProgressLine() {
        if (this.progressLineIndex !== -1) this.progressLineIndex = -1;
    }

    addLine(line) {
        this.lines.push({ type: this.classifyLine(line), content: line });
    }

    classifyLine(line) {
        if (/Epoch\s+GPU_mem|Class\s+Images/i.test(line)) return 'header';
        if (/^\s*\d+\/\d+\s+/.test(line)) return 'epoch';
        if (/all\s+\d+|mAP|precision/i.test(line)) return 'validation';
        if (/error|exception|traceback/i.test(line)) return 'error';
        if (/warning/i.test(line)) return 'warning';
        if (/success|saved|completed/i.test(line)) return 'success';
        if (/yolo|ultralytics/i.test(line)) return 'brand';
        if (/:/.test(line) && !/^\s*\d/.test(line)) return 'info';
        return 'normal';
    }

    render() {
        const html = this.lines.map((line, idx) => {
            const isActive = idx === this.progressLineIndex;
            return this.renderLine(line, isActive);
        }).join('');
        this.container.innerHTML = html;
        this.container.scrollTop = this.container.scrollHeight;
    }

    renderLine(lineObj, isActive) {
        let { type, content } = lineObj;
        content = this.escapeHtml(content);
        if (type === 'header') content = this.highlightHeader(content);
        else if (type === 'epoch' || type === 'progress') content = this.highlightEpochLine(content, isActive);
        else if (type === 'validation') content = this.highlightValidation(content);
        else if (type === 'info') content = content.replace(/^([^:]+:)/, '<span class="log-info-label">$1</span>');
        const activeClass = isActive ? ' log-active' : '';
        return `<div class="log-line log-${type}${activeClass}">${content}</div>`;
    }

    highlightHeader(html) {
        return `<span class="log-header">${html.replace(/([A-Za-z0-9_()]+)/g, '<span class="log-header-item">$1</span>')}</span>`;
    }

    highlightEpochLine(html, isActive) {
        const pctMatch = html.match(/(\d+)%\s*[━─█]+/);
        if (pctMatch) {
            const pct = pctMatch[1];
            const barHtml = `<span class="log-progress-bar${isActive ? ' active' : ''}"><span class="log-progress-fill" style="width:${pct}%"></span><span class="log-progress-text">${pct}%</span></span>`;
            html = html.replace(/\d+%\s*[━─█]+/, barHtml);
        }
        html = html.replace(/(\d+\/\d+)/, '<span class="log-epoch">$1</span>');
        html = html.replace(/([\d.]+G)/, '<span class="log-gpu">$1</span>');
        html = html.replace(/(\s)([\d.]{4,})(\s|$)/g, '$1<span class="log-loss">$2</span>$3');
        return html;
    }

    highlightValidation(html) {
        html = html.replace(/\ball\b/gi, '<span class="log-all">all</span>');
        html = html.replace(/(\s)(0\.\d+)(\s|$)/g, '$1<span class="log-metric">$2</span>$3');
        return `<span class="log-validation">${html}</span>`;
    }

    escapeHtml(text) {
        return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    appendSystem(msg, type = 'info') {
        this.finalizeProgressLine();
        this.lines.push({ type: `system-${type}`, content: msg });
        this.render();
    }

    clear() {
        this.lines = [];
        this.progressLineIndex = -1;
        this.container.innerHTML = '';
    }
}

// ============ 4. 样式注入 ============
function injectYOLOLogStyles() {
    if (document.getElementById('yolo-log-styles')) return;
    const css = `
        #log-output{font-family:'JetBrains Mono',Consolas,monospace;font-size:13px;line-height:1.6;background:#f8fafc;color:#334155;padding:15px;border-radius:12px;overflow-y:auto;height:450px;border:1px solid #cbd5e1}
        .log-line{white-space:pre-wrap;word-break:break-all;padding:2px 0}
        .log-line.log-active{background:rgba(99,102,241,0.08);border-left:2px solid #6366f1;padding-left:10px}
        .log-header-item{color:#0891b2;font-weight:700}
        .log-epoch{color:#7c3aed;font-weight:bold} .log-gpu{color:#059669} .log-loss{color:#d97706}
        .log-metric{color:#ca8a04;font-weight:bold} .log-all{color:#0284c7}
        .log-error{color:#dc2626;background:rgba(239,68,68,0.08);padding:5px}
        .log-success{color:#16a34a} .log-warning{color:#ca8a04} .log-info-label{color:#2563eb}
        .log-progress-bar{display:inline-block;width:80px;height:14px;background:#e2e8f0;border-radius:7px;position:relative;vertical-align:middle;margin:0 5px;overflow:hidden;border:1px solid #cbd5e1}
        .log-progress-fill{position:absolute;top:0;left:0;height:100%;background:linear-gradient(90deg,#6366f1,#a855f7);transition:width .2s}
        .log-progress-text{position:absolute;width:100%;text-align:center;font-size:10px;line-height:14px;color:#fff;z-index:1;text-shadow:0 1px 2px rgba(0,0,0,0.3)}
    `;
    const style = document.createElement('style');
    style.id = 'yolo-log-styles';
    style.textContent = css;
    document.head.appendChild(style);
}

// ============ 5. 主逻辑 (集成解耦、停止、重连) ============
document.addEventListener('DOMContentLoaded', () => {
    injectYOLOLogStyles();

    const owner = document.getElementById('owner').value;
    const taskName = document.getElementById('taskName').value;

    let currentRunName = null;
    let sseConnection = null;
    let currentStreamId = null; // 用于存储当前活跃的任务ID
    let currentEpochData = { epoch: 0, boxLoss: 0 };

    const form = document.getElementById('train-form');
    const startBtn = document.getElementById('start-train-btn');
    const stopBtn = document.getElementById('stop-train-btn'); // 新增：停止按钮
    const spinner = document.getElementById('btn-spinner');
    const btnText = document.getElementById('btn-text');
    const logOutput = document.getElementById('log-output');
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('training-progress-bar');
    const completeAlert = document.getElementById('training-complete-alert');
    const errorAlert = document.getElementById('error-alert');
    const downloadBtn = document.getElementById('download-results-btn');
    const runsSelect = document.getElementById('runs-select');
    const downloadSelectedBtn = document.getElementById('download-selected-btn');

    const logRenderer = new YOLOLogRenderer(logOutput);
    const trainingChart = new TrainingChart('log-output');

    // --- 加载初始数据 ---
    async function loadModels() {
        try {
            const res = await fetch('/api/get_models');
            const models = await res.json();
            const sel = document.getElementById('model-select');
            sel.innerHTML = '';
            if (models.length > 0) {
                models.forEach(m => sel.add(new Option(m, m)));
            } else {
                sel.add(new Option("未找到模型 (.pt)", ""));
                sel.disabled = true; startBtn.disabled = true;
            }
        } catch (e) { console.error(e); }
    }

    async function loadRuns() {
        if (!runsSelect) return;
        try {
            const res = await fetch(`/api/list_runs/${encodeURIComponent(owner)}/${encodeURIComponent(taskName)}`);
            const runs = await res.json();
            runsSelect.innerHTML = '';
            if (!runs || runs.length === 0) {
                runsSelect.add(new Option("(无历史记录)", ""));
                runsSelect.disabled = true;
            } else {
                runs.forEach(run => {
                    const date = new Date(run.mtime * 1000).toLocaleString();
                    runsSelect.add(new Option(`${run.name} — ${date}`, run.name));
                });
                runsSelect.disabled = false;
                if(downloadSelectedBtn) downloadSelectedBtn.disabled = false;
            }
        } catch (e) { console.error(e); }
    }

    // --- 新增：检查当前任务状态 (页面刷新后重连) ---
    async function checkActiveStatus() {
        try {
            const res = await fetch(`/api/check_status/${owner}/${taskName}`);
            const data = await res.json();
            if (data.status === 'running' && data.stream_id) {
                logRenderer.appendSystem('检测到后台有正在运行的训练任务，正在恢复连接...', 'info');
                await trainingChart.init(); // 初始化图表
                progressContainer.style.display = 'block';
                setTrainingState(true);
                startListening(data.stream_id);
            }
        } catch (e) {
            console.error("Status check failed", e);
        }
    }

    // --- 新增：统一设置UI状态 (训练中 vs 空闲) ---
    function setTrainingState(isTraining) {
        if (isTraining) {
            // 进入训练状态
            startBtn.disabled = true;
            spinner.style.display = 'inline-block';
            btnText.textContent = '训练进行中...';

            // 显示停止按钮
            if (stopBtn) {
                stopBtn.style.display = 'block';
                stopBtn.disabled = false;
                stopBtn.textContent = '停止';
            }
            // 禁用表单
            Array.from(form.elements).forEach(el => el.disabled = true);
            // 确保停止按钮始终可用
            if (stopBtn) stopBtn.disabled = false;
        } else {
            // 恢复空闲状态
            startBtn.disabled = false;
            spinner.style.display = 'none';
            btnText.textContent = '开始准备数据并训练';

            // 隐藏停止按钮
            if (stopBtn) stopBtn.style.display = 'none';
            // 恢复表单
            Array.from(form.elements).forEach(el => el.disabled = false);
        }
    }

    // --- 新增：停止按钮点击事件 ---
    if (stopBtn) {
        stopBtn.addEventListener('click', async () => {
            if (!currentStreamId) return;
            if (!confirm('确定要强制停止当前训练吗？\n进度将不会保存，且可能产生不完整的模型文件。')) return;

            stopBtn.disabled = true;
            stopBtn.textContent = '正在停止...';

            try {
                const res = await fetch(`/api/stop_train/${currentStreamId}`, { method: 'POST' });
                const data = await res.json();
                if (res.ok) {
                    logRenderer.appendSystem('已发送停止指令，请等待进程退出...', 'warning');
                } else {
                    alert('停止失败: ' + data.message);
                    stopBtn.disabled = false;
                    stopBtn.textContent = '停止';
                }
            } catch (e) {
                alert('网络错误，无法发送停止指令');
                stopBtn.disabled = false;
            }
        });
    }

    // --- 表单提交 (开始训练) ---
       form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // 【关键修复 1】: 在禁用表单前，先提取数据！
        // 如果先 setTrainingState(true) 把 input 禁用了，FormData 就抓不到数据了
        const formData = new FormData(form);

        // 【关键修复 2】: 手动校验一下模型是否已选
        if (!formData.get('model')) {
            alert('请先选择一个预训练模型！');
            return;
        }

        resetUI();
        setTrainingState(true); // 现在可以安全地禁用界面了

        btnText.textContent = '初始化中...';
        logRenderer.appendSystem('正在提交训练任务...', 'info');

        try {
            await trainingChart.init();

            // 使用上面提取好的 formData
            const res = await fetch(`/api/start_train/${owner}/${taskName}`, {
                method: 'POST',
                body: formData,
            });
            const data = await res.json();

            if (res.ok) {
                logRenderer.appendSystem('✅ 提交成功, 正在连接日志...', 'success');
                progressContainer.style.display = 'block';
                startListening(data.stream_id);
            } else {
                throw new Error(data.message);
            }
        } catch (err) {
            showError(err.message);
            setTrainingState(false);
        }
    });

    // --- 核心：日志监听 (SSE) ---
    function startListening(streamId) {
        if (sseConnection) sseConnection.close();

        currentStreamId = streamId;
        sseConnection = new EventSource(`/stream/${streamId}`);

        const trainRegex = /^\s*(\d+)\/(\d+)\s+[\d.]+G\s+([\d.]+)/;
        const valRegex = /^\s*all\s+\d+\s+\d+\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/;
        const queuedRegex = /^__QUEUED__:(\d+)/;

        sseConnection.onmessage = function(event) {
            const line = event.data;
            if (!line) return;

            // 1. 处理特殊控制信号
            if (line.startsWith('__SUCCESS__:')) {
                handleSuccess(line.replace('__SUCCESS__:', '').trim());
                return;
            }
            if (line.startsWith('__ERROR__:')) {
                handleError(line.replace('__ERROR__:', '').trim());
                return;
            }
            if (line.startsWith('__END_OF_STREAM__')) {
                logRenderer.appendSystem('📡 日志流结束', 'info');
                closeConnection();
                // 如果没有收到成功或错误信号就断开了，可能异常，重置状态
                if (startBtn.disabled) setTrainingState(false);
                return;
            }

            // 2. 处理排队和状态信息
            const queueMatch = line.match(queuedRegex);
            if (queueMatch) {
                const pos = parseInt(queueMatch[1]);
                btnText.textContent = pos > 0 ? `当前排队中 (第 ${pos} 位)` : '准备执行...';
            }
            if (line.includes('__STARTING__')) {
                btnText.textContent = '正在启动训练进程...';
                return;
            }

            // 3. 渲染常规日志
            logRenderer.append(line);

            // 4. 解析进度 (Epoch / Loss)
            const epochMatch = line.match(trainRegex);
            if (epochMatch) {
                btnText.textContent = '训练进行中...';
                const cur = parseInt(epochMatch[1]);
                const total = parseInt(epochMatch[2]);
                const boxLoss = parseFloat(epochMatch[3]);
                currentEpochData = { epoch: cur, boxLoss: boxLoss };

                if (total > 0) {
                    const pct = Math.round((cur / total) * 100);
                    progressBar.style.width = pct + '%';
                    progressBar.textContent = `${pct}% (${cur}/${total})`;
                }
            }

            // 5. 解析图表数据 (Precision / Recall / mAP)
            const valMatch = line.match(valRegex);
            if (valMatch && currentEpochData.epoch > 0) {
                const precision = parseFloat(valMatch[1]);
                const recall = parseFloat(valMatch[2]);
                const map50 = parseFloat(valMatch[3]);
                const map95 = parseFloat(valMatch[4]);

                trainingChart.update(
                    currentEpochData.epoch,
                    precision,
                    recall,
                    map50,
                    map95,
                    currentEpochData.boxLoss
                );
            }
        };

sseConnection.onerror = () => {
            console.warn('SSE连接断开');

            // 【优化】: 界面显示连接断开，并尝试通过 check_status 确认是否真的挂了
            btnText.textContent = "连接断开，尝试重连中...";
            startBtn.classList.remove('btn-success');
            startBtn.classList.add('btn-warning'); // 变黄提醒

            sseConnection.close();

            // 3秒后尝试检查后台状态，看是真挂了还是只是网络波动
            setTimeout(async () => {
                try {
                    const res = await fetch(`/api/check_status/${owner}/${taskName}`);
                    const data = await res.json();
                    if (data.status === 'running') {
                        // 如果后台还在跑，说明只是网络断了，重新连接 SSE
                        logRenderer.appendSystem('网络闪断，正在恢复连接...', 'warning');
                        startListening(data.stream_id);

                        // 恢复按钮样式
                        startBtn.classList.remove('btn-warning');
                        startBtn.classList.add('btn-success');
                    } else {
                        // 后台说没有在跑，说明服务重启了或者任务丢了
                        handleError('与服务器的连接中断，且后台任务已不存在。');
                    }
                } catch (e) {
                    // check_status 都连不上，说明服务器彻底挂了
                    logRenderer.appendSystem('服务器无响应', 'error');
                    // 这里不弹窗，防止一直弹，保持界面卡在最后状态即可
                    btnText.textContent = "服务器已离线";
                    stopBtn.disabled = true;
                }
            }, 3000); // 3秒后重试
        };
    }

    function handleSuccess(runName) {
        currentRunName = runName;
        progressBar.style.width = '100%';
        progressBar.classList.add('bg-success');
        progressBar.textContent = '完成';
        completeAlert.style.display = 'flex';
        logRenderer.appendSystem(`训练完成! 结果: ${runName}`, 'success');
        closeConnection();
        setTrainingState(false);
        loadRuns();
    }

    function handleError(msg) {
        showError(msg);
        logRenderer.appendSystem(`终止/错误: ${msg}`, 'error');
        progressBar.classList.add('bg-danger');
        closeConnection();
        setTrainingState(false);
    }

    function closeConnection() {
        if (sseConnection) {
            sseConnection.close();
            sseConnection = null;
        }
        currentStreamId = null;
    }

    function resetUI() {
        logRenderer.clear();
        trainingChart.reset();
        completeAlert.style.display = 'none';
        errorAlert.style.display = 'none';
        progressContainer.style.display = 'none';
        progressBar.style.width = '0%';
        progressBar.classList.remove('bg-success', 'bg-danger');
        currentRunName = null;
        currentEpochData = { epoch: 0, boxLoss: 0 };
        closeConnection();
    }

    function showError(msg) {
        document.getElementById('error-message').textContent = msg;
        errorAlert.style.display = 'block';
    }

    downloadBtn.addEventListener('click', () => {
        if (!currentRunName) return alert('暂无结果');
        window.location.href = `/api/download_results/${owner}/${taskName}/${currentRunName}`;
    });

    if (downloadSelectedBtn) {
        downloadSelectedBtn.addEventListener('click', () => {
            if (!runsSelect.value) return alert('请选择记录');
            window.location.href = `/api/download_results/${owner}/${taskName}/${runsSelect.value}`;
        });
    }

    // 初始化执行
    loadModels();
    loadRuns();
    checkActiveStatus(); // 启动时自动检查
});