// static/js/core/UIManager.js

import { generateDistinctColor } from '../utils/colorUtils.js';

export class UIManager {
    constructor(bus, imageManager, labelManager, config) {
        this.bus = bus;
        this.imageManager = imageManager;
        this.labelManager = labelManager;
        this.config = config;

        this.dom = {
            statusMessageDiv: document.getElementById('statusMessage'),
            loadingOverlay: document.getElementById('loadingOverlay'),
            loadingText: document.getElementById('loadingText'),
            imageUploadInput: document.getElementById('imageUploadInput'),
            uploadProgressContainer: document.getElementById('uploadProgressContainer'),
            uploadProgressBar: document.getElementById('uploadProgressBar'),
            uploadStatusText: document.getElementById('uploadStatusText'),
            newLabelInput: document.getElementById('newLabelInput'),
            addLabelBtn: document.getElementById('addLabelBtn'),
            labelsListDiv: document.getElementById('labelsList'),
            prevImageBtn: document.getElementById('prevImageBtn'),
            nextImageBtn: document.getElementById('nextImageBtn'),
            imageInfoSpan: document.getElementById('imageInfo'),
            currentModeDisplay: document.getElementById('currentModeDisplay'),
            deleteCurrentImageBtn: document.getElementById('deleteCurrentImageBtn'),

            // 批量/自动标注 Modal 相关
            batchManageBtn: document.getElementById('batchManageBtn'),
            batchManagementModal: document.getElementById('batchManagementModal'),
            modalOverlay: document.getElementById('modalOverlay'),

            // 稍后在 init 方法中动态查找或创建
            modalCloseBtn: null,
            imageListContainer: null,

            finishAndTrainBtn: document.getElementById('finish-and-train-btn'),
            contextMenuDiv: document.getElementById('contextMenu'),
            sidebar: document.querySelector('.sidebar'),
        };

        this.injectCustomStyles(); // 注入美化样式
        this.injectConfidenceSlider(); // 注入置信度滑块和模式切换按钮
        this.injectLabelManageButton(); // 注入标签管理入口
        this.createLabelManagementModal(); // 创建标签管理弹窗DOM
        this.initAutoAnnotationUI(); // 初始化自动标注UI

        this.setupListeners();
        this.bus.on('labelsUpdated', this.updateLabelList.bind(this));
        this.bus.on('imageIndexChanged', this.updateImageNav.bind(this));
        this.bus.on('modeChanged', this.updateCurrentModeDisplay.bind(this));
        this.bus.on('statusMessage', this.showStatusMessage.bind(this));
        this.bus.on('showLoading', this.showLoading.bind(this));
        this.bus.on('annotationsSelected', this.showCustomContextMenu.bind(this));
        this.bus.on('hideContextMenu', this.hideContextMenu.bind(this));

        // 【新增】监听模式切换事件，更新UI文字
        this.bus.on('samModeChanged', (mode) => {
            const btn = document.getElementById('samModeToggleBtn');
            if (btn) {
                if (mode === 'semantic') {
                    btn.textContent = "AI模式: 提示词关联 (Semantic)";
                    btn.style.background = "#0891b2"; // 青色
                } else {
                    btn.textContent = "AI模式: 单体分割 (Standard)";
                    btn.style.background = "#d97706"; // 橙色
                }
            }
        });
    }

    // 注入CSS以美化列表和模态框
    injectCustomStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* 通用模态框样式 */
            .modal-content-grid {
                display: grid;
                grid-template-columns: 350px 1fr;
                height: 100%;
                background: #fff;
                overflow: hidden; /* 防止网格本身溢出 */
            }
            .image-list-panel {
                border-right: 1px solid #eee;
                display: flex;
                flex-direction: column;
                background-color: #fcfcfc;
                height: 100%; /* 占满高度 */
                overflow: hidden; /* 关键：防止面板本身滚动，强制子元素处理滚动 */
            }
            .config-panel {
                padding: 30px;
                overflow-y: auto;
                background-color: #fff;
                height: 100%;
            }
            /* 列表项样式 */
            .modern-list-item {
                display: flex;
                align-items: center;
                padding: 12px 15px;
                border-bottom: 1px solid #f0f0f0;
                cursor: pointer;
                transition: all 0.2s ease;
                font-size: 14px;
                color: #444;
            }
            .modern-list-item:hover {
                background-color: #e6f7ff;
                padding-left: 20px;
            }
            .badge-count {
                background: #f0f0f0;
                color: #666;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 11px;
                margin-left: auto;
            }
            /* 标签管理表格样式 */
            .label-manage-table {
                width: 100%;
                border-collapse: collapse;
            }
            .label-manage-table th {
                text-align: left;
                padding: 10px;
                background: #f8f9fa;
                border-bottom: 2px solid #eee;
                color: #555;
            }
            .label-manage-table td {
                padding: 10px;
                border-bottom: 1px solid #f0f0f0;
            }
            .label-edit-input {
                width: 100%;
                padding: 6px;
                border: 1px solid #ddd;
                border-radius: 4px;
            }
            .label-edit-input:focus {
                border-color: #007bff;
                outline: none;
            }
            /* 图标按钮样式 */
            .btn-icon {
                background: none;
                border: none;
                cursor: pointer;
                font-size: 16px;
                padding: 4px 8px;
                border-radius: 4px;
                transition: background 0.2s;
                color: #666;
            }
            .btn-icon:hover { background: #eee; }
            .btn-icon.delete:hover { background: #fff1f0; color: #dc3545; }
        `;
        document.head.appendChild(style);
    }

    // 【修改】注入滑动条和模式切换按钮
    injectConfidenceSlider() {
        if (!this.dom.sidebar) return;
        const labelGroup = this.dom.sidebar.querySelector('.control-group:nth-child(3)');
        const div = document.createElement('div');
        div.className = 'control-group';
        div.innerHTML = `
            <h3>AI 辅助设置</h3>
            <div style="margin-top:5px;">
                <!-- 模式切换按钮 -->
                <button id="samModeToggleBtn" class="btn" style="background:#0891b2; margin-bottom:5px; font-size:12px; padding: 8px;">AI模式: 提示词关联 (Semantic)</button>
                <div style="font-size:11px; color:#666; margin-bottom:12px; text-align:center;">(快捷键: R 切换模式)</div>

                <label style="display:flex; justify-content:space-between;">
                    <span>交互置信度:</span>
                    <span id="interactiveConfDisplay">0.60</span>
                </label>
                <input type="range" id="interactiveConfSlider" min="0.1" max="0.9" step="0.05" value="0.6" style="width:100%;">
                <small style="color:#888; font-size:10px;">值越高，生成的框越少(更精准)；值越低，召回越多。</small>
            </div>
        `;
        if (labelGroup) { this.dom.sidebar.insertBefore(div, labelGroup); } else { this.dom.sidebar.appendChild(div); }

        const slider = div.querySelector('#interactiveConfSlider');
        const display = div.querySelector('#interactiveConfDisplay');
        slider.oninput = (e) => { display.textContent = parseFloat(e.target.value).toFixed(2); };

        // 绑定按钮点击事件，通过 Bus 触发 Annotator 的切换逻辑
        const toggleBtn = div.querySelector('#samModeToggleBtn');
        toggleBtn.onclick = () => {
            const annotator = this.bus.canvasManager?.annotators['sam_assist'];
            if(annotator && annotator.toggleMode) {
                annotator.toggleMode();
            } else {
                this.showStatusMessage("请先进入标注界面", "info");
            }
        };
    }

    // --- 注入“标签管理”按钮 ---
    injectLabelManageButton() {
        if (!this.dom.addLabelBtn) return;
        const container = this.dom.addLabelBtn.parentElement;
        const btnGroup = document.createElement('div');
        btnGroup.style.display = 'flex';
        btnGroup.style.gap = '5px';
        btnGroup.style.marginTop = '5px';

        this.dom.addLabelBtn.style.flex = '1';
        this.dom.addLabelBtn.parentNode.insertBefore(btnGroup, this.dom.addLabelBtn);
        btnGroup.appendChild(this.dom.addLabelBtn);

        const manageBtn = document.createElement('button');
        manageBtn.className = 'btn';
        manageBtn.innerHTML = '⚙️ 管理';
        manageBtn.style.flex = '0 0 80px';
        manageBtn.style.backgroundColor = '#6c757d';
        manageBtn.onclick = () => this.showLabelManagementModal();

        btnGroup.appendChild(manageBtn);
    }

    // --- 创建标签管理弹窗 DOM ---
    createLabelManagementModal() {
        const modalId = 'labelManagementModal';
        let modal = document.getElementById(modalId);

        if (!modal) {
            modal = document.createElement('div');
            modal.id = modalId;
            modal.style.display = 'none';
            modal.style.position = 'fixed';
            modal.style.top = '50%';
            modal.style.left = '50%';
            modal.style.transform = 'translate(-50%, -50%)';
            modal.style.zIndex = '3000'; // 确保在 overlay 之上
            modal.style.backgroundColor = '#fff';
            modal.style.width = '600px';
            modal.style.maxWidth = '90vw';
            modal.style.borderRadius = '8px';
            modal.style.boxShadow = '0 5px 30px rgba(0,0,0,0.3)';
            modal.style.padding = '0';
            modal.style.overflow = 'hidden';
            modal.addEventListener('click', (e) => e.stopPropagation());

            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="modal-header" style="padding:15px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
                <h3 style="margin:0;">🏷️ 标签全量管理</h3>
                <button class="modal-close-btn" style="background:none; border:none; font-size:24px; cursor:pointer;">&times;</button>
            </div>
            <div class="modal-content" style="padding:20px; max-height:500px; overflow-y:auto;">
                <div style="background:#f0f8ff; border:1px solid #cce5ff; padding:10px; border-radius:4px; margin-bottom:15px; font-size:13px; color:#004085;">
                    💡 修改标签名称后，会自动同步更新当前加载的所有图片中的对应标注。
                </div>
                <table class="label-manage-table">
                    <thead>
                        <tr>
                            <th style="width: 60px;">颜色</th>
                            <th>标签名称</th>
                            <th style="width: 80px; text-align:center;">操作</th>
                        </tr>
                    </thead>
                    <tbody id="labelManageTableBody"></tbody>
                </table>
            </div>
            <div class="modal-footer" style="padding:15px; border-top:1px solid #eee; text-align:right;">
                <button id="closeLabelModalBtn" class="btn" style="background:#6c757d;">关闭</button>
            </div>
        `;

        this.dom.labelManagementModal = modal;
        modal.querySelector('.modal-close-btn').onclick = () => this.hideLabelManagementModal();
        modal.querySelector('#closeLabelModalBtn').onclick = () => this.hideLabelManagementModal();
    }

    showLabelManagementModal() {
        this.dom.modalOverlay.style.display = 'block';
        this.dom.modalOverlay.style.zIndex = '2000';
        this.dom.labelManagementModal.style.display = 'block';
        this.renderLabelEditorList();
    }

    hideLabelManagementModal() {
        this.dom.modalOverlay.style.display = 'none';
        this.dom.labelManagementModal.style.display = 'none';
        this.updateLabelList();
        this.bus.emit('redraw');
    }

    renderLabelEditorList() {
        const tbody = this.dom.labelManagementModal.querySelector('#labelManageTableBody');
        tbody.innerHTML = '';
        const labels = this.labelManager.getLabels();

        labels.forEach((label, index) => {
            const tr = document.createElement('tr');

            const tdColor = document.createElement('td');
            const colorInput = document.createElement('input');
            colorInput.type = 'color';
            colorInput.value = label.color;
            colorInput.style.cursor = 'pointer';
            colorInput.onchange = (e) => this.handleLabelUpdate(index, 'color', e.target.value);
            tdColor.appendChild(colorInput);

            const tdName = document.createElement('td');
            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.value = label.name;
            nameInput.className = 'label-edit-input';
            nameInput.onchange = (e) => this.handleLabelUpdate(index, 'name', e.target.value);
            tdName.appendChild(nameInput);

            const tdAction = document.createElement('td');
            tdAction.style.textAlign = 'center';
            const delBtn = document.createElement('button');
            delBtn.className = 'btn-icon delete';
            delBtn.innerHTML = '🗑️';
            delBtn.title = '删除此标签';
            delBtn.onclick = () => this.handleLabelDeleteFromModal(index, label.name);
            tdAction.appendChild(delBtn);

            tr.appendChild(tdColor);
            tr.appendChild(tdName);
            tr.appendChild(tdAction);
            tbody.appendChild(tr);
        });
    }

    async handleLabelUpdate(index, field, value) {
        const labels = this.labelManager.getLabels();
        const oldName = labels[index].name;

        if (field === 'name') {
            const newName = value.trim();
            if (!newName) return alert("标签名不能为空");
            if (labels.some((l, i) => i !== index && l.name === newName)) return alert("标签名已存在");

            labels[index].name = newName;
            const allImages = this.imageManager.getAllImages();
            let updateCount = 0;
            allImages.forEach(img => {
                if (img.annotations) {
                    img.annotations.forEach(ann => {
                        if (ann.label === oldName) { ann.label = newName; updateCount++; }
                    });
                }
            });
            console.log(`Updated ${updateCount} annotations from "${oldName}" to "${newName}"`);
        } else if (field === 'color') {
            labels[index].color = value;
        }

        try {
            await this.bus.imageManager.apiClient.saveLabels(labels);
            this.bus.emit('redraw');
            this.updateLabelList();
        } catch (e) {
            console.error(e);
            this.showStatusMessage("保存标签失败", "error");
        }
    }

    async handleLabelDeleteFromModal(index, labelName) {
        if (!confirm(`确定删除标签 "${labelName}" 吗？\n注意：这不会删除已有的标注框，但它们可能会变成未知标签。`)) return;

        this.labelManager.getLabels().splice(index, 1);
        try {
            await this.bus.imageManager.apiClient.saveLabels(this.labelManager.getLabels());
            this.renderLabelEditorList();
            this.updateLabelList();
        } catch (e) {
            this.showStatusMessage("删除失败", "error");
        }
    }


    // --- 自动标注 UI 初始化 (修复滚动) ---
    initAutoAnnotationUI() {
        if (!this.dom.batchManagementModal) return;

        const modalContent = this.dom.batchManagementModal.querySelector('.modal-content');
        if (!modalContent) return;

        this.dom.batchManagementModal.style.width = '1000px';
        this.dom.batchManagementModal.style.maxWidth = '95vw';
        this.dom.batchManagementModal.style.borderRadius = '8px';
        this.dom.batchManagementModal.style.overflow = 'hidden';
        this.dom.batchManagementModal.style.boxShadow = '0 10px 30px rgba(0,0,0,0.2)';
        this.dom.batchManagementModal.style.zIndex = '2500';

        const header = this.dom.batchManagementModal.querySelector('.modal-header');
        header.style.background = '#fff';
        header.style.borderBottom = '1px solid #eee';
        header.querySelector('h3').textContent = "数据管理与自动标注中心";

        modalContent.innerHTML = '';
        modalContent.className = 'modal-content-grid';
        modalContent.style.padding = '0';
        modalContent.style.height = '650px';

        // --- 左侧：图片列表面板 ---
        const leftPanel = document.createElement('div');
        leftPanel.className = 'image-list-panel';

        const selectAllDiv = document.createElement('div');
        selectAllDiv.style.padding = '15px';
        selectAllDiv.style.borderBottom = '1px solid #eee';
        selectAllDiv.style.background = '#fff';
        selectAllDiv.innerHTML = `
            <label style="cursor:pointer; display:flex; align-items:center; font-weight:600; color:#333;">
                <input type="checkbox" id="selectAllImagesUI" style="transform:scale(1.2); margin-right:10px;"> 
                全选所有图片
            </label>`;
        leftPanel.appendChild(selectAllDiv);

        // 列表容器 (修复滚动)
        this.dom.imageListContainer = document.createElement('div');
        this.dom.imageListContainer.id = 'imageListContainerUI';
        this.dom.imageListContainer.style.flex = '1';
        this.dom.imageListContainer.style.overflowY = 'auto'; // 允许Y轴滚动
        this.dom.imageListContainer.style.minHeight = '0'; // Flexbox 滚动修复关键
        leftPanel.appendChild(this.dom.imageListContainer);

        const leftFooter = document.createElement('div');
        leftFooter.style.padding = '15px';
        leftFooter.style.borderTop = '1px solid #eee';
        leftFooter.style.background = '#fff';
        leftFooter.innerHTML = `<button id="deleteSelectedImagesBtn" class="btn" style="width:100%; background-color:#fff1f0; color:#ff4d4f; border:1px solid #ffa39e;">删除选中图片</button>`;
        leftPanel.appendChild(leftFooter);

        // --- 右侧：配置面板 ---
        const rightPanel = document.createElement('div');
        rightPanel.className = 'config-panel';

        rightPanel.innerHTML = `
            <div style="margin-bottom: 25px;">
                <h4 style="margin:0 0 10px 0; font-size:18px; color:#333; border-left:4px solid #007bff; padding-left:10px;">✨ AI 自动标注配置</h4>
                <div style="font-size: 13px; color: #666; line-height: 1.6; background:#f8f9fa; padding:12px; border-radius:6px;">
                    配置提示词后，模型将自动扫描选中图片并生成标注。
                    <br>💡 <strong>提示:</strong> 您可以删除不需要推理的标签行。
                </div>
            </div>
            
            <div style="margin-bottom:20px;">
                <label style="font-weight:600; display:block; margin-bottom:10px; color:#555;">提示词映射 (Prompt Config)</label>
                <div id="promptConfigList" style="margin-bottom: 10px;"></div>
                <div style="text-align:center; color:#999; font-size:12px; margin-top:5px;">提示词越多，推理时间越长</div>
            </div>
            
            <div style="margin-bottom:30px; background:#fff; border:1px solid #eee; padding:15px; border-radius:8px;">
                <label style="font-weight:600; display:flex; justify-content:space-between; margin-bottom:10px;">
                    <span>置信度阈值 (Confidence)</span>
                    <span id="confValueDisplay" style="color:#007bff; font-weight:bold;">0.40</span>
                </label>
                <input type="range" id="confSlider" min="0.1" max="0.9" step="0.05" value="0.4" style="width: 100%; cursor:pointer;">
                <div style="display:flex; justify-content:space-between; font-size:12px; color:#888; margin-top:5px;">
                    <span>Loose (0.1)</span>
                    <span>Strict (0.9)</span>
                </div>
            </div>

            <button id="startAutoAnnotateBtn" class="btn btn-primary" style="width: 100%; padding: 14px; font-size:16px; font-weight:bold; box-shadow: 0 4px 12px rgba(0,123,255,0.3); border-radius:6px; background: linear-gradient(to right, #007bff, #0056b3); border:none;">
                🚀 开始自动标注
            </button>
            
            <div id="autoAnnotateProgress" style="display: none; margin-top: 25px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:13px;">
                    <strong id="autoAnnotateStatus" style="color:#333;">准备中...</strong>
                    <span id="autoAnnotateCount" style="font-weight:bold; color:#007bff;">0/0</span>
                </div>
                <div style="height: 8px; background:#e9ecef; border-radius:4px; overflow:hidden;">
                    <div id="autoAnnotateProgressBar" style="height:100%; width:0%; background:#28a745; transition: width 0.3s ease;"></div>
                </div>
            </div>
        `;

        modalContent.appendChild(leftPanel);
        modalContent.appendChild(rightPanel);

        this.dom.selectAllImagesCheckbox = document.getElementById('selectAllImagesUI');
        this.dom.deleteSelectedImagesBtn = leftFooter.querySelector('#deleteSelectedImagesBtn');
        this.dom.promptConfigList = document.getElementById('promptConfigList');
        this.dom.confSlider = document.getElementById('confSlider');
        this.dom.startAutoAnnotateBtn = document.getElementById('startAutoAnnotateBtn');
        this.dom.modalCloseBtn = this.dom.batchManagementModal.querySelector('.modal-close-btn');

        this.dom.confSlider.oninput = (e) => document.getElementById('confValueDisplay').textContent = parseFloat(e.target.value).toFixed(2);
        this.dom.startAutoAnnotateBtn.onclick = () => this.startAutoAnnotation();
        if (this.dom.deleteSelectedImagesBtn) {
            this.dom.deleteSelectedImagesBtn.addEventListener('click', this.handleDeleteSelectedImages.bind(this));
        }
    }

    // --- 辅助：添加提示词配置行 (支持删除) ---
    addPromptConfigRow(textValue, labelObj) {
        const row = document.createElement('div');
        row.className = 'prompt-row';
        row.style.cssText = `display: flex; gap: 12px; margin-bottom: 12px; align-items: center; background: #fff; padding: 8px; border: 1px solid #eee; border-radius: 6px;`;

        row.innerHTML = `
            <div style="background-color: ${labelObj.color}; padding: 6px 12px; border-radius: 4px; color: #fff; font-size: 12px; font-weight: 500; min-width: 80px; text-align: center; text-shadow: 0 1px 1px rgba(0,0,0,0.2);">
                ${labelObj.name}
            </div>
            <input type="text" value="${textValue}" class="prompt-input" placeholder="输入英文提示词 (e.g. car)" style="flex: 1; padding: 10px; border: 1px solid #e1e1e1; border-radius: 4px; font-size: 14px;">
            <input type="hidden" class="prompt-label-name" value="${labelObj.name}">
            <button class="btn-icon delete" title="不对此标签进行推理" style="margin-left:5px;">✖</button>
        `;

        // 绑定删除行事件
        const delBtn = row.querySelector('.delete');
        delBtn.onclick = () => {
            row.remove();
        };

        this.dom.promptConfigList.appendChild(row);
    }

    setupListeners() {
        if (this.dom.imageUploadInput) {
            this.dom.imageUploadInput.setAttribute('accept', 'image/*,.txt,.json');
            this.dom.imageUploadInput.addEventListener('change', this.handleDatasetUpload.bind(this));
        }

        if (this.dom.addLabelBtn) this.dom.addLabelBtn.addEventListener('click', this.handleAddLabel.bind(this));
        if (this.dom.prevImageBtn) this.dom.prevImageBtn.addEventListener('click', () => this.bus.emit('navigate', -1));
        if (this.dom.nextImageBtn) this.dom.nextImageBtn.addEventListener('click', () => this.bus.emit('navigate', 1));
        if (this.dom.deleteCurrentImageBtn) this.dom.deleteCurrentImageBtn.addEventListener('click', this.handleDeleteCurrentImage.bind(this));
        if (this.dom.finishAndTrainBtn) this.dom.finishAndTrainBtn.addEventListener('click', () => this.bus.emit('finishAndTrain'));

        if (this.dom.batchManageBtn) this.dom.batchManageBtn.addEventListener('click', this.showBatchManagementModal.bind(this));
        if (this.dom.modalCloseBtn) this.dom.modalCloseBtn.addEventListener('click', this.hideBatchManagementModal.bind(this));

        if (this.dom.modalOverlay) this.dom.modalOverlay.addEventListener('click', () => {
            this.hideBatchManagementModal();
            this.hideLabelManagementModal();
        });

        if (this.dom.selectAllImagesCheckbox) {
            this.dom.selectAllImagesCheckbox.addEventListener('change', (e) => {
                const checkboxes = this.dom.imageListContainer.querySelectorAll('input[type="checkbox"]');
                checkboxes.forEach(cb => cb.checked = e.target.checked);
            });
        }
    }

    // --- 标签管理：增删改立即同步后端 ---

    async handleAddLabel() {
        const name = this.dom.newLabelInput.value.trim();
        if (!name) { this.showStatusMessage("标签名不能为空！", "error"); return; }

        // 检查重复
        const exists = this.labelManager.getLabels().some(l => l.name === name);
        if (exists) { this.showStatusMessage("标签已存在！", "error"); return; }

        try {
            this.labelManager.addLabel(name, generateDistinctColor(this.labelManager.getLabels().map(l => l.color)));
            this.dom.newLabelInput.value = '';
            // 立即同步
            await this.bus.imageManager.apiClient.saveLabels(this.labelManager.getLabels());
        } catch (e) { this.showStatusMessage(e.message, "error"); }
    }

    async handleLabelColorChange(labelName, newColor) {
        this.labelManager.updateLabelColor(labelName, newColor);
        await this.bus.imageManager.apiClient.saveLabels(this.labelManager.getLabels());
        this.bus.emit('redraw'); // 确保画布颜色更新
    }

    async deleteLabelHandler(labelName) {
        if (confirm(`删除标签 "${labelName}"?`)) {
            this.labelManager.deleteLabel(labelName);
            await this.bus.imageManager.apiClient.saveLabels(this.labelManager.getLabels());
        }
    }

    selectLabelHandler(label) { this.labelManager.selectLabel(label); }

    updateLabelList() {
        const labels = this.labelManager.getLabels();
        const currentLabel = this.labelManager.getCurrentLabel();
        if (!this.dom.labelsListDiv) return;
        this.dom.labelsListDiv.innerHTML = '';
        labels.forEach(label => {
            const item = document.createElement('div');
            item.className = 'label-item';
            if (currentLabel && currentLabel.name === label.name) item.classList.add('selected');

            const colorEditor = document.createElement('div');
            colorEditor.className = 'color-editor';
            const colorInput = document.createElement('input');
            colorInput.type = 'color';
            colorInput.value = label.color;
            colorInput.onclick = (e) => e.stopPropagation();
            colorInput.onchange = (e) => this.handleLabelColorChange(label.name, e.target.value);
            colorEditor.appendChild(colorInput);

            const nameSpan = document.createElement('span');
            nameSpan.className = 'label-name-text';
            nameSpan.textContent = label.name;

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-label-btn';
            deleteBtn.innerHTML = '×';
            deleteBtn.onclick = (e) => { e.stopPropagation(); this.deleteLabelHandler(label.name); };

            item.appendChild(colorEditor);
            item.appendChild(nameSpan);
            item.appendChild(deleteBtn);
            item.onclick = () => this.selectLabelHandler(label);
            this.dom.labelsListDiv.appendChild(item);
        });
    }

    // --- 通用UI更新 ---
    showLoading(show, text='加载中...') { if (this.dom.loadingOverlay) { this.dom.loadingText.textContent = text; this.dom.loadingOverlay.style.display = show ? 'flex' : 'none'; } }
    showStatusMessage(msg, type='info', dur=3000) { if (!this.dom.statusMessageDiv) return; this.dom.statusMessageDiv.textContent = msg; this.dom.statusMessageDiv.className = 'status-message ' + (type === 'error' ? 'error' : type === 'success' ? 'success' : 'info'); this.dom.statusMessageDiv.style.display = 'block'; setTimeout(() => { this.dom.statusMessageDiv.style.display = 'none'; }, dur); }
    updateImageNav() { const { currentImageIndex, totalImages } = this.imageManager.getNavInfo(); if (this.dom.imageInfoSpan) this.dom.imageInfoSpan.textContent = totalImages > 0 ? `${currentImageIndex + 1} / ${totalImages}` : '0 / 0'; if (this.dom.prevImageBtn) this.dom.prevImageBtn.disabled = currentImageIndex <= 0; if (this.dom.nextImageBtn) this.dom.nextImageBtn.disabled = currentImageIndex >= totalImages - 1; }
    updateCurrentModeDisplay(mode) { if(this.dom.currentModeDisplay) this.dom.currentModeDisplay.textContent = (mode === 'annotate' ? '标注' : (mode === 'selectEdit' ? '编辑' : 'AI辅助')); }
    hideContextMenu() { if (this.dom.contextMenuDiv) this.dom.contextMenuDiv.style.display = 'none'; }

    showCustomContextMenu(data) {
        const { annotation, index, event } = data;
        const labels = this.labelManager.getLabels();
        if (!this.dom.contextMenuDiv) return;
        this.dom.contextMenuDiv.innerHTML = '';

        const itemLabel = document.createElement('div');
        itemLabel.className = 'context-menu-item';
        const labelSelect = document.createElement('select');
        labels.forEach(lbl => {
            const option = document.createElement('option');
            option.value = lbl.name;
            option.textContent = lbl.name;
            if (lbl.name === annotation.label) option.selected = true;
            labelSelect.appendChild(option);
        });
        labelSelect.onchange = (e) => { this.bus.emit('updateAnnotationLabel', { index, newLabelName: e.target.value }); this.hideContextMenu(); };
        itemLabel.appendChild(labelSelect);
        this.dom.contextMenuDiv.appendChild(itemLabel);

        const deleteItem = document.createElement('div');
        deleteItem.className = 'context-menu-item delete';
        deleteItem.textContent = '删除';
        deleteItem.onclick = () => { this.bus.emit('deleteAnnotation', index); this.hideContextMenu(); };
        this.dom.contextMenuDiv.appendChild(deleteItem);

        const rect = document.querySelector('.main-content').getBoundingClientRect();
        this.dom.contextMenuDiv.style.left = (event.clientX - rect.left) + 'px';
        this.dom.contextMenuDiv.style.top = (event.clientY - rect.top) + 'px';
        this.dom.contextMenuDiv.style.display = 'block';
    }

    handleDeleteCurrentImage() { const t = this.imageManager.getNavInfo().totalImages; if(t===0)return; const n = this.imageManager.getCurrentImage().name; if(confirm(`删除 "${n}"?`)) this.bus.emit('deleteImage', [n]); }

    // --- 上传逻辑 ---
    async handleDatasetUpload(e) {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        this.dom.uploadProgressContainer.style.display = 'block';
        this.dom.uploadStatusText.textContent = "正在上传并处理...";
        this.dom.uploadProgressBar.removeAttribute('value');

        const formData = new FormData();
        files.forEach(file => formData.append('files', file));

        try {
            const result = await this.bus.imageManager.apiClient.uploadDataset(formData);

            this.showStatusMessage(result.message, "success");
            this.dom.uploadProgressBar.value = 100;
            this.dom.uploadStatusText.textContent = "完成";
            e.target.value = '';

            await this.imageManager.reloadTaskData();

        } catch (err) {
            console.error(err);
            this.showStatusMessage("上传失败: " + err.message, "error");
            this.dom.uploadStatusText.textContent = "失败";
        } finally {
            setTimeout(() => { this.dom.uploadProgressContainer.style.display = 'none'; }, 2000);
        }
    }

    // --- 批量管理 / 自动标注 逻辑 ---

    showBatchManagementModal() {
        if (!this.dom.batchManagementModal) return;

        this.populateImageListForModal();

        this.dom.promptConfigList.innerHTML = '';
        const labels = this.labelManager.getLabels();
        labels.forEach(label => {
            this.addPromptConfigRow(label.name, label);
        });

        this.dom.modalOverlay.style.display = 'block';
        this.dom.modalOverlay.style.zIndex = '2000';
        this.dom.batchManagementModal.style.display = 'block';
    }

    hideBatchManagementModal() {
        if (!this.dom.batchManagementModal) return;
        this.dom.modalOverlay.style.display = 'none';
        this.dom.batchManagementModal.style.display = 'none';
    }

    populateImageListForModal() {
        const images = this.imageManager.getAllImages();
        if (!this.dom.imageListContainer) return;
        this.dom.imageListContainer.innerHTML = '';

        images.forEach((img, index) => {
            const div = document.createElement('div');
            div.className = 'modern-list-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = img.name;
            checkbox.id = `img-select-${index}`;

            const label = document.createElement('label');
            label.htmlFor = `img-select-${index}`;
            label.style.flex = '1';
            label.style.cursor = 'pointer';
            label.style.display = 'flex';
            label.style.alignItems = 'center';
            label.innerHTML = `
                <span style="font-weight:500;">${index + 1}. ${img.name}</span>
            `;

            const count = img.annotations ? img.annotations.length : 0;
            const badge = document.createElement('span');
            badge.className = `badge-count ${count > 0 ? 'has-data' : ''}`;
            badge.textContent = count > 0 ? `${count} 标注` : '无标注';

            label.appendChild(badge);
            div.appendChild(checkbox);
            div.appendChild(label);

            div.addEventListener('dblclick', async () => {
                await this.imageManager.saveCurrentImageAnnotations();
                this.imageManager.currentImageIndex = index;
                await this.imageManager.loadCurrentImage(true);
                this.hideBatchManagementModal();
                this.showStatusMessage(`已跳转到: ${img.name}`, "success");
            });
            this.dom.imageListContainer.appendChild(div);
        });
    }

    handleDeleteSelectedImages() {
        const c = this.dom.imageListContainer.querySelectorAll('input[type="checkbox"]:checked');
        const n = Array.from(c).map(cb => cb.value);
        if (n.length === 0) return;
        if (confirm(`确定删除这 ${n.length} 张图片吗？`)) {
            this.hideBatchManagementModal();
            this.bus.emit('deleteImage', n);
        }
    }

    async startAutoAnnotation() {
        const checkboxes = this.dom.imageListContainer.querySelectorAll('input[type="checkbox"]:checked');
        const selectedImageNames = Array.from(checkboxes).map(cb => cb.value);
        if (selectedImageNames.length === 0) return alert("请在左侧至少选择一张图片！");

        const config = [];
        const rows = this.dom.promptConfigList.querySelectorAll('.prompt-row');
        rows.forEach(row => {
            const text = row.querySelector('.prompt-input').value.trim();
            const labelName = row.querySelector('.prompt-label-name').value;
            if (text && labelName) {
                const labelObj = this.labelManager.getLabels().find(l => l.name === labelName);
                config.push({ text, label: labelName, color: labelObj ? labelObj.color : '#ff0000' });
            }
        });

        if (config.length === 0) return alert("请配置有效的提示词！");

        const confidence = parseFloat(this.dom.confSlider.value);
        const progressDiv = document.getElementById('autoAnnotateProgress');
        const progressBar = document.getElementById('autoAnnotateProgressBar');
        const statusLabel = document.getElementById('autoAnnotateStatus');
        const countLabel = document.getElementById('autoAnnotateCount');
        const startBtn = this.dom.startAutoAnnotateBtn;

        progressDiv.style.display = 'block';
        startBtn.disabled = true;
        startBtn.textContent = "AI 正在思考中...";
        progressBar.style.width = '0%';

        let totalAdded = 0;
        const isRectMode = window.location.href.includes('/rect');

        for (let i = 0; i < selectedImageNames.length; i++) {
            const imgName = selectedImageNames[i];
            statusLabel.textContent = `正在分析: ${imgName}`;
            countLabel.textContent = `${i + 1}/${selectedImageNames.length}`;

            // 标记该图片是否原本就是未加载的，以便后续释放内存
            const targetImg = this.imageManager.findImageByName(imgName);
            const wasNotLoaded = targetImg && !targetImg.hasLoadedData;

            try {
                // 1. 调用后端推理 (GPU工作)
                const result = await this.bus.imageManager.apiClient.runAutoAnnotation(imgName, config, confidence);

                if (result.success && result.annotations.length > 0) {

                    // 2. 【关键修复】如果图片未加载，主动加载它以获取 w/h 用于保存
                    // 这里现在调用的是我们在 ImageManager 中新补上的方法
                    if (!targetImg.hasLoadedData) {
                        await this.imageManager.fetchImageAndAnnotations(targetImg);
                    }

                    const finalAnns = [];
                    result.annotations.forEach(ann => {
                        if (isRectMode && ann.type === 'polygon') {
                            // ... (保留原有的矩形转换逻辑) ...
                            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                            ann.points.forEach(p => {
                                if (p[0] < minX) minX = p[0];
                                if (p[0] > maxX) maxX = p[0];
                                if (p[1] < minY) minY = p[1];
                                if (p[1] > maxY) maxY = p[1];
                            });
                            if (minX < maxX && minY < maxY) {
                                finalAnns.push({
                                    type: 'rect',
                                    label: ann.label,
                                    color: ann.color,
                                    points: { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
                                });
                            }
                        } else {
                            finalAnns.push(ann);
                        }
                    });

                    finalAnns.forEach(ann => targetImg.annotations.push(ann));
                    totalAdded += finalAnns.length;

                    // 3. 保存结果
                    await this.imageManager.apiClient.saveAnnotation(
                        targetImg.name,
                        targetImg.originalWidth, // 确保这里不是 0
                        targetImg.originalHeight,
                        targetImg.annotations,
                        this.labelManager.getLabels()
                    );

                    // 如果当前正好显示这张图，刷新画布
                    const currentImg = this.imageManager.getCurrentImage();
                    if (currentImg && currentImg.name === imgName) this.bus.emit('redraw');
                }
            } catch (err) {
                console.error(`Error processing ${imgName}:`, err);
            } finally {
                // 4. 【内存优化】如果这张图原本不在缓存里，处理完就释放掉
                // 这样即使处理1000张图，浏览器内存也不会爆
                if (wasNotLoaded) {
                    this.imageManager.unloadSpecificImage(imgName);
                }
            }

            const percent = ((i + 1) / selectedImageNames.length) * 100;
            progressBar.style.width = `${percent}%`;
        }

        statusLabel.textContent = `✅ 处理完成！共新增 ${totalAdded} 个标注。`;
        startBtn.disabled = false;
        startBtn.textContent = "开始自动标注";

        this.populateImageListForModal();
    }
}