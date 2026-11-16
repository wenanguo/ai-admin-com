/* ============================================================
 * 公共组件注入 —— 侧边栏 / 顶栏 / AI 浮窗
 * 任何页面只需放 <div id="app"></div> + <div id="ai-fab"></div>
 * ============================================================ */
(function () {
  // 当前用户名下默认菜单高亮
  function activeMenu() {
    const path = location.pathname.split('/').pop() || 'index.html';
    return path;
  }

  function navItem(href, icon, label, badge, badgeColor) {
    const isExternal = href.startsWith('http');
    const target = isExternal ? ' target="_blank"' : '';
    const badgeHtml = badge ? `<span class="ml-auto text-xs px-1.5 rounded" style="background:${badgeColor || '#F56C6C'};color:#fff">${badge}</span>` : '';
    return `<a href="${href}"${target} class="nav-item flex items-center gap-2 px-3 py-2 rounded text-sm text-gray-700 hover:bg-gray-100">
      <i data-lucide="${icon}" class="w-4 h-4"></i>
      <span>${label}</span>
      ${badgeHtml}
    </a>`;
  }

  function renderSidebar() {
    return `
    <aside class="w-60 bg-white border-r border-gray-200 flex flex-col shrink-0 min-h-0">
      <div class="h-14 flex items-center gap-2 px-4 border-b border-gray-200">
        <div class="w-8 h-8 rounded bg-blue-500 flex items-center justify-center text-white font-bold text-sm">A</div>
        <div>
          <div class="text-sm font-medium text-gray-800">aicomm</div>
          <div class="text-xs text-gray-400">AI 增强项目管理</div>
        </div>
      </div>
      <nav class="flex-1 overflow-y-auto min-h-0 py-3 px-2 space-y-0.5 text-sm">
        <div class="px-3 py-1 text-xs text-gray-400 uppercase tracking-wider">工作台</div>
        ${navItem('dashboard.html', 'layout-dashboard', '仪表盘')}
        ${navItem('projects.html', 'folder-kanban', '项目管理')}

        <div class="px-3 py-1 mt-3 text-xs text-gray-400 uppercase tracking-wider">执行</div>
        ${navItem('milestones.html', 'flag', '里程碑')}
        ${navItem('task-board.html', 'kanban-square', '任务看板')}
        ${navItem('task-list.html', 'list-checks', '任务列表')}

        <div class="px-3 py-1 mt-3 text-xs text-gray-400 uppercase tracking-wider">洞察</div>
        ${navItem('risks.html', 'alert-triangle', '风险登记册', '3', '#F56C6C')}
        ${navItem('comments.html', 'message-square', '评论中心')}

        <div class="px-3 py-1 mt-3 text-xs text-gray-400 uppercase tracking-wider">AI 能力</div>
        ${navItem('ai-assistant.html', 'sparkles', 'AI 项目助理', 'NEW', '#7C3AED')}
        ${navItem('meeting-summary.html', 'file-audio', '会议纪要总结')}

        <div class="px-3 py-1 mt-3 text-xs text-gray-400 uppercase tracking-wider">管理</div>
        ${navItem('settings.html', 'settings', '模板与字段')}
      </nav>
      <div class="p-3 border-t border-gray-200 text-xs text-gray-400">
        <div>当前角色：<span class="text-blue-600 font-medium">PMO</span></div>
        <div class="mt-1">用户：张伟 · zhangwei@aicomm.cn</div>
      </div>
    </aside>`;
  }

  function renderTopbar() {
    const page = activeMenu();
    const pageTitleMap = {
      'index.html': '登录',
      'dashboard.html': '工作台 · 仪表盘',
      'projects.html': '项目管理',
      'project-detail.html': '项目详情',
      'milestones.html': '里程碑管理',
      'task-board.html': '任务看板',
      'task-list.html': '任务列表',
      'risks.html': '风险登记册',
      'comments.html': '评论中心',
      'ai-assistant.html': 'AI 项目助理',
      'meeting-summary.html': '会议纪要总结',
      'settings.html': '模板与字段配置'
    };
    const title = pageTitleMap[page] || 'aicomm';
    const from = new URLSearchParams(location.search).get('from');
    const crumbFrom = from ? `<a href="${from}.html" class="text-blue-500 hover:underline">${pageTitleMap[from + '.html'] || from}</a> <i data-lucide="chevron-right" class="inline w-3 h-3 mx-1 text-gray-400"></i>` : '';

    return `
    <header class="h-14 bg-white border-b border-gray-200 flex items-center px-6 shrink-0">
      <nav class="text-sm text-gray-500 flex items-center">
        <a href="dashboard.html" class="hover:text-blue-500">工作台</a>
        ${from ? `<i data-lucide="chevron-right" class="inline w-3 h-3 mx-1 text-gray-400"></i> ${crumbFrom}` : ''}
        <i data-lucide="chevron-right" class="inline w-3 h-3 mx-1 text-gray-400"></i>
        <span class="text-gray-700 font-medium">${title}</span>
      </nav>
      <div class="ml-auto flex items-center gap-3">
        <div class="relative">
          <input type="text" placeholder="搜索项目 / 任务 / 风险..." class="w-64 h-8 pl-8 pr-3 text-sm border border-gray-200 rounded focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100">
          <i data-lucide="search" class="w-4 h-4 text-gray-400 absolute left-2.5 top-2"></i>
        </div>
        <button class="relative w-8 h-8 rounded hover:bg-gray-100 flex items-center justify-center" title="通知">
          <i data-lucide="bell" class="w-4 h-4 text-gray-600"></i>
          <span class="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500"></span>
        </button>
        <button class="w-8 h-8 rounded hover:bg-gray-100 flex items-center justify-center" title="帮助">
          <i data-lucide="help-circle" class="w-4 h-4 text-gray-600"></i>
        </button>
        <div class="flex items-center gap-2 pl-3 border-l border-gray-200">
          <div class="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-medium">张</div>
          <div class="text-sm">
            <div class="font-medium text-gray-800">张伟</div>
            <div class="text-xs text-gray-400">PMO</div>
          </div>
        </div>
      </div>
    </header>`;
  }

  /* ============================================================
   * AI 工作台（常驻右侧）—— 对话 / 待确认 / 审计
   * 取代原来的右下角浮窗：待确认队列需要一个常驻可见的位置
   * ============================================================ */
  function wbState() {
    try { return JSON.parse(localStorage.getItem('aipm.wb') || '{}'); }
    catch (e) { return {}; }
  }
  function wbSet(k, v) {
    const s = wbState(); s[k] = v;
    try { localStorage.setItem('aipm.wb', JSON.stringify(s)); } catch (e) {}
  }

  function renderAIWorkbench() {
    const st = wbState();
    const collapsed = st.collapsed === true;
    const tab = st.tab || 'chat';
    const pend = (window.MOCK && MOCK.pendingActions) ? MOCK.pendingActions.filter(p => p.status === 'pending') : [];
    const aud = (window.MOCK && MOCK.auditLogs) ? MOCK.auditLogs : [];
    return `
    <aside id="ai-workbench" class="${collapsed ? 'hidden' : 'w-[400px]'} shrink-0 border-l border-gray-200 bg-white flex flex-col min-h-0">
      <div class="bg-gradient-to-r from-purple-500 to-blue-500 text-white px-4 py-3 flex items-center gap-2 shrink-0">
        <i data-lucide="bot" class="w-5 h-5"></i>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium">AI 工作台</div>
          <div class="text-xs opacity-80 truncate">对话 · 待确认 · 审计 &nbsp;|&nbsp; 命令层受控写入</div>
        </div>
        <button id="wb-collapse" class="hover:bg-white/20 rounded p-1" title="隐藏工作台 (⌘B)"><i data-lucide="chevrons-right" class="w-4 h-4"></i></button>
      </div>

      <div class="flex border-b border-gray-200 shrink-0">
        <button class="wb-tab flex-1 py-2 text-xs font-medium border-b-2 ${tab==='chat'?'border-purple-500 text-purple-600':'border-transparent text-gray-500'}" data-wb="chat">对话</button>
        <button class="wb-tab flex-1 py-2 text-xs font-medium border-b-2 ${tab==='pending'?'border-purple-500 text-purple-600':'border-transparent text-gray-500'}" data-wb="pending">待确认 <span class="ml-1 px-1.5 rounded text-[10px] bg-red-500 text-white">${pend.length}</span></button>
        <button class="wb-tab flex-1 py-2 text-xs font-medium border-b-2 ${tab==='audit'?'border-purple-500 text-purple-600':'border-transparent text-gray-500'}" data-wb="audit">审计 <span class="ml-1 px-1.5 rounded text-[10px] bg-gray-200 text-gray-600">${aud.length}</span></button>
      </div>

      <div id="wb-body" class="flex-1 overflow-y-auto min-h-0 bg-gray-50 p-3"></div>

      <div class="border-t border-gray-200 bg-white p-3 shrink-0">
        <div class="flex gap-2">
          <input id="wb-input" type="text" placeholder="对项目下指令…（Enter 发送）" class="flex-1 h-9 px-3 text-sm border border-gray-200 rounded focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100">
          <button id="wb-send" class="h-9 px-3 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 flex items-center gap-1">
            <i data-lucide="send" class="w-3.5 h-3.5"></i>发送
          </button>
        </div>
        <div class="mt-2 text-[11px] text-gray-400 flex items-center gap-1"><i data-lucide="shield-check" class="w-3 h-3"></i> 由 MiniMax 驱动 · 批量与破坏性操作需人工确认 · 每次写入可撤销</div>
      </div>
    </aside>
    <button id="wb-handle" class="${collapsed ? '' : 'hidden'} fixed right-0 top-32 z-50 w-7 h-20 rounded-l-lg bg-gradient-to-b from-purple-500 to-blue-500 text-white flex flex-col items-center justify-center gap-1 shadow-lg hover:w-8 transition-all" title="展开 AI 工作台 (⌘B)">
      <i data-lucide="sparkles" class="w-4 h-4"></i><span class="text-[10px] writing-mode-vertical">AI 工作台</span>
    </button>`;
  }

  /* ---------- 对话 ---------- */
  function cmdCard(o) {
    return `<div class="border border-gray-200 rounded-lg overflow-hidden bg-white text-xs">
      <div class="px-2.5 py-1.5 bg-gray-50 border-b border-gray-100 flex items-center gap-1.5 font-medium">
        <i data-lucide="terminal" class="w-3 h-3 text-purple-500"></i>
        <code class="text-purple-600">${o.fn}</code>
        <span class="ml-auto el-tag ${o.tagCls}">${o.tag}</span>
      </div>
      <div class="px-2.5 py-2 text-gray-600 leading-relaxed">${o.body}</div>
      ${o.foot ? `<div class="px-2.5 py-1.5 border-t border-gray-100 bg-white flex gap-1.5">${o.foot}</div>` : ''}
    </div>`;
  }

  function wbChatHtml() {
    const chips = ['@AI 建一个 SSO 登录任务', '本周所有 P0 顺延到下周一', '「预付款模块」还能按期完成吗？', '识别「财务对账系统」的潜在风险', '总结本周项目亮点与风险'];
    return `<div class="space-y-3">
      <div class="flex gap-2">
        <div class="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 text-white flex items-center justify-center text-xs shrink-0"><i data-lucide="bot" class="w-3.5 h-3.5"></i></div>
        <div class="bg-white rounded-lg p-3 shadow-sm text-sm max-w-[300px]">
          <div>你好，张伟 👋 我是 AI 助理。可以直接用一句话操作项目，或问我进度与风险。</div>
          <div class="mt-2 flex flex-wrap gap-1">
            ${chips.map(c => `<button class="wb-chip px-2 py-1 text-[11px] bg-purple-50 text-purple-700 rounded hover:bg-purple-100" data-q="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
          </div>
        </div>
      </div>

      <div class="flex gap-2 justify-end"><div class="bg-blue-500 text-white rounded-lg p-3 max-w-[300px] text-sm">「预付款模块」现在什么情况？</div></div>
      <div class="flex gap-2">
        <div class="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 text-white flex items-center justify-center text-xs shrink-0"><i data-lucide="bot" class="w-3.5 h-3.5"></i></div>
        <div class="bg-white rounded-lg p-3 shadow-sm text-sm max-w-[300px] space-y-2">
          <div>完成度 42%，截止 07-25。<strong>按当前速度预计延期 6 天</strong>。</div>
          ${cmdCard({
            fn: 'get_milestone_status', tag: '只读', tagCls: 'info',
            body: 'milestone: <code class="bg-gray-100 px-1 rounded">预付款模块</code> → 完成度 42%，未完成 7 项，阻塞 2 项'
          })}
          <div>主要瓶颈是「合规审批材料补充」（已阻塞 5 天）。要我把它拆出来并推动吗？</div>
        </div>
      </div>

      <div class="flex gap-2 justify-end"><div class="bg-blue-500 text-white rounded-lg p-3 max-w-[300px] text-sm">拆开，然后把本周所有 P0 任务的截止日顺延到下周一，R2 那条风险的等级也升到高</div></div>
      <div class="flex gap-2">
        <div class="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 text-white flex items-center justify-center text-xs shrink-0"><i data-lucide="bot" class="w-3.5 h-3.5"></i></div>
        <div class="bg-white rounded-lg p-3 shadow-sm text-sm max-w-[300px] space-y-2">
          <div>好的。3 件事：第 1 件直接执行了，后 2 件是批量 / 破坏性操作，已放进<b>待确认</b>队列。</div>
          ${cmdCard({
            fn: 'split_task', tag: '已执行', tagCls: 'success',
            body: '「对账引擎 V2 性能压测」→ 拆为「压测环境搭建」「基准测试执行」，依赖关系已保留',
            foot: '<button class="wb-undo px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-50 rounded" data-audit="a1">↩ 撤销</button>'
          })}
          ${cmdCard({
            fn: 'batch_update_tasks', tag: '待确认', tagCls: 'warning',
            body: '命中 <strong>3</strong> 项 · 截止日 07-01~07-04 → 07-13<br><span class="text-orange-600">⚠ 顺延后仍无法解锁关键路径</span>',
            foot: '<button class="wb-to-pending px-2 py-1 text-[11px] bg-blue-500 text-white rounded" data-tab="pending">查看待确认 →</button>'
          })}
          ${cmdCard({
            fn: 'update_risk', tag: '待确认', tagCls: 'warning',
            body: '「合规审批周期不可控」等级 <code class="bg-gray-100 px-1 rounded">中</code> → <code class="bg-gray-100 px-1 rounded">高</code>（score 9 → 12）',
            foot: '<button class="wb-to-pending px-2 py-1 text-[11px] bg-blue-500 text-white rounded" data-tab="pending">查看待确认 →</button>'
          })}
        </div>
      </div>
    </div>`;
  }

  /* ---------- 待确认 ---------- */
  function wbPendingHtml() {
    const list = (window.MOCK && MOCK.pendingActions) ? MOCK.pendingActions.filter(p => p.status === 'pending') : [];
    if (!list.length) {
      return `<div class="text-center text-gray-400 text-xs py-10"><i data-lucide="check-circle" class="w-8 h-8 mx-auto mb-2 opacity-40"></i>没有待确认的操作<br><span class="text-[11px]">批量与破坏性操作会先在这里等你点头</span></div>`;
    }
    return `<div class="space-y-2.5">${list.map(p => `
      <div class="border border-gray-200 rounded-lg bg-white overflow-hidden">
        <div class="px-2.5 py-1.5 bg-gray-50 border-b border-gray-100 flex items-center gap-1.5">
          <i data-lucide="terminal" class="w-3 h-3 text-purple-500"></i>
          <code class="text-[11px] text-purple-600">${p.command}</code>
          <span class="ml-auto el-tag warning">待确认</span>
        </div>
        <div class="p-2.5 text-xs">
          <div class="font-medium text-gray-700 mb-1.5">${p.title}</div>
          <div class="text-[11px] text-gray-400 mb-1.5">来自：${p.reason}</div>
          <div class="border border-gray-100 rounded overflow-hidden">
            ${p.hits.map(h => `<div class="px-2 py-1.5 border-b border-gray-50 last:border-0 flex items-center gap-1.5">
              <i data-lucide="corner-down-right" class="w-3 h-3 text-gray-300"></i>
              <span class="flex-1 truncate">${h.title}</span>
              <span class="text-gray-400 line-through">${h.from}</span>
              <i data-lucide="arrow-right" class="w-3 h-3 text-gray-300"></i>
              <span class="font-medium">${h.to}</span>
            </div>`).join('')}
          </div>
          ${p.warning ? `<div class="mt-1.5 px-2 py-1.5 bg-orange-50 border border-orange-200 rounded text-[11px] text-orange-700"><i data-lucide="alert-triangle" class="w-3 h-3 inline"></i> ${p.warning}</div>` : ''}
        </div>
        <div class="px-2.5 py-2 border-t border-gray-100 flex gap-1.5 items-center">
          <button class="wb-confirm px-2.5 py-1 bg-blue-500 text-white rounded text-[11px] font-medium" data-act="${p.id}">确认执行</button>
          <button class="wb-reject px-2.5 py-1 border border-gray-300 rounded text-[11px]" data-act="${p.id}">取消</button>
          <button class="wb-adjust px-2.5 py-1 text-[11px] text-gray-500 hover:bg-gray-50 rounded ml-auto" data-act="${p.id}">调整范围</button>
          <span class="text-[10px] text-gray-400">${p.expires_at.slice(11)} 过期</span>
        </div>
      </div>`).join('')}
    </div>`;
  }

  /* ---------- 审计 ---------- */
  function wbAuditHtml() {
    const list = (window.MOCK && MOCK.auditLogs) ? MOCK.auditLogs : [];
    return `<div class="space-y-1">${list.map(a => `
      <div class="flex gap-2 px-2 py-2 rounded hover:bg-white">
        <span class="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${a.actor === 'AI' ? 'bg-purple-500' : 'bg-blue-500'}"></span>
        <div class="flex-1 min-w-0">
          <div class="text-xs text-gray-700 leading-relaxed">${a.summary}</div>
          <div class="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1.5">
            <code class="text-purple-500">${a.command}</code> · ${a.actor_name} · ${a.time}
          </div>
        </div>
        ${a.undoable ? `<button class="wb-undo text-[11px] text-gray-400 hover:text-red-500 shrink-0" data-audit="${a.id}">↩</button>` : '<span class="text-[10px] text-gray-300 shrink-0">只读</span>'}
      </div>`).join('')}
      <div class="text-[11px] text-gray-400 pt-2 px-2 border-t border-gray-200 mt-2">审计记录 append-only：撤销是新增一条指向原记录的日志，不修改原记录。</div>
    </div>`;
  }

  function wbRenderBody() {
    const st = wbState();
    const tab = st.tab || 'chat';
    const body = document.getElementById('wb-body');
    if (!body) return;
    body.innerHTML = tab === 'chat' ? wbChatHtml() : tab === 'pending' ? wbPendingHtml() : wbAuditHtml();
    body.scrollTop = tab === 'chat' ? body.scrollHeight : 0;
    bindWBBody();
    if (window.lucide) lucide.createIcons();
  }

  function wbRender() {
    const st = wbState();
    const tab = st.tab || 'chat';
    document.querySelectorAll('.wb-tab').forEach(b => {
      const on = b.dataset.wb === tab;
      b.classList.toggle('border-purple-500', on); b.classList.toggle('text-purple-600', on);
      b.classList.toggle('border-transparent', !on); b.classList.toggle('text-gray-500', !on);
    });
    wbRenderBody();
  }

  function bindWBBody() {
    document.querySelectorAll('.wb-chip').forEach(b => b.addEventListener('click', () => wbSend(b.dataset.q)));
    document.querySelectorAll('.wb-to-pending').forEach(b => b.addEventListener('click', () => { wbSet('tab', 'pending'); wbRender(); }));
    document.querySelectorAll('.wb-confirm').forEach(b => b.addEventListener('click', () => wbResolve(b.dataset.act, 'confirm')));
    document.querySelectorAll('.wb-reject').forEach(b => b.addEventListener('click', () => wbResolve(b.dataset.act, 'reject')));
    document.querySelectorAll('.wb-adjust').forEach(b => b.addEventListener('click', () => wbAdjust(b.dataset.act)));
    document.querySelectorAll('.wb-undo').forEach(b => b.addEventListener('click', () => wbUndo(b.dataset.audit)));
  }

  function wbResolve(id, decision) {
    const p = MOCK.pendingActions.find(x => x.id === id);
    if (!p) return;
    if (decision === 'confirm') {
      p.status = 'executed';
      MOCK.auditLogs.unshift({
        id: 'a' + (MOCK.auditLogs.length + 1), time: '刚刚', actor: 'AI', actor_name: 'AI 助理',
        command: p.command, summary: p.title + '（已确认执行）', undoable: true, undo_of: null
      });
      toastAIPM('已执行：' + p.title);
    } else {
      p.status = 'rejected';
      toastAIPM('已取消：' + p.title);
    }
    wbRender();
  }

  function wbAdjust(id) {
    const p = MOCK.pendingActions.find(x => x.id === id);
    if (!p) return;
    toastAIPM('已按新范围重新预览，请再次确认');
    p.warning = '范围已调整：仅保留负责人为「赵磊」的 1 项，其余排除';
    p.hits = p.hits.slice(0, 1);
  }

  function wbUndo(auditId) {
    const a = MOCK.auditLogs.find(x => x.id === auditId);
    if (!a) return;
    a.undoable = false;
    a.summary = a.summary + '（已撤销）';
    MOCK.auditLogs.unshift({
      id: 'a' + (MOCK.auditLogs.length + 1), time: '刚刚', actor: 'USER', actor_name: '张伟',
      command: 'undo', summary: '撤销：' + a.command, undoable: false, undo_of: auditId
    });
    toastAIPM('已撤销（已写入审计日志）');
    wbRender();
  }

  function toastAIPM(msg) {
    let t = document.getElementById('aipm-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'aipm-toast';
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:9px 16px;border-radius:8px;font-size:13px;z-index:999;opacity:0;transition:.2s';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    setTimeout(() => { t.style.opacity = '0'; }, 2200);
  }

  function wbSend(q) {
    const body = document.getElementById('wb-body');
    if (!body) return;
    const st = wbState();
    if ((st.tab || 'chat') !== 'chat') { wbSet('tab', 'chat'); wbRender(); }
    body.insertAdjacentHTML('beforeend',
      `<div class="flex gap-2 justify-end"><div class="bg-blue-500 text-white rounded-lg p-2.5 max-w-[300px] text-xs">${escapeHtml(q)}</div></div>`);
    body.insertAdjacentHTML('beforeend',
      `<div class="flex gap-2"><div class="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 text-white flex items-center justify-center text-xs shrink-0"><i data-lucide="bot" class="w-3.5 h-3.5"></i></div>
       <div class="bg-white rounded-lg p-3 shadow-sm text-sm max-w-[300px]"><span class="inline-block animate-pulse">●</span><span class="inline-block animate-pulse" style="animation-delay:.2s">●</span><span class="inline-block animate-pulse" style="animation-delay:.4s">●</span></div></div>`);
    body.scrollTop = body.scrollHeight;
    setTimeout(() => {
      const typing = body.querySelector('.animate-pulse');
      const last = body.lastElementChild;
      if (last) {
        last.insertAdjacentHTML('beforeend', mockAIReply(q));
      }
      body.scrollTop = body.scrollHeight;
      if (window.lucide) lucide.createIcons();
    }, 800);
  }

  function bindWB() {
    const st = wbState();
    document.querySelectorAll('.wb-tab').forEach(b => b.addEventListener('click', () => { wbSet('tab', b.dataset.wb); wbRender(); }));
    const send = document.getElementById('wb-send');
    const input = document.getElementById('wb-input');
    if (send) send.addEventListener('click', () => { const v = input.value.trim(); if (v) { input.value = ''; wbSend(v); } });
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') { const v = input.value.trim(); if (v) { input.value = ''; wbSend(v); } } });

    const collapse = document.getElementById('wb-collapse');
    const handle = document.getElementById('wb-handle');
    if (collapse) collapse.addEventListener('click', () => { wbSet('collapsed', true); wbApplyCollapse(true); });
    if (handle) handle.addEventListener('click', () => { wbSet('collapsed', false); wbApplyCollapse(false); });
  }

  function wbApplyCollapse(collapsed) {
    const wbEl = document.getElementById('ai-workbench');
    const handle = document.getElementById('wb-handle');
    if (!wbEl) return;
    if (collapsed) {
      wbEl.classList.add('hidden'); wbEl.classList.remove('w-[400px]');
      if (handle) handle.classList.remove('hidden');
    } else {
      wbEl.classList.remove('hidden'); wbEl.classList.add('w-[400px]');
      if (handle) handle.classList.add('hidden');
    }
  }

  // 全局入口：任意页面的「✦ 让 AI 处理 / AI 推进」按钮都走这里
  window.__aipmAsk = function (q) {
    wbSet('collapsed', false);
    wbApplyCollapse(false);
    wbSet('tab', 'chat');
    const tabs = document.querySelectorAll('.wb-tab');
    tabs.forEach(b => {
      const on = b.dataset.wb === 'chat';
      b.classList.toggle('border-purple-500', on); b.classList.toggle('text-purple-600', on);
      b.classList.toggle('border-transparent', !on); b.classList.toggle('text-gray-500', !on);
    });
    wbRenderBody();
    setTimeout(() => wbSend(q), 60);
  };
  window.__aipmAsk = window.__aipmAsk || function () {};

  // 调试 / 集成测试钩子
  window.__aipmWB = {
    state: wbState,
    setTab: (t) => { wbSet('tab', t); wbRender(); },
    render: () => wbRender(),
    resolve: (id, d) => wbResolve(id, d),
    undo: (id) => wbUndo(id),
    body: () => (document.getElementById('wb-body') || {}).innerHTML
  };

  // 采纳候选风险 → 生成一条待确认（不直接落库）
  window.__aipmAdoptRisk = function (sid) {
    const sg = (window.MOCK && MOCK.riskSuggestions) ? MOCK.riskSuggestions.find(x => x.id === sid) : null;
    if (!sg) return;
    if (!MOCK.pendingActions) MOCK.pendingActions = [];
    MOCK.pendingActions.push({
      id: 'act_' + (2000 + MOCK.pendingActions.length),
      command: 'register_risk',
      title: '登记风险：' + sg.title,
      args: { title: sg.title, probability: sg.level === '高' ? 4 : 3, impact: sg.level === '高' ? 4 : 3, category: sg.category },
      hits: [{ title: sg.title, from: '候选（未入库）', to: '概率高×影响高', owner: '张伟', milestone: '预付款模块' }],
      warning: '采纳后需在风险登记册创建该条目（score ' + (sg.level === '高' ? 16 : 9) + '）',
      status: 'pending',
      expires_at: '2026-07-01T10:30',
      created_by: 'AI',
      reason: '用户采纳了 AI 候选风险（' + sg.category + '）'
    });
    wbSet('collapsed', false);
    wbApplyCollapse(false);
    wbSet('tab', 'pending');
    const tabs = document.querySelectorAll('.wb-tab');
    tabs.forEach(b => {
      const on = b.dataset.wb === 'pending';
      b.classList.toggle('border-purple-500', on); b.classList.toggle('text-purple-600', on);
      b.classList.toggle('border-transparent', !on); b.classList.toggle('text-gray-500', !on);
    });
    wbRender();
    toastAIPM('已加入待确认队列，确认后才会登记');
  };

  function highlightActive() {
    const path = location.pathname.split('/').pop();
    document.querySelectorAll('.nav-item').forEach(a => {
      const href = a.getAttribute('href');
      if (href && path && href.indexOf(path) !== -1) {
        a.classList.add('bg-blue-50', 'text-blue-600', 'font-medium');
        a.classList.remove('text-gray-700', 'hover:bg-gray-100');
      }
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function mockAIReply(q) {
    const text = q.toLowerCase();
    if (text.includes('sso') && text.includes('建')) {
      return `<div class="text-sm">已为您创建 1 个任务和 3 个子任务：</div>
        <div class="mt-2 border border-gray-200 rounded overflow-hidden text-xs">
          <div class="px-2 py-1.5 bg-blue-50 flex items-center gap-1"><i data-lucide="plus-circle" class="w-3 h-3 text-blue-500"></i><strong>SSO 登录功能接入</strong> · P1 · 16h · @赵磊</div>
          <div class="px-2 py-1.5 border-t bg-white flex items-center gap-1"><i data-lucide="corner-down-right" class="w-3 h-3 text-gray-400"></i>SSO 客户端 SDK 集成 · 14h · @赵磊</div>
          <div class="px-2 py-1.5 border-t bg-white flex items-center gap-1"><i data-lucide="corner-down-right" class="w-3 h-3 text-gray-400"></i>单点登录 UI 适配 · 8h · @周欣</div>
          <div class="px-2 py-1.5 border-t bg-white flex items-center gap-1"><i data-lucide="corner-down-right" class="w-3 h-3 text-gray-400"></i>SSO 单元 + 集成测试 · 6h · @陈敏</div>
        </div>
        <div class="mt-2 flex gap-1.5 text-xs">
          <button class="px-2 py-1 bg-blue-500 text-white rounded">采纳并创建</button>
          <button class="px-2 py-1 border border-gray-300 rounded">编辑</button>
          <button class="px-2 py-1 text-gray-500 rounded">拒绝</button>
        </div>`;
    }
    if (text.includes('拆解') || text.includes('拆')) {
      return `<div class="text-sm">已为您拆出 6 个子任务，按「需求-设计-研发-联调-测试-上线」分布：</div>
        <div class="mt-2 border border-gray-200 rounded overflow-hidden text-xs">
          ${['用户中心需求分析','架构设计 + DB 评审','用户表 / 权限拆分重构','前后端联调 + 用例','灰度数据迁移','上线 + 监控'].map((t, i) => `<div class="px-2 py-1.5 ${i ? 'border-t' : ''} bg-white flex items-center gap-1"><i data-lucide="check-square" class="w-3 h-3 text-green-500"></i>${t} · P${i < 2 ? 0 : 1} · ${[16, 12, 32, 20, 16, 8][i]}h</div>`).join('')}
        </div>
        <div class="mt-2 text-xs text-gray-500">⚡ M2 走通后估时偏差 MAPE &lt; 30%</div>`;
    }
    if (text.includes('风险')) {
      return `<div class="text-sm font-medium">财务对账系统识别到 3 类风险：</div>
        <div class="mt-2 space-y-1.5 text-xs">
          <div class="px-2 py-1.5 rounded border border-red-200 bg-red-50"><i data-lucide="alert-octagon" class="inline w-3 h-3 text-red-500"></i> <strong>P0 · 高</strong> 预付款幂等性未上线，存在重复支付（score 20）<br><span class="text-gray-600">→ 建议 7/8 前完成 idempotency-key</span></div>
          <div class="px-2 py-1.5 rounded border border-orange-200 bg-orange-50"><i data-lucide="alert-triangle" class="inline w-3 h-3 text-orange-500"></i> <strong>P1 · 中</strong> 12 业务线蓝图签字延期（score 9）</div>
          <div class="px-2 py-1.5 rounded border border-yellow-200 bg-yellow-50"><i data-lucide="alert-circle" class="inline w-3 h-3 text-yellow-600"></i> <strong>P2 · 低</strong> 合规口径差异（score 12）</div>
        </div>`;
    }
    if (text.includes('会议纪要') || text.includes('总结')) {
      return `<div class="text-sm font-medium">已抽取关键信息：</div>
        <div class="mt-2 space-y-1.5 text-xs">
          <div><strong>📌 结论：</strong> 财务对账系统 M2 进入快车道。</div>
          <div><strong>✅ Action：</strong> 幂等设计 PR（刘洋，6/30）｜ ERP 兜底（王芳，7/2）</div>
          <div><strong>⚠️ 风险：</strong> ERP 接口幂等性未上线前存在重复支付风险</div>
          <div><strong>❓ 待澄清：</strong> UAT 提前 3 天需 PMO 审批？</div>
        </div>
        <div class="mt-2 flex gap-1.5">
          <button class="px-2 py-1 bg-blue-500 text-white rounded text-xs">转为任务</button>
          <button class="px-2 py-1 border border-gray-300 rounded text-xs">保存到会议</button>
        </div>`;
    }
    if (text.includes('上周') || text.includes('进度')) {
      return `<div class="text-sm">您共负责 <strong>5 个项目</strong>，本周进度汇总：</div>
        <div class="mt-2 space-y-1.5 text-xs">
          <div class="px-2 py-1 rounded bg-green-50"><i data-lucide="check-circle" class="inline w-3 h-3 text-green-500"></i> 财务对账系统 62%（+8%）</div>
          <div class="px-2 py-1 rounded bg-green-50"><i data-lucide="check-circle" class="inline w-3 h-3 text-green-500"></i> SSO 单点登录 45%（+5%）</div>
          <div class="px-2 py-1 rounded bg-red-50"><i data-lucide="alert-octagon" class="inline w-3 h-3 text-red-500"></i> 营销活动平台 35%（<span class="text-red-500">🚩 延期风险</span>）</div>
        </div>
        <div class="mt-2 text-xs text-gray-600">共识别 <strong>1 个红旗项目</strong>，建议优先复盘。</div>`;
    }
    if (text.includes('亮点') || text.includes('周报')) {
      return `<div class="text-sm font-medium">本周公司项目周报（AI 生成）：</div>
        <div class="mt-2 space-y-1.5 text-xs">
          <div>📈 <strong>亮点</strong>：财务对账系统里程碑达成率 +12%；SSO IdP 集群部署完成 60%。</div>
          <div>🚀 <strong>建议</strong>：营销活动平台建议增援 1 名设计；合规审计二期建议提前预定测评机构。</div>
          <div>🛡 <strong>风险</strong>：3 个红旗项目（详见风险登记册）。</div>
        </div>
        <button class="mt-2 px-2 py-1 bg-blue-500 text-white rounded text-xs">导出周报 PDF</button>`;
    }
    return `<div class="text-sm">收到，<strong>${escapeHtml(q)}</strong></div>
      <div class="mt-2 text-xs text-gray-600">我已理解您的意图，正在为您查询项目数据库……</div>
      <div class="mt-2 text-xs text-gray-500">💡 该意图将匹配到 10 类意图分类器（详见文档 §5.7.4）</div>`;
  }

  window.aicomLayout = function (innerHtml) {
    const app = document.getElementById('app');
    if (!app) return;
    if (location.pathname.endsWith('index.html') || location.pathname === '/' || location.pathname.endsWith('/docs/prototype/')) {
      app.innerHTML = innerHtml;
    } else {
      app.innerHTML = `${renderSidebar()}<div class="flex-1 flex flex-col min-w-0 min-h-0"><div class="sticky top-0 z-10 shrink-0">${renderTopbar()}</div><main class="flex-1 overflow-auto min-h-0">${innerHtml}</main></div>${renderAIWorkbench()}`;
    }
    highlightActive();
    bindWB();
    wbRender();
    if (window.lucide) lucide.createIcons();
  };
})();
