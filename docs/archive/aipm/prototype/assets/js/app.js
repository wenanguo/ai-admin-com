/* ============================================================
 * 全局应用行为 —— 顶栏菜单 / Tab 切换 / Chart.js 默认配置
 * ============================================================ */
window.AICOMM = {
  ChartConfig: function () {
    if (typeof Chart === 'undefined') return null;
    Chart.defaults.font.family = 'PingFang SC, Helvetica, Arial, sans-serif';
    Chart.defaults.font.size = 12;
    Chart.defaults.color = '#606266';
    return Chart;
  },
  bindTabs: function (selector) {
    const root = document.querySelector(selector);
    if (!root) return;
    const btns = root.querySelectorAll('[data-tab]');
    const panels = root.querySelectorAll('[data-panel]');
    btns.forEach(b => b.addEventListener('click', () => {
      btns.forEach(x => x.classList.remove('border-blue-500', 'text-blue-600'));
      btns.forEach(x => x.classList.add('border-transparent', 'text-gray-500'));
      b.classList.add('border-blue-500', 'text-blue-600');
      b.classList.remove('border-transparent', 'text-gray-500');
      panels.forEach(p => p.classList.add('hidden'));
      const tgt = root.querySelector(`[data-panel="${b.dataset.tab}"]`);
      if (tgt) tgt.classList.remove('hidden');
    }));
  }
};

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
    e.preventDefault();
    let st = {};
    try { st = JSON.parse(localStorage.getItem('aipm.wb') || '{}'); } catch (err) { st = {}; }
    const next = !(st.collapsed === true);
    st.collapsed = next;
    try { localStorage.setItem('aipm.wb', JSON.stringify(st)); } catch (err) {}
    const el = document.getElementById('ai-workbench');
    const handle = document.getElementById('wb-handle');
    if (el) {
      if (next) { el.classList.add('hidden'); el.classList.remove('w-[400px]'); }
      else { el.classList.remove('hidden'); el.classList.add('w-[400px]'); }
    }
    if (handle) handle.classList.toggle('hidden', !next);
  }
});

document.addEventListener('DOMContentLoaded', () => {
  AICOMM.ChartConfig();
  // 自动为每个 .data-tabs 容器绑定
  document.querySelectorAll('.data-tabs').forEach(el => AICOMM.bindTabs(el));
  // 顶栏菜单高亮
  const path = location.pathname.split('/').pop();
  document.querySelectorAll('header [data-nav], aside [data-nav]').forEach(a => {
    if (a.getAttribute('href') === path) a.classList.add('text-blue-600', 'font-medium');
  });
  // 重绘 lucide
  if (window.lucide) lucide.createIcons();
});
